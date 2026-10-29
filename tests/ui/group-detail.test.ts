import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	CURSOR_MARKER,
	type KeybindingsConfig,
	KeybindingsManager,
	renderFakeCursor,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ModelGroup } from "../../src/models/groups/config.ts";
import { GroupDetail } from "../../src/ui/dashboard/group-detail.ts";
import type { ModelCatalogItem } from "../../src/ui/dashboard/models.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

const catalog: readonly ModelCatalogItem[] = [
	{ provider: "vendor", id: "org/model", name: "Model", contextWindow: 1000 },
	{ provider: "vendor", id: "other", name: "Other", contextWindow: 2000 },
	{
		provider: "vendor",
		id: "alias/path",
		name: "Alias",
		contextWindow: 1000,
		api: "openai-completions",
	},
	{ provider: "group", id: "g", name: "Group", contextWindow: 50, api: "openai-completions" },
	{ provider: "group", id: "no-api", name: "Group", contextWindow: 50 },
	{ provider: "foreign", id: "logical", name: "Virtual", contextWindow: 50, api: "pi-virtual" },
];

function open(
	initial?: ModelGroup,
	models: () => readonly ModelCatalogItem[] = () => catalog,
	bindings: KeybindingsConfig = {},
) {
	const keys = new KeybindingsManager(TUI_KEYBINDINGS, bindings);
	const host: TabViewHost = {
		theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {},
		finish: () => {},
	};
	const groups: ModelGroup[] = [];
	let pendingDiscard: (() => void) | undefined;
	let backs = 0;
	host.confirmDiscard = (discard) => {
		pendingDiscard = discard;
	};
	const view = new GroupDetail(
		host,
		initial,
		models,
		(group) => groups.push(group),
		() => {
			backs++;
		},
	);
	const press = (key: string) => view.handleInput(key);
	const select = (label: string) => {
		for (let i = 0; i < 60; i++) press("k");
		for (let i = 0; i < 60; i++) {
			const text = view.render(120, 60).lines.map(stripVTControlCharacters);
			if (text.some((line) => line.includes("❯") && line.includes(label))) return;
			press("j");
		}
		throw new Error(`Cannot select ${label}`);
	};
	const edit = (label: string, value: string) => {
		select(label);
		press("\r");
		press("\x15");
		press(`\x1b[200~${value}\x1b[201~`);
		press("\r");
	};
	const text = () => view.render(120, 60).lines.map(stripVTControlCharacters).join("\n");
	return {
		view,
		groups,
		press,
		select,
		edit,
		text,
		confirmDiscard: () => {
			const discard = pendingDiscard;
			pendingDiscard = undefined;
			discard?.();
		},
		backs: () => backs,
	};
}

