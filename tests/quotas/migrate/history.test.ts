import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "../../../src/core/cache/lock.ts";
import { SETTINGS } from "../../../src/core/config/catalog.ts";
import { SettingsStore } from "../../../src/core/config/index.ts";
import { Registry } from "../../../src/core/registry/index.ts";
import { QuotaEngine } from "../../../src/quotas/engine.ts";
import { migratePiQuotasHistory } from "../../../src/quotas/migrate/history.ts";
import { carryOverPiQuotas } from "../../../src/quotas/migrate/index.ts";

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

test("a cancelled carry-over waiting for the cache lock leaves the shared cache untouched", async () => {
	const originalState = process.env["XDG_STATE_HOME"];
	process.env["XDG_STATE_HOME"] = join(dir, "state");
	const legacyDir = join(dir, "legacy");
	await mkdir(join(legacyDir, "cache"), { recursive: true });
	await writeFile(
		join(legacyDir, "cache", "quotas-cache.json"),
		JSON.stringify({ version: 1, history: [history("codex", Date.now(), 0.2)] }),
	);
	const cachePath = join(dir, "quotas.json");
	await engine().cache.put("xai", { drainage: [] });
	const cacheBytes = await readFile(cachePath);
	const shared = engine();
	const events: string[] = [];
	shared.cache.onChange((key) => events.push(key));
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const held = withFileLock(cachePath, async () => {
		entered.resolve();
		await release.promise;
	});
	await entered.promise;
	const queued = Promise.withResolvers<void>();
	const patch = shared.cache.patch.bind(shared.cache);
	const patchSpy = spyOn(shared.cache, "patch").mockImplementation((...args) => {
		queued.resolve();
		return patch(...args);
	});
	const controller = new AbortController();
	const options = {
		settings: new SettingsStore(SETTINGS, { user: join(dir, "settings.json") }),
		registry,
		engine: shared,
		cwd: dir,
		projectTrusted: false,
		dir: legacyDir,
	};
	try {
		const pending = carryOverPiQuotas({ ...options, signal: controller.signal });
		await queued.promise;
		const marker = join(dir, "state", "pi-auth-plus", "migrations.json");
		const markerBytes = await readFile(marker);
		controller.abort();
		release.resolve();
		await held;
		await pending;
		patchSpy.mockRestore();

		expect(events).toEqual([]);
		expect([...shared.cache.all()]).toEqual([]);
		expect(await readFile(cachePath)).toEqual(cacheBytes);
		expect(await readFile(marker)).toEqual(markerBytes);
		await carryOverPiQuotas({ ...options, signal: new AbortController().signal });
		expect(shared.cache.get("codex")?.value.drainage[0]?.samples[0]?.value).toBe(0.2);
		expect(JSON.parse(await readFile(marker, "utf8"))["pi-quotas-history"]).toBeString();
	} finally {
		release.resolve();
		await held;
		patchSpy.mockRestore();
		if (originalState === undefined) delete process.env["XDG_STATE_HOME"];
		else process.env["XDG_STATE_HOME"] = originalState;
	}
});

test("cancellation while the migration lock is held leaves the marker retryable", async () => {
	const cache = engine().cache;
	const sourcePath = join(dir, "legacy.json");
	const markerPath = join(dir, "migrations.json");
	await writeFile(
		sourcePath,
		JSON.stringify({ version: 1, history: [history("codex", clock, 0.2)] }),
	);
	await writeFile(markerPath, JSON.stringify({ other: "preserved" }));
	const before = await readFile(markerPath);
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const held = withFileLock(markerPath, async () => {
		entered.resolve();
		await release.promise;
	});
	await entered.promise;
	const controller = new AbortController();
	const options = { cache, registry, sourcePath, markerPath, now: () => clock };
	try {
		const pending = migratePiQuotasHistory({ ...options, signal: controller.signal });
		controller.abort();
		release.resolve();
		await held;
		expect(await pending).toMatchObject({ finished: false, changedProviders: [] });
		expect(cache.all().size).toBe(0);
		expect(await Bun.file(join(dir, "quotas.json")).exists()).toBe(false);
		expect(await readFile(markerPath)).toEqual(before);
		expect(await migratePiQuotasHistory(options)).toMatchObject({
			finished: true,
			changedProviders: ["codex"],
		});
		expect(JSON.parse(await readFile(markerPath, "utf8"))["other"]).toBe("preserved");
	} finally {
		release.resolve();
		await held;
	}
});

