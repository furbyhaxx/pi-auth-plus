import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { channelName, request } from "../../src/core/bus/index.ts";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { SettingsStore } from "../../src/core/config/index.ts";
import { ProviderHttpError } from "../../src/core/http/index.ts";
import { Registry } from "../../src/core/registry/index.ts";
import { type QuotaBusOptions, registerQuotaBus } from "../../src/quotas/bus.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";
import type { ProviderQuotaSnapshot, QuotaResets } from "../../src/quotas/types.ts";

let dir: string;
let clock: number;
let fetchQuota: () => Promise<ProviderQuotaSnapshot>;
const cleanup: (() => void)[] = [];
const snap = (): ProviderQuotaSnapshot => ({
	provider: "claude",
	fetchedAt: clock,
	source: "endpoint",
	windows: [{ id: "5h", label: "Five hours", shortLabel: "5h" }],
});
function setup(options: QuotaBusOptions = {}, resets?: QuotaResets) {
	const settings = new SettingsStore(SETTINGS, { user: join(dir, "settings.json") });
	const registry = new Registry([
		{
			id: "anthropic",
			label: "Anthropic",
			providers: [
				{
					id: "claude",
					label: "Claude",
					aliases: ["cc", "cl"],
					quota: {
						kind: "windows",
						shortLabel: "cl",
						parserVersion: 1,
						fetch: () => fetchQuota(),
						...(resets ? { resets } : {}),
					},
				},
			],
		},
	]);
	const engine = new QuotaEngine({
		registry,
		settings: () => settings,
		cachePath: join(dir, "quotas.json"),
		now: () => clock,
		fetch: async () => {
			throw new Error("Unexpected network");
		},
		authFor: async () => undefined,
	});
	const bus = createEventBus();
	const ready: unknown[] = [];
	const snapshots: unknown[] = [];
	const events: unknown[] = [];
	bus.on(channelName("quotas", "ready"), (raw) => ready.push(raw));
	bus.on(channelName("quotas", "snapshot"), (raw) => snapshots.push(raw));
	bus.on(channelName("quotas", "event"), (raw) => events.push(raw));
	const stop = registerQuotaBus(
		bus,
		engine,
		registry,
		() => settings,
		() => clock,
		options,
	);
	cleanup.push(() => {
		stop();
		engine.stop();
	});
	const ask = (event: string, payload: unknown) =>
		request(bus, "quotas", event, payload, (raw) => raw, { timeoutMs: 20 });
	return { bus, engine, settings, stop, ready, snapshots, events, ask };
}
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "quota-bus-"));
	clock = 1_000_000;
	fetchQuota = async () => snap();
});
afterEach(() => {
	for (const stop of cleanup.splice(0)) stop();
	rmSync(dir, { recursive: true, force: true });
});

