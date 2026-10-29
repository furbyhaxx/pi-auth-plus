import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "../../src/core/cache/lock.ts";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { SettingsStore } from "../../src/core/config/index.ts";
import { detectConflicts, loadsPackage } from "../../src/core/conflicts/index.ts";
import { ProviderHttpError } from "../../src/core/http/index.ts";
import { type ProviderEntry, Registry } from "../../src/core/registry/index.ts";
import { syntheticQuota } from "../../src/families/synthetic/quota.ts";
import { quotaAuthFor } from "../../src/quotas/auth.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";
import { engineReport } from "../../src/quotas/report.ts";
import { enabledQuotaProviders } from "../../src/quotas/settings.ts";
import { parseQuotaState } from "../../src/quotas/state.ts";
import type {
	ProviderQuotaSnapshot,
	QuotaFetchContext,
	QuotaResets,
	QuotaSource,
	ResetOutcome,
} from "../../src/quotas/types.ts";

let dir: string;
let path: string;
let clock: number;
let calls: number;
let minPollMs: number;
let fetchQuota: (ctx: QuotaFetchContext) => Promise<ProviderQuotaSnapshot>;
const engines: QuotaEngine[] = [];

function snapshot(): ProviderQuotaSnapshot {
	return {
		provider: "fake",
		fetchedAt: clock,
		source: "endpoint",
		windows: [{ id: "5h", shortLabel: "5h", label: "Five hours", usedFraction: 0.25 }],
	};
}

function setup(
	headers?: QuotaSource["headers"],
	others: ProviderEntry[] = [],
	resets?: QuotaResets,
	backgroundNetwork?: boolean,
) {
	const settings = new SettingsStore(SETTINGS, { user: join(dir, "settings.json") });
	const registry = new Registry([
		{
			id: "fake",
			label: "Fake",
			providers: [
				{
					id: "fake",
					label: "Fake",
					aliases: ["alias"],
					quota: {
						kind: "windows",
						shortLabel: "f",
						parserVersion: 1,
						minPollMs,
						...(resets ? { resets } : {}),
						...(headers ? { headers } : {}),
						fetch: async (ctx) => {
							calls++;
							return fetchQuota(ctx);
						},
					},
				},
				{ id: "no-quota", label: "No quota", aliases: [] },
				...others,
			],
		},
	]);
	const engine = new QuotaEngine({
		registry,
		cachePath: path,
		settings: () => settings,
		now: () => clock,
		fetch: async () => {
			throw new Error("Unexpected network call");
		},
		authFor: async () => ({ token: "test-token", extra: { account: "test" } }),
		...(backgroundNetwork === undefined ? {} : { backgroundNetwork }),
	});
	engines.push(engine);
	return { engine, settings, registry };
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "quota-engine-"));
	path = join(dir, "quotas.json");
	clock = 1_000_000;
	calls = 0;
	minPollMs = 0;
	fetchQuota = async () => snapshot();
});

afterEach(() => {
	for (const engine of engines.splice(0)) engine.stop();
	rmSync(dir, { recursive: true, force: true });
});