test("cancellation during marker publication leaves no finished marker or temporary file", async () => {
	const cache = engine().cache;
	const markerPath = join(dir, "migrations.json");
	const controller = new AbortController();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const options = { cache, registry, sourcePath: join(dir, "missing.json"), markerPath };
	const open = fs.open;
	const openSpy = spyOn(fs, "open").mockImplementation(async (path, flags, mode) => {
		const handle = await open(path, flags, mode);
		if (typeof path === "string" && path.startsWith(join(dir, ".migrations.json."))) {
			entered.resolve();
			await release.promise;
		}
		return handle;
	});
	try {
		const pending = migratePiQuotasHistory({ ...options, signal: controller.signal });
		await entered.promise;
		controller.abort();
		release.resolve();
		expect(await pending).toMatchObject({ finished: false });
		expect(await Bun.file(markerPath).exists()).toBe(false);
		expect((await fs.readdir(dir)).filter((name) => name.startsWith(".migrations.json."))).toEqual(
			[],
		);
	} finally {
		release.resolve();
		openSpy.mockRestore();
	}
	expect(await migratePiQuotasHistory(options)).toMatchObject({ finished: true });
	expect(JSON.parse(await readFile(markerPath, "utf8"))["pi-quotas-history"]).toBeString();
});

test("cancellation after a committed provider leaves it intact and lets the rest retry", async () => {
	const shared = engine();
	await shared.cache.put("codex", {
		drainage: [{ kind: "window", id: "primary", samples: [{ at: clock - 2000, value: 0.5 }] }],
	});
	const sourcePath = join(dir, "legacy.json");
	await writeFile(
		sourcePath,
		JSON.stringify({
			version: 1,
			history: [
				history("codex", clock - 3000, 0.1),
				history("codex", clock - 1000, 0.4),
				history("xai", clock - 1000, 0.3),
			],
		}),
	);
	const markerPath = join(dir, "migrations.json");
	const controller = new AbortController();
	const stop = shared.cache.onChange(() => controller.abort());
	const options = { cache: shared.cache, registry, sourcePath, markerPath, now: () => clock };
	const report = await migratePiQuotasHistory({ ...options, signal: controller.signal });
	stop();
	expect(report.finished).toBe(false);
	const partial = JSON.parse(await readFile(markerPath, "utf8"));
	expect(partial["pi-quotas-history"]).toBeUndefined();
	expect(partial["pi-quotas-history:provider:codex"]).toBeString();
	expect(shared.cache.get("codex")?.value.drainage[0]?.samples).toEqual([
		{ at: clock - 1000, value: 0.4, resetAtMs: undefined },
	]);
	expect(shared.cache.get("xai")).toBeUndefined();
	const next = engine();
	await next.cache.sync();
	await migratePiQuotasHistory({ ...options, cache: next.cache });
	expect(next.cache.get("codex")?.value.drainage[0]?.samples).toEqual([
		{ at: clock - 1000, value: 0.4, resetAtMs: undefined },
	]);
	expect(next.cache.get("xai")?.value.drainage[0]?.samples[0]?.value).toBe(0.3);
	const finished = JSON.parse(await readFile(markerPath, "utf8"));
	expect(finished["pi-quotas-history"]).toBeString();
	expect(finished["pi-quotas-history:provider:codex"]).toBeUndefined();
	expect(finished["pi-quotas-history:provider:xai"]).toBeUndefined();
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
