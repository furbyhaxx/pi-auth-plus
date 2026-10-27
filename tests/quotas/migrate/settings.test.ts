import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETTINGS } from "../../../src/core/config/catalog.ts";
import { SettingsStore } from "../../../src/core/config/index.ts";
import { projectSettingsPath, userSettingsPath } from "../../../src/core/paths/index.ts";
import { Registry } from "../../../src/core/registry/index.ts";
import { migratePiQuotasSettings } from "../../../src/quotas/migrate/settings.ts";

const registry = new Registry([
	{
		id: "test",
		label: "Test",
		providers: [
			{ id: "codex", label: "OpenAI", aliases: ["openai", "openai-codex"] },
			{ id: "xai", label: "xAI", aliases: ["grok"] },
		],
	},
]);
let dir: string;
let originalAgentDir: string | undefined;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "quota-settings-migration-"));
	originalAgentDir = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = dir;
});
afterEach(async () => {
	if (originalAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
	else process.env["PI_CODING_AGENT_DIR"] = originalAgentDir;
	await rm(dir, { recursive: true, force: true });
});

function store() {
	return new SettingsStore(SETTINGS, { user: userSettingsPath() });
}
function migrate(settings = store()) {
	return migratePiQuotasSettings({
		settings,
		registry,
		sources: { user: join(dir, "quotas.json") },
	});
}
async function source(value: unknown) {
	await writeFile(join(dir, "quotas.json"), JSON.stringify(value));
}

describe("pi-quotas settings carry-over", () => {
	test("fills unset keys, resolves aliases, and never reapplies after a later deletion", async () => {
		const template = " {codex:id} / {grok:id} ";
		const legacy = {
			linePlacement: "above-editor",
			percentDisplay: "remaining",
			enabledProviders: "codex,grok,nope,codex",
			lineTemplate: template,
			lineTemplateNarrow: "discard",
			unknown: true,
		};
		await source(legacy);
		await writeFile(
			userSettingsPath(),
			JSON.stringify({ quotas: { linePlacement: "off" }, extra: 1 }),
		);
		const settings = store();
		await settings.load();
		const report = await migrate(settings);
		expect(report.unknownProviders).toEqual([{ scope: "user", name: "nope" }]);
		expect(report.problems).toEqual([]);
		expect(JSON.parse(await readFile(userSettingsPath(), "utf8"))).toEqual({
			quotas: {
				linePlacement: "off",
				percentDisplay: "remaining",
				providers: ["codex", "xai"],
				lineTemplate: template,
			},
			extra: 1,
		});
		expect(settings.get("quotas.lineTemplate")).toBe(template);
		expect(JSON.parse(await readFile(join(dir, "quotas.json"), "utf8"))).toEqual(legacy);
		await settings.save("user", { "quotas.percentDisplay": null });
		const before = await readFile(userSettingsPath(), "utf8");
		expect((await migrate(settings)).migrated).toEqual([]);
		expect(await readFile(userSettingsPath(), "utf8")).toBe(before);
	});

	test("preserves present invalid and default-valued target keys, skipping rejected source values", async () => {
		await source({
			linePlacement: "off",
			refreshOnRequest: false,
			percentDisplay: "invalid",
			lineTemplate: " ",
			creditCriticalUsd: 8,
			refreshIntervalSec: "bad",
		});
		await writeFile(
			userSettingsPath(),
			JSON.stringify({ quotas: { linePlacement: null, refreshOnRequest: true } }),
		);
		const report = await migrate();
		expect(report.problems.map((problem) => problem.key)).toEqual([
			"refreshIntervalSec",
			"percentDisplay",
			"lineTemplate",
		]);
		expect(JSON.parse(await readFile(userSettingsPath(), "utf8"))).toEqual({
			quotas: { linePlacement: null, refreshOnRequest: true, creditCriticalUsd: 8 },
		});
	});

	test.each(["", "all", "nope", []].map((providers) => ({ providers })))(
		"mirrors the legacy all-sources fallback for %j",
		async ({ providers }) => {
			await source({ enabledProviders: providers });
			await migrate();
			expect(JSON.parse(await readFile(userSettingsPath(), "utf8"))).toEqual({
				quotas: { providers: [] },
			});
		},
	);

	test("migrates project and user independently and ignores an omitted project source", async () => {
		const cwd = join(dir, "project");
		const project = projectSettingsPath(cwd);
		const projectSource = join(cwd, ".pi", "quotas.json");
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(
			projectSource,
			JSON.stringify({ linePlacement: "off", enabledProviders: ["grok", "codex"] }),
		);
		await source({
			linePlacement: "above-editor",
			refreshIntervalSec: 120,
			compactWidthCols: 80,
			alwaysShortIds: true,
			creditHealthyUsd: 75,
		});
		await migrate();
		expect(await Bun.file(project).exists()).toBe(false);
		const settings = new SettingsStore(SETTINGS, { user: userSettingsPath(), project });
		await settings.load();
		const report = await migratePiQuotasSettings({
			settings,
			registry,
			sources: { user: join(dir, "quotas.json"), project: projectSource },
		});
		expect(report.problems).toEqual([]);
		expect(report.migrated.every((entry) => entry.scope === "project")).toBe(true);
		expect(settings.get("quotas.linePlacement")).toBe("off");
		expect(settings.get("quotas.providers")).toEqual(["xai", "codex"]);
		expect(settings.get("quotas.refreshIntervalSec")).toBe(120);
		expect(settings.get("quotas.compactWidthCols")).toBe(80);
		expect(settings.get("quotas.alwaysShortIds")).toBe(true);
		expect(settings.get("quotas.creditHealthyUsd")).toBe(75);
	});

	test("records a missing source as finished", async () => {
		await migrate();
		await source({ linePlacement: "off" });
		expect((await migrate()).migrated).toEqual([]);
		expect(await Bun.file(userSettingsPath()).exists()).toBe(false);
	});

	test("retries malformed sources and targets", async () => {
		await writeFile(join(dir, "quotas.json"), "{");
		expect((await migrate()).problems).toHaveLength(1);
		await source({ linePlacement: "off" });
		await writeFile(userSettingsPath(), "{");
		expect((await migrate()).problems).toHaveLength(1);
		await writeFile(userSettingsPath(), "{}");
		expect((await migrate()).migrated).toEqual([{ scope: "user", key: "quotas.linePlacement" }]);
	});
});