describe("quota engine", () => {
	for (const code of [
		"reset",
		"nothing_to_reset",
		"no_credit",
		"already_redeemed",
		"throw",
	] as const) {
		test(`reset ${code} consumes once and force-refreshes after an in-flight refresh`, async () => {
			let consumed = 0;
			const seen: ResetOutcome[] = [];
			const outcome: ResetOutcome = {
				provider: "fake",
				code: code === "throw" ? "reset" : code,
				creditId: "one",
				windowsReset: 1,
			};
			const { engine } = setup(undefined, [], {
				list: async (ctx) => {
					expect(await ctx.auth()).toEqual({ token: "test-token", extra: { account: "test" } });
					return { provider: "fake", fetchedAt: ctx.now(), available: 1, credits: [] };
				},
				consume: async (ctx, creditId) => {
					consumed++;
					expect(ctx.signal.aborted).toBe(false);
					expect(creditId).toBe("one");
					if (code === "throw") throw new Error("Consume uncertain");
					return outcome;
				},
			});
			expect(engine.resetSupport("fake")).toBe(true);
			expect(await engine.listResets("fake")).toMatchObject({ available: 1 });
			const off = engine.onResetConsumed((result, requester) => {
				expect(requester).toBe("panel");
				seen.push(result);
			});
			const started = Promise.withResolvers<void>();
			const finish = Promise.withResolvers<ProviderQuotaSnapshot>();
			fetchQuota = async () => {
				started.resolve();
				return finish.promise;
			};
			const refreshing = engine.refresh("fake");
			await started.promise;
			const pending = engine.consumeReset("fake", "one", "panel");
			fetchQuota = async () => snapshot();
			finish.resolve(snapshot());
			await refreshing;
			if (code === "throw") await expect(pending).rejects.toThrow("Consume uncertain");
			else expect(await pending).toEqual(outcome);
			expect(consumed).toBe(1);
			expect(calls).toBe(2);
			expect(seen).toEqual(code === "reset" ? [outcome] : []);
			off();
		});
	}

	test("refresh storage failures cannot hide the consume verdict or original error", async () => {
		let failConsume = false;
		const outcome: ResetOutcome = {
			provider: "fake",
			code: "reset",
			creditId: "one",
			windowsReset: 1,
		};
		const { engine } = setup(undefined, [], {
			list: async () => ({ provider: "fake", fetchedAt: clock, available: 1, credits: [] }),
			consume: async () => {
				if (failConsume) throw new Error("Consume uncertain");
				return outcome;
			},
		});
		const refresh = spyOn(engine, "refresh").mockRejectedValue(new Error("Cache unavailable"));
		expect(await engine.consumeReset("fake", "one")).toEqual(outcome);
		failConsume = true;
		await expect(engine.consumeReset("fake", "one")).rejects.toThrow("Consume uncertain");
		expect(refresh).toHaveBeenCalledTimes(2);
		refresh.mockRestore();
	});

	test("reset operations reject unknown, disabled, unsupported and stopped providers", async () => {
		const { engine, settings } = setup();
		expect(engine.resetSupport("missing")).toBe(false);
		expect(engine.resetSupport("fake")).toBe(false);
		await expect(engine.listResets("missing")).rejects.toThrow('Unknown provider "missing"');
		await expect(engine.consumeReset("fake", "one")).rejects.toThrow(
			"no verified on-demand reset endpoint",
		);
		await settings.save("runtime", { "quotas.providers": ["missing"] });
		await expect(engine.listResets("fake")).rejects.toThrow("disabled");
		engine.stop();
		await expect(engine.listResets("fake")).rejects.toThrow("stopped");
		await expect(engine.consumeReset("fake", "one")).rejects.toThrow("stopped");
	});

	test("headers overlay shared endpoint state without refreshing endpoint freshness", async () => {
		fetchQuota = async () => ({
			...snapshot(),
			windows: [
				...snapshot().windows,
				{ id: "7d", label: "Week", shortLabel: "7d", usedFraction: 0.4 },
			],
		});
		const a = setup((headers, now) =>
			headers["x-used"]
				? {
						...snapshot(),
						source: "headers",
						fetchedAt: now,
						windows: [{ id: "5h", label: "Header", shortLabel: "h", usedFraction: 0.5 }],
					}
				: undefined,
		).engine;
		await a.tick();
		const fetchedAt = clock;
		clock += 1_000;
		expect(await a.ingestHeaders({ "X-Used": "50" })).toBe("fake");
		expect(a.view()[0]?.snapshot?.windows).toEqual([
			{ id: "5h", label: "Five hours", shortLabel: "5h", usedFraction: 0.5 },
			{ id: "7d", label: "Week", shortLabel: "7d", usedFraction: 0.4 },
		]);
		expect(a.cache.get("fake")?.fetchedAt).toBe(fetchedAt);
		expect(a.cache.get("fake")?.value.drainage[0]?.samples).toHaveLength(2);
		const b = setup().engine;
		await b.cache.sync();
		expect(b.view()[0]?.snapshot).toEqual(a.view()[0]?.snapshot);
		expect(b.view()[0]?.fetchedAt).toBe(fetchedAt);
		clock += 1_000;
		await b.refresh("fake", { force: true });
		expect(b.view()[0]?.snapshot?.windows[0]?.usedFraction).toBe(0.25);
		await a.cache.sync();
		expect(a.view()[0]?.snapshot?.windows[0]?.usedFraction).toBe(0.25);
	});

	test("hinted enabled claimant runs first and headers-only entries remain stale", async () => {
		const order: string[] = [];
		const claimant = (id: string): QuotaSource => ({
			kind: "windows",
			shortLabel: id,
			parserVersion: 1,
			fetch: async () => snapshot(),
			headers: (_headers, now) => {
				order.push(id);
				return { ...snapshot(), provider: id, source: "headers", fetchedAt: now };
			},
		});
		const { engine, settings } = setup(claimant("fake").headers, [
			{ id: "other", label: "Other", aliases: ["other-alias"], quota: claimant("other") },
		]);
		expect(await engine.ingestHeaders({}, "other")).toBe("other");
		expect(order).toEqual(["other"]);
		expect(engine.cache.get("other")?.fetchedAt).toBe(0);
		expect(engine.view()[1]?.snapshot?.source).toBe("headers");
		const b = setup(undefined, [
			{ id: "other", label: "Other", aliases: [], quota: claimant("other") },
		]).engine;
		await b.cache.sync();
		expect(b.view()[1]?.snapshot?.source).toBe("headers");
		expect(await b.cache.tryAcquire("other", { minAgeMs: 60_000 })).toBe(true);
		await settings.save("runtime", { "quotas.providers": ["fake"] });
		expect(await engine.ingestHeaders({}, "other")).toBe("fake");
		expect(order).toEqual(["other", "fake"]);
	});

	test("physical attribution never assigns headers to another provider", async () => {
		const order: string[] = [];
		const { engine } = setup(() => {
			order.push("fake");
			return { ...snapshot(), source: "headers" };
		}, [
			{
				id: "other",
				label: "Other",
				aliases: [],
				quota: {
					kind: "windows",
					shortLabel: "o",
					parserVersion: 1,
					fetch: async () => snapshot(),
					headers: () => {
						order.push("other");
						return undefined;
					},
				},
			},
		]);
		expect(await engine.ingestHeaders({}, "other", { strict: true })).toBeUndefined();
		expect(order).toEqual(["other"]);
		order.length = 0;
		expect(
			await engine.ingestHeaders({}, "not-a-quota-provider", { strict: true }),
		).toBeUndefined();
		expect(order).toEqual([]);
	});

	test("a throwing hint falls through for both canonical ids and aliases", async () => {
		const order: string[] = [];
		const { engine } = setup(() => {
			order.push("fake");
			return { ...snapshot(), source: "headers" };
		}, [
			{
				id: "other",
				label: "Other",
				aliases: ["other-alias"],
				quota: {
					kind: "windows",
					shortLabel: "o",
					parserVersion: 1,
					fetch: async () => snapshot(),
					headers: () => {
						order.push("other");
						throw new Error("Malformed headers");
					},
				},
			},
		]);
		expect(await engine.ingestHeaders({}, "other")).toBe("fake");
		expect(order).toEqual(["other", "fake"]);
		order.length = 0;
		expect(await engine.ingestHeaders({}, "other-alias")).toBe("fake");
		expect(order).toEqual(["other", "fake"]);
	});

	test("unclaimed, malformed and stopped ingests do not write", async () => {
		const engine = setup(() => {
			throw new Error("Malformed headers");
		}).engine;
		expect(await engine.ingestHeaders({})).toBeUndefined();
		expect(existsSync(path)).toBe(false);
		const unclaimed = setup(() => undefined).engine;
		expect(await unclaimed.ingestHeaders({})).toBeUndefined();
		expect(existsSync(path)).toBe(false);
		const stopped = setup(() => ({ ...snapshot(), source: "headers" })).engine;
		stopped.stop();
		expect(await stopped.ingestHeaders({})).toBeUndefined();
		expect(existsSync(path)).toBe(false);
	});

	test("offline startup and repeated ticks sync shared reports without automatic fetches", async () => {
		const writer = setup().engine;
		const cached = snapshot();
		await writer.cache.put("fake", { snapshot: cached, drainage: [] });
		utimesSync(path, new Date(0), new Date(1_000));
		clock += 120_000;

		const { engine, settings } = setup(undefined, [], undefined, false);
		await engine.start();
		expect(engine.view()[0]?.snapshot).toEqual(cached);
		expect(engineReport(engine, settings, clock).providers[0]?.windows[0]?.usedPercent).toBe(25);
		await engine.tick();
		await engine.tick();
		expect(calls).toBe(0);

		const updated = {
			...snapshot(),
			windows: cached.windows.map((window) => ({ ...window, usedFraction: 0.5 })),
		};
		await writer.cache.put("fake", { snapshot: updated, drainage: [] });
		utimesSync(path, new Date(0), new Date(2_000));
		await engine.tick();
		expect(engine.view()[0]?.snapshot).toEqual(updated);
		expect(calls).toBe(0);

		await engine.refresh("fake", { force: true });
		expect(calls).toBe(1);
		expect(engine.view()[0]?.snapshot).toEqual(snapshot());
		clock += 120_000;
		await engine.tick();
		await engine.start();
		await engine.tick();
		expect(calls).toBe(1);
	});

	test("sessions share snapshots and fetch only once per interval", async () => {
		const a = setup().engine;
		const b = setup().engine;
		await Promise.all([a.tick(), b.tick()]);
		expect(calls).toBe(1);
		await b.tick();
		expect(b.view()[0]?.snapshot).toEqual(snapshot());
		expect(b.view()[0]?.fetchedAt).toBe(clock);
		clock += 59_999;
		await Promise.all([a.tick(), b.tick()]);
		expect(calls).toBe(1);
		clock++;
		await a.tick();
		await b.tick();
		expect(calls).toBe(2);
		expect(b.view()[0]?.snapshot?.fetchedAt).toBe(clock);
	});

	test("403 backs off across sessions and force cannot bypass it", async () => {
		fetchQuota = async () => {
			throw new ProviderHttpError("fake", 403, "https://fake.test/quota", "limited", undefined);
		};
		const a = setup().engine;
		await a.tick();
		expect(a.view()[0]?.backoff?.until).toBe(clock + 60_000);
		const b = setup().engine;
		await b.refresh("fake", { force: true });
		expect(calls).toBe(1);
		await b.tick();
		expect(calls).toBe(1);
		clock += 60_000;
		fetchQuota = async () => snapshot();
		await b.tick();
		expect(calls).toBe(2);
		expect(b.view()[0]?.backoff).toBeUndefined();
		expect(b.view()[0]?.snapshot).toEqual(snapshot());
	});

	test("idle ticks do not rewrite the shared file", async () => {
		const engine = setup().engine;
		await engine.tick();
		utimesSync(path, new Date(0), new Date(1_000));
		const mtime = statSync(path).mtimeMs;
		clock += 5_000;
		await engine.tick();
		expect(statSync(path).mtimeMs).toBe(mtime);
		expect(calls).toBe(1);
	});

	test("request refreshes respect the source floor and endpoint success drops headers", async () => {
		minPollMs = 120_000;
		const engine = setup().engine;
		await engine.tick();
		clock += 3_000;
		await engine.cache.patch("fake", (current) => ({
			...current,
			drainage: current?.drainage ?? [],
			headers: { snapshot: { ...snapshot(), source: "headers" }, observedAt: clock },
		}));
		await engine.refresh("fake", { minAgeMs: 2_000 });
		expect(calls).toBe(1);
		clock += 117_000;
		await engine.tick();
		expect(calls).toBe(2);
		expect(engine.cache.get("fake")?.value.headers).toBeUndefined();
		expect(engine.cache.get("fake")?.value.drainage[0]?.samples).toHaveLength(2);
	});

	test("headers observed while an endpoint fetch is in flight survive its write", async () => {
		const { engine } = setup();
		const deferred = Promise.withResolvers<ProviderQuotaSnapshot>();
		const started = Promise.withResolvers<void>();
		fetchQuota = async () => {
			const taken = snapshot();
			started.resolve();
			return deferred.promise.then(() => taken);
		};
		const pending = engine.refresh("fake");
		await started.promise;
		clock += 1_000;
		const observed = { ...snapshot(), source: "headers" as const };
		await engine.cache.patch("fake", (current) => ({
			drainage: current?.drainage ?? [],
			headers: { snapshot: observed, observedAt: clock },
		}));
		deferred.resolve(snapshot());
		await pending;
		expect(engine.cache.get("fake")?.value.headers?.observedAt).toBe(clock);
		expect(engine.cache.get("fake")?.value.snapshot?.source).toBe("endpoint");
	});

	test("deduplicates in flight and discards a late result after stop", async () => {
		const { engine } = setup();
		const deferred = Promise.withResolvers<ProviderQuotaSnapshot>();
		let signal: AbortSignal | undefined;
		const started = Promise.withResolvers<void>();
		fetchQuota = async (ctx) => {
			signal = ctx.signal;
			expect(await ctx.auth()).toEqual({ token: "test-token", extra: { account: "test" } });
			started.resolve();
			return deferred.promise;
		};
		const pending = engine.refresh("fake");
		expect(engine.refresh("fake")).toBe(pending);
		await started.promise;
		expect(engine.view()[0]?.refreshing).toBe(true);
		engine.stop();
		expect(signal?.aborted).toBe(true);
		deferred.resolve(snapshot());
		await pending;
		expect(engine.view()[0]?.snapshot).toBeUndefined();
		expect(engine.view()[0]?.refreshing).toBe(false);
	});

	for (const phase of ["acquire", "snapshot", "failure", "headers"] as const) {
		test(`stopping while ${phase} is queued leaves no late cache change or event`, async () => {
			const engine = setup(() => ({ ...snapshot(), source: "headers" })).engine;
			const started = Promise.withResolvers<void>();
			const result = Promise.withResolvers<ProviderQuotaSnapshot>();
			let pending: Promise<unknown>;
			if (phase === "snapshot" || phase === "failure") {
				fetchQuota = async () => {
					started.resolve();
					return result.promise;
				};
				pending = engine.refresh("fake");
				await started.promise;
			} else {
				pending = Promise.resolve();
			}
			await setup().engine.cache.put("other", { drainage: [] });
			utimesSync(path, new Date(0), new Date(1_000));
			const before = readFileSync(path, "utf8");
			const mtime = statSync(path).mtimeMs;
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const held = withFileLock(path, async () => {
				entered.resolve();
				await release.promise;
			});
			await entered.promise;
			let events = 0;
			engine.onChange(() => events++);
			const queued = Promise.withResolvers<void>();
			const putWith = engine.cache.putWith.bind(engine.cache);
			const fail = engine.cache.fail.bind(engine.cache);
			const putSpy = spyOn(engine.cache, "putWith").mockImplementation((...args) => {
				queued.resolve();
				return putWith(...args);
			});
			const failSpy = spyOn(engine.cache, "fail").mockImplementation((...args) => {
				queued.resolve();
				return fail(...args);
			});
			if (phase === "acquire") pending = engine.refresh("fake");
			if (phase === "headers") pending = engine.ingestHeaders({ "x-used": "50" });
			if (phase === "snapshot") result.resolve(snapshot());
			if (phase === "failure") result.reject(new Error("failed"));
			if (phase === "snapshot" || phase === "failure") await queued.promise;
			engine.stop();
			const eventsAtStop = events;
			release.resolve();
			await held;
			await pending;
			putSpy.mockRestore();
			failSpy.mockRestore();

			expect(events).toBe(eventsAtStop);
			expect(engine.view()[0]?.snapshot).toBeUndefined();
			expect(engine.view()[0]?.backoff).toBeUndefined();
			expect(engine.cache.get("other")).toBeUndefined();
			expect(readFileSync(path, "utf8")).toBe(before);
			expect(statSync(path).mtimeMs).toBe(mtime);

			fetchQuota = async () => snapshot();
			await engine.start();
			await engine.refresh("fake");
			await engine.refresh("fake", { force: true });
			expect(engine.view()[0]?.snapshot).toEqual(snapshot());
		});
	}

	test("a restarted session survives an older snapshot waiting inside the lock", async () => {
		const engine = setup().engine;
		const started = Promise.withResolvers<void>();
		const result = Promise.withResolvers<ProviderQuotaSnapshot>();
		fetchQuota = async () => {
			started.resolve();
			return result.promise;
		};
		const pending = engine.refresh("fake");
		await started.promise;
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const sync = engine.cache.sync.bind(engine.cache);
		const syncSpy = spyOn(engine.cache, "sync").mockImplementation(async (...args) => {
			if (args[0]) {
				entered.resolve();
				await release.promise;
			}
			return sync(...args);
		});
		let events = 0;
		engine.onChange(() => events++);
		result.resolve(snapshot());
		await entered.promise;
		engine.stop();
		clock += 30_001;
		const nextStarted = Promise.withResolvers<void>();
		const nextResult = Promise.withResolvers<ProviderQuotaSnapshot>();
		fetchQuota = async () => {
			nextStarted.resolve();
			return nextResult.promise;
		};
		await engine.start();
		const next = engine.refresh("fake");
		const eventsAtRestart = events;
		release.resolve();
		await pending;
		await nextStarted.promise;
		expect(events).toBe(eventsAtRestart);
		expect(engine.view()[0]?.refreshing).toBe(true);
		expect(engine.view()[0]?.snapshot).toBeUndefined();
		expect(engine.view()[0]?.backoff).toBeUndefined();
		expect(readFileSync(path, "utf8")).not.toContain('"snapshot"');
		nextResult.resolve(snapshot());
		await next;
		syncSpy.mockRestore();
		expect(engine.view()[0]?.snapshot).toEqual(snapshot());
	});

	for (const method of ["start", "tick"] as const) {
		test(`${method} discards synchronization finishing after stop`, async () => {
			await setup().engine.cache.put("other", { drainage: [] });
			const engine = setup().engine;
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const sync = engine.cache.sync.bind(engine.cache);
			const syncSpy = spyOn(engine.cache, "sync").mockImplementation(async (...args) => {
				entered.resolve();
				await release.promise;
				return sync(...args);
			});
			let events = 0;
			engine.onChange(() => events++);
			const pending = engine[method]();
			await entered.promise;
			engine.stop();
			const eventsAtStop = events;
			release.resolve();
			await pending;
			syncSpy.mockRestore();
			expect(events).toBe(eventsAtStop);
			expect(engine.cache.get("other")).toBeUndefined();
			expect(calls).toBe(0);
			await engine.start();
			expect(engine.cache.get("other")).toBeDefined();
			await engine.refresh("fake");
		});
	}

	test("offline restart retains one timer when an older startup sync finishes late", async () => {
		const cached = snapshot();
		await setup().engine.cache.put("fake", { snapshot: cached, drainage: [] });
		const engine = setup(undefined, [], undefined, false).engine;
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const sync = engine.cache.sync.bind(engine.cache);
		let first = true;
		const syncSpy = spyOn(engine.cache, "sync").mockImplementation(async (...args) => {
			if (first) {
				first = false;
				entered.resolve();
				await release.promise;
			}
			return sync(...args);
		});
		const timer = spyOn(globalThis, "setInterval");
		try {
			const previous = engine.start();
			await entered.promise;
			engine.stop();
			await engine.start();
			expect(timer).toHaveBeenCalledTimes(1);
			expect(engine.view()[0]?.snapshot).toEqual(cached);
			release.resolve();
			await previous;
			expect(timer).toHaveBeenCalledTimes(1);
			await engine.tick();
			expect(calls).toBe(0);
		} finally {
			release.resolve();
			syncSpy.mockRestore();
			timer.mockRestore();
		}
	});

	test("a stopped startup refresh does not report a late storage error", async () => {
		const engine = setup().engine;
		const entered = Promise.withResolvers<void>();
		const failure = Promise.withResolvers<boolean>();
		const acquire = spyOn(engine.cache, "tryAcquire").mockImplementation(() => {
			entered.resolve();
			return failure.promise;
		});
		let events = 0;
		engine.onChange(() => events++);
		await engine.start();
		await entered.promise;
		const pending = engine.refresh("fake");
		engine.stop();
		const eventsAtStop = events;
		failure.reject(new Error("Cache unavailable"));
		await expect(pending).rejects.toThrow("Cache unavailable");
		expect(events).toBe(eventsAtStop);
		acquire.mockRestore();
	});

	test("a reset notification stops when its session is stopped", async () => {
		const outcome: ResetOutcome = {
			provider: "fake",
			code: "reset",
			creditId: "one",
			windowsReset: 1,
		};
		const engine = setup(undefined, [], {
			list: async () => ({ provider: "fake", fetchedAt: clock, available: 1, credits: [] }),
			consume: async () => outcome,
		}).engine;
		const events: string[] = [];
		engine.onResetConsumed(() => {
			events.push("first");
			engine.stop();
		});
		engine.onResetConsumed(() => events.push("second"));
		expect(await engine.consumeReset("fake", "one")).toEqual(outcome);
		expect(events).toEqual(["first"]);
		expect(calls).toBe(0);
	});

	test("a stopped reset's failed follow-up does not emit a late event", async () => {
		const outcome: ResetOutcome = {
			provider: "fake",
			code: "reset",
			creditId: "one",
			windowsReset: 1,
		};
		const engine = setup(undefined, [], {
			list: async () => ({ provider: "fake", fetchedAt: clock, available: 1, credits: [] }),
			consume: async () => outcome,
		}).engine;
		const started = Promise.withResolvers<void>();
		const failed = Promise.withResolvers<void>();
		const refresh = spyOn(engine, "refresh").mockImplementation(() => {
			started.resolve();
			return failed.promise;
		});
		let events = 0;
		engine.onChange(() => events++);
		const pending = engine.consumeReset("fake", "one");
		await started.promise;
		engine.stop();
		const eventsAtStop = events;
		failed.reject(new Error("Cache unavailable"));
		expect(await pending).toEqual(outcome);
		expect(events).toBe(eventsAtStop);
		refresh.mockRestore();
	});

	test("ordinary errors use 30 seconds; forced refresh can recover", async () => {
		fetchQuota = async () => {
			throw new Error("failed");
		};
		const engine = setup().engine;
		await engine.tick();
		expect(engine.view()[0]?.backoff).toEqual({ until: clock + 30_000, error: "failed" });
		fetchQuota = async () => snapshot();
		await engine.refresh("fake", { force: true });
		expect(calls).toBe(2);
	});
});

