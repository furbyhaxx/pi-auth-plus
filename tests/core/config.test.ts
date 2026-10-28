import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("core/config", () => {
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

	test("an untrusted project file is never read", async () => {
		write(project, { quotas: { refreshIntervalSec: 10 } });
		const store = new SettingsStore(catalog, { user });
		await store.load();
		expect(store.get("quotas.refreshIntervalSec")).toBe(60);
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
