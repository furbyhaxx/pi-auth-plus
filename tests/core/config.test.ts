import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { fork } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import {
	booleanField,
	enumField,
	numberField,
	SettingsError,
	SettingsStore,
	textRulesField,
} from "../../src/core/config/index.ts";
import { effectiveModelRules } from "../../src/models/rules/settings.ts";

const catalog = {
	"quotas.refreshIntervalSec": numberField({
		label: "Refresh interval",
		description: "Seconds between refreshes",
		default: 60,
		min: 0,
		max: 3600,
	}),
	"quotas.placement": enumField({
		label: "Placement",
		description: "Where the quota line renders",
		default: "below-editor",
		options: [
			{ value: "above-editor", label: "Above editor" },
			{ value: "below-editor", label: "Below editor" },
		],
	}),
	"synthetic.webSearch": booleanField({
		label: "Web search",
		description: "Expose the web search tool",
		default: true,
	}),
	"claude.replacePatterns": textRulesField({
		label: "Prompt rules",
		description: "Literal rules",
		default: [],
	}),
};

let dir: string;
let user: string;
let project: string;

function write(path: string, value: unknown): void {
	writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "config-"));
	user = join(dir, "user.json");
	project = join(dir, "project.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("core/config", () => {
	test("loads groups by scope and rejects an invalid project group list", async () => {
		const groups = [{ id: "models", members: [{ provider: "claude", id: "example" }] }];
		write(user, { models: { groups } });
		write(project, { models: { groups: [{ id: "bad", members: [] }] } });
		const store = new SettingsStore(SETTINGS, { user, project });
		const problems = await store.load();
		expect(problems.map((problem) => problem.key)).toEqual(["models.groups"]);
		expect(store.get("models.groups")).toEqual([
			{
				id: "models",
				strategy: "sticky",
				triggers: ["rate-limit", "quota", "auth"],
				members: [{ provider: "claude", id: "example", tier: 1 }],
			},
		]);
	});

	test("loads validated aliases and rejects a malformed project alias list", async () => {
		const aliases = [{ provider: "claude", source: "source", id: "short", contextWindow: 10000 }];
		write(user, { models: { aliases } });
		write(project, {
			models: { aliases: [...aliases, { provider: "claude", source: "source", id: "short" }] },
		});
		const store = new SettingsStore(SETTINGS, { user, project });
		const problems = await store.load();
		expect(problems.map((problem) => problem.key)).toEqual(["models.aliases"]);
		expect(store.get("models.aliases")).toEqual(aliases);
	});

	test("loads ordered model visibility rules from user settings before a session exists", async () => {
		const rules = ["opencode/*", "!opencode/example", "openrouter/google/**"];
		write(user, { models: { rules } });
		const store = new SettingsStore(SETTINGS, { user });
		expect(await store.load()).toEqual([]);
		expect(store.get("models.rules")).toEqual(rules);
		expect(store.get("models.rulesScope")).toBe("trusted-project");
		expect(store.get("models.hiddenDefault")).toBe("warn");
	});

	test("does not allow trusted project rules when user scope is restricted", async () => {
		write(user, { models: { rules: ["claude/*"], rulesScope: "user" } });
		write(project, { models: { rules: ["synthetic/*"], rulesScope: "trusted-project" } });
		const store = new SettingsStore(SETTINGS, { user, project });
		await store.load();
		expect(effectiveModelRules(store)).toEqual(["claude/*"]);
		await store.save("runtime", { "models.rulesScope": "trusted-project" });
		expect(effectiveModelRules(store)).toEqual(["synthetic/*"]);
	});

	test("runtime > project > user > default, each value reports its source", async () => {
		write(user, { quotas: { refreshIntervalSec: 30, placement: "above-editor" } });
		write(project, { quotas: { refreshIntervalSec: 10 } });
		const store = new SettingsStore(catalog, { user, project });
		expect(await store.load()).toEqual([]);
		await store.save("runtime", { "synthetic.webSearch": false });

		expect(store.values()).toEqual({
			"quotas.refreshIntervalSec": 10,
			"quotas.placement": "above-editor",
			"synthetic.webSearch": false,
			"claude.replacePatterns": [],
		});
		expect(store.sourceOf("quotas.refreshIntervalSec")).toBe("project");
		expect(store.get("quotas.refreshIntervalSec", { includeProject: false })).toBe(30);
		expect(store.sourceOf("quotas.refreshIntervalSec", { includeProject: false })).toBe("user");
		expect(store.sourceOf("quotas.placement")).toBe("user");
		expect(store.sourceOf("synthetic.webSearch")).toBe("runtime");
		expect(store.shadowed("user", ["quotas.refreshIntervalSec", "quotas.placement"])).toEqual([
			"quotas.refreshIntervalSec",
		]);
		await store.save("runtime", { "quotas.refreshIntervalSec": 20 });
		expect(store.get("quotas.refreshIntervalSec", { includeProject: false })).toBe(20);
		expect(store.sourceOf("quotas.refreshIntervalSec", { includeProject: false })).toBe("runtime");
	});

	test("an untrusted project file is never read or written", async () => {
		write(project, { quotas: { refreshIntervalSec: 10 } });
		const store = new SettingsStore(catalog, { user });
		await store.load();
		expect(store.get("quotas.refreshIntervalSec")).toBe(60);
		await expect(store.save("project", { "quotas.refreshIntervalSec": 20 })).rejects.toThrow(
			"project is trusted",
		);
		expect(JSON.parse(readFileSync(project, "utf8"))).toEqual({
			quotas: { refreshIntervalSec: 10 },
		});
	});

	test("save preserves unknown keys and removes a key with null", async () => {
		write(user, { quotas: { refreshIntervalSec: 30, legacyThing: 1 }, other: { keep: true } });
		const store = new SettingsStore(catalog, { user });
		await store.load();
		await store.save("user", {
			"quotas.refreshIntervalSec": null,
			"quotas.placement": "above-editor",
		});

		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual({
			quotas: { legacyThing: 1, placement: "above-editor" },
			other: { keep: true },
		});
		expect(store.sourceOf("quotas.refreshIntervalSec")).toBe("default");
	});

	test("runtime saves stay in memory and file saves create missing parents", async () => {
		const missingUser = join(dir, "nested", "user.json");
		const missingProject = join(dir, "trusted", "project.json");
		const store = new SettingsStore(catalog, { user: missingUser, project: missingProject });
		await store.save("runtime", { "synthetic.webSearch": false });
		expect(store.get("synthetic.webSearch")).toBe(false);
		expect(existsSync(join(dir, "nested"))).toBe(false);
		const other = new SettingsStore(catalog, { user: missingUser });
		await Promise.all([
			store.save("user", { "quotas.refreshIntervalSec": 30 }),
			other.save("user", { "quotas.placement": "above-editor" }),
		]);
		await store.save("project", { "quotas.placement": "above-editor" });
		expect(JSON.parse(readFileSync(missingUser, "utf8"))).toEqual({
			quotas: { refreshIntervalSec: 30, placement: "above-editor" },
		});
		expect(JSON.parse(readFileSync(missingProject, "utf8"))).toEqual({
			quotas: { placement: "above-editor" },
		});
	});

	test("concurrent stores wait for the lock and preserve distinct changes and unknown keys", async () => {
		const initial = { quotas: { legacyThing: 1 }, other: { keep: true } };
		write(user, initial);
		const release = await lockfile.lock(user, { realpath: false, stale: 30_000 });
		const originalLock = lockfile.lock;
		let attempts = 0;
		let signalAttempts = () => {};
		const bothAttempted = new Promise<void>((resolve) => {
			signalAttempts = resolve;
		});
		const lock = spyOn(lockfile, "lock").mockImplementation((path, options) => {
			if (path === user && ++attempts === 2) signalAttempts();
			return originalLock(path, options);
		});
		const first = new SettingsStore(catalog, { user });
		const second = new SettingsStore(catalog, { user });
		const saves = [
			first.save("user", { "quotas.refreshIntervalSec": 30 }),
			second.save("user", { "quotas.placement": "above-editor" }),
		];
		try {
			await Promise.race([bothAttempted, ...saves]);
			expect(attempts).toBeGreaterThanOrEqual(2);
			expect(JSON.parse(readFileSync(user, "utf8"))).toEqual(initial);
			write(user, { ...initial, other: { keep: true, changedWhileLocked: true } });
		} finally {
			lock.mockRestore();
			await release();
			await Promise.all(saves);
		}

		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual({
			quotas: { legacyThing: 1, refreshIntervalSec: 30, placement: "above-editor" },
			other: { keep: true, changedWhileLocked: true },
		});
	});

	test("settings locks serialize saves from independent processes", async () => {
		const initial = { other: { keep: true } };
		write(user, initial);
		const release = await lockfile.lock(user, { realpath: false, stale: 30_000 });
		const worker = join(dir, "session.mjs");
		write(
			worker,
			`
import lockfile from ${JSON.stringify(new URL("../../node_modules/proper-lockfile/index.js", import.meta.url).href)};
import { SETTINGS } from ${JSON.stringify(new URL("../../src/core/config/catalog.ts", import.meta.url).href)};
import { SettingsStore } from ${JSON.stringify(new URL("../../src/core/config/index.ts", import.meta.url).href)};
const originalLock = lockfile.lock;
let reported = false;
lockfile.lock = (...args) => {
	if (!reported) { reported = true; process.send?.("attempt"); }
	return originalLock(...args);
};
process.once("message", async () => {
	try {
		const changes = process.argv[3] === "first"
			? { "quotas.alwaysShortIds": true }
			: { "quotas.refreshOnRequest": false };
		await new SettingsStore(SETTINGS, { user: process.argv[2] }).save("user", changes);
		process.send?.("saved");
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	} finally {
		process.disconnect?.();
	}
});
process.send?.("ready");
`,
		);
		const children = ["first", "second"].map((name) =>
			fork(worker, [user, name], {
				execPath: process.execPath,
				stdio: ["ignore", "ignore", "inherit", "ipc"],
			}),
		);
		let released = false;
		let ready = 0;
		const attempts = new Set<(typeof children)[number]>();
		let signalAttempts = () => {};
		let watchdog: ReturnType<typeof setTimeout> | undefined;
		const bothAttempted = new Promise<void>((resolve, reject) => {
			signalAttempts = resolve;
			watchdog = setTimeout(() => reject(new Error("Sessions did not attempt the lock")), 4_000);
		});
		const exits = children.map(
			(child) =>
				new Promise<void>((resolve, reject) => {
					child.on("error", reject);
					child.on("message", (message: unknown) => {
						if (message === "ready" && ++ready === children.length) {
							for (const session of children) session.send("start");
						} else if (message === "attempt") {
							attempts.add(child);
							if (attempts.size === children.length) signalAttempts();
						} else if (message === "saved" && !released) {
							reject(new Error("A session saved while another process held the lock"));
						}
					});
					child.on("exit", (code) =>
						code === 0 ? resolve() : reject(new Error(`Session exited with ${code}`)),
					);
				}),
		);
		const completed = Promise.all(exits);
		try {
			await Promise.race([bothAttempted, completed]);
			expect(attempts.size).toBe(2);
			expect(JSON.parse(readFileSync(user, "utf8"))).toEqual(initial);
			write(user, { other: { keep: true, changedWhileLocked: true } });
			released = true;
			await release();
			await completed;
		} finally {
			clearTimeout(watchdog);
			if (!released) await release();
			for (const child of children) {
				if (child.exitCode === null && child.signalCode === null) child.kill();
			}
			await Promise.allSettled(exits);
		}
		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual({
			other: { keep: true, changedWhileLocked: true },
			quotas: { alwaysShortIds: true, refreshOnRequest: false },
		});
	});

	test("a lock timeout fails without writing", async () => {
		const initial = { other: { keep: true } };
		write(user, initial);
		const realNow = Date.now;
		let expired = false;
		const clock = spyOn(Date, "now").mockImplementation(() => realNow() + (expired ? 31_000 : 0));
		const lock = spyOn(lockfile, "lock").mockImplementation(async () => {
			expired = true;
			throw Object.assign(new Error("lock is held"), { code: "ELOCKED" });
		});
		let caught: unknown;
		try {
			caught = await new SettingsStore(catalog, { user })
				.save("user", { "quotas.refreshIntervalSec": 30 })
				.catch((error: unknown) => error);
		} finally {
			lock.mockRestore();
			clock.mockRestore();
		}
		expect(caught).toBeInstanceOf(SettingsError);
		expect(String(caught)).toContain(user);
		expect(String(caught)).toContain("retry");
		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual(initial);
	});

	test("a compromised lock fails without writing", async () => {
		const initial = { other: { keep: true } };
		write(user, initial);
		const originalLock = lockfile.lock;
		const lock = spyOn(lockfile, "lock").mockImplementation(async (path, options) => {
			const release = await originalLock(path, options);
			options?.onCompromised?.(new Error("lock was lost"));
			return release;
		});
		let caught: unknown;
		try {
			caught = await new SettingsStore(catalog, { user })
				.save("user", { "quotas.refreshIntervalSec": 30 })
				.catch((error: unknown) => error);
		} finally {
			lock.mockRestore();
		}
		expect(caught).toBeInstanceOf(SettingsError);
		expect(String(caught)).toContain("lock was lost");
		expect(String(caught)).toContain("retry");
		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual(initial);
		expect(existsSync(`${user}.lock`)).toBe(false);
	});

	test("invalid values are reported and inherit; malformed files block saving", async () => {
		write(user, { quotas: { placement: "sideways" } });
		write(project, "{ not json");
		const store = new SettingsStore(catalog, { user, project });
		const problems = await store.load();

		expect(problems.map((p) => [p.path, p.key])).toEqual([
			[user, "quotas.placement"],
			[project, undefined],
		]);
		expect(store.get("quotas.placement")).toBe("below-editor");
		await expect(store.save("project", { "synthetic.webSearch": false })).rejects.toBeInstanceOf(
			SettingsError,
		);
		expect(readFileSync(project, "utf8")).toBe("{ not json");
		expect(existsSync(`${project}.lock`)).toBe(false);
		write(project, { other: { keep: true } });
		await store.save("project", { "synthetic.webSearch": false });
		expect(JSON.parse(readFileSync(project, "utf8"))).toEqual({
			other: { keep: true },
			synthetic: { webSearch: false },
		});
	});

	test("text rules keep match-only and replacement entries; one malformed entry rejects the list", async () => {
		const rules = [{ match: "acme.example/docs" }, { match: "Acme", replacement: "the assistant" }];
		write(user, { claude: { replacePatterns: rules } });
		write(project, { claude: { replacePatterns: [...rules, { match: " " }] } });
		const store = new SettingsStore(catalog, { user, project });
		const problems = await store.load();

		expect(problems.map((p) => [p.path, p.key])).toEqual([[project, "claude.replacePatterns"]]);
		expect(store.get("claude.replacePatterns")).toEqual(rules);
	});
});
