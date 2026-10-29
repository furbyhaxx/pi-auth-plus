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
		const problems = await store.load();
		expect(problems.map((problem) => [problem.path, problem.key])).toEqual([
			[project, "models.rulesScope"],
		]);
		expect(store.get("models.rulesScope")).toBe("user");
		expect(store.sourceOf("models.rulesScope")).toBe("user");
		expect(effectiveModelRules(store)).toEqual(["claude/*"]);
		await store.save("runtime", { "models.rulesScope": "trusted-project" });
		expect(store.get("models.rulesScope")).toBe("trusted-project");
		expect(store.sourceOf("models.rulesScope")).toBe("runtime");
		expect(store.shadowed("user", ["models.rulesScope"])).toEqual(["models.rulesScope"]);
		expect(store.shadowed("project", ["models.rulesScope"])).toEqual([]);
		expect(effectiveModelRules(store)).toEqual(["synthetic/*"]);
	});

	test("project cannot change the effective scope shown for model rules", async () => {
		write(user, { models: { rules: ["claude/*"] } });
		write(project, { models: { rules: ["synthetic/*"], rulesScope: "user" } });
		const store = new SettingsStore(SETTINGS, { user, project });
		const problems = await store.load();

		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatchObject({ path: project, key: "models.rulesScope" });
		expect(problems[0]?.reason).toContain("project scope");
		expect(problems[0]?.reason).toContain("user, runtime");
		expect(effectiveModelRules(store)).toEqual(["synthetic/*"]);
		expect(store.get("models.rulesScope")).toBe("trusted-project");
		expect(store.sourceOf("models.rulesScope")).toBe("default");
		expect(store.values()["models.rulesScope"]).toBe("trusted-project");
		expect(store.shadowed("user", ["models.rulesScope"])).toEqual([]);
	});

	test("forbidden project edits fail atomically but null removes legacy overrides", async () => {
		write(user, { models: { rules: ["claude/*"], rulesScope: "user" } });
		write(project, {
			models: { rules: ["synthetic/*"], rulesScope: "trusted-project" },
			other: { keep: true },
		});
		const original = readFileSync(project, "utf8");
		const store = new SettingsStore(SETTINGS, { user, project });
		await store.load();
		const error: unknown = await store
			.save("project", { "models.rules": ["changed/*"], "models.rulesScope": "trusted-project" })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(SettingsError);
		if (!(error instanceof SettingsError)) throw new Error("Expected SettingsError");
		expect(error.path).toBe(project);
		expect(error.message).toContain("models.rulesScope");
		expect(error.message).toContain("project");
		expect(error.message).toContain("user, runtime");
		expect(readFileSync(project, "utf8")).toBe(original);
		expect(store.get("models.rulesScope")).toBe("user");
		expect(effectiveModelRules(store)).toEqual(["claude/*"]);

		await store.save("project", { "models.rules": ["changed/*"] });
		expect(store.get("models.rulesScope")).toBe("user");
		expect(store.sourceOf("models.rulesScope")).toBe("user");
		expect(store.shadowed("user", ["models.rulesScope"])).toEqual([]);
		expect(effectiveModelRules(store)).toEqual(["claude/*"]);
		expect(JSON.parse(readFileSync(project, "utf8"))).toEqual({
			models: { rules: ["changed/*"], rulesScope: "trusted-project" },
			other: { keep: true },
		});

		await store.save("project", { "models.rulesScope": null });
		expect(JSON.parse(readFileSync(project, "utf8"))).toEqual({
			models: { rules: ["changed/*"] },
			other: { keep: true },
		});
		expect(await store.load()).toEqual([]);
		expect(effectiveModelRules(store)).toEqual(["claude/*"]);

		const missing = join(dir, "missing", "project.json");
		const newStore = new SettingsStore(SETTINGS, { user, project: missing });
		await expect(newStore.save("project", { "models.rulesScope": "user" })).rejects.toThrow(
			"project scope",
		);
		expect(existsSync(missing)).toBe(false);
	});

	test("scope metadata governs generic fields, resolution and shadowing", async () => {
		const fields = {
			"flags.user": booleanField({
				label: "User",
				description: "User only",
				default: false,
				allowedScopes: ["user"],
			}),
			"flags.project": booleanField({
				label: "Project",
				description: "Project only",
				default: false,
				allowedScopes: ["project"],
			}),
			"flags.all": booleanField({ label: "All", description: "All scopes", default: false }),
			"flags.none": booleanField({
				label: "Default",
				description: "Default only",
				default: false,
				allowedScopes: [],
			}),
		};
		write(user, { flags: { user: true, project: true, all: true, none: true } });
		write(project, { flags: { user: false, project: true, all: false, none: true } });
		const store = new SettingsStore(fields, { user, project });
		const problems = await store.load();
		expect(problems.map((problem) => [problem.path, problem.key])).toEqual([
			[user, "flags.project"],
			[user, "flags.none"],
			[project, "flags.user"],
			[project, "flags.none"],
		]);
		expect(store.values()).toEqual({
			"flags.user": true,
			"flags.project": true,
			"flags.all": false,
			"flags.none": false,
		});
		expect(store.sourceOf("flags.user")).toBe("user");
		expect(store.sourceOf("flags.project")).toBe("project");
		expect(store.sourceOf("flags.none")).toBe("default");
		expect(store.get("flags.all", { includeProject: false })).toBe(true);
		expect(store.sourceOf("flags.all", { includeProject: false })).toBe("user");
		expect(
			store.shadowed("user", ["flags.user", "flags.project", "flags.all", "flags.none"]),
		).toEqual(["flags.all"]);

		await expect(store.save("runtime", { "flags.user": false })).rejects.toThrow("user");
		await store.save("runtime", { "flags.all": true });
		expect(store.get("flags.all")).toBe(true);
		expect(store.sourceOf("flags.all")).toBe("runtime");
		expect(store.shadowed("user", ["flags.all"])).toEqual(["flags.all"]);
		await store.save("project", { "flags.user": null, "flags.none": null });
		await store.save("user", { "flags.project": null, "flags.none": null });
		expect(await store.load()).toEqual([]);
	});

	test("dashboard settings expose their defaults and null edits inherit them", async () => {
		const store = new SettingsStore(SETTINGS, { user });
		expect(await store.load()).toEqual([]);
		expect(store.get("dashboard.density")).toBe("comfortable");
		expect(store.get("dashboard.maxBodyRows")).toBe(0);
		expect(store.get("dashboard.showProvenance")).toBe(false);
		expect(store.get("dashboard.showMatchedRule")).toBe(false);
		expect(store.get("tokens.warningPercent")).toBe(70);
		expect(store.get("tokens.errorPercent")).toBe(90);

		await store.save("user", {
			"dashboard.density": "compact",
			"dashboard.maxBodyRows": 20,
			"dashboard.showProvenance": true,
			"dashboard.showMatchedRule": true,
			"tokens.warningPercent": 75,
			"tokens.errorPercent": 95,
		});
		expect(store.get("dashboard.density")).toBe("compact");
		expect(store.get("dashboard.maxBodyRows")).toBe(20);
		expect(store.get("dashboard.showProvenance")).toBe(true);
		expect(store.get("dashboard.showMatchedRule")).toBe(true);
		expect(store.get("tokens.warningPercent")).toBe(75);
		expect(store.get("tokens.errorPercent")).toBe(95);

		await store.save("user", {
			"dashboard.density": null,
			"dashboard.maxBodyRows": null,
			"dashboard.showProvenance": null,
			"dashboard.showMatchedRule": null,
			"tokens.warningPercent": null,
			"tokens.errorPercent": null,
		});
		expect(store.get("dashboard.density")).toBe("comfortable");
		expect(store.get("dashboard.maxBodyRows")).toBe(0);
		expect(store.get("dashboard.showProvenance")).toBe(false);
		expect(store.get("dashboard.showMatchedRule")).toBe(false);
		expect(store.get("tokens.warningPercent")).toBe(70);
		expect(store.get("tokens.errorPercent")).toBe(90);
		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual({});
	});

	test("token thresholds reject contradictions before writing and save together", async () => {
		write(user, { other: { keep: true } });
		const before = readFileSync(user, "utf8");
		const store = new SettingsStore(SETTINGS, { user });
		expect(await store.load()).toEqual([]);

		await expect(store.save("user", { "tokens.warningPercent": 95 })).rejects.toThrow(
			"tokens.warningPercent, tokens.errorPercent",
		);
		expect(readFileSync(user, "utf8")).toBe(before);
		expect(store.get("tokens.warningPercent")).toBe(70);
		expect(store.get("tokens.errorPercent")).toBe(90);

		await store.save("user", {
			"tokens.warningPercent": 80,
			"tokens.errorPercent": 90,
		});
		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual({
			other: { keep: true },
			tokens: { warningPercent: 80, errorPercent: 90 },
		});
		expect(store.get("tokens.warningPercent")).toBe(80);
		expect(store.get("tokens.errorPercent")).toBe(90);
	});

	test("loading a hand-edited contradictory token threshold reports and inherits", async () => {
		write(user, { tokens: { warningPercent: 95, errorPercent: 90 }, other: true });
		const store = new SettingsStore(SETTINGS, { user });
		const problems = await store.load();

		expect(problems.map((problem) => [problem.path, problem.key])).toEqual([
			[user, "tokens.warningPercent"],
		]);
		expect(problems[0]?.reason).toContain("tokens.warningPercent, tokens.errorPercent");
		expect(problems[0]?.reason).toContain("warning must be strictly less than error");
		expect(problems[0]?.reason).toContain("using inherited values");
		expect(store.get("tokens.warningPercent")).toBe(70);
		expect(store.get("tokens.errorPercent")).toBe(90);
		expect(store.sourceOf("tokens.warningPercent")).toBe("default");
		expect(store.sourceOf("tokens.errorPercent")).toBe("default");
		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual({
			tokens: { warningPercent: 95, errorPercent: 90 },
			other: true,
		});
	});

	test("rejects contradictory credit thresholds in every scope without writing", async () => {
		write(user, { other: { keep: true } });
		write(project, { other: { keep: true } });
		const userBefore = readFileSync(user, "utf8");
		const projectBefore = readFileSync(project, "utf8");
		for (const scope of ["runtime", "user", "project"] as const) {
			const store = new SettingsStore(SETTINGS, { user, project });
			expect(await store.load()).toEqual([]);
			const error: unknown = await store
				.save(scope, { "quotas.creditHealthyUsd": 50, "quotas.creditCriticalUsd": 100 })
				.catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(SettingsError);
			expect(String(error)).toContain("quotas.creditCriticalUsd");
			expect(String(error)).toContain("quotas.creditHealthyUsd");
			expect(String(error)).toContain("strictly less");
			expect(store.get("quotas.creditHealthyUsd")).toBe(50);
			expect(store.get("quotas.creditCriticalUsd")).toBe(5);
			expect(readFileSync(user, "utf8")).toBe(userBefore);
			expect(readFileSync(project, "utf8")).toBe(projectBefore);
		}
	});

	test("valid related threshold edits save together and preserve unknown keys", async () => {
		write(user, { quotas: { legacy: true }, other: { keep: true } });
		const store = new SettingsStore(SETTINGS, { user });
		await store.load();
		await expect(store.save("user", { "quotas.creditCriticalUsd": 80 })).rejects.toThrow(
			"quotas.creditHealthyUsd",
		);
		await store.save("user", {
			"quotas.creditHealthyUsd": 100,
			"quotas.creditCriticalUsd": 80,
		});
		expect(JSON.parse(readFileSync(user, "utf8"))).toEqual({
			quotas: { legacy: true, creditHealthyUsd: 100, creditCriticalUsd: 80 },
			other: { keep: true },
		});
		expect(store.get("quotas.creditHealthyUsd")).toBe(100);
		expect(store.get("quotas.creditCriticalUsd")).toBe(80);
	});

	test("checks target and higher scope relationships even when masked", async () => {
		write(user, { quotas: { creditHealthyUsd: 50, creditCriticalUsd: 5 } });
		write(project, { quotas: { creditHealthyUsd: 100 } });
		const store = new SettingsStore(SETTINGS, { user, project });
		await store.load();
		const userBefore = readFileSync(user, "utf8");
		await expect(store.save("user", { "quotas.creditCriticalUsd": 60 })).rejects.toThrow(
			"quotas.creditHealthyUsd",
		);
		expect(readFileSync(user, "utf8")).toBe(userBefore);

		write(user, { quotas: { creditHealthyUsd: 100, creditCriticalUsd: 5 } });
		write(project, { quotas: { creditCriticalUsd: 40 } });
		await store.load();
		await store.save("runtime", { "quotas.creditHealthyUsd": 100 });
		const validBefore = readFileSync(user, "utf8");
		await expect(store.save("user", { "quotas.creditHealthyUsd": 30 })).rejects.toThrow(
			"quotas.creditCriticalUsd",
		);
		expect(readFileSync(user, "utf8")).toBe(validBefore);
		expect(store.get("quotas.creditHealthyUsd")).toBe(100);
		expect(store.get("quotas.creditCriticalUsd")).toBe(40);
	});

	test("checks inherited relationships when removing overrides", async () => {
		write(user, { quotas: { creditHealthyUsd: 50, creditCriticalUsd: 5 } });
		write(project, { quotas: { creditHealthyUsd: 100, creditCriticalUsd: 80 }, other: true });
		const store = new SettingsStore(SETTINGS, { user, project });
		await store.load();
		const before = readFileSync(project, "utf8");
		await expect(store.save("project", { "quotas.creditHealthyUsd": null })).rejects.toThrow(
			"quotas.creditCriticalUsd",
		);
		expect(readFileSync(project, "utf8")).toBe(before);
		await store.save("project", {
			"quotas.creditHealthyUsd": null,
			"quotas.creditCriticalUsd": null,
		});
		expect(JSON.parse(readFileSync(project, "utf8"))).toEqual({ other: true });
		expect(store.get("quotas.creditHealthyUsd")).toBe(50);
		expect(store.get("quotas.creditCriticalUsd")).toBe(5);

		await store.save("runtime", {
			"quotas.creditHealthyUsd": 100,
			"quotas.creditCriticalUsd": 80,
		});
		await expect(store.save("runtime", { "quotas.creditHealthyUsd": null })).rejects.toThrow(
			"quotas.creditCriticalUsd",
		);
		expect(store.get("quotas.creditHealthyUsd")).toBe(100);
		expect(store.get("quotas.creditCriticalUsd")).toBe(80);
		await store.save("runtime", {
			"quotas.creditHealthyUsd": null,
			"quotas.creditCriticalUsd": null,
		});
		expect(store.get("quotas.creditHealthyUsd")).toBe(50);
		expect(store.get("quotas.creditCriticalUsd")).toBe(5);
	});

	test("loads conflicting thresholds as problems and inherits consistent values", async () => {
		write(user, { quotas: { creditHealthyUsd: 50, creditCriticalUsd: 100 }, other: true });
		write(project, { quotas: { creditCriticalUsd: 50 } });
		const userBefore = readFileSync(user, "utf8");
		const projectBefore = readFileSync(project, "utf8");
		const store = new SettingsStore(SETTINGS, { user, project });
		const problems = await store.load();
		expect(problems.map((problem) => problem.path)).toEqual([user, project]);
		for (const problem of problems) {
			expect(problem.reason).toContain("quotas.creditHealthyUsd");
			expect(problem.reason).toContain("quotas.creditCriticalUsd");
			expect(problem.reason).toContain("inherited");
		}
		expect(store.get("quotas.creditHealthyUsd")).toBe(50);
		expect(store.get("quotas.creditCriticalUsd")).toBe(5);
		expect(store.sourceOf("quotas.creditHealthyUsd")).toBe("default");
		expect(store.sourceOf("quotas.creditCriticalUsd")).toBe("default");
		expect(readFileSync(user, "utf8")).toBe(userBefore);
		expect(readFileSync(project, "utf8")).toBe(projectBefore);

		write(user, { quotas: { creditHealthyUsd: 100, creditCriticalUsd: 80 } });
		write(project, { quotas: { creditHealthyUsd: 50 } });
		const inherited = await store.load();
		expect(inherited.map((problem) => [problem.path, problem.key])).toEqual([
			[project, "quotas.creditHealthyUsd"],
		]);
		expect(store.get("quotas.creditHealthyUsd")).toBe(100);
		expect(store.get("quotas.creditCriticalUsd")).toBe(80);
	});

	test("reload drops a runtime override invalidated by changed file values", async () => {
		write(user, { quotas: { creditHealthyUsd: 100, creditCriticalUsd: 5 } });
		const store = new SettingsStore(SETTINGS, { user });
		await store.load();
		const pending = store.load();
		await store.save("runtime", { "quotas.creditCriticalUsd": 80 });
		expect(await pending).toEqual([]);
		expect(store.sourceOf("quotas.creditCriticalUsd")).toBe("runtime");
		write(user, { quotas: { creditHealthyUsd: 50, creditCriticalUsd: 5 } });
		const reload = store.load();
		expect(store.get("quotas.creditHealthyUsd")).toBe(100);
		expect(store.get("quotas.creditCriticalUsd")).toBe(80);
		const problems = await reload;
		expect(problems.map((problem) => [problem.path, problem.key])).toEqual([
			["runtime", "quotas.creditCriticalUsd"],
		]);
		expect(store.get("quotas.creditHealthyUsd")).toBe(50);
		expect(store.get("quotas.creditCriticalUsd")).toBe(5);
	});

	test("validates the fresh locked file rather than a stale store layer", async () => {
		const first = new SettingsStore(SETTINGS, { user });
		const second = new SettingsStore(SETTINGS, { user });
		await first.load();
		await second.load();
		await first.save("user", { "quotas.creditHealthyUsd": 100, "quotas.creditCriticalUsd": 80 });
		const before = readFileSync(user, "utf8");
		await expect(second.save("user", { "quotas.creditHealthyUsd": 60 })).rejects.toThrow(
			"quotas.creditCriticalUsd",
		);
		expect(readFileSync(user, "utf8")).toBe(before);
	});

	test("relation metadata also validates other field types", async () => {
		const fields = {
			"example.enabled": booleanField({ label: "Enabled", description: "Enabled", default: false }),
			"example.option": booleanField({
				label: "Option",
				description: "Requires enabled",
				default: false,
				validateRelation: (value, lookup) =>
					value && lookup("example.enabled") !== true
						? { keys: ["example.option", "example.enabled"], reason: "option requires enabled" }
						: undefined,
			}),
		};
		const store = new SettingsStore(fields, { user });
		await expect(store.save("runtime", { "example.option": true })).rejects.toThrow(
			"example.enabled",
		);
		await store.save("runtime", { "example.option": true, "example.enabled": true });
		expect(store.values()).toEqual({ "example.enabled": true, "example.option": true });
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
