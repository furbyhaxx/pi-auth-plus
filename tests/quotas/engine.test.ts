import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { SettingsStore } from "../../src/core/config/index.ts";
import { detectConflicts, loadsPackage } from "../../src/core/conflicts/index.ts";
import { ProviderHttpError } from "../../src/core/http/index.ts";
import { type ProviderEntry, Registry } from "../../src/core/registry/index.ts";
import { quotaAuthFor } from "../../src/index.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";
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

	test("a throwing hint falls through and aliases are not provider hints", async () => {
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
		expect(order).toEqual(["fake"]);
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

test("pi-quotas gates the engine without becoming an absorbed-package warning", () => {
	expect(loadsPackage("pi-quotas", ["npm:@furbyhaxx/pi-quotas@1.0.0"], [], [])).toBe(true);
	expect(loadsPackage("pi-quotas", [{ source: "npm:pi-quotas", extensions: [] }], [], [])).toBe(
		false,
	);
	expect(loadsPackage("pi-quotas", [], ["-/tmp/pi-quotas/src/index.ts"], [])).toBe(false);
	expect(loadsPackage("pi-quotas", [], [], ["/tmp/pi-quotas/src/commands/quota.ts"])).toBe(true);
	expect(loadsPackage("pi-quotas", ["npm:pi-quotas-other"], [], [])).toBe(false);
	expect(detectConflicts(["npm:pi-quotas"], [], [])).toEqual([]);
});