test("provider settings resolve aliases, deduplicate and never broaden unknown selections", async () => {
	const { settings, registry } = setup();
	expect(enabledQuotaProviders(registry, settings).map((p) => p.id)).toEqual(["fake"]);
	await settings.save("runtime", { "quotas.providers": ["alias", "FAKE", "no-quota", "unknown"] });
	expect(enabledQuotaProviders(registry, settings).map((p) => p.id)).toEqual(["fake"]);
	await settings.save("runtime", { "quotas.providers": ["unknown"] });
	expect(enabledQuotaProviders(registry, settings)).toEqual([]);
});

test("cache parsing drops malformed fields without turning unknown into zero", () => {
	const parsed = parseQuotaState(
		{
			snapshot: {
				...snapshot(),
				credits: { currency: "$", remaining: "unknown", total: 0, used: Number.NaN },
				windows: [{ id: "x", label: "X", shortLabel: "x", usedFraction: "unknown" }, null],
				resetCredits: Number.POSITIVE_INFINITY,
			},
			headers: { snapshot: { ...snapshot(), source: "headers" }, observedAt: clock },
			drainage: [null],
		},
		clock,
	);
	expect(parsed.snapshot?.credits?.remaining).toBeUndefined();
	expect(parsed.snapshot?.credits?.total).toBe(0);
	expect(parsed.snapshot?.credits?.used).toBeUndefined();
	expect(parsed.snapshot?.windows).toHaveLength(1);
	expect(parsed.snapshot?.windows[0]?.usedFraction).toBeUndefined();
	expect(parsed.snapshot?.resetCredits).toBeUndefined();
	expect(parsed.headers?.observedAt).toBe(clock);
	expect(parsed.drainage).toEqual([]);
	expect(parseQuotaState(null)).toEqual({ drainage: [] });
	expect(
		parseQuotaState({
			snapshot: { ...snapshot(), fetchedAt: "bad" },
			headers: { observedAt: "bad" },
		}).snapshot,
	).toBeUndefined();
});

