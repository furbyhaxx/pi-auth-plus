import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { TextRule } from "../../src/core/config/fields.ts";
import { CollectionDetail } from "../../src/ui/dashboard/collection-detail.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel, fitHint } from "../../src/ui/frame/index.ts";

const choices = [
	{ value: "alpha", label: "Alpha" },
	{ value: "beta", label: "Beta" },
] as const;

type ListKey = "quotas.providers" | "openai.verbosityProviders";
function fixture(confirm = true) {
	const keys = new KeybindingsManager(TUI_KEYBINDINGS);
	let pending: (() => void) | undefined;
	let backs = 0;
	const host: TabViewHost = {
		theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {},
		finish: () => {},
		...(confirm
			? {
					confirmDiscard: (discard: () => void) => {
						pending = discard;
					},
				}
			: {}),
	};
	return {
		host,
		onBack: () => {
			backs++;
		},
		backs: () => backs,
		confirm: () => {
			const discard = pending;
			pending = undefined;
			discard?.();
		},
		cancel: () => {
			pending = undefined;
		},
		hasConfirmation: () => pending !== undefined,
	};
}
function controls(view: CollectionDetail) {
	const press = (key: string) => view.handleInput(key);
	const text = () => view.render(140, 80).lines.map(stripVTControlCharacters).join("\n");
	const select = (label: string) => {
		for (let i = 0; i < 80; i++) press("k");
		for (let i = 0; i < 80; i++) {
			if (
				text()
					.split("\n")
					.some((line) => line.includes("❯") && line.includes(label))
			)
				return;
			press("j");
		}
		throw new Error(`Cannot select ${label}: ${text()}`);
	};
	const type = (value: string) => {
		press("\x15");
		press(`\x1b[200~${value}\x1b[201~`);
	};
	const edit = (label: string, value: string) => {
		select(label);
		press("\r");
		type(value);
		press("\r");
	};
	return { press, select, type, edit, text };
}
function list(key: ListKey, initial: readonly string[], confirm = true) {
	const f = fixture(confirm);
	const staged: (readonly string[])[] = [];
	const view = new CollectionDetail(
		f.host,
		key,
		initial,
		choices,
		(value) => staged.push(value),
		f.onBack,
	);
	return { ...f, ...controls(view), view, staged };
}
function rules(initial: readonly TextRule[] = []) {
	const f = fixture();
	const staged: (readonly TextRule[])[] = [];
	const view = new CollectionDetail(
		f.host,
		"claude.replacePatterns",
		initial,
		(value) => staged.push(value),
		f.onBack,
	);
	return { ...f, ...controls(view), view, staged };
}

