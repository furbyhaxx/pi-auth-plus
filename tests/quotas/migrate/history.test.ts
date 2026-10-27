import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETTINGS } from "../../../src/core/config/catalog.ts";
import { SettingsStore } from "../../../src/core/config/index.ts";
import { Registry } from "../../../src/core/registry/index.ts";
import { QuotaEngine } from "../../../src/quotas/engine.ts";
import { migratePiQuotasHistory } from "../../../src/quotas/migrate/history.ts";

let dir: string;
let clock: number;
let calls: string[];
const engines: QuotaEngine[] = [];
const registry = new Registry([
	{
		id: "test",
		label: "Test",
		providers: [
			{ id: "codex", aliases: ["openai", "openai-codex"] },
			{ id: "xai", aliases: ["grok"] },
		].map((provider) => ({
			...provider,
			label: provider.id,
			quota: {
				kind: "windows",
				shortLabel: provider.id,
				parserVersion: 1,
				fetch: async () => {
					calls.push(provider.id);
					return { provider: provider.id, fetchedAt: clock, source: "endpoint", windows: [] };
				},
			},
		})),
	},
]);

function engine() {
	const settings = new SettingsStore(SETTINGS, { user: join(dir, "settings.json") });
	const result = new QuotaEngine({
		registry,
		cachePath: join(dir, "quotas.json"),
		settings: () => settings,
		now: () => clock,
		fetch: async () => {
			throw new Error("Unexpected network call");
		},
		authFor: async () => undefined,
	});
	engines.push(result);
	return result;
}

function history(provider: string, at: number, value: number) {
	return { provider, kind: "window", id: "primary", samples: [{ at, value }] };
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "quota-history-"));
	clock = 1_800_000_000_000;
	calls = [];
});

afterEach(async () => {
	for (const item of engines.splice(0)) item.stop();
	await rm(dir, { recursive: true, force: true });
});

test("merges aliases under the lock, preserves state and is byte-identical on repeat", async () => {
	const first = engine();
	const concurrent = engine();
	await first.cache.sync();
	await concurrent.cache.put("codex", {
		snapshot: { provider: "codex", fetchedAt: clock, source: "endpoint", windows: [] },
		drainage: [{ kind: "window", id: "primary", samples: [{ at: clock - 1000, value: 0.4 }] }],
	});
	const before = concurrent.cache.get("codex");
	const sourcePath = join(dir, "legacy.json");
	await writeFile(
		sourcePath,
		JSON.stringify({
			version: 1,
			history: [
				history("codex", clock - 2000, 0.2),
				history("grok", clock - 1000, 0.3),
				history("unknown", clock, 0.5),
			],
			snapshots: [{ provider: "xai", fetchedAt: clock }],
			inFlightUntil: { xai: clock + 60_000 },
			backoffUntil: { xai: clock + 60_000 },
		}),
	);
	clock += 100;
	const options = {
		cache: first.cache,
		registry,
		sourcePath,
		now: () => clock,
		markerPath: join(dir, "migrations.json"),
	};
	const report = await migratePiQuotasHistory(options);
	expect(report).toEqual({
		finished: true,
		unknownProviders: ["unknown"],
		changedProviders: ["codex", "xai"],
	});
	const entry = first.cache.get("codex");
	expect(entry?.value.drainage[0]?.samples.map((s) => s.value)).toEqual([0.2, 0.4]);
	expect(entry?.value.snapshot).toEqual(before?.value.snapshot);
	expect(entry?.fetchedAt).toBe(before?.fetchedAt);
	const bytes = await readFile(join(dir, "quotas.json"));
	clock += 100;
	expect((await migratePiQuotasHistory(options)).changedProviders).toEqual([]);
	expect(await readFile(join(dir, "quotas.json"))).toEqual(bytes);

	const restarted = engine();
	await restarted.cache.sync();
	expect(restarted.cache.get("xai")?.value.drainage[0]?.samples).toHaveLength(1);
	expect(restarted.cache.get("xai")?.fetchedAt).toBe(0);
	expect(restarted.view().find((v) => v.provider.id === "xai")).toMatchObject({
		snapshot: undefined,
		fetchedAt: undefined,
	});
	await restarted.start();
	await restarted.refresh("xai");
	expect(calls).toEqual(["xai"]);
});

test("concurrent migrations do not resurrect history discarded by a reversal", async () => {
	const first = engine();
	await first.cache.put("codex", {
		drainage: [{ kind: "window", id: "primary", samples: [{ at: clock - 2000, value: 0.5 }] }],
	});
	const sourcePath = join(dir, "legacy.json");
	await writeFile(
		sourcePath,
		JSON.stringify({
			version: 1,
			history: [history("codex", clock - 3000, 0.1), history("codex", clock - 1000, 0.4)],
		}),
	);
	const options = {
		registry,
		sourcePath,
		now: () => clock,
		markerPath: join(dir, "migrations.json"),
	};
	const reports = await Promise.all([
		migratePiQuotasHistory({ ...options, cache: first.cache }),
		migratePiQuotasHistory({ ...options, cache: engine().cache }),
	]);
	expect(reports.flatMap((report) => report.changedProviders)).toEqual(["codex"]);
	await first.cache.sync(true);
	expect(first.cache.get("codex")?.value.drainage[0]?.samples).toEqual([
		{ at: clock - 1000, value: 0.4, resetAtMs: undefined },
	]);
	const bytes = await readFile(join(dir, "quotas.json"));
	await migratePiQuotasHistory({ ...options, cache: engine().cache });
	expect(await readFile(join(dir, "quotas.json"))).toEqual(bytes);
});

test("runOnce finishes missing sources, retries malformed sources, and records success", async () => {
	const cache = engine().cache;
	const sourcePath = join(dir, "legacy.json");
	const marker = join(dir, "migrations.json");
	const migrate = () =>
		migratePiQuotasHistory({
			cache,
			registry,
			sourcePath,
			now: () => clock,
			markerPath: marker,
		});
	await writeFile(sourcePath, "{");
	expect(await migrate()).toMatchObject({
		finished: false,
		error: expect.stringContaining(sourcePath),
	});
	await writeFile(
		sourcePath,
		JSON.stringify({ version: 1, history: [history("codex", clock, 0.2), { provider: "codex" }] }),
	);
	expect(await migrate()).toMatchObject({
		finished: false,
		error: expect.stringContaining(sourcePath),
	});
	expect(cache.all().size).toBe(0);
	await writeFile(
		sourcePath,
		JSON.stringify({ version: 1, history: [history("codex", clock, 0.2)] }),
	);
	expect(await migrate()).toMatchObject({ finished: true, changedProviders: ["codex"] });
	const bytes = await readFile(join(dir, "quotas.json"));
	clock += 100;
	expect(await migrate()).toMatchObject({ finished: true, changedProviders: [] });
	expect(await readFile(join(dir, "quotas.json"))).toEqual(bytes);
	await rm(sourcePath);
	expect(
		await migratePiQuotasHistory({
			cache,
			registry,
			sourcePath,
			markerPath: join(dir, "missing-marker.json"),
		}),
	).toEqual({ finished: true, unknownProviders: [], changedProviders: [] });
});
