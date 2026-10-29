import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { SaveScope } from "../../src/core/config/index.ts";
import type { SaveOutcome } from "../../src/core/config/save.ts";
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
	let pendingDiscard: (() => void) | undefined;
	let saveBehavior: (groups: readonly ModelGroup[], scope: SaveScope) => Promise<SaveOutcome> =
		async (_groups, scope) => ({
			committed: true,
			scope,
			shadowed: [],
			warnings: [],
		});
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
		confirmDiscard: (discard) => {
			pendingDiscard = discard;
		},
	};
	const view = new GroupsView(host, {
		groups: () => stored,
		catalog: () => [{ provider: "vendor", id: "one", name: "One", contextWindow: 1000 }],
		health: (member) => (member.id === "one" ? "healthy" : "unknown"),
		save: async (groups, scope) => {
			const outcome: SaveOutcome = fail
				? { committed: false, error: "disk error; retry" }
				: await saveBehavior(groups, scope);
			if (outcome.committed) {
				stored = [...groups];
				saves.push({ groups, scope });
			}
			return outcome;
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
	const beginSave = (key: string) => {
		press("\x13");
		const done = new Promise<void>((resolve) => {
			refresh = resolve;
		});
		press(key);
		return done;
	};
	const save = async (key: string) => await beginSave(key);
	return {
		view,
		press,
		text,
		select,
		edit,
		save,
		beginSave,
		saves,
		stored: () => stored,
		fail: (value: boolean) => {
			fail = value;
		},
		setSaveBehavior: (behavior: typeof saveBehavior) => {
			saveBehavior = behavior;
		},
		confirmDiscard: () => {
			const discard = pendingDiscard;
			pendingDiscard = undefined;
			discard?.();
		},
		cancelDiscard: () => {
			pendingDiscard = undefined;
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
			expect(r.press("\x1b")).toBe(false);
			expect(r.view.hasDrafts()).toBe(true);
			r.view.discardDrafts();
			expect(r.view.hasDrafts()).toBe(false);
			expect(r.text()).toContain("team");
			expect(r.press("\x1b")).toBe(false);
		}
	});
	test("local child discard preserves parent staging and global discard clears both", () => {
		const r = open([group("first"), group("second")]);
		r.press("\r");
		r.edit("Display name", "Parent draft");
		r.press("\x13");
		r.press("j");
		r.press("\r");
		r.edit("Display name", "Child draft");
		expect(r.view.hasDrafts()).toBe(true);
		expect(r.press("\x1b")).toBe(true);
		expect(r.text()).toContain("Child draft");
		r.cancelDiscard();
		expect(r.view.hasDrafts()).toBe(true);
		expect(r.text()).toContain("Child draft");
		r.press("\x1b");
		r.confirmDiscard();
		expect(r.text()).toContain("Parent draft");
		expect(r.text()).not.toContain("Child draft");
		expect(r.view.hasDrafts()).toBe(true);
		r.view.discardDrafts();
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.text()).not.toContain("Parent draft");
	});
	test("changed nested input counts as a draft but focus alone does not", () => {
		const r = open();
		r.press("a");
		expect(r.view.hasDrafts()).toBe(false);
		r.select("Group ID");
		r.press("\r");
		expect(r.view.hasDrafts()).toBe(false);
		r.press("\x15");
		r.press("\x1b[200~team\x1b[201~");
		expect(r.view.hasDrafts()).toBe(true);
		expect(r.press("\x1b")).toBe(true);
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.text()).not.toContain("team");
		r.press("\x1b");
		expect(r.view.hasDrafts()).toBe(false);
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
		r.confirmDiscard();
		r.press("j");
		r.press("d");
		await r.save("u");
		expect(r.stored().map((item) => item.id)).toEqual(["renamed"]);
	});
	test("failed save retains staged list and modal keys never leak", async () => {
		const r = open([group("first")]);
		r.press("\r");
		expect(r.press("\t")).toBe(true);
		expect(r.press("\x1b[C")).toBe(true);
		r.edit("Display name", "Changed");
		r.press("\x13");
		r.press("d");
		r.fail(true);
		await r.save("p");
		expect(r.text()).toContain("disk error");
		expect(r.view.hasDrafts()).toBe(true);
		expect(r.stored()).toHaveLength(1);
		r.press("\x13");
		expect(r.view.render(80, 4).modal).toBe(true);
		expect(r.press("\t")).toBe(true);
		expect(r.press("\x1b")).toBe(true);
		r.fail(false);
		await r.save("r");
		expect(r.stored()).toEqual([]);
	});
	test("delayed failed and committed-warning outcomes update staged state exactly", async () => {
		const r = open([group("first")]);
		r.press("d");
		let started = Promise.withResolvers<void>();
		let result = Promise.withResolvers<SaveOutcome>();
		r.setSaveBehavior(() => {
			started.resolve();
			return result.promise;
		});
		const failed = r.beginSave("u");
		await started.promise;
		expect(r.view.isSaving()).toBe(true);
		expect(r.view.handleInput("d")).toBe(true);
		expect(r.view.hasDrafts()).toBe(true);
		result.resolve({ committed: false, error: "disk error" });
		await failed;
		expect(r.view.isSaving()).toBe(false);
		expect(r.view.hasDrafts()).toBe(true);
		expect(r.text()).toContain("disk error");

		started = Promise.withResolvers<void>();
		result = Promise.withResolvers<SaveOutcome>();
		const committed = r.beginSave("p");
		await started.promise;
		expect(r.view.isSaving()).toBe(true);
		expect(r.view.handleInput("d")).toBe(true);
		result.resolve({
			committed: true,
			scope: "project",
			shadowed: ["models.groups", "models.other"],
			warnings: ["effects failed", "reopen the session"],
		});
		await committed;
		expect(r.view.isSaving()).toBe(false);
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.text()).toContain("shadowed by higher scope: models.groups, models.other");
		expect(r.text()).toContain("warning: effects failed");
		expect(r.text()).toContain("warning: reopen the session");
	});
	test("blocks navigation while an asynchronous save is pending", async () => {
		let finishSave: ((outcome: SaveOutcome) => void) | undefined;
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
				new Promise<SaveOutcome>((resolve) => {
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
		finishSave?.({ committed: true, scope: "runtime", shadowed: [], warnings: [] });
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
