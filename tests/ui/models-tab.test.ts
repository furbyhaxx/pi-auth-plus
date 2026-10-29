import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { SaveScope } from "../../src/core/config/index.ts";
import type { ModelAlias } from "../../src/models/aliases/index.ts";
import { compileModelRules, evaluateModelRules } from "../../src/models/rules/match.ts";
import {
	type ModelCatalogItem,
	type ModelsTabDeps,
	ModelsView,
} from "../../src/ui/dashboard/models.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

function open(
	initial: readonly string[] = ["vendor/*", "!vendor/one"],
	fail = false,
	extra: readonly ModelCatalogItem[] = [],
	details?: ModelsTabDeps["details"],
) {
	let stored = [...initial];
	const saves: { rules: readonly string[]; scope: SaveScope }[] = [];
	let onRefresh: (() => void) | undefined;
	const keys = new KeybindingsManager(TUI_KEYBINDINGS);
	const host: TabViewHost = {
		theme: {
			fg: (_color, text) => `\x1b[90m${text}\x1b[39m`,
			bg: (_color, text) => text,
			bold: (text) => text,
		},
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {
			onRefresh?.();
			onRefresh = undefined;
		},
		finish: () => {},
	};
	const deps: ModelsTabDeps = {
		rules: () => stored,
		catalog: () => [
			{ provider: "vendor", id: "one", name: "First\x1b]0;evil\x07", contextWindow: 1000 },
			{ provider: "vendor", id: "two", name: "Second", contextWindow: 2000 },
			{ provider: "other", id: "three", name: "Third", contextWindow: 3000 },
			...extra,
		],
		evaluate: (rules, provider, id) => {
			const outcome = evaluateModelRules(compileModelRules(rules), provider, id);
			return outcome.ruleIndex === undefined
				? { visible: !outcome.hidden }
				: { visible: !outcome.hidden, ruleIndex: outcome.ruleIndex };
		},
		save: async (rules, scope) => {
			if (fail) throw new Error("save failed; retry");
			stored = [...rules];
			saves.push({ rules: [...rules], scope });
		},
	};
	if (details) deps.details = details;
	const view = new ModelsView(host, deps);
	return {
		view,
		saves,
		stored: () => stored,
		text: () => view.render(140, 30).lines.map(stripVTControlCharacters).join("\n"),
		nextRefresh: () =>
			new Promise<void>((resolve) => {
				onRefresh = resolve;
			}),
	};
}

async function save(rig: ReturnType<typeof open>, target: string) {
	rig.view.handleInput("\x13");
	const refreshed = rig.nextRefresh();
	rig.view.handleInput(target);
	await refreshed;
}