test("a source's own auth resolver replaces the lookup by provider id", async () => {
	const seen: unknown[] = [];
	const { engine } = setup(undefined, [
		{
			id: "borrowed",
			label: "Borrowed",
			aliases: [],
			quota: {
				kind: "windows",
				shortLabel: "b",
				parserVersion: 1,
				auth: async (lookup) => {
					const other = await lookup("pi-provider");
					return other && { token: `via-${other.token}`, extra: {} };
				},
				fetch: async (ctx) => {
					seen.push(await ctx.auth());
					return { ...snapshot(), provider: "borrowed" };
				},
			},
		},
	]);
	await engine.start();
	seen.length = 0;
	await engine.refresh("borrowed", { force: true });
	expect(seen).toEqual([{ token: "via-test-token", extra: {} }]);
});

function missingEnvironmentError(provider: string, plural = false): Error {
	return Object.assign(
		new Error("API key auth failed", {
			cause: new Error(
				`Failed to resolve API key for provider "${provider}" from environment variable${plural ? "s" : ""}: KEY`,
			),
		}),
		{ name: "ModelsError", code: "auth" },
	);
}

test("missing environment credentials reach Synthetic as a login-required snapshot", async () => {
	for (const plural of [false, true]) {
		const registry = {
			getProviderAuth: async (id: string) => {
				expect(id).toBe("synthetic");
				throw missingEnvironmentError(id, plural);
			},
		};
		expect(await quotaAuthFor("synthetic", registry)).toBeUndefined();
		const result = await syntheticQuota.fetch({
			auth: () => quotaAuthFor("synthetic", registry),
			fetch: async () => {
				throw new Error("Unexpected network call");
			},
			signal: new AbortController().signal,
			now: () => clock,
		});
		expect(result).toMatchObject({ provider: "synthetic", needsAuth: true, windows: [] });
		expect(result.error).toContain("/login synthetic");
	}
	expect(
		await quotaAuthFor("test.provider", {
			getProviderAuth: async () => {
				throw missingEnvironmentError("test.provider");
			},
		}),
	).toBeUndefined();
});

