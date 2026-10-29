import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	type KeybindingsConfig,
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { SaveScope } from "../../src/core/config/index.ts";
import type { SaveOutcome } from "../../src/core/config/save.ts";
import type { ModelAlias } from "../../src/models/aliases/index.ts";
import { compileModelRules, evaluateModelRules } from "../../src/models/rules/match.ts";
import { AuthDashboard, staticViews } from "../../src/ui/dashboard/index.ts";
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
	bindings: KeybindingsConfig = {},
	outcome?: (rules: readonly string[], scope: SaveScope) => SaveOutcome,
	presentation?: () => { showProvenance: boolean; showMatchedRule: boolean },
) {
	let stored = [...initial];
	const saves: { rules: readonly string[]; scope: SaveScope }[] = [];
	let onRefresh: (() => void) | undefined;
	let onDiscard: (() => void) | undefined;
	const keys = new KeybindingsManager(TUI_KEYBINDINGS, bindings);
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
		confirmDiscard: (discard) => {
			onDiscard = discard;
		},
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
			const result =
				outcome?.(rules, scope) ??
				(fail
					? { committed: false, error: "save failed; retry" }
					: { committed: true, scope, shadowed: [], warnings: [] });
			if (result.committed) {
				stored = [...rules];
				saves.push({ rules: [...rules], scope });
			}
			return result;
		},
	};
	if (details) deps.details = details;
	if (presentation) deps.presentation = presentation;
	const view = new ModelsView(host, deps);
	return {
		view,
		saves,
		stored: () => stored,
		confirmDiscard: () => {
			const discard = onDiscard;
			onDiscard = undefined;
			discard?.();
		},
		text: () => {
			const body = view.render(140, 30);
			return [body.state ?? "", ...body.lines].map(stripVTControlCharacters).join("\n");
		},
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

function dashboard(
	saveAlias: (aliases: readonly ModelAlias[], scope: SaveScope) => Promise<SaveOutcome> = async (
		_aliases,
		scope,
	) => ({ committed: true, scope, shadowed: [], warnings: [] }),
	saveOverride: () => Promise<void> = async () => {},
	saveRules: (rules: readonly string[], scope: SaveScope) => Promise<SaveOutcome> = async (
		_rules,
		scope,
	) => ({ committed: true, scope, shadowed: [], warnings: [] }),
	rows = 40,
) {
	let modelHost: TabViewHost | undefined;
	let modelView: ModelsView | undefined;
	let closed = 0;
	const keys = new KeybindingsManager(TUI_KEYBINDINGS);
	const views = staticViews({ providers: [], nowMs: 0 });
	views.models = (host) => {
		modelHost = host;
		modelView = new ModelsView(host, {
			rules: () => [],
			catalog: () => [{ provider: "vendor", id: "one", name: "First", contextWindow: 1000 }],
			evaluate: (rules, provider, id) => ({
				visible: !evaluateModelRules(compileModelRules(rules), provider, id).hidden,
			}),
			save: saveRules,
			details: {
				read: async () => undefined,
				save: saveOverride,
				aliases: { list: () => [], supported: () => true, save: saveAlias },
			},
		});
		return modelView;
	};
	const panel = new AuthDashboard(
		{ terminal: { rows }, requestRender: () => {} },
		{ fg: (_color, value) => value, bg: (_color, value) => value, bold: (value) => value },
		keys,
		() => closed++,
		views,
		"models",
		0,
	);
	return {
		panel,
		view: () => {
			if (!modelView) throw new Error("models view missing");
			return modelView;
		},
		navigate: () => modelHost?.navigate?.("settings"),
		backToModels: () => modelHost?.navigate?.("models"),
		closed: () => closed,
		text: () => stripVTControlCharacters(panel.render(140).join("\n")),
	};
}

async function openModel(rig: ReturnType<typeof dashboard>) {
	rig.panel.handleInput("v");
	rig.panel.handleInput("\r");
	await Promise.resolve();
}

function openAlias(rig: ReturnType<typeof dashboard>) {
	for (let i = 0; i < 9; i++) rig.panel.handleInput("j");
	rig.panel.handleInput("\r");
}

describe("models tab", () => {
	test("searches and pages 555 models, opens the selection, and hides its exact physical ID", async () => {
		const provider = "provider-with-a-long-common-prefix";
		const catalog: ModelCatalogItem[] = Array.from({ length: 555 }, (_, index) => ({
			provider,
			id: `physical-${String(index).padStart(3, "0")}${index === 5 ? "*with-distinct-tail" : ""}`,
			name: `Human hv model ${index}`,
			contextWindow: 1000,
		}));
		const target = catalog[5];
		if (!target) throw new Error("fixture missing");
		target.aliasSource = "physical-000";
		let stored: readonly string[] = [];
		const reads: string[] = [];
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
				rules: () => [...stored],
				catalog: () => catalog.map((item) => ({ ...item })),
				presentation: () => ({ showProvenance: true, showMatchedRule: true }),
				evaluate: (rules, itemProvider, id) => {
					evaluations++;
					if (rules !== previous) {
						previous = rules;
						compiled = compileModelRules(rules);
						compilations++;
					}
					return { visible: !evaluateModelRules(compiled, itemProvider, id).hidden };
				},
				save: async (rules, scope) => {
					expect(scope).toBe("runtime");
					stored = [...rules];
					return { committed: true, scope, shadowed: [], warnings: [] };
				},
				details: {
					read: async (itemProvider, id) => {
						reads.push(`${itemProvider}/${id}`);
						return undefined;
					},
					save: async () => {},
				},
			},
		);
		view.render(36, 6);
		view.handleInput("v");
		view.handleInput("/");
		for (const char of "Human hv") view.handleInput(char);
		let body = view.render(36, 6);
		expect(body.state).toContain("1–5 of 555");
		expect(body.lines.join(" ")).toContain("Human hv");
		const baselineEvaluations = evaluations;
		const baselineCompilations = compilations;
		view.handleInput("\x1b[6~");
		body = view.render(36, 6);
		expect(body.state).toContain("6–10 of 555");
		expect(body.lines.join(" ")).toContain("listed");
		expect(view.render(140, 6).lines.join(" ")).toContain("alias of physical-000");
		view.handleInput("\r");
		await Promise.resolve();
		expect(reads).toEqual([`${provider}/${target.id}`]);
		view.handleInput("\x1b");
		view.handleInput("?");
		view.handleInput("h");
		view.handleInput("v");
		let fullDetail = "";
		for (let i = 0; i < 30; i++) {
			body = view.render(36, 2);
			expect(body.state).toContain("listed");
			for (const line of body.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
			fullDetail += body.lines.map(stripVTControlCharacters).join("");
			if (body.below === 0) break;
			view.handleInput("\x1b[B");
		}
		expect(fullDetail).toContain(`${provider}/${target.id}`);
		expect(fullDetail).toContain(target.name);
		view.handleInput("\x1b");
		view.handleInput("v");
		view.handleInput("v");
		view.handleInput("h");
		expect(evaluations).toBe(baselineEvaluations);
		expect(compilations).toBe(baselineCompilations);
		body = view.render(36, 6);
		expect(body.state).toContain("hidden");
		expect(body.state).toContain("●");
		expect(view.render(140, 6).state).toContain("1 hidden");
		expect(body.lines.join(" ")).toContain("hidden");
		expect(evaluations).toBe(baselineEvaluations + 555);
		expect(compilations).toBe(baselineCompilations + 1);
		view.render(36, 6);
		expect(evaluations).toBe(baselineEvaluations + 555);
		expect(compilations).toBe(baselineCompilations + 1);
		view.handleInput("\x13");
		view.handleInput("r");
		await Promise.resolve();
		expect(stored).toEqual([`${provider}/physical-005\\*with-distinct-tail`]);
	});

	test("search and inspection unwind before returning to rules; rebound picker keys win", async () => {
		const reads: string[] = [];
		const rig = open(
			[],
			false,
			[{ provider: "vendor", id: "hv", name: "Human hv", contextWindow: 1000 }],
			{
				read: async (provider, id) => {
					reads.push(`${provider}/${id}`);
					return undefined;
				},
				save: async () => {},
			},
			{ "tui.select.pageDown": "v", "tui.select.confirm": "h" },
		);
		rig.view.handleInput("v");
		rig.view.render(80, 2);
		rig.view.handleInput("/");
		rig.view.handleInput("h");
		rig.view.handleInput("v");
		expect(rig.view.render(80, 2).state).toContain("1–1 of 1");
		rig.view.handleInput("\x1b");
		expect(rig.view.render(80, 2).state).toContain("of 4");
		rig.view.handleInput("/");
		rig.view.handleInput("\x1b[200~VENDOR/TWO\x1b[201~");
		expect(rig.view.render(80, 2).lines.map(stripVTControlCharacters).join(" ")).toContain(
			"vendor/two",
		);
		rig.view.handleInput("\x1b");
		rig.view.handleInput("v");
		expect(rig.view.render(80, 2).lines.map(stripVTControlCharacters).join(" ")).toContain(
			"❯ listed vendor/two",
		);
		const refreshed = rig.nextRefresh();
		rig.view.handleInput("h");
		await refreshed;
		expect(reads).toEqual(["vendor/two"]);
		rig.view.handleInput("\x1b");
		rig.view.handleInput("?");
		rig.view.handleInput("\x1b");
		expect(rig.view.render(80, 2).state).toContain("of 4");
		rig.view.handleInput("\x1b");
		expect(rig.view.render(80, 2).lines.join(" ")).toContain("Rules");
	});

	test("narrow catalog footer keeps visibility and return actions legible", () => {
		const rig = dashboard();
		rig.panel.handleInput("v");
		const screen = stripVTControlCharacters(rig.panel.render(36).join("\n"));
		expect(screen).toContain("h hide/show");
		expect(screen).toContain("v rules");
		expect(screen).toContain("esc back");
		rig.panel.dispose();
	});

	test("compact dashboard keeps selected visibility visible during search and inspection", () => {
		const rig = dashboard(undefined, undefined, undefined, 10);
		rig.panel.handleInput("v");
		rig.panel.handleInput("h");
		rig.panel.handleInput("/");
		for (const width of [36, 57, 80, 140]) {
			const lines = rig.panel.render(width);
			expect(stripVTControlCharacters(lines.join(" "))).toContain("hidden");
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		rig.panel.handleInput("\t");
		rig.panel.handleInput("?");
		for (const width of [36, 57, 80, 140]) {
			const lines = rig.panel.render(width);
			expect(stripVTControlCharacters(lines.join(" "))).toContain("hidden");
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		rig.panel.dispose();
	});

	test("dashboard keeps changed nested override and alias input across another tab's cancelled exit", async () => {
		for (const alias of [false, true]) {
			const rig = dashboard();
			await openModel(rig);
			if (alias) openAlias(rig);
			rig.panel.handleInput("\r");
			rig.panel.handleInput("\x01");
			rig.panel.handleInput("\x0b");
			rig.panel.handleInput(alias ? "pending-alias" : "pending-override");
			expect(rig.view().hasDrafts()).toBe(true);
			rig.navigate();
			rig.panel.handleInput("\x1b");
			expect(rig.text()).toContain("Discard all & exit?");
			rig.panel.handleInput("\x1b");
			expect(rig.closed()).toBe(0);
			rig.backToModels();
			expect(rig.text()).toContain(alias ? "pending-alias" : "pending-override");
			rig.panel.handleInput("\x03");
			rig.panel.handleInput("\r");
			expect(rig.closed()).toBe(1);
		}
	});

	test("unfinished rule input is guarded and canceling the field restores a clean view", () => {
		const rig = dashboard();
		rig.panel.handleInput("a");
		expect(rig.view().hasDrafts()).toBe(false);
		rig.panel.handleInput("draft-rule");
		expect(rig.view().hasDrafts()).toBe(true);
		rig.panel.handleInput("\x03");
		expect(rig.text()).toContain("Discard all & exit?");
		rig.panel.handleInput("\x1b");
		expect(rig.text()).toContain("draft-rule");
		rig.panel.handleInput("\x1b");
		expect(rig.view().hasDrafts()).toBe(false);
		rig.panel.handleInput("\x1b");
		expect(rig.closed()).toBe(1);
	});

	test("unchanged override input is clean and a changed input can be discarded", async () => {
		const rig = dashboard();
		await openModel(rig);
		rig.panel.handleInput("\r");
		expect(rig.view().hasDrafts()).toBe(false);
		rig.panel.handleInput(" edited");
		expect(rig.view().hasDrafts()).toBe(true);
		rig.view().discardDrafts();
		expect(rig.view().hasDrafts()).toBe(false);
		expect(rig.text()).toContain("Name · First");
		expect(rig.text()).not.toContain("Name · First · default");
		rig.panel.dispose();
	});

	test("confirmed child backs discard only their own drafts and root escape asks for rules", async () => {
		const rig = dashboard();
		rig.panel.handleInput("a");
		rig.panel.handleInput("vendor/one");
		rig.panel.handleInput("\r");
		await openModel(rig);
		rig.panel.handleInput("\r");
		rig.panel.handleInput("\x01");
		rig.panel.handleInput("\x0b");
		rig.panel.handleInput("parent override");
		rig.panel.handleInput("\r");
		openAlias(rig);
		rig.panel.handleInput("\r");
		rig.panel.handleInput("child-alias");
		rig.panel.handleInput("\r");
		rig.panel.handleInput("\x1b");
		expect(rig.text()).toContain("Discard this draft?");
		rig.panel.handleInput("\x1b");
		expect(rig.text()).toContain("child-alias");
		rig.panel.handleInput("\x1b");
		rig.panel.handleInput("\r");
		expect(rig.text()).toContain("parent override");
		expect(rig.view().hasDrafts()).toBe(true);
		rig.panel.handleInput("\x1b");
		expect(rig.text()).toContain("Discard this draft?");
		rig.panel.handleInput("\r");
		expect(rig.text()).toContain("provider/id or name");
		rig.panel.handleInput("v");
		expect(rig.text()).toContain("vendor/one");
		rig.panel.handleInput("\x1b");
		expect(rig.text()).toContain("Discard all & exit?");
		rig.panel.handleInput("\x1b");
		expect(rig.text()).toContain("vendor/one");
		rig.panel.handleInput("\x1b");
		rig.panel.handleInput("\r");
		expect(rig.closed()).toBe(1);
	});

	test("committed alias warning remains visible in the owning model detail", async () => {
		const pending = Promise.withResolvers<SaveOutcome>();
		const rig = dashboard(() => pending.promise);
		await openModel(rig);
		openAlias(rig);
		rig.panel.handleInput("\r");
		rig.panel.handleInput("copy");
		rig.panel.handleInput("\r");
		rig.panel.handleInput("\x13");
		rig.panel.handleInput("u");
		pending.resolve({
			committed: true,
			scope: "user",
			shadowed: ["models.aliases"],
			warnings: ["refresh failed"],
		});
		await Promise.resolve();
		expect(rig.text()).toContain(
			"Saved to user scope; shadowed by higher scope: models.aliases; warning: refresh failed",
		);
		expect(rig.text()).toContain("+ new alias");
		for (const width of [36, 57, 80, 140]) {
			const lines = rig.panel.render(width).map(stripVTControlCharacters);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(lines.join(" ").replace(/\s+/g, " ")).toContain("warning: refresh failed");
		}
		expect(rig.view().hasDrafts()).toBe(false);
		rig.panel.dispose();
	});

	test("pending alias save blocks dashboard navigation and exit until failure", async () => {
		const pending = Promise.withResolvers<SaveOutcome>();
		const rig = dashboard(() => pending.promise);
		await openModel(rig);
		openAlias(rig);
		rig.panel.handleInput("\r");
		rig.panel.handleInput("pending-alias");
		rig.panel.handleInput("\r");
		rig.panel.handleInput("\x13");
		rig.panel.handleInput("r");
		expect(rig.view().isSaving()).toBe(true);
		rig.navigate();
		rig.panel.handleInput("\x03");
		rig.panel.handleInput("\x1b");
		expect(rig.panel.tab).toBe("models");
		expect(rig.closed()).toBe(0);
		pending.resolve({ committed: false, error: "write failed; retry" });
		await Promise.resolve();
		expect(rig.view().isSaving()).toBe(false);
		expect(rig.text()).toContain("write failed; retry");
		expect(rig.text()).toContain("pending-alias");
		rig.panel.dispose();
	});
	test("pending physical override save blocks every dashboard exit and retains drafts on failure", async () => {
		const pending = Promise.withResolvers<void>();
		const rig = dashboard(undefined, () => pending.promise);
		await openModel(rig);
		rig.panel.handleInput("\r");
		rig.panel.handleInput(" edited");
		rig.panel.handleInput("\r");
		rig.panel.handleInput("\x13");
		expect(rig.view().isSaving()).toBe(true);
		rig.view().discardDrafts();
		rig.panel.handleInput("\x1b");
		rig.navigate();
		rig.panel.handleInput("\x03");
		expect(rig.panel.tab).toBe("models");
		expect(rig.closed()).toBe(0);
		pending.reject(new Error("models.json locked; retry"));
		await Promise.resolve();
		expect(rig.view().isSaving()).toBe(false);
		expect(rig.view().hasDrafts()).toBe(true);
		expect(rig.text()).toContain("models.json locked; retry");
		expect(rig.text()).toContain("First edited");
		rig.panel.dispose();
	});

	test("pending rule save also blocks dashboard navigation and exit", async () => {
		const pending = Promise.withResolvers<SaveOutcome>();
		const rig = dashboard(undefined, undefined, () => pending.promise);
		rig.panel.handleInput("a");
		rig.panel.handleInput("vendor/one");
		rig.panel.handleInput("\r");
		rig.panel.handleInput("\x13");
		rig.panel.handleInput("r");
		expect(rig.view().isSaving()).toBe(true);
		rig.view().discardDrafts();
		rig.navigate();
		rig.panel.handleInput("\x03");
		expect(rig.panel.tab).toBe("models");
		expect(rig.closed()).toBe(0);
		expect(rig.view().hasDrafts()).toBe(true);
		pending.resolve({ committed: true, scope: "runtime", shadowed: [], warnings: [] });
		await Promise.resolve();
		expect(rig.view().isSaving()).toBe(false);
		expect(rig.view().hasDrafts()).toBe(false);
		rig.panel.dispose();
	});

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
				save: async (_rules, scope) => ({
					committed: true,
					scope,
					shadowed: [],
					warnings: [],
				}),
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
		expect(evaluations).toBe(initialEvaluations);
		expect(compilations - before).toBeLessThanOrEqual(3);
		view.handleInput("j");
		body = render();
		expect(body.description).toContain("changes 1 model;");
		expect(body.lines.join("\n")).toContain("vendor/* · 550 hidden");
		expect(body.lines.join("\n")).toContain("!vendor/model-1 · 1 shown");
		expect(body.lines.join("\n")).toContain("unmatched/rule-0 · 0 changes");

		view.handleInput(" ");
		before = compilations;
		body = render();
		expect(body.state).toContain("550 hidden");
		expect(body.description).toContain("changes 0 models");
		expect(body.lines.join("\n")).toContain("#!vendor/model-1 · 0 changes");
		expect(compilations - before).toBeLessThanOrEqual(3);
		expect(view.handleInput("\x1b")).toBe(false);
		view.discardDrafts();
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
		expect(lines).toContain("listed vendor/renamed · Renamed");
		expect(lines).toContain("hidden vendor/model-1 · Added");
		expect(lines.indexOf("listed other/model-111")).toBeLessThan(
			lines.indexOf("listed vendor/renamed"),
		);
		renamed.name = "Updated name";
		const beforeMetadataChange = evaluations;
		body = view.render(140, 600);
		expect(body.lines.join("\n")).toContain("listed vendor/renamed · Updated name");
		expect(evaluations).toBeGreaterThan(beforeMetadataChange);
		catalog.reverse();
		body = view.render(140, 600);
		lines = body.lines.join("\n");
		expect(lines.indexOf("hidden vendor/model-1 · Added")).toBeLessThan(
			lines.indexOf("listed other/model-111"),
		);
		expect(lines).toContain("❯ listed other/model-0");
		view.handleInput("/");
		view.handleInput("Added");
		view.handleInput("\t");
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

	test("live presentation explains accepted aliases, winning rules and override sources", async () => {
		const presentation = { showProvenance: false, showMatchedRule: false };
		const alias: ModelCatalogItem = {
			provider: "vendor",
			id: "copy",
			name: "Copy",
			contextWindow: 4096,
			aliasSource: "one\x1b]0;evil\x07",
		};
		const rig = open(
			["vendor/*", "!vendor/copy", "vendor/copy"],
			false,
			[alias],
			{ read: async () => ({ contextWindow: 1200 }), save: async () => {} },
			{},
			undefined,
			() => presentation,
		);
		let body = rig.view.render(140, 30);
		let lines = body.lines.map(stripVTControlCharacters).join("\n");
		expect(lines).toContain("vendor/* · 3 hidden");
		expect(lines).toContain("!vendor/copy · 1 shown");
		expect(lines).toContain("vendor/copy · 1 hidden");
		rig.view.handleInput("v");
		rig.view.handleInput("/");
		rig.view.handleInput("vendor/copy");
		rig.view.handleInput("\t");
		expect(rig.text()).toContain("hidden vendor/copy · Copy");
		expect(rig.text()).not.toContain("alias of");
		expect(rig.text()).not.toContain("rule 3");
		presentation.showProvenance = true;
		expect(rig.text()).toContain("hidden · alias of one vendor/copy · Copy");
		expect(rig.text()).not.toContain("rule 3");
		presentation.showMatchedRule = true;
		expect(rig.text()).toContain("hidden · alias of one · rule 3 vendor/copy · Copy");
		presentation.showProvenance = false;
		expect(rig.text()).toContain("hidden · rule 3 vendor/copy · Copy");
		expect(rig.text()).not.toContain("alias of");
		presentation.showProvenance = true;
		for (const width of [36, 57, 80, 140]) {
			body = rig.view.render(width, 6);
			lines = body.lines.map(stripVTControlCharacters).join("\n");
			expect(lines).toContain("hidden");
			expect(lines).toContain("vendor/copy");
			expect(lines).not.toContain("evil");
			for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		const opened = rig.nextRefresh();
		rig.view.handleInput("\r");
		await opened;
		expect(rig.text()).toContain("vendor/copy");
		expect(rig.text()).toContain("Visibility · hidden");
		expect(rig.text()).toContain("Alias of · vendor/one");
		expect(rig.text()).toContain("Matched rule · 3");
		expect(rig.text()).toContain("Name · Copy · default");
		expect(rig.text()).toContain("Context window · 1200 · override");
		alias.aliasSource = "two";
		expect(rig.text()).toContain("Alias of · vendor/two");
		presentation.showProvenance = false;
		presentation.showMatchedRule = false;
		expect(rig.text()).toContain("vendor/copy");
		expect(rig.text()).toContain("Visibility · hidden");
		expect(rig.text()).toContain("Context window · 1200");
		expect(rig.text()).not.toContain("Alias of");
		expect(rig.text()).not.toContain("Matched rule");
		expect(rig.text()).not.toContain("· override");
		expect(rig.text()).not.toContain("· default");
		rig.view.handleInput("\r");
		rig.view.handleInput(" edited");
		rig.view.handleInput("\r");
		expect(rig.text()).toContain("Name · Copy edited · staged");
		presentation.showProvenance = true;
		presentation.showMatchedRule = true;
		expect(rig.text()).toContain("Name · Copy edited · override (staged)");
		expect(rig.text()).toContain("Matched rule · 3");
		presentation.showProvenance = false;
		presentation.showMatchedRule = false;
		expect(rig.text()).toContain("Name · Copy edited · staged");
		rig.view.handleInput("j");
		rig.view.handleInput("\x7f");
		expect(rig.text()).toContain("Context window · unknown · inherit (staged)");
		for (const width of [36, 57, 80, 140]) {
			body = rig.view.render(width, 6);
			lines = body.lines.map(stripVTControlCharacters).join("\n");
			expect(lines.split("\n").find((line) => line.includes("Context window"))).toContain("staged");
			expect(body.state).toContain("hidden");
			for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		rig.view.discardDrafts();
		rig.view.handleInput("\x1b");
		rig.view.handleInput("\x1b");
		rig.view.handleInput("/");
		rig.view.handleInput("other/three");
		rig.view.handleInput("\t");
		presentation.showProvenance = true;
		presentation.showMatchedRule = true;
		expect(rig.text()).toContain("listed other/three · Third");
		expect(rig.text()).not.toContain("alias of");
		expect(rig.text()).not.toContain("rule ");
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
					return { committed: true, scope, shadowed: [], warnings: [] };
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
				save: async (aliases, scope) => {
					saves.push(aliases);
					return { committed: true, scope, shadowed: [], warnings: [] };
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
		rig.confirmDiscard();
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
		const rig = open([], false, [], details, {}, undefined, () => ({
			showProvenance: true,
			showMatchedRule: false,
		}));
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
		rig.confirmDiscard();
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
		const rig = open([], false, [], details, {}, undefined, () => ({
			showProvenance: true,
			showMatchedRule: false,
		}));
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
			{},
			undefined,
			() => ({ showProvenance: true, showMatchedRule: false }),
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
		const rig = open(
			[],
			false,
			[],
			{
				read: async () => {
					throw new Error("bad file");
				},
				save: async () => {
					saved = true;
				},
			},
			{},
			undefined,
			() => ({ showProvenance: true, showMatchedRule: true }),
		);
		rig.view.handleInput("v");
		const opened = rig.nextRefresh();
		rig.view.handleInput("\r");
		await opened;
		expect(rig.text()).toContain("Read failed");
		expect(rig.text()).not.toContain("· default");
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
		expect(rig.view.handleInput("\x1b")).toBe(false);
		expect(rig.text()).toContain("vendor/two");
		rig.view.discardDrafts();
		expect(rig.text()).not.toContain("vendor/two");
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
		expect(rig.text()).toContain("listed vendor/star-other-id");
		await save(rig, "r");
		expect(rig.stored()).toEqual(["vendor/star\\*id"]);
	});

	test("uncommitted rules can retry and committed outcomes report each selected scope", async () => {
		for (const [target, scope] of [
			["u", "user"],
			["p", "project"],
			["r", "runtime"],
		] as const) {
			const attempts: { rules: readonly string[]; scope: SaveScope }[] = [];
			const rig = open([], false, [], undefined, {}, (rules, attemptedScope) => {
				attempts.push({ rules: [...rules], scope: attemptedScope });
				return attempts.length === 1
					? { committed: false, error: "write failed; retry" }
					: {
							committed: true,
							scope: attemptedScope,
							shadowed: ["models.rules"],
							warnings: ["refresh failed"],
						};
			});
			rig.view.handleInput("a");
			rig.view.handleInput("vendor/one");
			rig.view.handleInput("\r");
			const rules = ["vendor/one"];

			await save(rig, target);
			expect(rig.view.hasDrafts()).toBe(true);
			expect(rig.text()).toContain("Save failed: write failed; retry");
			expect(rig.text()).toContain("vendor/one");
			expect(rig.stored()).toEqual([]);

			await save(rig, target);
			expect(attempts).toEqual([
				{ rules, scope },
				{ rules, scope },
			]);
			expect(rig.saves).toEqual([{ rules, scope }]);
			expect(rig.view.hasDrafts()).toBe(false);
			expect(rig.stored()).toEqual(rules);
			expect(rig.text()).toContain(
				`Saved to ${scope} scope; shadowed by higher scope: models.rules; warning: refresh failed`,
			);
		}
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
