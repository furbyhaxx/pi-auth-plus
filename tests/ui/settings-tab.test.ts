import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { type SaveScope, SettingsStore } from "../../src/core/config/index.ts";
import { createSettingsSaver, type SettingsSaver } from "../../src/core/config/save.ts";
import { AuthDashboard, staticViews } from "../../src/ui/dashboard/index.ts";
import { type SettingsTabDeps, SettingsView } from "../../src/ui/dashboard/settings.ts";
import type { DashboardResult, TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "settings-tab-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function open(
	select = "quotas.refreshOnRequest",
	previewTemplate?: SettingsTabDeps["previewTemplate"],
	trusted = true,
	options?: {
		providerOptions?: SettingsTabDeps["providerOptions"];
		keys?: KeybindingsManager;
	},
) {
	const user = join(dir, "user.json");
	const project = join(dir, "project.json");
	const store = new SettingsStore(SETTINGS, trusted ? { user, project } : { user });
	const saved: { keys: readonly string[]; scope: SaveScope }[] = [];
	let save: SettingsSaver = createSettingsSaver(() => ({
		store,
		signal: new AbortController().signal,
		apply: async (keys, scope) => {
			saved.push({ keys, scope });
			return [];
		},
	}));
	const finished: DashboardResult[] = [];
	let onRefresh: (() => void) | undefined;
	let pendingDiscard: (() => void) | undefined;
	const keys = options?.keys ?? new KeybindingsManager(TUI_KEYBINDINGS);
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
		finish: (result) => {
			finished.push(result);
		},
		confirmDiscard: (discard) => {
			pendingDiscard = discard;
		},
	};
	const view = new SettingsView(
		host,
		{
			store: () => store,
			save: (scope, changes) => save(scope, changes),
			...(previewTemplate ? { previewTemplate } : {}),
			...(options?.providerOptions ? { providerOptions: options.providerOptions } : {}),
		},
		select,
	);
	const text = () => view.render(140, 30).lines.map(stripVTControlCharacters).join("\n");
	return {
		view,
		host,
		store,
		saved,
		finished,
		text,
		user,
		project,
		confirmDiscard: () => {
			const discard = pendingDiscard;
			pendingDiscard = undefined;
			discard?.();
		},
		hasConfirmation: () => pendingDiscard !== undefined,
		select: (label: string) => {
			for (let i = 0; i < 80; i++) {
				const lines = view.render(140, 80).lines.map(stripVTControlCharacters);
				if (lines.some((line) => line.includes("❯") && line.includes(label))) return;
				view.handleInput("j");
			}
			throw new Error(`Cannot select ${label}`);
		},
		setSave: (next: SettingsSaver) => {
			save = next;
		},
		nextRefresh: () =>
			new Promise<void>((resolve) => {
				onRefresh = resolve;
			}),
	};
}

async function save(rig: ReturnType<typeof open>, target: string) {
	rig.view.handleInput("\x13");
	rig.view.handleInput(target);
	await rig.nextRefresh();
}