describe("group detail", () => {
	test("creates and stages a group with a slash-containing catalog identity", () => {
		const r = open();
		r.edit("Group ID", "team");
		r.edit("Display name", "Team");
		r.select("Strategy");
		r.press("l");
		r.press("l");
		r.select("Trigger quota");
		r.press(" ");
		r.edit("+ Add member", "vendor/org/model");
		r.select("Member 1");
		r.select("Priority tier");
		r.press("\r");
		r.press("\x15");
		r.press("3");
		r.press("\r");
		r.select("Cost label");
		r.press("l");
		r.press("l");
		r.edit("Thinking map", "low=high, medium=max");
		r.press("\x13");
		expect(r.groups).toEqual([
			{
				id: "team",
				name: "Team",
				strategy: "balance",
				triggers: ["rate-limit", "auth"],
				members: [
					{
						provider: "vendor",
						id: "org/model",
						tier: 3,
						cost: "free",
						thinking: { low: "high", medium: "max" },
					},
				],
			},
		]);
	});
	test("rejects missing, unknown and duplicate members and malformed caps", () => {
		const r = open();
		r.press("\x13");
		expect(r.text()).toContain("Invalid group");
		r.edit("Group ID", "team");
		r.edit("+ Add member", "vendor/missing");
		expect(r.text()).toContain("not in catalog");
		r.press("\x15");
		r.press("\x1b[200~vendor/org/model\x1b[201~");
		r.press("\r");
		r.edit("+ Add member", "vendor/org/model");
		expect(r.text()).toContain("Duplicate member");
		r.press("\x1b");
		r.edit("Context window", "12oops");
		r.press("\x13");
		expect(r.text()).toContain("Context window must be a positive integer");
		r.edit("Context window", "1001");
		r.press("\x13");
		expect(r.text()).toContain("cannot exceed smallest member (1000)");
		r.edit("Context window", "");
		r.edit("Thinking map", "low=bogus");
		r.press("\x13");
		expect(r.text()).toContain("Invalid group");
		expect(r.groups).toHaveLength(0);
	});
	test.each(["group/g", "group/no-api", "group/missing", "foreign/logical"])(
		"rejects %s with actionable feedback and stages a physical alias instead",
		(identity) => {
			const r = open();
			r.edit("Group ID", "team");
			r.edit("+ Add member", identity);
			expect(r.text()).toContain("Choose a physical model");
			expect(r.text()).not.toContain("Member 1");
			r.press("\x15");
			r.press("\x1b[200~vendor/alias/path\x1b[201~");
			r.press("\r");
			expect(r.text()).toContain("vendor/alias/path");
			r.press("\x13");
			expect(r.groups[0]?.members).toEqual([{ provider: "vendor", id: "alias/path", tier: 1 }]);
		},
	);
	test("explains legacy nonphysical members and permits their deletion", () => {
		const initial: ModelGroup = {
			id: "team",
			strategy: "sticky",
			triggers: [],
			contextWindow: 900,
			members: [
				{ provider: "group", id: "g", tier: 1 },
				{ provider: "foreign", id: "logical", tier: 1 },
				{ provider: "vendor", id: "org/model", tier: 2 },
			],
		};
		const r = open(initial);
		expect(r.text()).toContain("not physical; delete · group/g");
		expect(r.text()).toContain("not physical; delete · foreign/logical");
		for (const width of [36, 57, 80, 140]) {
			const lines = r.view.render(width, 60).lines;
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(lines.map(stripVTControlCharacters).join("\n")).toContain("not physical; delete");
		}
		r.press("\x13");
		expect(r.text()).toContain("choose a physical model");
		expect(r.groups).toHaveLength(0);
		r.select("Member 1");
		r.press("d");
		r.press("d");
		r.press("\x13");
		expect(r.groups[0]?.members).toEqual([{ provider: "vendor", id: "org/model", tier: 2 }]);
		expect(r.groups[0]?.contextWindow).toBe(900);
		expect(initial.members).toHaveLength(3);
	});
	test("explains missing legacy members without rewriting them", () => {
		const initial: ModelGroup = {
			id: "team",
			strategy: "sticky",
			triggers: [],
			members: [{ provider: "vendor", id: "missing", tier: 1 }],
		};
		const r = open(initial);
		expect(r.text()).toContain("not in catalog · vendor/missing");
		r.press("\x13");
		expect(r.groups).toEqual([initial]);
	});
	test("rechecks a staged member if its catalog entry becomes virtual", () => {
		let models = [catalog[2]].filter((item): item is ModelCatalogItem => item !== undefined);
		const r = open(undefined, () => models);
		r.edit("Group ID", "team");
		r.edit("+ Add member", "vendor/alias/path");
		models = models.map((item) => ({ ...item, api: "pi-virtual" }));
		r.press("\x13");
		expect(r.text()).toContain("choose a physical model");
		expect(r.groups).toHaveLength(0);
		r.select("Member 1");
		r.press("d");
		expect(r.text()).not.toContain("Member 1");
	});
	test("counts a changed active input but not an unchanged focused input", () => {
		const r = open();
		expect(r.view.hasDrafts()).toBe(false);
		r.select("Group ID");
		r.press("\r");
		expect(r.view.hasDrafts()).toBe(false);
		r.press("\x15");
		r.press("\x1b[200~team\x1b[201~");
		expect(r.view.hasDrafts()).toBe(true);
		expect(r.press("\x1b")).toBe(true);
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.view.isSaving()).toBe(false);
	});
	test("shows rebound cursor bindings as separate hints and handles them", () => {
		const r = open(undefined, undefined, {
			"tui.editor.cursorLeft": "ctrl+b",
			"tui.editor.cursorRight": "ctrl+f",
		});
		r.select("Strategy");
		expect(r.view.render(80, 60).hints).toContainEqual({
			key: "ctrl+b/ctrl+f",
			action: "change",
			priority: 1,
		});
		r.press("\x06");
		expect(r.text()).toContain("Strategy · failover");
	});
	test("saves member reordering and deletion", () => {
		const initial: ModelGroup = {
			id: "a",
			strategy: "sticky",
			triggers: [],
			members: [
				{ provider: "vendor", id: "org/model", tier: 1 },
				{ provider: "vendor", id: "other", tier: 2 },
			],
		};
		const r = open(initial);
		r.select("Member 1");
		r.press("\x1b[1;2B");
		r.press("\x13");
		expect(r.groups[0]?.members.map((member) => member.id)).toEqual(["other", "org/model"]);
		r.press("d");
		r.press("\x13");
		expect(r.groups[1]?.members.map((member) => member.id)).toEqual(["other"]);
	});
	test("discard, sanitization and width", () => {
		const initial: ModelGroup = {
			id: "a\x1b]0;bad\x07",
			strategy: "sticky",
			triggers: [],
			members: [
				{ provider: "vendor", id: "org/model", tier: 1 },
				{ provider: "vendor", id: "other", tier: 2 },
			],
		};
		const r = open(initial);
		expect(r.text()).not.toContain("\x1b]0;bad");
		r.select("Member 1");
		r.press("\x1b[1;2B");
		r.press("d");
		for (const width of [40, 80]) {
			for (let i = 0; i < 20; i++) {
				const body = r.view.render(width, 4);
				expect(body.lines.length).toBeLessThanOrEqual(4);
				for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				r.press("j");
			}
		}
		r.select("Group ID");
		r.press("\r");
		for (const width of [36, 57, 80, 140]) {
			const body = r.view.render(width, 4);
			expect(body.lines.join("")).toContain(CURSOR_MARKER + renderFakeCursor(" "));
			expect(body.lines.length).toBeLessThanOrEqual(4);
			for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		expect(r.press("\x1b")).toBe(true);
		expect(r.press("\x1b")).toBe(true);
		expect(r.view.hasDrafts()).toBe(true);
		r.confirmDiscard();
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.text()).toContain("Member 2");
		expect(r.backs()).toBe(1);
		r.view.dispose();
	});
});