describe("quota bus", () => {
	for (const approval of [undefined, false, true]) {
		test(`reset requires interactive approval (${approval}) and consumes exactly once`, async () => {
			let consumed = 0;
			let prompts = 0;
			let fetched = 0;
			const credit = { id: "early", type: "reset", status: "available" };
			const outcome = {
				provider: "claude",
				code: "reset" as const,
				creditId: credit.id,
				windowsReset: 2,
			};
			const resets: QuotaResets = {
				list: async () => ({
					provider: "claude",
					fetchedAt: clock,
					available: 1,
					credits: [credit],
				}),
				consume: async (_ctx, id) => {
					consumed++;
					expect(id).toBe(credit.id);
					return outcome;
				},
			};
			const { ask, events, engine } = setup(
				approval === undefined
					? {}
					: {
							confirmReset: async (id, selected, requester) => {
								prompts++;
								expect([id, selected, requester]).toEqual(["claude", credit, "bus"]);
								return approval;
							},
						},
				resets,
			);
			fetchQuota = async () => {
				fetched++;
				return snap();
			};
			await engine.refresh("claude");
			expect(await ask("resets", { provider: "cc" })).toMatchObject({
				ok: true,
				resets: { available: 1 },
			});
			expect(consumed).toBe(0);
			expect(prompts).toBe(0);
			expect(await ask("reset", { provider: "cc" })).toMatchObject({
				ok: false,
				error: "A reset request needs confirm: true.",
			});
			expect(prompts).toBe(0);
			const reply = await ask("reset", { provider: "cc", confirm: true });
			if (approval === true) {
				expect(reply).toEqual({ v: 1, ok: true, outcome });
				expect(consumed).toBe(1);
				expect(fetched).toBe(2);
				expect(events).toEqual([
					{
						v: 1,
						kind: "reset-consumed",
						provider: "claude",
						code: "reset",
						windowsReset: 2,
						requester: "bus",
					},
				]);
			} else {
				expect(reply).toEqual({
					v: 1,
					ok: false,
					error: "The user did not approve the reset, or no interactive UI is available.",
				});
				expect(consumed).toBe(0);
				expect(fetched).toBe(1);
				expect(events).toEqual([]);
			}
		});
	}

	test("disposal while approval is pending prevents a late spend", async () => {
		const started = Promise.withResolvers<void>();
		const approval = Promise.withResolvers<boolean>();
		let consumed = 0;
		const { ask, stop, events } = setup(
			{
				confirmReset: async () => {
					started.resolve();
					return approval.promise;
				},
			},
			{
				list: async () => ({
					provider: "claude",
					fetchedAt: clock,
					available: 1,
					credits: [{ id: "one", type: "reset", status: "available" }],
				}),
				consume: async () => {
					consumed++;
					throw new Error("Must not consume");
				},
			},
		);
		const pending = ask("reset", { provider: "cc", confirm: true });
		await started.promise;
		stop();
		approval.resolve(true);
		expect(await pending).toBeUndefined();
		expect(consumed).toBe(0);
		expect(events).toEqual([]);
	});

	test("reset channels reject malformed, unsupported, unknown and unavailable requests", async () => {
		const unsupported = setup();
		expect(await unsupported.ask("resets", { provider: "cc" })).toMatchObject({
			ok: false,
			error: expect.stringContaining("no verified"),
		});
		expect(await unsupported.ask("resets", { provider: "missing" })).toMatchObject({
			ok: false,
			error: expect.stringContaining("Known: claude"),
		});
		for (const payload of [
			null,
			{},
			{ provider: 1 },
			{ provider: "" },
			{ provider: "cc", confirm: "yes" },
			{ provider: "cc", creditId: 1 },
		])
			expect(await unsupported.ask("reset", payload)).toBeUndefined();
		let consumed = 0;
		const { ask } = setup(
			{
				confirmReset: async () => {
					throw new Error("Must not prompt");
				},
			},
			{
				list: async () => ({ provider: "claude", fetchedAt: clock, available: 0, credits: [] }),
				consume: async () => {
					consumed++;
					throw new Error("Must not consume");
				},
			},
		);
		expect(await ask("reset", { provider: "cc", confirm: true })).toMatchObject({
			ok: false,
			error: "No reset credit available.",
		});
		expect(await ask("reset", { provider: "cc", confirm: true, creditId: "gone" })).toMatchObject({
			ok: false,
			error: "Reset credit gone is not available.",
		});
		expect(consumed).toBe(0);
	});
	test("announces capabilities once and answers aliases with Pi ids without fetching", async () => {
		const { engine, ask, ready } = setup();
		await engine.cache.put("claude", { snapshot: snap(), drainage: [] });
		const refresh = spyOn(engine, "refresh");
		expect(ready).toEqual([
			{
				v: 1,
				providers: [{ id: "claude", aliases: ["cc", "cl"] }],
				capabilities: ["query", "refresh", "resets", "reset", "snapshot", "event"],
			},
		]);
		expect(await ask("query", { providers: ["cc", "claude"] })).toMatchObject({
			v: 1,
			ok: true,
			report: { providers: [{ id: "claude", title: "Claude", state: "ok" }] },
		});
		expect(refresh).not.toHaveBeenCalled();
	});

	test("rejects unknown and disabled providers explicitly", async () => {
		const { ask, settings } = setup();
		expect(await ask("query", { providers: ["missing"] })).toEqual({
			v: 1,
			ok: false,
			error: 'Unknown provider "missing". Known: claude',
		});
		await settings.save("runtime", { "quotas.providers": ["missing"] });
		expect(await ask("refresh", { providers: ["cc"] })).toMatchObject({
			ok: false,
			error: 'Quota provider "claude" is disabled. Enable it in quotas.providers.',
		});
	});

	test("refreshes stale entries before query replies and honors force", async () => {
		const { ask, engine } = setup();
		await engine.cache.put("claude", { snapshot: snap(), drainage: [] });
		const refresh = spyOn(engine, "refresh");
		expect(await ask("query", { maxAgeSec: 60 })).toMatchObject({ ok: true });
		expect(refresh).not.toHaveBeenCalled();
		clock += 61_000;
		expect(await ask("query", { providers: ["cc"], maxAgeSec: 60 })).toMatchObject({
			ok: true,
			report: { generatedAt: clock, providers: [{ fetchedAt: clock }] },
		});
		expect(refresh).toHaveBeenLastCalledWith("claude", { minAgeMs: 60_000 });
		expect(await ask("refresh", { providers: ["cc"], force: true })).toMatchObject({ ok: true });
		expect(refresh).toHaveBeenLastCalledWith("claude", { force: true, minAgeMs: 0 });
	});

	test("drops malformed payloads", async () => {
		const { ask, engine } = setup();
		const refresh = spyOn(engine, "refresh");
		for (const payload of [
			null,
			[],
			{ providers: "cc" },
			{ providers: [1] },
			{ maxAgeSec: -1 },
			{ maxAgeSec: Number.NaN },
		])
			expect(await ask("query", payload)).toBeUndefined();
		expect(await ask("refresh", { force: "yes" })).toBeUndefined();
		expect(refresh).not.toHaveBeenCalled();
	});

	test("publishes changed rows and emits auth and rate-limit transitions once", async () => {
		const { ask, engine, snapshots, events } = setup();
		await engine.cache.put("claude", {
			snapshot: { ...snap(), needsAuth: true, error: "Login required" },
			drainage: [],
		});
		await engine.cache.put("claude", {
			snapshot: { ...snap(), needsAuth: true, error: "Login required" },
			drainage: [],
		});
		expect(snapshots).toHaveLength(1);
		expect(events).toEqual([
			{ v: 1, kind: "auth-required", provider: "claude", message: "Login required" },
		]);
		await engine.cache.put("claude", { snapshot: snap(), drainage: [] });
		fetchQuota = async () => {
			throw new ProviderHttpError(
				"claude",
				429,
				"https://example.test/quota",
				"Limited",
				undefined,
			);
		};
		await ask("refresh", { force: true });
		await ask("refresh", { force: true });
		expect(
			events.filter(
				(event) =>
					typeof event === "object" &&
					event !== null &&
					"kind" in event &&
					event.kind === "rate-limited",
			),
		).toHaveLength(1);
	});

	test("converts failures to replies and disposal suppresses in-flight replies and pushes", async () => {
		const { ask, engine, stop, snapshots } = setup();
		const refresh = spyOn(engine, "refresh").mockRejectedValueOnce(new Error("Disk unavailable"));
		expect(await ask("refresh", {})).toMatchObject({
			ok: false,
			error: "Quota refresh failed: Disk unavailable. Retry the request.",
		});
		let finish: (() => void) | undefined;
		refresh.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const pending = ask("refresh", {});
		stop();
		finish?.();
		expect(await pending).toBeUndefined();
		await engine.cache.put("claude", { snapshot: snap(), drainage: [] });
		expect(snapshots).toHaveLength(0);
		expect(await ask("query", {})).toBeUndefined();
	});
});
