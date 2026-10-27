import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
	listQuotaResets,
	QUOTA_CHANNELS,
	QuotaBusError,
	queryQuotas,
	refreshQuotas,
	requestQuotaReset,
	subscribeQuotaEvent,
	subscribeQuotaReady,
	subscribeQuotaSnapshot,
} from "@furbyhaxx/pi-auth-plus/bus";
import { serve } from "../../src/core/bus/index.ts";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { SettingsStore } from "../../src/core/config/index.ts";
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
	return { bus, engine };
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

describe("quota bus client", () => {
	test("queries aliases and refreshes through the real service", async () => {
		const { bus, engine } = setup();
		await engine.cache.put("claude", { snapshot: snap(), drainage: [] });
		expect((await queryQuotas(bus, { providers: ["cc"] })).providers[0]?.id).toBe("claude");
		expect(
			(await refreshQuotas(bus, { providers: ["cc"], force: true })).providers[0]?.fetchedAt,
		).toBe(clock);
		await expect(queryQuotas(bus, { providers: ["missing"] })).rejects.toMatchObject({
			reason: "rejected",
		});
	});
	test("lists credits and refuses spending without UI approval", async () => {
		let spent = 0;
		const { bus } = setup(
			{},
			{
				list: async () => ({
					provider: "claude",
					fetchedAt: clock,
					available: 1,
					credits: [{ id: "one", type: "reset", status: "available" }],
				}),
				consume: async () => {
					spent++;
					throw new Error("Must not spend");
				},
			},
		);
		expect((await listQuotaResets(bus, "cc")).available).toBe(1);
		await expect(requestQuotaReset(bus, { provider: "cc", confirm: true })).rejects.toMatchObject({
			reason: "rejected",
		});
		expect(spent).toBe(0);
	});
	test("decodes an approved reset outcome", async () => {
		const outcome = {
			provider: "claude",
			creditId: "one",
			code: "reset" as const,
			windowsReset: 2,
		};
		const { bus } = setup(
			{ confirmReset: async () => true },
			{
				list: async () => ({
					provider: "claude",
					fetchedAt: clock,
					available: 1,
					credits: [{ id: "one", type: "reset", status: "available" }],
				}),
				consume: async () => outcome,
			},
		);
		expect(await requestQuotaReset(bus, { provider: "cc", confirm: true })).toEqual(outcome);
	});
	test("times out an unanswered request", async () => {
		await expect(queryQuotas(createEventBus(), {}, { timeoutMs: 1 })).rejects.toMatchObject({
			name: "QuotaBusError",
			reason: "timeout",
		});
	});
	test("aborts before emission and while waiting", async () => {
		const bus = createEventBus();
		let emitted = 0;
		bus.on(QUOTA_CHANNELS.query, () => emitted++);
		const controller = new AbortController();
		controller.abort();
		await expect(queryQuotas(bus, {}, { signal: controller.signal })).rejects.toBeInstanceOf(
			QuotaBusError,
		);
		expect(emitted).toBe(0);
		const pendingController = new AbortController();
		const pending = queryQuotas(bus, {}, { signal: pendingController.signal });
		pendingController.abort();
		await expect(pending).rejects.toMatchObject({ reason: "aborted" });
	});
	test("drops malformed nested replies rather than exposing them", async () => {
		for (const report of [
			{ v: 2, generatedAt: clock, providers: [] },
			{ v: 1, generatedAt: clock, providers: [{ id: "claude" }] },
			{
				v: 1,
				generatedAt: clock,
				providers: [
					{
						id: "claude",
						title: "Claude",
						short: "cl",
						state: "ok",
						windows: [{ id: "5h", label: "Five", shortLabel: "5h", usedFraction: "bad" }],
					},
				],
			},
		]) {
			const bus = createEventBus();
			const off = serve(
				bus,
				"quotas",
				"query",
				() => ({}),
				() => ({ v: 1, ok: true, report }),
			);
			await expect(queryQuotas(bus, {}, { timeoutMs: 1 })).rejects.toMatchObject({
				reason: "timeout",
			});
			off();
		}
	});
	test("drops malformed credit listings and reset verdicts", async () => {
		for (const [event, value] of [
			[
				"resets",
				{
					provider: "claude",
					fetchedAt: clock,
					available: 1,
					credits: [{ id: "one", type: "reset", status: "available", expiresAtMs: "later" }],
				},
			],
			["reset", { provider: "claude", creditId: "one", code: "unknown", windowsReset: 1 }],
		] as const) {
			const bus = createEventBus();
			const off = serve(
				bus,
				"quotas",
				event,
				() => ({}),
				() => ({ v: 1, ok: true, [event === "reset" ? "outcome" : "resets"]: value }),
			);
			const pending =
				event === "reset"
					? requestQuotaReset(bus, { provider: "cc", confirm: true }, { timeoutMs: 1 })
					: listQuotaResets(bus, "cc", { timeoutMs: 1 });
			await expect(pending).rejects.toMatchObject({ reason: "timeout" });
			off();
		}
	});
	test("subscriptions validate broadcasts and unsubscribe", () => {
		const bus = createEventBus();
		const ready: unknown[] = [],
			snapshot: unknown[] = [],
			events: unknown[] = [];
		const stops = [
			subscribeQuotaReady(bus, (value) => ready.push(value)),
			subscribeQuotaSnapshot(bus, (value) => snapshot.push(value)),
			subscribeQuotaEvent(bus, (value) => events.push(value)),
		];
		const announcement = {
			v: 1,
			providers: [{ id: "claude", aliases: ["cc"] }],
			capabilities: ["query"],
		};
		bus.emit(QUOTA_CHANNELS.ready, announcement);
		bus.emit(QUOTA_CHANNELS.ready, { ...announcement, providers: [{ id: 3 }] });
		bus.emit(QUOTA_CHANNELS.snapshot, {
			v: 1,
			provider: { id: "claude", title: "Claude", short: "cl", state: "unknown", windows: [] },
		});
		bus.emit(QUOTA_CHANNELS.event, { v: 1, kind: "rate-limited", provider: "claude", status: 429 });
		bus.emit(QUOTA_CHANNELS.event, {
			v: 1,
			kind: "rate-limited",
			provider: "claude",
			status: "429",
		});
		expect([ready.length, snapshot.length, events.length]).toEqual([1, 1, 1]);
		for (const stop of stops) stop();
		bus.emit(QUOTA_CHANNELS.ready, announcement);
		expect(ready).toHaveLength(1);
	});
});