describe("models tab", () => {
	test("batches and caches full-catalog previews until relevant state changes", () => {
		const rules = [
			"vendor/*",
			"!vendor/model-1",
			...Array.from({ length: 48 }, (_, index) => `unmatched/rule-${index}`),
		];
		const catalog: ModelCatalogItem[] = Array.from({ length: 555 }, (_, index) => ({
			provider: index % 111 === 0 ? "other" : "vendor",
			id: `model-${index}`,
			name: `Model ${index}`,
			contextWindow: 100000,
		}));
		catalog[1] = {
			provider: "vendor",
			id: "model-1",
			name: "Model 1",
			contextWindow: 100000,
			input: ["text"],
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
		};
		let previous: readonly string[] | undefined;
		let compiled = compileModelRules([]);
		let compilations = 0;
		let evaluations = 0;
		const keys = new KeybindingsManager(TUI_KEYBINDINGS);
		const view = new ModelsView(
			{
				theme: {
					fg: (_color, value) => value,
					bg: (_color, value) => value,
					bold: (value) => value,
				},
				keys,
				binding: (id) => bindingLabel(keys, id),
				refresh: () => {},
				finish: () => {},
			},
			{
				rules: () => [...rules],
				catalog: () =>
					catalog.map((item) => ({
						...item,
						...(item.input ? { input: [...item.input] } : {}),
						...(item.cost ? { cost: { ...item.cost } } : {}),
					})),
				evaluate: (input, provider, id) => {
					evaluations++;
					if (input !== previous) {
						previous = input;
						compiled = compileModelRules(input);
						compilations++;
					}
					const result = evaluateModelRules(compiled, provider, id);
					return { visible: !result.hidden };
				},
				save: async () => {},
			},
		);
		const render = () => view.render(140, 30);
		for (let index = 1; index < rules.length; index++) view.handleInput("j");
		let body = render();
		expect(body.state).toContain("549 hidden");
		expect(body.description).toContain("changes 0 models");
		expect(compilations).toBeLessThanOrEqual(3);
		expect(evaluations).toBeGreaterThan(0);
		const initialEvaluations = evaluations;
		render();
		expect(evaluations).toBe(initialEvaluations);

		for (let index = 1; index < rules.length; index++) view.handleInput("k");
		let before = compilations;
		body = render();
		expect(body.state).toContain("549 hidden");
		expect(body.description).toContain("changes 550 models");
		expect(compilations - before).toBeLessThanOrEqual(3);
		view.handleInput("j");
		body = render();
		expect(body.description).toContain("changes 1 model;");

		view.handleInput(" ");
		before = compilations;
		body = render();
		expect(body.state).toContain("550 hidden");
		expect(body.description).toContain("changes 0 models");
		expect(compilations - before).toBeLessThanOrEqual(3);
		view.handleInput("\x1b");
		body = render();
		expect(body.state).toContain("549 hidden");
		expect(body.description).toContain("changes 1 model;");

		rules[0] = "#vendor/*";
		rules[1] = "vendor/model-1";
		body = render();
		expect(body.state).toContain("1 hidden");
		expect(body.description).toContain("changes 1 model;");
		const renamed: ModelCatalogItem = {
			provider: "vendor",
			id: "renamed",
			name: "Renamed",
			contextWindow: 100000,
		};
		catalog[1] = renamed;
		body = render();
		expect(body.state).toContain("0 hidden");
		expect(body.description).toContain("changes 0 models");
		renamed.id = "model-1";
		expect(render().state).toContain("1 hidden");
		renamed.id = "renamed";
		expect(render().state).toContain("0 hidden");
		catalog.push({ provider: "vendor", id: "model-1", name: "Added", contextWindow: 100000 });
		body = render();
		expect(body.state).toContain("1 hidden");
		expect(body.description).toContain("changes 1 model;");
		catalog.pop();
		expect(render().state).toContain("0 hidden");
		catalog.push({ provider: "vendor", id: "model-1", name: "Added", contextWindow: 100000 });
		expect(render().state).toContain("1 hidden");
		view.handleInput("v");
		body = view.render(140, 600);
		let lines = body.lines.join("\n");
		expect(lines).toContain("listed renamed · Renamed");
		expect(lines).toContain("hidden model-1 · Added");
		expect(lines.indexOf("listed model-111")).toBeLessThan(lines.indexOf("listed renamed"));
		renamed.name = "Updated name";
		const beforeMetadataChange = evaluations;
		body = view.render(140, 600);
		expect(body.lines.join("\n")).toContain("listed renamed · Updated name");
		expect(evaluations).toBeGreaterThan(beforeMetadataChange);
		catalog.reverse();
		body = view.render(140, 600);
		lines = body.lines.join("\n");
		expect(lines.indexOf("hidden model-1 · Added")).toBeLessThan(lines.indexOf("listed model-111"));
		view.handleInput("h");
		expect(render().state).toContain("0 hidden");
	});

	test("selected-rule effect uses its prefix even when a later rule overrides it", () => {
		const rig = open(["vendor/*", "!vendor/one", "vendor/one"]);
		rig.view.handleInput("j");
		const body = rig.view.render(140, 30);
		expect(body.state).toContain("2 hidden");
		expect(body.description).toContain("changes 1 model;");
	});

	test("creates, edits and removes aliases with scoped validation while preserving overrides", async () => {
		let aliases: readonly ModelAlias[] = [
			{ provider: "other", source: "three", id: "other-alias" },
		];
		const saves: { aliases: readonly ModelAlias[]; scope: SaveScope }[] = [];
		const overrides: unknown[] = [];
		const rig = open([], false, [], {
			read: async () => undefined,
			save: async (_provider, _id, changes) => {
				overrides.push(changes);
			},
			aliases: {
				list: () => aliases,
				supported: (provider) => provider === "vendor",
				save: async (next, scope) => {
					aliases = next;
					saves.push({ aliases: next, scope });
				},
			},
		});
		rig.view.handleInput("v");
		let refreshed = rig.nextRefresh();
		rig.view.handleInput("\r");
		await refreshed;
		// Stage an override before entering the alias editor.
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("Edited");
		rig.view.handleInput("\r");
		for (let i = 0; i < 9; i++) rig.view.handleInput("j");
		expect(rig.text()).toContain("+ new alias");
		rig.view.handleInput("\r");
		const edit = (value: string) => {
			rig.view.handleInput("\r");
			rig.view.handleInput("\x01");
			rig.view.handleInput("\x0b");
			rig.view.handleInput(value);
			rig.view.handleInput("\r");
		};
		edit("copy");
		rig.view.handleInput("j");
		rig.view.handleInput("j");
		edit("0");
		rig.view.handleInput("\x13");
		expect(rig.text()).toContain("positive integer");
		expect(saves).toEqual([]);
		edit("4096");
		rig.view.handleInput("j");
		edit("512");
		for (const width of [36, 57, 80, 140]) {
			const body = rig.view.render(width, 3);
			for (const line of [...body.lines, body.description ?? "", body.state ?? ""])
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		rig.view.handleInput("\x13");
		refreshed = rig.nextRefresh();
		rig.view.handleInput("r");
		await refreshed;
		expect(saves[0]).toEqual({
			scope: "runtime",
			aliases: [
				{ provider: "other", source: "three", id: "other-alias" },
				{ provider: "vendor", source: "one", id: "copy", contextWindow: 4096, maxTokens: 512 },
			],
		});
		expect(rig.text()).toContain("staged");
		rig.view.handleInput("\r");
		rig.view.handleInput("j");
		edit("Alias name");
		rig.view.handleInput("\x13");
		refreshed = rig.nextRefresh();
		rig.view.handleInput("r");
		await refreshed;
		expect(saves[1]?.aliases).toEqual([
			{ provider: "other", source: "three", id: "other-alias" },
			{
				provider: "vendor",
				source: "one",
				id: "copy",
				name: "Alias name",
				contextWindow: 4096,
				maxTokens: 512,
			},
		]);
		rig.view.handleInput("\r");
		rig.view.handleInput("d");
		rig.view.handleInput("\x13");
		refreshed = rig.nextRefresh();
		rig.view.handleInput("r");
		await refreshed;
		expect(saves[2]).toEqual({
			scope: "runtime",
			aliases: [{ provider: "other", source: "three", id: "other-alias" }],
		});
		refreshed = rig.nextRefresh();
		rig.view.handleInput("\x13");
		await refreshed;
		expect(overrides).toEqual([[{ field: ["name"], edit: { kind: "set", value: "Edited" } }]]);
	});

	test("refuses duplicate aliases and explains unsupported providers", async () => {
		const saves: unknown[] = [];
		const rig = open([], false, [], {
			read: async () => undefined,
			save: async () => {},
			aliases: {
				list: () => [{ provider: "vendor", source: "two", id: "duplicate" }],
				supported: (provider) => provider === "vendor",
				save: async (aliases) => {
					saves.push(aliases);
				},
			},
		});
		rig.view.handleInput("v");
		let refreshed = rig.nextRefresh();
		rig.view.handleInput("\r");
		await refreshed;
		for (let i = 0; i < 9; i++) rig.view.handleInput("j");
		rig.view.handleInput("\r");
		rig.view.handleInput("\r");
		rig.view.handleInput("duplicate");
		rig.view.handleInput("\r");
		rig.view.handleInput("\x13");
		expect(rig.text()).toContain("duplicate IDs");
		expect(saves).toEqual([]);
		rig.view.handleInput("\x1b");
		expect(rig.text()).toContain("Discarded");
		rig.view.handleInput("\x1b");
		rig.view.handleInput("\x1b");
		rig.view.handleInput("j");
		rig.view.handleInput("j");
		refreshed = rig.nextRefresh();
		rig.view.handleInput("\r");
		await refreshed;
		expect(rig.text()).toContain("not supported");
		expect(rig.text()).not.toContain("+ new alias");
	});
	test("detail stages patches, validates, removes and discards", async () => {
		const saves: unknown[] = [];
		const details: NonNullable<ModelsTabDeps["details"]> = {
			read: async () => ({ contextWindow: 1200, cost: { input: 2 } }),
			save: async (provider, id, changes) => {
				saves.push({ provider, id, changes });
			},
		};
		const rig = open([], false, [], details);
		rig.view.handleInput("v");
		let refreshed = rig.nextRefresh();
		rig.view.handleInput("\r");
		await refreshed;
		expect(rig.text()).toContain("override");
		for (let selected = 0; selected < 9; selected++) {
			for (const width of [36, 57, 80, 140]) {
				const body = rig.view.render(width, 3);
				for (const line of [...body.lines, body.description ?? "", body.state ?? ""]) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					expect(stripVTControlCharacters(line)).not.toContain("evil");
				}
			}
			rig.view.handleInput("j");
		}
		for (let selected = 0; selected < 8; selected++) rig.view.handleInput("k");
		rig.view.handleInput("j");
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("0");
		rig.view.handleInput("\r");
		expect(rig.text()).toContain("positive integer");
		rig.view.handleInput("\x13");
		expect(saves).toEqual([]);
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("4096");
		rig.view.handleInput("\r");
		for (let i = 0; i < 4; i++) rig.view.handleInput("j");
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("-1");
		rig.view.handleInput("\r");
		expect(rig.text()).toContain("non-negative cost");
		rig.view.handleInput("\x13");
		expect(saves).toEqual([]);
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("0");
		rig.view.handleInput("\r");
		refreshed = rig.nextRefresh();
		rig.view.handleInput("\x13");
		await refreshed;
		expect(saves).toEqual([
			{
				provider: "vendor",
				id: "one",
				changes: [
					{ field: ["contextWindow"], edit: { kind: "set", value: 4096 } },
					{ field: ["cost", "input"], edit: { kind: "set", value: 0 } },
				],
			},
		]);
		rig.view.handleInput("k");
		rig.view.handleInput("k");
		rig.view.handleInput("k");
		rig.view.handleInput("k");
		rig.view.handleInput("\x7f");
		refreshed = rig.nextRefresh();
		rig.view.handleInput("\x13");
		await refreshed;
		expect(saves[1]).toEqual({
			provider: "vendor",
			id: "one",
			changes: [{ field: ["contextWindow"], edit: { kind: "remove" } }],
		});
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("5000");
		rig.view.handleInput("\r");
		rig.view.handleInput("\x1b");
		refreshed = rig.nextRefresh();
		rig.view.handleInput("\r");
		await refreshed;
		rig.view.handleInput("\x13");
		expect(saves).toHaveLength(2);
	});
	test("shows the inherited catalog value after an override is removed", async () => {
		let override: Record<string, unknown> | undefined = { contextWindow: 1200 };
		const details: NonNullable<ModelsTabDeps["details"]> = {
			read: async () => override,
			save: async () => {
				override = undefined;
			},
			current: () => ({ provider: "vendor", id: "one", name: "First", contextWindow: 5000 }),
		};
		const rig = open([], false, [], details);
		rig.view.handleInput("v");
		let refreshed = rig.nextRefresh();
		rig.view.handleInput("\r");
		await refreshed;
		expect(rig.text()).toContain("Context window · 1200 · override");
		rig.view.handleInput("j");
		rig.view.handleInput("\x7f");
		refreshed = rig.nextRefresh();
		rig.view.handleInput("\x13");
		await refreshed;
		expect(rig.text()).toContain("Context window · 5000 · default");
	});

	test("detail cycles typed fields and removes default verbosity", async () => {
		const saves: unknown[] = [];
		const details: NonNullable<ModelsTabDeps["details"]> = {
			read: async () => ({ samplingParams: { text: { verbosity: "high" } } }),
			save: async (_provider, _id, changes) => {
				saves.push(changes);
			},
		};
		const rig = open(
			[],
			false,
			[
				{
					provider: "vendor",
					id: "responses",
					name: "Responses",
					contextWindow: 100,
					api: "openai-responses",
					reasoning: false,
					input: ["text"],
				},
			],
			details,
		);
		rig.view.handleInput("v");
		rig.view.handleInput("j");
		rig.view.handleInput("j");
		const opened = rig.nextRefresh();
		rig.view.handleInput("\r");
		await opened;
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput(" ");
		rig.view.handleInput("\r");
		expect(rig.text()).toContain("Name cannot be empty");
		rig.view.handleInput("\x1b");
		for (let i = 0; i < 3; i++) rig.view.handleInput("j");
		rig.view.handleInput(" ");
		rig.view.handleInput("j");
		rig.view.handleInput(" ");
		for (let i = 0; i < 5; i++) rig.view.handleInput("j");
		expect(rig.text()).toContain("Response verbosity · high · override");
		rig.view.handleInput(" ");
		const saved = rig.nextRefresh();
		rig.view.handleInput("\x13");
		await saved;
		expect(saves).toEqual([
			[
				{ field: ["reasoning"], edit: { kind: "set", value: true } },
				{ field: ["input"], edit: { kind: "set", value: ["text", "image"] } },
				{ field: ["samplingParams", "text", "verbosity"], edit: { kind: "remove" } },
			],
		]);
	});

	test("detail read failure blocks changes and save", async () => {
		let saved = false;
		const rig = open([], false, [], {
			read: async () => {
				throw new Error("bad file");
			},
			save: async () => {
				saved = true;
			},
		});
		rig.view.handleInput("v");
		const opened = rig.nextRefresh();
		rig.view.handleInput("\r");
		await opened;
		expect(rig.text()).toContain("Read failed");
		rig.view.handleInput("\r");
		rig.view.handleInput("\x13");
		expect(saved).toBe(false);
	});

	test("edits and reorders rules, previews immediately, and saves only to the selected scope", async () => {
		for (const [target, scope] of [
			["u", "user"],
			["p", "project"],
			["r", "runtime"],
		] as const) {
			const rig = open();
			expect(stripVTControlCharacters(rig.view.render(140, 30).description ?? "")).toContain(
				"changes 2 models",
			);
			rig.view.handleInput("j");
			expect(stripVTControlCharacters(rig.view.render(140, 30).description ?? "")).toContain(
				"changes 1 model;",
			);
			rig.view.handleInput("\r");
			rig.view.handleInput("\x01");
			rig.view.handleInput("\x0b");
			rig.view.handleInput("!vendor/two");
			rig.view.handleInput("\r");
			rig.view.handleInput("\x1b[1;2A");
			expect(rig.stored()).toEqual(["vendor/*", "!vendor/one"]);
			rig.view.handleInput("v");
			expect(rig.text()).toContain("2 hidden");
			expect(rig.text()).toContain("hidden");
			rig.view.handleInput("h");
			expect(rig.text()).toContain("1 hidden");
			expect(rig.stored()).toEqual(["vendor/*", "!vendor/one"]);
			await save(rig, target);
			expect(rig.saves).toEqual([{ rules: ["!vendor/two", "vendor/*", "!vendor/one"], scope }]);
		}
	});

	test("adds, disables, enables, deletes and discards rules; cancel traps inline input", () => {
		const rig = open([]);
		rig.view.handleInput("a");
		expect(rig.view.handleInput("\t")).toBe(true);
		rig.view.handleInput("vendor/one");
		rig.view.handleInput("\x1b");
		expect(rig.text()).not.toContain("vendor/one");
		rig.view.handleInput("a");
		rig.view.handleInput("vendor/one");
		rig.view.handleInput("\r");
		rig.view.handleInput(" ");
		expect(rig.text()).toContain("#vendor/one");
		rig.view.handleInput(" ");
		expect(rig.text()).not.toContain("#vendor/one");
		rig.view.handleInput("d");
		expect(rig.text()).not.toContain("vendor/one");
		rig.view.handleInput("a");
		rig.view.handleInput("vendor/two");
		rig.view.handleInput("\r");
		expect(rig.view.handleInput("\x1b")).toBe(true);
		expect(rig.text()).toContain("Discarded");
		expect(rig.view.handleInput("\x1b")).toBe(false);
	});

	test("catalog toggles append rules in both directions and frame navigation remains available", async () => {
		const rig = open([]);
		rig.view.handleInput("v");
		expect(rig.view.handleInput("\t")).toBe(false);
		expect(rig.view.handleInput("\x1b[C")).toBe(false);
		rig.view.handleInput("h");
		expect(rig.text()).toContain("1 hidden");
		rig.view.handleInput("h");
		expect(rig.text()).toContain("0 hidden");
		await save(rig, "r");
		expect(rig.stored()).toEqual(["vendor/one", "!vendor/one"]);
	});

	test("catalog hide targets only the selected ID when it contains a wildcard", async () => {
		const rig = open([], false, [
			{ provider: "vendor", id: "star*id", name: "Literal star", contextWindow: 1000 },
			{ provider: "vendor", id: "star-other-id", name: "Other", contextWindow: 1000 },
		]);
		rig.view.handleInput("v");
		rig.view.handleInput("j");
		rig.view.handleInput("j");
		rig.view.handleInput("h");
		expect(rig.text()).toContain("1 hidden");
		expect(rig.text()).toContain("listed star-other-id");
		await save(rig, "r");
		expect(rig.stored()).toEqual(["vendor/star\\*id"]);
	});

	test("failed save retains staged rules and retry prompt can be cancelled", async () => {
		const rig = open([], true);
		rig.view.handleInput("a");
		rig.view.handleInput("vendor/one");
		rig.view.handleInput("\r");
		await save(rig, "p");
		expect(rig.text()).toContain("save failed; retry");
		expect(rig.text()).toContain("vendor/one");
		expect(rig.stored()).toEqual([]);
		rig.view.handleInput("\x13");
		rig.view.handleInput("\x1b");
		expect(rig.text()).toContain("vendor/one");
	});

	test("catalog, rules, edit and save screens fit widths, sanitize names and clamp scroll", () => {
		const rig = open();
		for (const key of ["", "\r", "\x1b", " ", "\x13", "\x1b", "v", "j", "j", "j"]) {
			if (key) rig.view.handleInput(key);
			for (const width of [36, 57, 80, 140]) {
				const body = rig.view.render(width, 3);
				expect(body.lines.length).toBeLessThanOrEqual(3);
				for (const line of [...body.lines, body.description ?? "", body.state ?? ""]) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					expect(stripVTControlCharacters(line)).not.toContain("evil");
				}
				expect(body.above).toBeGreaterThanOrEqual(0);
				expect(body.below).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
