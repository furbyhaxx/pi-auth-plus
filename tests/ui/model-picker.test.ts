import { describe, expect, spyOn, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	type KeybindingsConfig,
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { ModelPicker } from "../../src/ui/dashboard/model-picker.ts";
import type { ModelCatalogItem } from "../../src/ui/dashboard/models.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

function catalog(): ModelCatalogItem[] {
	return Array.from({ length: 555 }, (_, index) => ({
		provider: "sample-provider",
		id: `sample-${String(index).padStart(3, "0")}`,
		name: `Sample Human ${index}`,
		contextWindow: 1000,
	}));
}

function open(models: () => readonly ModelCatalogItem[], bindings: KeybindingsConfig = {}) {
	const keys = new KeybindingsManager(TUI_KEYBINDINGS, bindings);
	const host: TabViewHost = {
		theme: {
			fg: (_color, text) => `\x1b[90m${text}\x1b[39m`,
			bg: (_color, text) => text,
			bold: (text) => text,
		},
		keys,
		binding(id) {
			return bindingLabel(this.keys, id);
		},
		refresh: () => {},
		finish: () => {},
	};
	const chosen: ModelCatalogItem[] = [];
	let cancelled = 0;
	const picker = new ModelPicker(
		host,
		models,
		(item) => chosen.push(item),
		() => cancelled++,
	);
	const press = (data: string) => picker.handleInput(data);
	const paste = (text: string) => press(`\x1b[200~${text}\x1b[201~`);
	const render = (width = 80, height = 6) => picker.render(width, height);
	return { picker, press, paste, render, chosen, cancelled: () => cancelled };
}

function assertFits(body: ReturnType<ModelPicker["render"]>, width: number, height: number) {
	expect(body.lines.length).toBeLessThanOrEqual(height);
	for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
		expect(visibleWidth(line)).toBeLessThanOrEqual(width);
}

describe("model picker", () => {
	test("searches 555 identities by provider/id and chooses the exact item", () => {
		const models = catalog();
		const last = models[554];
		if (!last) throw new Error("fixture missing");
		const r = open(() => models);
		expect(r.render().state).toContain("1–5 of 555");
		r.press("/");
		expect(r.picker.isEditing()).toBe(true);
		r.paste("SAMPLE-PROVIDER/SAMPLE-554");
		expect(r.render().state).toContain("1–1 of 1");
		expect(r.picker.selected()).toBe(models[554]);
		r.press("\r");
		expect(r.chosen).toEqual([last]);
		expect(r.chosen[0]).toBe(last);
	});

	test("typing searches human names, preserves the cursor, and sanitizes pasted text", () => {
		const models = catalog();
		models[554] = { provider: "sample", id: "unicode", name: "Café 星", contextWindow: 1000 };
		const r = open(() => models);
		r.press("c");
		r.paste("AFÉ 星\x1b]0;bad\x07");
		const body = r.render(36, 3);
		expect(r.picker.isEditing()).toBe(true);
		expect(body.lines.join("")).toContain("\x1b_pi:c\x07");
		expect(body.lines.join("")).not.toContain("\x1b]0;bad");
		expect(body.state).toContain("1–1 of 1");
		expect(r.picker.selected()).toBe(models[554]);
		assertFits(body, 36, 3);
		r.press("\r");
		expect(r.chosen).toEqual([models[554]]);
	});

	test("pages and moves using rebound keys and advertises those bindings", () => {
		const models = catalog();
		const first = models[0];
		if (!first) throw new Error("fixture missing");
		const r = open(() => models, {
			"tui.select.up": "alt+k",
			"tui.select.down": "alt+j",
			"tui.select.pageUp": "alt+u",
			"tui.select.pageDown": "alt+d",
			"tui.select.confirm": "ctrl+g",
			"tui.select.cancel": "ctrl+x",
		});
		let body = r.render();
		expect(body.above).toBe(0);
		expect(body.below).toBe(550);
		expect(body.hints.map((hint) => hint.key).join(" ")).toContain("alt+d");
		expect(body.hints.map((hint) => hint.key).join(" ")).toContain("alt+j");
		r.press("\x1bd");
		body = r.render();
		expect(body.state).toContain("6–10 of 555");
		expect(body.above).toBe(5);
		expect(body.below).toBe(545);
		expect(r.picker.selected()).toBe(models[5]);
		r.press("\x1bj");
		expect(r.picker.selected()).toBe(models[6]);
		r.press("\x1bk");
		expect(r.picker.selected()).toBe(models[5]);
		r.press("\x1bu");
		expect(r.picker.selected()).toBe(models[0]);
		r.press("\x07");
		expect(r.chosen).toEqual([first]);
		r.press("\x18");
		expect(r.cancelled()).toBe(1);
	});

	test("printable navigation bindings remain searchable until tab returns focus to results", () => {
		const models: ModelCatalogItem[] = [
			{ provider: "sample", id: "first", name: "hjk one", contextWindow: 1 },
			{ provider: "sample", id: "second", name: "hjk two", contextWindow: 1 },
		];
		const r = open(() => models, { "tui.select.up": "k", "tui.select.down": "j" });
		r.press("/");
		r.press("h");
		r.press("j");
		r.press("k");
		expect(r.picker.isEditing()).toBe(true);
		const body = r.render();
		expect(body.state).toContain("of 2");
		expect(body.hints.map((hint) => hint.key)).not.toContain("k/j");
		expect(body.hints.map((hint) => hint.key)).toContain("tab");
		r.press("\t");
		expect(r.picker.isEditing()).toBe(false);
		r.press("j");
		expect(r.picker.selected()).toBe(models[1]);
		r.press("?");
		expect(r.picker.isInspecting()).toBe(true);
	});

	test("printable confirm and cancel bindings are not advertised while editing", () => {
		const models: ModelCatalogItem[] = [
			{ provider: "sample", id: "xy", name: "xy", contextWindow: 1 },
		];
		const r = open(() => models, { "tui.select.confirm": "y", "tui.select.cancel": "x" });
		r.press("/");
		r.press("x");
		r.press("y");
		const hints = r.render().hints.map((hint) => hint.key);
		expect(hints).not.toContain("x");
		expect(hints).not.toContain("y");
		expect(r.picker.selected()).toBe(models[0]);
		r.press("\t");
		r.press("y");
		expect(r.chosen).toEqual(models);
	});

	test("split pasted escapes cannot cancel search or reach the terminal", () => {
		const models: ModelCatalogItem[] = [
			{ provider: "sample", id: "cafe", name: "Café", contextWindow: 1 },
		];
		const r = open(() => models);
		r.press("\x1b[200~Ca");
		r.press("\x1b");
		r.press("]0;bad\x07");
		r.press("\x1b[201~");
		const body = r.render();
		expect(r.picker.isEditing()).toBe(true);
		expect(r.cancelled()).toBe(0);
		expect(r.picker.selected()).toBe(models[0]);
		expect(body.lines.join("")).not.toContain("\x1b]0;bad");
	});

	test("empty catalogs are safe and modal keys do not escape to the dashboard", () => {
		const r = open(() => []);
		const body = r.render(36, 1);
		expect(body.modal).toBe(true);
		expect(body.state).toContain("0 results");
		expect(body.lines.map(stripVTControlCharacters).join("")).toContain("No models match");
		expect(r.press("\t")).toBe(true);
		r.press("\r");
		expect(r.chosen).toHaveLength(0);
	});

	test("no match cannot choose; escape clears search before cancelling the owner", () => {
		const r = open(catalog);
		r.press("/");
		r.paste("no such item");
		const body = r.render();
		expect(body.state).toContain("0 results");
		expect(body.lines.map(stripVTControlCharacters).join("\n")).toContain("No models match");
		expect(r.picker.selected()).toBeUndefined();
		r.press("\r");
		expect(r.chosen).toHaveLength(0);
		r.press("\x1b");
		expect(r.picker.isEditing()).toBe(false);
		expect(r.cancelled()).toBe(0);
		expect(r.render().state).toContain("of 555");
		r.press("\x1b");
		expect(r.cancelled()).toBe(1);
	});

	test("invalidates on catalog mutations while accepting fresh equivalent arrays", () => {
		const models = catalog();
		const r = open(() => models.map((item) => ({ ...item })));
		r.press("/");
		r.paste("needle");
		expect(r.render().state).toContain("0 results");
		const changed = models[111];
		if (!changed) throw new Error("fixture missing");
		changed.name = "Needle";
		expect(r.render().state).toContain("1–1 of 1");
		expect(r.picker.selected()?.id).toBe("sample-111");
		changed.name = "renamed";
		changed.id = "needle-in-id";
		expect(r.render().state).toContain("1–1 of 1");
		changed.id = "gone";
		expect(r.render().state).toContain("0 results");
		models.push({ provider: "needle", id: "added", name: "Other", contextWindow: 1 });
		expect(r.render().state).toContain("1–1 of 1");
		expect(r.picker.selected()?.id).toBe("added");
	});

	test("filters once per query or catalog change, even with fresh equivalent arrays", () => {
		const models = catalog();
		const r = open(() => models.map((item) => ({ ...item })));
		const includes = spyOn(String.prototype, "includes");
		try {
			r.press("/");
			r.paste("needle");
			r.render();
			const calls = () => includes.mock.calls.filter(([text]) => text === "needle").length;
			expect(calls()).toBe(555);
			r.render();
			r.render(36, 1);
			r.picker.selected();
			expect(calls()).toBe(555);
			const changed = models[0];
			if (!changed) throw new Error("fixture missing");
			changed.name = "needle";
			r.render();
			expect(calls()).toBe(1110);
		} finally {
			includes.mockRestore();
		}
	});

	test("live catalog reorder preserves the focused identity and returns its newest object", () => {
		let models = catalog();
		const r = open(() => models);
		r.render();
		r.press("\x1b[B");
		const selected = models[1];
		if (!selected) throw new Error("fixture missing");
		const replacement = { ...selected, contextWindow: 2000 };
		models = [models[0], models[2], replacement, ...models.slice(3)].filter(
			(item): item is ModelCatalogItem => item !== undefined,
		);
		expect(r.picker.selected()).toBe(replacement);
		r.press("\r");
		expect(r.chosen).toEqual([replacement]);
		expect(r.chosen[0]).toBe(replacement);
	});

	test("catalog text is sanitized in results and full identity detail", () => {
		const models: ModelCatalogItem[] = [
			{
				provider: "source\x1b]0;bad\x07",
				id: "item\nsecond",
				name: "Name\x1b[31m Red\x1b[0m",
				contextWindow: 1,
			},
		];
		const r = open(() => models);
		const result = r.render(36, 6);
		expect(result.description).toContain("?");
		expect(result.description).toContain("/");
		expect(result.lines.join("")).not.toContain("\x1b]0;bad");
		expect(result.lines.map(stripVTControlCharacters).join(" ")).toContain("source/item second");
		r.press("?");
		const detail = r.render(36, 6);
		expect(detail.lines.join("")).not.toContain("\x1b]0;bad");
		expect(detail.lines.map(stripVTControlCharacters).join(" ")).toContain("Name Red");
		for (const line of detail.lines) expect(line).not.toContain("\n");
	});

	test("navigation retains a query for inspection and escape clears it before cancellation", () => {
		const r = open(catalog);
		r.press("/");
		r.paste("human 42");
		r.render();
		r.press("\x1b[B");
		expect(r.picker.isEditing()).toBe(false);
		r.press("?");
		expect(r.picker.isInspecting()).toBe(true);
		expect(r.render().lines.map(stripVTControlCharacters).join(" ")).toContain("sample-420");
		r.press("\x1b");
		expect(r.picker.isInspecting()).toBe(false);
		expect(r.render().state).toContain("of 11");
		r.press("\x1b");
		expect(r.cancelled()).toBe(0);
		expect(r.render().state).toContain("of 555");
	});

	test.each([36, 57, 80, 140])(
		"reveals the complete wrapped selection at %i columns and short heights",
		(width) => {
			const provider = "provider-with-a-very-long-common-identity-prefix";
			const id = "nested/long-model-identifier-with-an-essential-tail-星-56789";
			const name = "A very long human-readable name with a distinctive finishing suffix";
			const models = [
				{ provider, id, name, contextWindow: 1 },
				{ provider, id: `${id}-other`, name: `${name} other`, contextWindow: 1 },
			];
			const r = open(() => models);
			for (const height of [1, 2, 3, 6]) assertFits(r.render(width, height), width, height);
			r.press("?");
			const seen: string[] = [];
			for (let step = 0; step < 30; step++) {
				const body = r.render(width, 1);
				assertFits(body, width, 1);
				seen.push(...body.lines.map(stripVTControlCharacters));
				if (body.below === 0) break;
				r.press("\x1b[B");
			}
			const detail = seen.join("");
			expect(detail).toContain(`${provider}/${id}`);
			expect(detail).toContain(name);
			r.press("\x1b");
			r.press("\x1b[B");
			expect(r.picker.selected()).toBe(models[1]);
			r.press("?");
			const second: string[] = [];
			for (let step = 0; step < 30; step++) {
				const body = r.render(width, 1);
				second.push(...body.lines.map(stripVTControlCharacters));
				if (body.below === 0) break;
				r.press("\x1b[B");
			}
			expect(second.join("")).toContain(`${provider}/${id}-other`);
		},
	);

	test("one-row search retains cursor and returns to the selection on navigation", () => {
		const r = open(catalog);
		r.render(36, 1);
		r.press("\x1b[B");
		r.press("/");
		expect(r.render(36, 1).state).toContain("0–0 of 555");
		r.paste("Sample Human 55");
		const editing = r.render(36, 1);
		assertFits(editing, 36, 1);
		expect(editing.lines.join("")).toContain("\x1b_pi:c\x07");
		r.press("\x1b[B");
		expect(r.picker.isEditing()).toBe(false);
		const selected = r.render(36, 1);
		assertFits(selected, 36, 1);
		expect(selected.lines.map(stripVTControlCharacters).join("")).toContain("❯");
		expect(r.picker.selected()?.id).toBe("sample-550");
		r.press("\x1b");
		expect(r.cancelled()).toBe(0);
		expect(r.render(36, 1).state).toContain("of 555");
	});
});
