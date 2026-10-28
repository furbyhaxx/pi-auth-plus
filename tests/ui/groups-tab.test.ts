import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { SaveScope } from "../../src/core/config/index.ts";
import type { ModelGroup } from "../../src/models/groups/config.ts";
import { GroupsView } from "../../src/ui/dashboard/groups.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

const group = (id: string): ModelGroup => ({
	id,
	strategy: "sticky",
	triggers: [],
	members: [{ provider: "vendor", id: "one", tier: 1 }],
});

function open(initial: readonly ModelGroup[] = []) {
	let stored = [...initial];
	let fail = false;
	let refresh: (() => void) | undefined;
	const saves: { groups: readonly ModelGroup[]; scope: SaveScope }[] = [];
	const keys = new KeybindingsManager(TUI_KEYBINDINGS);
	const host: TabViewHost = {
		theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {
			refresh?.();
			refresh = undefined;
		},
		finish: () => {},
	};
	const view = new GroupsView(host, {
		groups: () => stored,
		catalog: () => [{ provider: "vendor", id: "one", name: "One", contextWindow: 1000 }],
		health: (member) => (member.id === "one" ? "healthy" : "unknown"),
		save: async (groups, scope) => {
			if (fail) throw new Error("disk error; retry");
			stored = [...groups];
			saves.push({ groups, scope });
		},
	});
	const press = (key: string) => view.handleInput(key);
	const text = () => view.render(140, 60).lines.map(stripVTControlCharacters).join("\n");
	const select = (label: string) => {
		for (let i = 0; i < 60; i++) press("k");
		for (let i = 0; i < 60; i++) {
			if (
				text()
					.split("\n")
					.some((line) => line.includes("❯") && line.includes(label))
			)
				return;
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
	const save = async (key: string) => {
		press("\x13");
		const done = new Promise<void>((resolve) => {
			refresh = resolve;
		});
		press(key);
		await done;
	};
	return {
		view,
		press,
		text,
		select,
		edit,
		save,
		saves,
		stored: () => stored,
		fail: (value: boolean) => {
			fail = value;
		},
	};
}

describe("groups tab", () => {
	test("creates through detail, saves to each scope, and discards staged list", async () => {
		for (const [key, scope] of [
			["r", "runtime"],
			["u", "user"],
			["p", "project"],
		] as const) {
			const r = open();
			r.press("a");
			r.edit("Group ID", "team");
			r.edit("+ Add member", "vendor/one");
			r.press("\x13");
			expect(r.text()).toContain("team");
			expect(r.stored()).toEqual([]);
			await r.save(key);
			expect(r.saves[0]?.scope).toBe(scope);
			expect(r.stored()[0]?.id).toBe("team");
			r.press("d");
			expect(r.press("\x1b")).toBe(true);
			expect(r.text()).toContain("team");
			expect(r.press("\x1b")).toBe(false);
		}
	});
	test("edits and deletes, rejects duplicate rename and creation", async () => {
		const r = open([group("first"), group("second")]);
		r.press("\r");
		r.edit("Group ID", "second");
		r.press("\x13");
		expect(r.text()).toContain("duplicate");
		r.edit("Group ID", "renamed");
		r.press("\x13");
		expect(r.text()).toContain("renamed");
		expect(r.text()).toContain("second");
		r.press("a");
		r.edit("Group ID", "second");
		r.edit("+ Add member", "vendor/one");
		r.press("\x13");
		expect(r.text()).toContain("duplicate");
		r.press("\x1b");
		r.press("\x1b");
		r.press("j");
		r.press("d");
		await r.save("u");
		expect(r.stored().map((item) => item.id)).toEqual(["renamed"]);
	});
	test("failed save retains staged list, cancel and retry; modal keys never leak", async () => {
		const r = open([group("first")]);
		r.press("\r");
		expect(r.press("\t")).toBe(true);
		expect(r.press("\x1b[C")).toBe(true);
		r.edit("Display name", "Changed");
		r.press("\x1b");
		expect(r.text()).toContain("Discarded");
		r.press("\x1b");
		r.press("d");
		r.fail(true);
		await r.save("p");
		expect(r.text()).toContain("disk error");
		expect(r.stored()).toHaveLength(1);
		r.press("\x13");
		expect(r.view.render(80, 4).modal).toBe(true);
		expect(r.press("\t")).toBe(true);
		expect(r.press("\x1b")).toBe(true);
		r.fail(false);
		await r.save("r");
		expect(r.stored()).toEqual([]);
	});
	test("blocks navigation while an asynchronous save is pending", async () => {
		let finishSave: (() => void) | undefined;
		let refreshed: (() => void) | undefined;
		const keys = new KeybindingsManager(TUI_KEYBINDINGS);
		const host: TabViewHost = {
			theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
			keys,
			binding: (id) => bindingLabel(keys, id),
			refresh: () => refreshed?.(),
			finish: () => {},
		};
		const view = new GroupsView(host, {
			groups: () => [group("first")],
			catalog: () => [],
			save: () =>
				new Promise<void>((resolve) => {
					finishSave = resolve;
				}),
		});
		expect(view.render(80, 4).lines.join(" ")).toContain("1 unknown");
		view.handleInput("d");
		view.handleInput("\x13");
		view.handleInput("r");
		expect(view.render(80, 4).modal).toBe(true);
		expect(view.handleInput("\t")).toBe(true);
		expect(view.handleInput("\x1b")).toBe(true);
		const done = new Promise<void>((resolve) => {
			refreshed = resolve;
		});
		finishSave?.();
		await done;
		view.dispose();
	});
	test("renders health, ordered members, scroll and sanitization at narrow and wide widths", () => {
		const groups = Array.from(
			{ length: 9 },
			(_, i): ModelGroup => ({
				...group(`group-${i}`),
				name: `Name\x1b]0;evil\x07`,
				members: [
					{ provider: "vendor", id: "one", tier: 1 },
					{ provider: "other", id: "unknown", tier: 2 },
				],
			}),
		);
		const r = open(groups);
		expect(r.text()).toContain("1/2 healthy");
		expect(r.text()).toContain("1 unknown");
		expect(r.text()).toContain("vendor/one → other/unknown");
		expect(r.text()).not.toContain("evil");
		for (let i = 0; i < 9; i++) {
			for (const width of [40, 80]) {
				const body = r.view.render(width, 4);
				expect(body.lines.length).toBeLessThanOrEqual(4);
				for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			r.press("j");
		}
		expect(r.view.render(40, 4).above).toBeGreaterThan(0);
	});
});
