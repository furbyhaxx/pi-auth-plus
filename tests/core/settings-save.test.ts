import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { type SaveScope, SettingsStore } from "../../src/core/config/index.ts";
import {
	createSettingsSaver,
	formatSaveOutcome,
	type SettingsChanges,
} from "../../src/core/config/save.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "settings-save-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("settings saver", () => {
	test("captures queued owners and deep drafts at invocation and awaits effects in order", async () => {
		const oldStore = new SettingsStore(SETTINGS, { user: join(dir, "old.json") });
		const newStore = new SettingsStore(SETTINGS, { user: join(dir, "new.json") });
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const events: string[] = [];
		const oldController = new AbortController();
		let current = {
			store: oldStore,
			signal: oldController.signal,
			apply: async (keys: readonly string[], scope: SaveScope) => {
				events.push(`old:${scope}:${keys.join(",")}`);
				if (keys.includes("quotas.refreshOnRequest")) {
					started.resolve();
					await release.promise;
				}
				return [];
			},
		};
		const save = createSettingsSaver(() => current);
		const first = save("runtime", { "quotas.refreshOnRequest": false });
		await started.promise;
		const member = {
			provider: "claude",
			id: "original",
			tier: 1,
			thinking: { low: "medium" as const },
		};
		const group = {
			id: "group",
			strategy: "sticky" as const,
			triggers: ["auth" as const],
			members: [member],
		};
		const draft = { "models.groups": [group] } satisfies SettingsChanges;
		const second = save("runtime", draft);
		current = {
			store: newStore,
			signal: new AbortController().signal,
			apply: async (keys, scope) => {
				events.push(`new:${scope}:${keys.join(",")}`);
				return [];
			},
		};
		const third = save("runtime", { "synthetic.webSearch": true });
		member.id = "changed";
		group.members.push({
			provider: "synthetic",
			id: "extra",
			tier: 1,
			thinking: { low: "medium" },
		});
		Object.assign(draft, { "synthetic.webSearch": true });
		try {
			expect(oldStore.get("models.groups")).toEqual([]);
			expect(newStore.get("synthetic.webSearch")).toBe(false);
			expect(events).toEqual(["old:runtime:quotas.refreshOnRequest"]);
		} finally {
			release.resolve();
		}
		const outcomes = await Promise.all([first, second, third]);
		expect(outcomes.map((outcome) => outcome.committed)).toEqual([true, true, true]);
		expect(oldStore.get("models.groups")).toEqual([
			{
				id: "group",
				strategy: "sticky",
				triggers: ["auth"],
				members: [{ provider: "claude", id: "original", tier: 1, thinking: { low: "medium" } }],
			},
		]);
		expect(oldStore.get("synthetic.webSearch")).toBe(false);
		expect(newStore.get("models.groups")).toEqual([]);
		expect(newStore.get("synthetic.webSearch")).toBe(true);
		expect(events).toEqual([
			"old:runtime:quotas.refreshOnRequest",
			"old:runtime:models.groups",
			"new:runtime:synthetic.webSearch",
		]);
	});

	test("cancels an old queued save rather than writing to its replacement", async () => {
		const oldStore = new SettingsStore(SETTINGS, { user: join(dir, "old.json") });
		const newStore = new SettingsStore(SETTINGS, { user: join(dir, "new.json") });
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const events: string[] = [];
		const controller = new AbortController();
		let current = {
			store: oldStore,
			signal: controller.signal,
			apply: async (keys: readonly string[]) => {
				events.push(`old:${keys.join(",")}`);
				started.resolve();
				await release.promise;
				return [];
			},
		};
		const save = createSettingsSaver(() => current);
		const first = save("runtime", { "quotas.refreshOnRequest": false });
		await started.promise;
		const queued = save("runtime", { "synthetic.webSearch": true });
		controller.abort();
		current = {
			store: newStore,
			signal: new AbortController().signal,
			apply: async (keys) => {
				events.push(`new:${keys.join(",")}`);
				return [];
			},
		};
		const replacement = save("runtime", { "quotas.alwaysShortIds": true });
		release.resolve();
		const [firstOutcome, queuedOutcome, replacementOutcome] = await Promise.all([
			first,
			queued,
			replacement,
		]);
		expect(firstOutcome.committed).toBe(true);
		if (!firstOutcome.committed) throw new Error("Expected the first save to commit");
		expect(firstOutcome.warnings.join(" ")).toContain("Session ended");
		expect(queuedOutcome).toMatchObject({
			committed: false,
			error: expect.stringMatching(/cancel/i),
		});
		expect(replacementOutcome.committed).toBe(true);
		expect(oldStore.get("synthetic.webSearch")).toBe(false);
		expect(newStore.get("synthetic.webSearch")).toBe(false);
		expect(newStore.get("quotas.alwaysShortIds")).toBe(true);
		expect(events).toEqual(["old:quotas.refreshOnRequest", "new:quotas.alwaysShortIds"]);
	});

	test("keeps a persisted save committed and skips effects after session shutdown", async () => {
		const path = join(dir, "old.json");
		const oldStore = new SettingsStore(SETTINGS, { user: path });
		const newStore = new SettingsStore(SETTINGS, { user: join(dir, "new.json") });
		await oldStore.save("runtime", { "synthetic.webSearch": false });
		const originalSave = oldStore.save.bind(oldStore);
		const persisted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const saveSpy = spyOn(oldStore, "save").mockImplementation(async (scope, changes) => {
			const result = await originalSave(scope, changes);
			persisted.resolve();
			await release.promise;
			return result;
		});
		const oldApply = spyOn(
			{ apply: async (_keys: readonly string[], _scope: SaveScope) => [] },
			"apply",
		);
		const newApply = spyOn(
			{ apply: async (_keys: readonly string[], _scope: SaveScope) => [] },
			"apply",
		);
		const controller = new AbortController();
		let current = { store: oldStore, signal: controller.signal, apply: oldApply };
		const save = createSettingsSaver(() => current);
		const pending = save("user", { "synthetic.webSearch": true });
		await persisted.promise;
		controller.abort();
		current = { store: newStore, signal: new AbortController().signal, apply: newApply };
		release.resolve();
		const outcome = await pending;
		saveSpy.mockRestore();
		expect(outcome).toMatchObject({
			committed: true,
			scope: "user",
			shadowed: ["synthetic.webSearch"],
			warnings: [expect.stringMatching(/session|cancel/i)],
		});
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ synthetic: { webSearch: true } });
		expect(oldApply).not.toHaveBeenCalled();
		expect(newApply).not.toHaveBeenCalled();
		expect(newStore.get("synthetic.webSearch")).toBe(false);
	});

	test("commits and applies effects when lock release fails, then processes the next save", async () => {
		const path = join(dir, "user.json");
		const store = new SettingsStore(SETTINGS, { user: path });
		const originalLock = lockfile.lock;
		let lockCount = 0;
		const lock = spyOn(lockfile, "lock").mockImplementation(async (target, options) => {
			const release = await originalLock(target, options);
			if (++lockCount !== 1) return release;
			return async () => {
				await release();
				throw new Error("release failed");
			};
		});
		const events: Array<[readonly string[], SaveScope]> = [];
		const observed: Array<{ disk: unknown; enabled: boolean }> = [];
		const save = createSettingsSaver(() => ({
			store,
			signal: new AbortController().signal,
			apply: async (keys, scope) => {
				events.push([keys, scope]);
				if (keys.includes("synthetic.webSearch")) {
					observed.push({
						disk: JSON.parse(readFileSync(path, "utf8")),
						enabled: store.get("synthetic.webSearch"),
					});
					return ["effect warning"];
				}
				return [];
			},
		}));
		try {
			const first = save("user", { "synthetic.webSearch": true });
			const second = save("user", { "quotas.alwaysShortIds": true });
			const [outcome, subsequent] = await Promise.all([first, second]);
			expect(outcome.committed).toBe(true);
			if (!outcome.committed) throw new Error("Expected the first save to commit");
			expect(outcome.warnings).toHaveLength(2);
			expect(outcome.warnings[0]).toContain("release failed");
			expect(outcome.warnings[0]).toContain(path);
			expect(outcome.warnings[0]).toMatch(/check|retry/i);
			expect(outcome.warnings[1]).toBe("effect warning");
			expect(formatSaveOutcome(outcome)).toContain("release failed");
			expect(subsequent).toEqual({ committed: true, scope: "user", shadowed: [], warnings: [] });
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
				synthetic: { webSearch: true },
				quotas: { alwaysShortIds: true },
			});
			expect(store.get("synthetic.webSearch")).toBe(true);
			expect(observed).toEqual([{ disk: { synthetic: { webSearch: true } }, enabled: true }]);
			expect(events).toEqual([
				[["synthetic.webSearch"], "user"],
				[["quotas.alwaysShortIds"], "user"],
			]);
		} finally {
			lock.mockRestore();
		}
	});

	test("reports effect failure as committed and continues processing later saves", async () => {
		const path = join(dir, "user.json");
		const store = new SettingsStore(SETTINGS, { user: path });
		let attempts = 0;
		const save = createSettingsSaver(() => ({
			store,
			signal: new AbortController().signal,
			apply: async () => {
				if (++attempts === 1) throw new Error("refresh failed");
				return [];
			},
		}));
		const first = save("user", { "synthetic.webSearch": true });
		const second = save("runtime", { "quotas.alwaysShortIds": true });
		const [failedEffect, subsequent] = await Promise.all([first, second]);
		expect(failedEffect).toMatchObject({
			committed: true,
			scope: "user",
			warnings: [expect.stringContaining("refresh failed")],
		});
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ synthetic: { webSearch: true } });
		expect(subsequent).toEqual({ committed: true, scope: "runtime", shadowed: [], warnings: [] });
		expect(attempts).toBe(2);
	});

	test("reports a failed persistence without effects and continues the queue", async () => {
		const path = join(dir, "malformed.json");
		writeFileSync(path, "{not json");
		const store = new SettingsStore(SETTINGS, { user: path });
		const events: string[] = [];
		const save = createSettingsSaver(() => ({
			store,
			signal: new AbortController().signal,
			apply: async (keys) => {
				events.push(keys.join(","));
				return [];
			},
		}));
		const first = save("user", { "synthetic.webSearch": true });
		const second = save("runtime", { "quotas.alwaysShortIds": true });
		const [failed, subsequent] = await Promise.all([first, second]);
		expect(failed.committed).toBe(false);
		if (failed.committed) throw new Error("Expected persistence to fail");
		expect(failed.error).toContain("valid JSON");
		expect(formatSaveOutcome(failed)).toBe(failed.error);
		expect(readFileSync(path, "utf8")).toBe("{not json");
		expect(subsequent.committed).toBe(true);
		expect(events).toEqual(["quotas.alwaysShortIds"]);
	});

	test("reports shadowing and includes every effect warning in the shared message", async () => {
		const store = new SettingsStore(SETTINGS, { user: join(dir, "user.json") });
		await store.save("runtime", { "synthetic.webSearch": false });
		const save = createSettingsSaver(() => ({
			store,
			signal: new AbortController().signal,
			apply: async () => ["first warning", "second warning"],
		}));
		const outcome = await save("user", { "synthetic.webSearch": true });
		expect(outcome).toEqual({
			committed: true,
			scope: "user",
			shadowed: ["synthetic.webSearch"],
			warnings: ["first warning", "second warning"],
		});
		const message = formatSaveOutcome(outcome);
		expect(message).toContain("user");
		expect(message).toContain("shadowed");
		expect(message).toContain("synthetic.webSearch");
		expect(message).toContain("first warning");
		expect(message).toContain("second warning");
		expect(store.get("synthetic.webSearch")).toBe(false);
	});

	test("supports null removal and passes changed keys to effects", async () => {
		const path = join(dir, "user.json");
		const store = new SettingsStore(SETTINGS, { user: path });
		await store.save("user", { "synthetic.webSearch": true });
		const events: Array<[readonly string[], SaveScope]> = [];
		const save = createSettingsSaver(() => ({
			store,
			signal: new AbortController().signal,
			apply: async (keys, scope) => {
				events.push([keys, scope]);
				return [];
			},
		}));
		const outcome = await save("user", { "synthetic.webSearch": null });
		expect(outcome).toEqual({ committed: true, scope: "user", shadowed: [], warnings: [] });
		expect(formatSaveOutcome(outcome)).toContain("user");
		expect(store.get("synthetic.webSearch")).toBe(false);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({});
		expect(events).toEqual([[["synthetic.webSearch"], "user"]]);
	});

	test("does not save or apply for an already aborted owner", async () => {
		const store = new SettingsStore(SETTINGS, { user: join(dir, "user.json") });
		const saveSpy = spyOn(store, "save");
		const apply = spyOn({ run: async () => [] }, "run");
		const controller = new AbortController();
		controller.abort();
		const save = createSettingsSaver(() => ({ store, signal: controller.signal, apply }));
		const outcome = await save("runtime", { "synthetic.webSearch": true });
		expect(outcome).toMatchObject({ committed: false, error: expect.stringMatching(/cancel/i) });
		expect(saveSpy).not.toHaveBeenCalled();
		expect(apply).not.toHaveBeenCalled();
		saveSpy.mockRestore();
	});
});
