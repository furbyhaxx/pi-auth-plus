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
import type { SaveScope } from "../../src/core/config/index.ts";
import type { SaveOutcome } from "../../src/core/config/save.ts";
import type { GroupMember, ModelGroup } from "../../src/models/groups/config.ts";
import type { GroupMemberHealth } from "../../src/models/groups/member.ts";
import { GroupsView } from "../../src/ui/dashboard/groups.ts";
import type { ModelCatalogItem } from "../../src/ui/dashboard/models.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

const group = (id: string): ModelGroup => ({
	id,
	strategy: "sticky",
	triggers: [],
	members: [{ provider: "vendor", id: "one", tier: 1 }],
});

function open(
	initial: readonly ModelGroup[] = [],
	catalog: () => readonly ModelCatalogItem[] = () => [
		{ provider: "vendor", id: "one", name: "One", contextWindow: 1000 },
	],
	bindings: KeybindingsConfig = {},
	health: (member: GroupMember) => GroupMemberHealth = (member) =>
		member.id === "one"
			? { state: "healthy", routable: true }
			: { state: "unknown", routable: true },
) {
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
	const keys = new KeybindingsManager(TUI_KEYBINDINGS, bindings);
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
		catalog,
		health,
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
	const add = (name: string) => {
		select("+ Add member");
		press("\r");
		press(`\x1b[200~${name}\x1b[201~`);
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
		add,
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
			r.add("One");
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
	test("searches a large physical catalog, excludes ineligible and duplicate members, and saves an alias", async () => {
		const models: ModelCatalogItem[] = [
			{ provider: "vendor", id: "one", name: "Already Included", contextWindow: 1000 },
			{ provider: "group", id: "g", name: "Group Model", contextWindow: 1000 },
			{
				provider: "group",
				id: "api",
				name: "Group API",
				contextWindow: 1000,
				api: "openai-completions",
			},
			{
				provider: "foreign",
				id: "v",
				name: "Virtual Model",
				contextWindow: 1000,
				api: "pi-virtual",
			},
			...Array.from({ length: 180 }, (_, i) => ({
				provider: "vendor",
				id: `model-${i}`,
				name: `Model ${i}`,
				contextWindow: 1000,
			})),
			{
				provider: "alias",
				id: "path/model",
				name: "Aurora Search Alias",
				contextWindow: 1000,
				api: "openai-completions",
			},
		];
		const r = open([group("first")], () => models);
		r.press("\r");
		r.select("+ Add member");
		r.press("\r");
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.view.render(140, 60).state).toContain("of 181");
		for (const query of [
			"Already Included",
			"Group Model",
			"Group API",
			"Virtual Model",
			"missing",
		]) {
			r.press(`\x1b[200~${query}\x1b[201~`);
			expect(r.text()).toContain("No models match");
			r.press("\r");
			expect(r.text()).toContain("No models match");
			expect(r.view.hasDrafts()).toBe(false);
			r.press("\x1b");
		}
		r.press("\x1b[200~Aurora Search\x1b[201~");
		for (const width of [36, 57, 80, 140]) {
			for (const height of [0, 1, 2, 4, 60]) {
				const body = r.view.render(width, height);
				expect(body.modal).toBe(true);
				expect(body.lines.length).toBeLessThanOrEqual(height);
				if (height > 0)
					expect(body.lines.join("")).toContain(CURSOR_MARKER + renderFakeCursor(" "));
				for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			expect(r.view.render(width, 60).lines).toHaveLength(2);
		}
		expect(r.text()).toContain("alias/path/model · Aurora Search Alias");
		r.press("\x13");
		expect(r.text()).toContain("alias/path/model · Aurora Search Alias");
		r.press("\t");
		r.press("?");
		expect(r.text()).toContain("alias/path/model");
		for (const width of [36, 57, 80, 140]) {
			const body = r.view.render(width, 4);
			expect(body.lines.length).toBeLessThanOrEqual(4);
			for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		r.press("\x1b");
		r.press("\r");
		expect(r.text()).toContain("alias/path/model");
		expect(r.view.hasDrafts()).toBe(true);
		r.select("+ Add member");
		r.press("\r");
		r.press("\x1b[200~Aurora Search\x1b[201~");
		expect(r.text()).toContain("No models match");
		r.press("\r");
		r.press("\x1b");
		r.press("\x1b");
		expect(r.text()).toContain("alias/path/model");
		r.press("\x13");
		expect(r.stored()).toEqual([group("first")]);
		await r.save("p");
		expect(r.saves[0]?.scope).toBe("project");
		expect(r.stored()[0]?.members).toEqual([
			{ provider: "vendor", id: "one", tier: 1 },
			{ provider: "alias", id: "path/model", tier: 1 },
		]);
	});
	test("retains group schema, context and thinking validation after choosing a member", async () => {
		const r = open();
		r.press("a");
		r.press("\x13");
		expect(r.text()).toContain("Invalid group");
		r.edit("Group ID", "team");
		r.add("One");
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
		r.edit("Thinking map", "low=high, medium=max");
		r.edit("Priority tier", "0");
		r.press("\x13");
		expect(r.text()).toContain("Invalid group");
		expect(r.stored()).toEqual([]);
		r.edit("Priority tier", "3");
		r.press("\x13");
		await r.save("u");
		expect(r.stored()[0]?.members).toEqual([
			{ provider: "vendor", id: "one", tier: 3, thinking: { low: "high", medium: "max" } },
		]);
	});
	test("picker honors rebound confirm and cancel keys without leaking them to the group", () => {
		const r = open(
			[group("first")],
			() => [{ provider: "alias", id: "path/model", name: "Alias", contextWindow: 1000 }],
			{ "tui.select.confirm": "ctrl+g", "tui.select.cancel": "ctrl+x" },
		);
		r.press("\x07");
		r.select("+ Add member");
		r.press("\x07");
		const hints = r.view.render(80, 4).hints;
		expect(hints).toContainEqual({ key: "ctrl+g", action: "choose", priority: 0 });
		expect(hints).toContainEqual({ key: "ctrl+x", action: "back", priority: 0 });
		r.press("\x1b[200~Alias\x1b[201~");
		r.press("\x18");
		r.press("\x18");
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.text()).toContain("+ Add member");
		r.press("\x07");
		r.press("\x1b[200~Alias\x1b[201~");
		r.press("\x07");
		expect(r.text()).toContain("alias/path/model");
		expect(r.view.hasDrafts()).toBe(true);
	});
	test("picker cancellation and global discard preserve draft ownership", () => {
		const r = open([group("first"), group("second")]);
		r.press("\r");
		r.edit("Display name", "Parent draft");
		r.press("\x13");
		r.press("j");
		r.press("\r");
		r.edit("Display name", "Child draft");
		r.select("+ Add member");
		r.press("\r");
		r.press("\x1b[200~search\x1b[201~");
		r.press("\x1b");
		r.press("\x1b");
		expect(r.text()).toContain("Child draft");
		expect(r.text()).toContain("vendor/one");
		expect(r.view.hasDrafts()).toBe(true);
		r.press("\r");
		r.press("\x1b[200~search\x1b[201~");
		r.view.discardDrafts();
		expect(r.view.hasDrafts()).toBe(false);
		expect(r.text()).not.toContain("Parent draft");
		expect(r.text()).not.toContain("Child draft");
		expect(r.stored()).toEqual([group("first"), group("second")]);
		r.press("\r");
		r.select("+ Add member");
		r.press("\r");
		r.view.dispose();
		expect(r.press("\r")).toBe(true);
		expect(r.stored()).toEqual([group("first"), group("second")]);
	});
	test("rechecks changing catalog eligibility when selecting and staging a member", async () => {
		let models: ModelCatalogItem[] = [
			{ provider: "alias", id: "path/model", name: "Alias", contextWindow: 1000 },
		];
		const r = open([group("first")], () => models);
		r.press("\r");
		r.select("+ Add member");
		r.press("\r");
		expect(r.text()).toContain("alias/path/model");
		models = models.map((item) => ({ ...item, api: "pi-virtual" }));
		r.press("\r");
		expect(r.text()).toContain("No models match");
		expect(r.view.hasDrafts()).toBe(false);
		models = models.map((item) => ({ ...item, api: "openai-completions" }));
		r.press("\r");
		expect(r.text()).toContain("alias/path/model");
		models = models.map((item) => ({ ...item, api: "pi-virtual" }));
		r.press("\x13");
		expect(r.text()).toContain("choose a physical model");
		expect(r.stored()).toEqual([group("first")]);
		models = models.map((item) => ({ ...item, api: "openai-completions" }));
		r.press("\x13");
		await r.save("r");
		expect(r.stored()[0]?.members).toEqual([
			{ provider: "vendor", id: "one", tier: 1 },
			{ provider: "alias", id: "path/model", tier: 1 },
		]);
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
		r.add("One");
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
	test("renders each health state and eligibility, scroll, and fit at supported widths", () => {
		const healthById: Record<string, GroupMemberHealth> = {
			one: { state: "healthy", routable: true },
			dry: { state: "exhausted", routable: false },
			auth: { state: "needs-auth", routable: false },
			maybe: { state: "unknown", routable: true },
			hold: { state: "unknown", routable: false },
			lost: { state: "unavailable", routable: false },
			unknown: { state: "unknown", routable: true },
		};
		const groups = Array.from(
			{ length: 9 },
			(_, i): ModelGroup => ({
				...group(`group-${i}`),
				name: `Name\x1b]0;evil\x07`,
				members:
					i === 0
						? [
								{ provider: "v", id: "one", tier: 1 },
								{ provider: "v", id: "dry", tier: 2 },
								{ provider: "v", id: "auth", tier: 3 },
								{ provider: "v", id: "maybe", tier: 4 },
								{ provider: "v", id: "hold", tier: 5 },
								{ provider: "v", id: "lost", tier: 6 },
							]
						: [
								{ provider: "vendor", id: "one", tier: 1 },
								{ provider: "other", id: "unknown", tier: 2 },
							],
			}),
		);
		const r = open(
			groups,
			undefined,
			{},
			(member) => healthById[member.id] ?? { state: "unknown", routable: false },
		);
		const lines = r.view.render(140, 60).lines.map(stripVTControlCharacters);
		const summary = lines.find((line) => line.includes("group-0"));
		expect(summary).toContain("1 healthy · 1 exhausted · 1 needs-auth · 1 unavailable · 2 unknown");
		expect(summary).not.toContain("3 healthy");
		expect(lines.indexOf(" healthy · routable v/one")).toBeLessThan(
			lines.indexOf(" exhausted · not routable v/dry"),
		);
		expect(lines).toContain(" healthy · routable v/one");
		expect(lines).toContain(" exhausted · not routable v/dry");
		expect(lines).toContain(" needs-auth · not routable v/auth");
		expect(lines).toContain(" unknown · best-effort v/maybe");
		expect(lines).toContain(" unknown · not routable v/hold");
		expect(lines).toContain(" unavailable · not routable v/lost");
		expect(r.text()).not.toContain("evil");
		r.press("\r");
		expect(r.text()).toContain("v/lost");
		r.press("\x1b");
		const narrowLines = r.view.render(36, 60).lines.map(stripVTControlCharacters);
		for (const line of narrowLines) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
		expect(narrowLines.find((line) => line.includes("group-0"))).toContain("1 healthy");
		expect(narrowLines).toContain(" healthy · routable v/one");
		expect(narrowLines).toContain(" exhausted · not routable v/dry");
		expect(narrowLines).toContain(" needs-auth · not routable v/auth");
		expect(narrowLines).toContain(" unknown · best-effort v/maybe");
		expect(narrowLines).toContain(" unknown · not routable v/hold");
		expect(narrowLines).toContain(" unavailable · not routable v/lost");
		for (let i = 0; i < 9; i++) {
			for (const width of [36, 57, 80, 140]) {
				const body = r.view.render(width, 4);
				expect(body.lines.length).toBeLessThanOrEqual(4);
				for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			r.press("j");
		}
		expect(r.view.render(36, 4).above).toBeGreaterThan(0);
	});
	test("scrolls all members inside a group before moving selection and back", () => {
		const memberIds = Array.from(
			{ length: 12 },
			(_, index) => `member-${String(index + 1).padStart(2, "0")}`,
		);
		const memberStates = [
			"healthy",
			"exhausted",
			"needs-auth",
			"unknown",
			"unavailable",
			"unknown",
		] as const;
		const members = memberIds.map((id, index) => ({
			provider: "v",
			id,
			tier: index + 1,
		}));
		const r = open([{ ...group("many"), members }, group("next")], (member) => {
			const index = memberIds.indexOf(member.id);
			const state = memberStates[Math.max(index, 0) % memberStates.length] ?? "unknown";
			return {
				state,
				routable: state === "healthy" || (state === "unknown" && index % 2 === 0),
			};
		});
		const seen = new Set<string>();
		const draw = () => {
			let linesAt80: string[] = [];
			for (const width of [36, 57, 80, 140]) {
				const body = r.view.render(width, 3);
				expect(body.lines).toHaveLength(3);
				for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				if (width === 80) linesAt80 = body.lines.map(stripVTControlCharacters);
			}
			for (const id of memberIds)
				if (linesAt80.some((line) => line.endsWith(`v/${id}`))) seen.add(id);
			return r.view.render(80, 3);
		};

		let body = draw();
		expect(body.above).toBe(0);
		for (let offset = 1; offset <= 10; offset++) {
			r.press("j");
			body = draw();
			expect(body.above).toBe(offset);
		}
		expect(body.lines.map(stripVTControlCharacters).join(" ")).toContain("v/member-12");
		expect([...seen].sort()).toEqual([...memberIds].sort());

		r.press("j");
		body = draw();
		expect(body.lines.map(stripVTControlCharacters).some((line) => line.includes("❯ next"))).toBe(
			true,
		);
		r.press("k");
		body = draw();
		expect(body.above).toBe(0);
		expect(body.lines.map(stripVTControlCharacters).some((line) => line.includes("❯ many"))).toBe(
			true,
		);

		for (let offset = 1; offset <= 10; offset++) {
			r.press("j");
			body = draw();
			expect(body.above).toBe(offset);
		}
		for (let offset = 9; offset >= 0; offset--) {
			r.press("k");
			body = draw();
			expect(body.above).toBe(offset);
		}
		expect(body.lines.map(stripVTControlCharacters).some((line) => line.includes("❯ many"))).toBe(
			true,
		);
	});
});