describe("collection detail", () => {
	test.each(["quotas.providers", "openai.verbosityProviders"] as const)(
		"%s toggles choices, retains unknown values and adds custom IDs locally",
		(key) => {
			const initial = ["beta", "legacy", "legacy"];
			const r = list(key, initial);
			r.select("Alpha");
			r.press(" ");
			r.select("Beta");
			r.press("\r");
			r.select("+ Add provider");
			r.press("\r");
			r.type("custom/vendor");
			expect(r.view.hasDrafts()).toBe(true);
			expect(r.staged).toEqual([]);
			r.press("\r");
			expect(r.staged).toEqual([]);
			r.press("\x13");
			expect(r.staged).toEqual([["legacy", "legacy", "alpha", "custom/vendor"]]);
			expect(initial).toEqual(["beta", "legacy", "legacy"]);
			expect(r.view.hasDrafts()).toBe(false);
			r.select("Unknown id: legacy");
			r.press("d");
			r.press("\x13");
			expect(r.staged[1]).toEqual(["legacy", "alpha", "custom/vendor"]);
			expect(r.staged[0]).toEqual(["legacy", "legacy", "alpha", "custom/vendor"]);
			expect(r.view.isSaving()).toBe(false);
		},
	);

	test("edits Unicode literal rules, adds drop and rewrite, reorders and removes", () => {
		const initial: TextRule[] = [{ match: "old", replacement: "before" }, { match: "omit" }];
		const r = rules(initial);
		r.edit("Rule 1 match", "猫.*🙂");
		r.edit("Rule 1 replacement", "λ → café");
		r.select("Rule 2 match");
		r.press("\x1b[1;2A");
		r.select("+ Add drop");
		r.press("\r");
		r.type("secret");
		r.press("\r");
		r.select("+ Add rewrite");
		r.press("\r");
		r.type("empty rewrite");
		r.press("\r");
		r.select("Rule 1 match");
		r.press("d");
		expect(r.staged).toEqual([]);
		r.press("\x13");
		expect(r.staged).toEqual([
			[
				{ match: "猫.*🙂", replacement: "λ → café" },
				{ match: "secret" },
				{ match: "empty rewrite", replacement: "" },
			],
		]);
		expect(initial).toEqual([{ match: "old", replacement: "before" }, { match: "omit" }]);
	});

	test("rule action distinguishes drop from an empty replacement and catalog rejects blank matches", () => {
		const r = rules([{ match: "literal", replacement: "" }]);
		r.select("Rule 1 action");
		r.press(" ");
		r.press("\x13");
		expect(r.staged[0]).toEqual([{ match: "literal" }]);
		r.select("Rule 1 action");
		r.press(" ");
		r.press("\x13");
		expect(r.staged[1]).toEqual([{ match: "literal", replacement: "" }]);
		r.edit("Rule 1 match", "   ");
		r.press("\x13");
		expect(r.staged).toHaveLength(2);
		const body = r.view.render(36, 1);
		expect(stripVTControlCharacters(body.description ?? "")).toMatch(/match/i);
		expect(body.hints.some((item) => item.key === "ctrl+s")).toBe(true);
		r.edit("Rule 1 match", "fixed");
		r.press("\x13");
		expect(r.staged[2]).toEqual([{ match: "fixed", replacement: "" }]);
	});

	test("switching to drop and back retains the rewrite while changing its match", () => {
		const r = rules([{ match: "old", replacement: "keep me" }]);
		r.select("Rule 1 action");
		r.press(" ");
		r.edit("Rule 1 match", "new");
		r.select("Rule 1 action");
		r.press(" ");
		r.press("\x13");
		expect(r.staged).toEqual([[{ match: "new", replacement: "keep me" }]]);
	});

	test("applying an untouched custom input does not add an empty ID", () => {
		const r = list("quotas.providers", ["beta"]);
		r.select("+ Add provider");
		r.press("\r");
		r.press("\x13");
		expect(r.staged).toEqual([["beta"]]);
	});

	test("normal mode keeps narrow rule recovery and local apply controls visible", () => {
		const r = rules([{ match: "example", replacement: "text" }]);
		r.select("Rule 1 match");
		const body = r.view.render(36, 1);
		expect(stripVTControlCharacters(body.description ?? "")).toContain("d remove");
		expect(stripVTControlCharacters(body.description ?? "")).toContain("shift+↑/↓");
		const hints = fitHint(r.host.theme, body.hints, 35);
		expect(hints).toContain("ctrl+s");
		expect(hints).toContain(r.host.binding("tui.select.cancel"));
	});

	test("long provider identities are revealable and removable at 36 columns", () => {
		const id = "legacy-provider-with-a-very-long-unique-ending";
		const r = list("quotas.providers", [id]);
		r.select("Unknown id:");
		expect(r.view.render(36, 1).lines.join("")).toContain("legacy-provider");
		for (let i = 0; i < 6; i++) r.press("\x1b[C");
		const body = r.view.render(36, 1);
		expect(body.lines.join("")).toContain("unique-ending");
		expect(body.lines.every((line) => visibleWidth(line) <= 36)).toBe(true);
		expect(stripVTControlCharacters(body.description ?? "")).toContain("remove");
		r.press("d");
		r.press("\x13");
		expect(r.staged).toEqual([[]]);
	});

	test("a long choice label cannot hide its short provider ID", () => {
		const f = fixture();
		const view = new CollectionDetail(
			f.host,
			"quotas.providers",
			[],
			[
				{
					value: "actual-id",
					label: "An exceptionally long provider label that consumes the whole line",
				},
			],
			() => {},
			f.onBack,
		);
		expect(view.render(36, 1).lines.join("")).not.toContain("actual-id");
		view.handleInput("\x1b[C");
		expect(view.render(36, 1).lines.join("")).toContain("actual-id");
	});

	test("a rebound confirm key takes precedence over navigation aliases", () => {
		const f = fixture();
		const keys = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "j" });
		const host: TabViewHost = { ...f.host, keys, binding: (id) => bindingLabel(keys, id) };
		const staged: (readonly string[])[] = [];
		const view = new CollectionDetail(
			host,
			"quotas.providers",
			[],
			choices,
			(value) => staged.push(value),
			f.onBack,
		);
		view.handleInput("j");
		view.handleInput("\x13");
		expect(staged).toEqual([["alpha"]]);
	});

	test("a rebound confirm does not disable rule removal or mislabel its shortcut", () => {
		const f = fixture();
		const keys = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "d" });
		const host: TabViewHost = { ...f.host, keys, binding: (id) => bindingLabel(keys, id) };
		const staged: (readonly TextRule[])[] = [];
		const view = new CollectionDetail(
			host,
			"claude.replacePatterns",
			[{ match: "old" }],
			(value) => staged.push(value),
			f.onBack,
		);
		expect(view.render(36, 1).description).toContain("x remove");
		view.handleInput("x");
		view.handleInput("\x13");
		expect(staged).toEqual([[]]);
	});

	test("apply and its hint remain available when ctrl+s is rebound to confirm", () => {
		const f = fixture();
		const keys = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.confirm": "ctrl+s" });
		const host: TabViewHost = { ...f.host, keys, binding: (id) => bindingLabel(keys, id) };
		const staged: (readonly string[])[] = [];
		const view = new CollectionDetail(
			host,
			"quotas.providers",
			[],
			choices,
			(value) => staged.push(value),
			f.onBack,
		);
		view.handleInput("\x13");
		expect(staged).toEqual([]);
		expect(
			view.render(36, 1).hints.some((hint) => hint.key === "ctrl+g" && hint.action === "apply"),
		).toBe(true);
		view.handleInput("\x07");
		expect(staged).toEqual([["alpha"]]);
	});

	test("reordering remains available when shift-up is rebound", () => {
		const f = fixture();
		const keys = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.select.up": "shift+up" });
		const host: TabViewHost = { ...f.host, keys, binding: (id) => bindingLabel(keys, id) };
		const staged: (readonly TextRule[])[] = [];
		const view = new CollectionDetail(
			host,
			"claude.replacePatterns",
			[{ match: "one" }, { match: "two" }],
			(value) => staged.push(value),
			f.onBack,
		);
		expect(view.render(36, 1).description).toContain("alt+↑/↓");
		view.handleInput("\x1b[1;3B");
		view.handleInput("\x13");
		expect(staged).toEqual([[{ match: "two" }, { match: "one" }]]);
	});

	test("cancelled local confirmation retains staged and in-progress edits; confirmed discard stays local", () => {
		const r = list("quotas.providers", ["beta"]);
		const other = new CollectionDetail(
			r.host,
			"openai.verbosityProviders",
			[],
			choices,
			() => {},
			() => {},
		);
		const otherControls = controls(other);
		otherControls.select("Alpha");
		otherControls.press(" ");
		r.select("Alpha");
		r.press(" ");
		r.select("+ Add provider");
		r.press("\r");
		r.type("pending");
		r.press("\x1b");
		expect(r.hasConfirmation()).toBe(true);
		r.cancel();
		expect(r.view.hasDrafts()).toBe(true);
		expect(r.backs()).toBe(0);
		expect(r.text()).toContain("pending");
		r.press("\x1b");
		r.confirm();
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.backs()).toBe(1);
		expect(r.staged).toEqual([]);
		expect(r.text()).toContain("Beta");
		expect(other.hasDrafts()).toBe(true);
	});

	test("unfinished input counts as a draft and global discard resets only this editor", () => {
		const r = list("openai.verbosityProviders", []);
		r.select("+ Add provider");
		r.press("\r");
		expect(r.view.hasDrafts()).toBe(false);
		r.type("partial");
		expect(r.view.hasDrafts()).toBe(true);
		r.view.discardDrafts();
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.staged).toEqual([]);
		r.press("\x1b");
		expect(r.backs()).toBe(1);
		expect(r.hasConfirmation()).toBe(false);
	});

	test("an unfinished bracketed paste is a draft before Pi commits the input", () => {
		const r = list("quotas.providers", []);
		r.select("+ Add provider");
		r.press("\r");
		r.press("\x1b[200~partial");
		expect(r.view.hasDrafts()).toBe(true);
		r.press("\x1b[201~");
		expect(r.view.hasDrafts()).toBe(true);
		r.press("\r");
		r.press("\x13");
		expect(r.staged).toEqual([["partial"]]);
	});

	test("without a confirmation host, dirty back cannot lose edits", () => {
		const r = list("quotas.providers", [], false);
		r.select("Alpha");
		r.press(" ");
		r.press("\x1b");
		expect(r.backs()).toBe(0);
		expect(r.view.hasDrafts()).toBe(true);
		expect(stripVTControlCharacters(r.view.render(36, 1).description ?? "")).toMatch(/stage/i);
	});

	test("sanitizes external input, preserves Pi cursor styling, and fits narrow fixed controls", () => {
		const r = rules([{ match: "safe\x1b]0;bad\x07x", replacement: "value" }]);
		r.select("Rule 1 match");
		r.press("\r");
		for (const width of [36, 57, 80, 140]) {
			const body = r.view.render(width, 1);
			const all = [...body.lines, body.description ?? "", body.state ?? ""];
			for (const line of all) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(body.lines.join("")).toContain("\x1b_pi:c\x07");
			expect(body.lines.join("")).not.toContain("\x1b]0;bad");
			const hints = fitHint(r.host.theme, body.hints, width - 1);
			expect(visibleWidth(hints)).toBeLessThanOrEqual(width - 1);
			expect(hints).toContain(r.host.binding("tui.select.confirm"));
			expect(hints).toContain(r.host.binding("tui.select.cancel"));
			expect(hints).toContain("ctrl+s");
		}
		r.type("test\x1b]0;injected\x07safe");
		expect(r.view.render(80, 1).lines.join("")).not.toContain("\x1b]0;injected");
		r.press("\r");
		r.press("\x13");
		expect(r.staged[0]).toEqual([{ match: "testsafe", replacement: "value" }]);
	});
});