describe("settings tab", () => {
	test("edits remain staged until saved to exactly the chosen scope", async () => {
		for (const [target, scope] of [
			["u", "user"],
			["p", "project"],
			["r", "runtime"],
		] as const) {
			const rig = open();
			rig.view.handleInput(" ");
			expect(rig.store.get("quotas.refreshOnRequest")).toBe(true);
			expect(rig.text()).toContain("● staged");
			await save(rig, target);
			expect(rig.saved).toEqual([{ keys: ["quotas.refreshOnRequest"], scope }]);
			expect(rig.store.sourceOf("quotas.refreshOnRequest")).toBe(scope);
			expect(rig.store.get("quotas.refreshOnRequest")).toBe(false);
			for (const [path, fileScope] of [
				[rig.user, "user"],
				[rig.project, "project"],
			]) {
				expect(existsSync(path ?? "")).toBe(fileScope === scope);
				if (path && existsSync(path)) {
					expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
						quotas: { refreshOnRequest: false },
					});
					rmSync(path);
				}
			}
		}
	});

	test("saving under a higher scope warns without losing the chosen scope's value", async () => {
		const rig = open();
		await rig.store.save("runtime", { "quotas.refreshOnRequest": true });
		rig.view.handleInput(" ");
		await save(rig, "u");
		expect(rig.text()).toContain("shadowed by higher scope: quotas.refreshOnRequest");
		expect(rig.store.get("quotas.refreshOnRequest")).toBe(true);
		expect(JSON.parse(readFileSync(rig.user, "utf8"))).toEqual({
			quotas: { refreshOnRequest: false },
		});
	});

	test("top-level cancel leaves staged edits for the dashboard to confirm", () => {
		const rig = open();
		rig.view.handleInput(" ");
		expect(rig.view.hasDrafts?.()).toBe(true);
		expect(rig.view.handleInput("\x1b")).toBe(false);
		expect(rig.text()).toContain("● staged");
		rig.view.discardDrafts?.();
		expect(rig.view.hasDrafts?.()).toBe(false);
		expect(rig.text()).not.toContain("● staged");
		expect(rig.view.handleInput("\t")).toBe(false);
	});

	test("unfinished input is a draft only when changed, and field cancel keeps other drafts", () => {
		const rig = open("quotas.lineTemplate");
		rig.view.handleInput("\r");
		expect(rig.view.hasDrafts?.()).toBe(false);
		rig.view.handleInput("!");
		expect(rig.view.hasDrafts?.()).toBe(true);
		expect(rig.view.handleInput("\x1b")).toBe(true);
		expect(rig.view.hasDrafts?.()).toBe(false);
		rig.view.handleInput("\x7f");
		rig.view.handleInput("\r");
		rig.view.handleInput("!");
		rig.view.handleInput("\x1b");
		expect(rig.view.hasDrafts?.()).toBe(true);
		expect(rig.text()).toContain("● staged");
	});

	test("failed save preserves staged and unfinished input; committed warnings clear both", async () => {
		const rig = open("quotas.lineTemplate");
		await rig.store.save("runtime", { "quotas.lineTemplate": "runtime-value" });
		const pending = Promise.withResolvers<Awaited<ReturnType<SettingsSaver>>>();
		const calls: Parameters<SettingsSaver>[] = [];
		rig.setSave(async (scope, changes) => {
			calls.push([scope, structuredClone(changes)]);
			return pending.promise;
		});
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("staged-value");
		rig.view.handleInput("\r");
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("unfinished-value");
		rig.view.handleInput("\x13");
		rig.view.handleInput("r");
		expect(rig.view.isSaving?.()).toBe(true);
		expect(calls).toEqual([["runtime", { "quotas.lineTemplate": "unfinished-value" }]]);
		const failed = rig.nextRefresh();
		pending.resolve({ committed: false, error: "disk rejected changes" });
		await failed;
		expect(rig.view.isSaving?.()).toBe(false);
		expect(rig.view.hasDrafts?.()).toBe(true);
		expect(rig.text()).toContain("unfinished-value");
		expect(rig.text()).toContain("● staged");
		expect(rig.text()).toContain("disk rejected changes");
		expect(stripVTControlCharacters(rig.view.render(36, 1).fullFeedback?.[0] ?? "")).toBe(
			"disk rejected changes",
		);

		rig.setSave(
			createSettingsSaver(() => ({
				store: rig.store,
				signal: new AbortController().signal,
				apply: async () => ["Effects failed; retry or reopen the session"],
			})),
		);
		await save(rig, "u");
		expect(rig.store.get("quotas.lineTemplate")).toBe("runtime-value");
		expect(JSON.parse(readFileSync(rig.user, "utf8"))).toEqual({
			quotas: { lineTemplate: "unfinished-value" },
		});
		expect(rig.view.hasDrafts?.()).toBe(false);
		expect(rig.text()).not.toContain("● staged");
		const message = rig.view.render(80, 30).lines.map(stripVTControlCharacters).join(" ");
		expect(message.replace(/\s+/g, " ")).toContain(
			"Saved to user scope; shadowed by higher scope: quotas.lineTemplate; warning: Effects failed; retry or reopen the session",
		);
	});

	test("saving edited input validates it and cancelling scope keeps it unstaged", async () => {
		const rig = open("quotas.compactWidthCols");
		rig.view.handleInput("l");
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("bad");
		rig.view.handleInput("\x13");
		expect(rig.text()).toContain("Invalid value");
		expect(stripVTControlCharacters(rig.view.render(36, 1).fullFeedback?.[0] ?? "")).toBe(
			"Invalid value for Compact width; edit and retry",
		);
		expect(rig.saved).toEqual([]);
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("115");
		rig.view.handleInput("\x13");
		expect(rig.text()).toContain("Save:");
		rig.view.handleInput("\x1b");
		expect(rig.text()).toContain("115");
		rig.view.handleInput("\x1b");
		expect(rig.text()).toContain("105");
		await save(rig, "r");
		expect(rig.store.get("quotas.compactWidthCols")).toBe(105);
	});

	test("full help retains the setting description, save warning and rebound key", async () => {
		const keys = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "j" });
		const rig = open("dashboard.maxBodyRows", undefined, true, { keys });
		const description = SETTINGS["dashboard.maxBodyRows"].description;
		const warning = "A long warning with its complete explanation\nincluding the second line";
		rig.setSave(async (scope) => ({ committed: true, scope, shadowed: [], warnings: [warning] }));

		let body = rig.view.render(36, 1);
		expect(stripVTControlCharacters(body.fullDescription ?? "")).toBe(description);
		expect(body.fullHints?.some((hint) => hint.key === "j")).toBe(true);
		for (const line of [...body.lines, body.description ?? ""])
			expect(visibleWidth(line)).toBeLessThanOrEqual(36);

		rig.view.handleInput("l");
		await save(rig, "u");
		body = rig.view.render(36, 1);
		expect(stripVTControlCharacters(body.fullFeedback?.[0] ?? "")).toBe(
			`Saved to user scope; warning: ${warning}`,
		);
		for (const line of body.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
	});

	test("long save outcomes remain readable across result pages", async () => {
		const rig = open();
		rig.setSave(async (scope) => ({
			committed: true,
			scope,
			shadowed: ["quotas.refreshOnRequest", "quotas.lineTemplate"],
			warnings: [
				"First warning with details about a failed effect",
				"Second warning with more important details",
				"Final warning requires the user to retry",
			],
		}));
		rig.view.handleInput(" ");
		await save(rig, "u");
		const pages: string[] = [];
		for (let i = 0; i < 10; i++) {
			const lines = rig.view.render(36, 4).lines;
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
			pages.push(lines.map(stripVTControlCharacters).join(" "));
			rig.view.handleInput("\x1b[6~");
		}
		const all = pages.join(" ").replace(/\s+/g, " ");
		expect(all).toContain("Saved to user scope;");
		expect(all).toContain("shadowed by higher scope:");
		expect(all).toContain("quotas.refreshOnRequest");
		expect(all).toContain("quotas.lineTemplate");
		expect(all).toContain("First warning");
		expect(all).toContain("Second warning");
		expect(all).toContain("Final warning requires the user to retry");
		rig.view.handleInput("\x1b[5~");
		expect(rig.view.render(36, 4).lines.map(stripVTControlCharacters).join(" ")).not.toBe(
			pages.at(-1),
		);
	});

	test("scope choices intersect staged non-null fields and allow legacy removals", async () => {
		const rig = open("models.rulesScope");
		rig.view.handleInput(" ");
		rig.view.handleInput("j");
		rig.view.handleInput(" ");
		rig.view.handleInput("\x13");
		expect(rig.text()).not.toContain("p project");
		expect(rig.view.render(140, 30).hints.map((hint) => hint.key)).not.toContain("p");
		expect(rig.view.render(140, 30).fullHints?.map((hint) => hint.key)).not.toContain("p");
		rig.view.handleInput("p");
		expect(rig.saved).toEqual([]);
		expect(rig.text()).not.toContain("p project");
		rig.view.handleInput("u");
		await rig.nextRefresh();
		expect(rig.saved[0]?.scope).toBe("user");

		const removal = open("models.rulesScope");
		writeFileSync(removal.project, JSON.stringify({ models: { rulesScope: "user" } }));
		await removal.store.load();
		removal.view.handleInput("\x7f");
		removal.view.handleInput("j");
		removal.view.handleInput(" ");
		removal.view.handleInput("\x13");
		expect(removal.text()).toContain("p project");
		expect(removal.view.render(140, 30).fullHints).toContainEqual(
			expect.objectContaining({ key: "p", action: "project" }),
		);
		removal.view.handleInput("p");
		await removal.nextRefresh();
		expect(removal.saved[0]?.scope).toBe("project");
		expect(JSON.parse(readFileSync(removal.project, "utf8"))).toEqual({
			models: { hiddenDefault: "warn" },
		});
	});

	test("provider detail stages unfinished input and preserves it across failed and successful saves", async () => {
		const optionKeys: string[] = [];
		const rig = open("quotas.providers", undefined, true, {
			providerOptions: (key) => {
				optionKeys.push(key);
				return [{ value: "alpha", label: "Alpha" }];
			},
		});
		rig.view.handleInput("\r");
		expect(optionKeys).toEqual(["quotas.providers"]);
		expect(rig.finished).toEqual([]);
		expect(rig.text()).toContain("[ ] Alpha");
		rig.select("+ Add provider");
		rig.view.handleInput("\r");
		expect(rig.view.hasDrafts()).toBe(false);
		rig.view.handleInput("custom/vendor");
		expect(rig.view.hasDrafts()).toBe(true);
		expect(rig.store.get("quotas.providers")).toEqual([]);
		for (const width of [36, 57, 80, 140]) {
			const body = rig.view.render(width, 2);
			expect(body.modal).toBe(true);
			expect(body.lines.join("")).toContain("\x1b_pi:c\x07");
			for (const line of [...body.lines, body.description ?? "", body.state ?? ""]) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
		rig.view.handleInput("\r");
		rig.view.handleInput("k");
		rig.view.handleInput(" ");
		rig.view.handleInput("\x13");
		expect(rig.saved).toEqual([]);
		rig.view.handleInput("\x1b");
		expect(rig.text()).toContain("● staged");

		const pending = Promise.withResolvers<Awaited<ReturnType<SettingsSaver>>>();
		const calls: Parameters<SettingsSaver>[] = [];
		rig.setSave(async (scope, changes) => {
			calls.push([scope, structuredClone(changes)]);
			return pending.promise;
		});
		rig.view.handleInput("\x13");
		rig.view.handleInput("u");
		expect(rig.view.isSaving()).toBe(true);
		rig.view.discardDrafts();
		expect(rig.view.hasDrafts()).toBe(true);
		expect(calls).toEqual([["user", { "quotas.providers": ["custom/vendor", "alpha"] }]]);
		const failed = rig.nextRefresh();
		pending.resolve({ committed: false, error: "disk rejected changes" });
		await failed;
		expect(rig.view.isSaving()).toBe(false);
		expect(rig.view.hasDrafts()).toBe(true);
		expect(rig.text()).toContain("disk rejected changes");
		rig.view.handleInput("\r");
		expect(rig.text()).toContain("[x] Alpha");
		expect(rig.text()).toContain("custom/vendor");
		rig.view.handleInput("\x1b");

		rig.setSave(
			createSettingsSaver(() => ({
				store: rig.store,
				signal: new AbortController().signal,
				apply: async () => [],
			})),
		);
		await save(rig, "r");
		expect(rig.store.get("quotas.providers")).toEqual(["custom/vendor", "alpha"]);
		expect(rig.view.hasDrafts()).toBe(false);
		rig.view.handleInput("\r");
		expect(rig.text()).toContain("[x] Alpha");
		expect(rig.view.hasDrafts()).toBe(false);
	});

	test("verbosity provider choices and Claude literal rules stage their typed values", async () => {
		const optionKeys: string[] = [];
		const providers = open("openai.verbosityProviders", undefined, true, {
			providerOptions: (key) => {
				optionKeys.push(key);
				return [{ value: "selected", label: "Selected provider" }];
			},
		});
		providers.select("Model rules scope");
		providers.view.handleInput(" ");
		providers.select("Verbosity providers");
		providers.view.handleInput("\r");
		providers.view.handleInput(" ");
		providers.view.handleInput("\x13");
		providers.view.handleInput("\x1b");
		expect(optionKeys).toEqual(["openai.verbosityProviders"]);
		expect(providers.store.get("openai.verbosityProviders")).toEqual(["openai", "openai-codex"]);
		providers.view.handleInput("\x13");
		expect(providers.text()).not.toContain("p project");
		providers.view.handleInput("p");
		expect(providers.saved).toEqual([]);
		providers.view.handleInput("u");
		await providers.nextRefresh();
		expect(providers.store.get("openai.verbosityProviders")).toEqual([
			"openai",
			"openai-codex",
			"selected",
		]);
		expect(providers.finished).toEqual([]);

		const rules = open("claude.replacePatterns");
		rules.view.handleInput("\r");
		rules.view.handleInput("\r");
		rules.view.handleInput("\x13");
		expect(rules.view.hasDrafts()).toBe(true);
		expect(stripVTControlCharacters(rules.view.render(80, 20).description ?? "")).toContain(
			"Match required",
		);
		rules.view.handleInput("\r");
		rules.view.handleInput("literal");
		rules.view.handleInput("\x13");
		rules.view.handleInput("\x1b");
		expect(rules.store.get("claude.replacePatterns")).toEqual([]);
		await save(rules, "r");
		expect(rules.store.get("claude.replacePatterns")).toEqual([
			{ match: "literal", replacement: "" },
		]);
		expect(rules.finished).toEqual([]);
	});

	test("local and global discard include child input and preserve other staged values", () => {
		const rig = open("quotas.providers");
		rig.select("Show dashboard provenance");
		rig.view.handleInput(" ");
		rig.select("Quota providers");
		rig.view.handleInput("\r");
		rig.view.handleInput("\r");
		rig.view.handleInput("unfinished");
		expect(rig.view.hasDrafts()).toBe(true);
		rig.view.handleInput("\x1b");
		expect(rig.hasConfirmation()).toBe(true);
		rig.confirmDiscard();
		expect(rig.text()).toContain("● staged");
		expect(rig.view.hasDrafts()).toBe(true);
		rig.view.handleInput("\r");
		rig.view.handleInput("\r");
		rig.view.handleInput("another draft");
		rig.view.discardDrafts();
		expect(rig.view.hasDrafts()).toBe(false);
		expect(rig.text()).not.toContain("● staged");
		expect(rig.finished).toEqual([]);
	});

	test("discard and disposal invalidate pending child confirmations", () => {
		const rig = open("quotas.providers");
		rig.view.handleInput("\r");
		rig.view.handleInput("\r");
		rig.view.handleInput("old input");
		rig.view.handleInput("\x1b");
		expect(rig.hasConfirmation()).toBe(true);
		rig.view.discardDrafts();
		rig.view.handleInput("\r");
		rig.view.handleInput("\r");
		rig.view.handleInput("new input");
		rig.confirmDiscard();
		expect(rig.view.hasDrafts()).toBe(true);
		expect(rig.text()).toContain("new input");
		rig.view.handleInput("\x1b");
		rig.view.dispose();
		rig.confirmDiscard();
		expect(rig.view.hasDrafts()).toBe(true);
		expect(rig.text()).toContain("new input");
	});

	test("a rebound j confirm opens and operates the collection", async () => {
		const keys = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "j" });
		const rig = open("quotas.providers", undefined, true, {
			keys,
			providerOptions: () => [{ value: "alpha", label: "Alpha" }],
		});
		rig.view.handleInput("j");
		expect(rig.text()).toContain("[ ] Alpha");
		rig.view.handleInput("j");
		rig.view.handleInput("\x13");
		rig.view.handleInput("\x1b");
		await save(rig, "r");
		expect(rig.store.get("quotas.providers")).toEqual(["alpha"]);
	});

	test("rebound confirm retains collection apply and parent save shortcuts", async () => {
		const keys = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "ctrl+s" });
		const rig = open("quotas.providers", undefined, true, {
			keys,
			providerOptions: () => [{ value: "alpha", label: "Alpha" }],
		});
		rig.view.handleInput("\x13");
		expect(rig.text()).toContain("[ ] Alpha");
		rig.view.handleInput("\x13");
		expect(rig.text()).toContain("[x] Alpha");
		expect(rig.view.render(80, 10).hints.some((hint) => hint.key === "ctrl+g")).toBe(true);
		rig.view.handleInput("\x07");
		rig.view.handleInput("\x1b");
		expect(rig.view.render(80, 10).hints.some((hint) => hint.key === "ctrl+g")).toBe(true);
		rig.view.handleInput("\x07");
		rig.view.handleInput("r");
		await rig.nextRefresh();
		expect(rig.store.get("quotas.providers")).toEqual(["alpha"]);
	});

	test("dashboard shrinks around the nested collection and keeps the input cursor", () => {
		const rig = open("quotas.providers");
		const views = staticViews({ providers: [], nowMs: 0 });
		views.settings = (host) =>
			new SettingsView(
				host,
				{
					store: () => rig.store,
					save: createSettingsSaver(() => ({
						store: rig.store,
						signal: new AbortController().signal,
						apply: async () => [],
					})),
				},
				"quotas.providers",
			);
		const panel = new AuthDashboard(
			{ terminal: { rows: 80 }, requestRender: () => {} },
			rig.host.theme,
			rig.host.keys,
			() => {},
			views,
			"settings",
			0,
		);
		const settingsHeight = panel.render(80).length;
		panel.handleInput("\r");
		expect(panel.render(80).length).toBeLessThan(settingsHeight);
		panel.handleInput("\r");
		panel.handleInput("custom");
		for (const width of [36, 57, 80, 140]) {
			const lines = panel.render(width);
			expect(lines.join("")).toContain("\x1b_pi:c\x07");
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		panel.handleInput("\x03");
		expect(panel.render(80).map(stripVTControlCharacters).join("\n")).toContain(
			"Discard all & exit?",
		);
		panel.handleInput("\x1b");
		expect(panel.render(80).join("")).toContain("custom");
		panel.dispose();
	});

	test.each([
		["models.rules", "models"],
		["models.aliases", "models"],
		["models.groups", "groups"],
	] as const)("%s navigates to %s with Settings drafts intact", async (key, tab) => {
		const rig = open(key);
		const views = staticViews({ providers: [], nowMs: 0 });
		views.settings = (host) =>
			new SettingsView(
				host,
				{
					store: () => rig.store,
					save: createSettingsSaver(() => ({
						store: rig.store,
						signal: new AbortController().signal,
						apply: async () => [],
					})),
				},
				key,
			);
		let closed = 0;
		let onRefresh: (() => void) | undefined;
		const panel = new AuthDashboard(
			{ terminal: { rows: 80 }, requestRender: () => onRefresh?.() },
			rig.host.theme,
			rig.host.keys,
			() => closed++,
			views,
			"settings",
			0,
		);
		const select = (label: string) => {
			for (let i = 0; i < 80; i++) {
				const lines = panel.render(140).map(stripVTControlCharacters);
				if (lines.some((line) => line.includes("❯") && line.includes(label))) return;
				panel.handleInput("j");
			}
			throw new Error(`Cannot select ${label}`);
		};
		select("Show dashboard provenance");
		panel.handleInput(" ");
		select(SETTINGS[key].label);
		panel.handleInput("\r");
		expect(panel.tab).toBe(tab);
		expect(closed).toBe(0);
		for (let i = 0; i < 6 && panel.tab !== "settings"; i++) panel.handleInput("\t");
		expect(panel.tab).toBe("settings");
		expect(panel.render(140).map(stripVTControlCharacters).join("\n")).toContain("● staged");
		panel.handleInput("\x03");
		expect(panel.render(140).map(stripVTControlCharacters).join("\n")).toContain(
			"Discard all & exit?",
		);
		panel.handleInput("\x1b");
		panel.handleInput("\x13");
		panel.handleInput("r");
		await new Promise<void>((resolve) => {
			onRefresh = resolve;
		});
		expect(rig.store.get("dashboard.showProvenance")).toBe(true);
		panel.dispose();
	});

	test("failed save retains edits and cancellation leaves them available", async () => {
		const rig = open("quotas.refreshOnRequest", undefined, false);
		rig.view.handleInput(" ");
		await save(rig, "p");
		expect(rig.text()).toContain("trusted");
		expect(rig.text()).toContain("● staged");
		expect(rig.saved).toEqual([]);
		rig.view.handleInput("\x13");
		expect(rig.view.handleInput("\x1b")).toBe(true);
		expect(rig.text()).toContain("● staged");
		writeFileSync(rig.user, "{");
		await save(rig, "u");
		expect(rig.text()).toContain("not valid JSON");
		expect(rig.saved).toEqual([]);
	});

	test("number Input traps navigation, validates, clamps and saves; reset deletes the scoped key", async () => {
		const rig = open("quotas.compactWidthCols");
		rig.view.handleInput("l");
		expect(rig.text()).toContain("105");
		rig.view.handleInput("h");
		rig.view.handleInput("\r");
		expect(rig.view.handleInput("\t")).toBe(true);
		expect(rig.view.handleInput("\x1b[D")).toBe(true);
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("nope");
		rig.view.handleInput("\r");
		expect(rig.text()).toContain("Invalid value");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("9999");
		rig.view.handleInput("\r");
		await save(rig, "r");
		expect(rig.store.get("quotas.compactWidthCols")).toBe(220);
		rig.view.handleInput("\x7f");
		await save(rig, "r");
		expect(rig.store.get("quotas.compactWidthCols")).toBe(100);
		expect(rig.store.sourceOf("quotas.compactWidthCols")).toBe("default");
	});

	test("enum cycling and movement stage the selected field", async () => {
		const rig = open("quotas.percentDisplay");
		rig.view.handleInput("\x1b[C");
		expect(rig.text()).toContain("Remaining");
		rig.view.handleInput("\x1b[D");
		rig.view.handleInput("\r");
		rig.view.handleInput("j");
		rig.view.handleInput("l");
		rig.view.handleInput("k");
		await save(rig, "r");
		expect(rig.store.get("quotas.percentDisplay")).toBe("remaining");
		expect(rig.store.get("quotas.compactWidthCols")).toBe(105);
	});

	test("template preview pages expose every row", () => {
		const rig = open("quotas.lineTemplate", () => ({
			rows: ["first preview", "second preview"],
			unknown: ["unknown-token"],
		}));
		expect(rig.text()).toContain("first preview");
		expect(rig.text()).toContain("ignored: unknown-token");
		rig.view.handleInput("\x1b[6~");
		expect(rig.text()).toContain("second preview");
		expect(rig.text()).toContain("preview 2/2");
		rig.view.handleInput("\x1b[5~");
		expect(rig.text()).toContain("first preview");
	});

	test("template preview follows inline and staged edits without writing the store", async () => {
		const seen: { source: string; width: number }[] = [];
		const rig = open("quotas.lineTemplate", (source, width) => {
			seen.push({ source, width });
			return { rows: [source], unknown: [] };
		});
		await rig.store.save("runtime", { "quotas.lineTemplate": "old" });
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("new");
		rig.view.render(57, 20);
		expect(seen.at(-1)).toEqual({ source: "new", width: 56 });
		rig.view.handleInput("\r");
		rig.view.render(80, 20);
		expect(seen.at(-1)).toEqual({ source: "new", width: 79 });
		expect(rig.store.get("quotas.lineTemplate")).toBe("old");
		rig.view.handleInput("\r");
		rig.view.handleInput("more");
		rig.view.handleInput("\x1b");
		rig.view.render(36, 20);
		expect(seen.at(-1)?.source).toBe("new");
	});

	test("wide settings labels and short edits fit without a false ellipsis", () => {
		const rig = open("quotas.refreshIntervalSec");
		rig.view.handleInput("\r");
		const wide = rig.view.render(140, 30);
		const wideLines = wide.lines.map(stripVTControlCharacters);
		expect(wideLines.some((line) => line.includes("Refresh quotas after requests"))).toBe(true);
		const edited = wideLines.find((line) => line.includes("❯")) ?? "";
		expect(edited).toContain("Quota refresh interval");
		expect(edited).toContain("60");
		expect(edited).not.toContain("…");
		for (const line of wide.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(140);

		const narrow = rig.view.render(36, 30);
		expect(narrow.lines.join("")).toContain("\x1b_pi:c\x07");
		for (const line of narrow.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
	});

	test("sections, editing, save prompts and sanitized template previews fit every check width", async () => {
		const rig = open("quotas.lineTemplate", (source, width) => ({
			rows: [source.repeat(2), "preview".repeat(width)],
			unknown: ["bad\x1b]0;evil\x07"],
		}));
		await rig.store.save("runtime", { "quotas.lineTemplate": "hello\x1b]0;evil\x07" });
		for (const data of ["", "\r", "\x1b", "\x7f", "\x13"]) {
			if (data) rig.view.handleInput(data);
			for (const width of [36, 57, 80, 140]) {
				const body = rig.view.render(width, 30);
				for (const line of [...body.lines, body.description ?? ""]) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					expect(stripVTControlCharacters(line)).not.toContain("evil");
				}
			}
		}
		rig.view.handleInput("\x1b");
		expect(rig.text()).toContain("⚠ ignored: bad");
		const pages: string[] = [];
		for (let i = 0; i <= Object.keys(SETTINGS).length; i++) {
			pages.push(rig.view.render(80, 8).lines.map(stripVTControlCharacters).join("\n"));
			rig.view.handleInput("j");
		}
		const sections = pages.join("\n");
		for (const section of [
			"Dashboard",
			"Quotas",
			"Models",
			"Openai",
			"Claude",
			"Synthetic",
			"Tokens",
		]) {
			expect(sections).toContain(section);
		}
	});
});