test("quota auth propagates unrelated failures and errors for other providers", async () => {
	const network = new Error("network unavailable");
	const refresh = Object.assign(new Error("OAuth refresh failed", { cause: network }), {
		name: "ModelsError",
		code: "auth",
	});
	const wrongCode = Object.assign(missingEnvironmentError("synthetic"), { code: "network" });
	const wrongName = Object.assign(missingEnvironmentError("synthetic"), { name: "OtherError" });
	const stringCause = Object.assign(
		new Error("API key auth failed", {
			cause: 'Failed to resolve API key for provider "synthetic" from environment variable: KEY',
		}),
		{ name: "ModelsError", code: "auth" },
	);
	for (const error of [
		network,
		refresh,
		missingEnvironmentError("other"),
		wrongCode,
		wrongName,
		stringCause,
	]) {
		await expect(
			quotaAuthFor("synthetic", {
				getProviderAuth: async () => {
					throw error;
				},
			}),
		).rejects.toBe(error);
	}
	await expect(
		quotaAuthFor("test.provider", {
			getProviderAuth: async () => {
				throw missingEnvironmentError("testXprovider");
			},
		}),
	).rejects.toThrow("API key auth failed");
});

test("quota auth supports header-only bearers and prefers Pi's API key", async () => {
	expect(
		await quotaAuthFor("fake", {
			getProviderAuth: async () => ({ auth: { headers: { aUtHoRiZaTiOn: "Bearer test-token" } } }),
		}),
	).toEqual({ token: "test-token", extra: {} });
	expect(
		await quotaAuthFor("fake", {
			getProviderAuth: async () => ({
				auth: { apiKey: "test-key", headers: { Authorization: "Bearer ignored" } },
			}),
		}),
	).toEqual({ token: "test-key", extra: {} });
	expect(
		await quotaAuthFor("fake", {
			getProviderAuth: async () => ({ auth: { headers: { Authorization: null } } }),
		}),
	).toBeUndefined();
	expect(await quotaAuthFor("fake", undefined)).toBeUndefined();
});

test("pi-quotas gates the engine and is an absorbed package", () => {
	expect(loadsPackage("pi-quotas", ["npm:@furbyhaxx/pi-quotas@1.0.0"], [], [])).toBe(true);
	expect(loadsPackage("pi-quotas", [{ source: "npm:pi-quotas", extensions: [] }], [], [])).toBe(
		false,
	);
	expect(loadsPackage("pi-quotas", [], ["-/tmp/pi-quotas/src/index.ts"], [])).toBe(false);
	expect(loadsPackage("pi-quotas", [], [], ["/tmp/pi-quotas/src/commands/quota.ts"])).toBe(true);
	expect(loadsPackage("pi-quotas", ["npm:pi-quotas-other"], [], [])).toBe(false);
	expect(detectConflicts(["npm:pi-quotas"], [], []).map((conflict) => conflict.name)).toEqual([
		"pi-quotas",
	]);
});
