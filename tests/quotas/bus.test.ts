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
import { registerQuotaBus } from "../../src/quotas/bus.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";
import type { ProviderQuotaSnapshot } from "../../src/quotas/types.ts";

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
function setup() {
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
					quota: { kind: "windows", shortLabel: "cl", parserVersion: 1, fetch: () => fetchQuota() },
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
	test("announces capabilities once and answers aliases with Pi ids without fetching", async () => {
		const { engine, ask, ready } = setup();
		await engine.cache.put("claude", { snapshot: snap(), drainage: [] });
		const refresh = spyOn(engine, "refresh");
		expect(ready).toEqual([
			{
				v: 1,
				providers: [{ id: "claude", aliases: ["cc", "cl"] }],
				capabilities: ["query", "refresh", "snapshot", "event"],
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
