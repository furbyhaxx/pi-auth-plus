import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { ModelGroup } from "../../src/models/groups/config.ts";
import { GroupDetail } from "../../src/ui/dashboard/group-detail.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

function open(initial?: ModelGroup) {
	const keys = new KeybindingsManager(TUI_KEYBINDINGS);
	const host: TabViewHost = {
		theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {},
		finish: () => {},
	};
	const groups: ModelGroup[] = [];
	const view = new GroupDetail(
		host,
		initial,
		() => [
			{ provider: "vendor", id: "org/model", name: "Model", contextWindow: 1000 },
			{ provider: "vendor", id: "other", name: "Other", contextWindow: 2000 },
		],
		(group) => groups.push(group),
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
	return { view, groups, press, select, edit, text };
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
		r.edit("Context window", "");
		r.edit("Thinking map", "low=bogus");
		r.press("\x13");
		expect(r.text()).toContain("Invalid group");
		expect(r.groups).toHaveLength(0);
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
		expect(r.view.render(80, 4).lines.join("")).toContain("\x1b_pi:c\x07");
		for (const width of [40, 80]) {
			const body = r.view.render(width, 4);
			for (const line of [...body.lines, body.description ?? ""])
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		expect(r.press("\x1b")).toBe(true);
		expect(r.press("\x1b")).toBe(true);
		expect(r.text()).toContain("Discarded staged changes");
		expect(r.text()).toContain("Member 2");
		expect(r.press("\x1b")).toBe(false);
		r.view.dispose();
	});
});
