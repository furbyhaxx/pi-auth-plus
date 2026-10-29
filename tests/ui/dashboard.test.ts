import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import {
	AuthDashboard,
	type DashboardModel,
	type DashboardResult,
	dashboardText,
	staticViews,
	TABS,
	type TabId,
	type TabView,
	type TabViewFactory,
	type TabViewHost,
} from "../../src/ui/dashboard/index.ts";
import type { PanelTheme } from "../../src/ui/frame/index.ts";

const theme: PanelTheme = {
	fg: (_color, text) => `\x1b[90m${text}\x1b[39m`,
	bg: (_color, text) => text,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
};
const HOUR = 3_600_000;
const model: DashboardModel = {
	nowMs: 0,
	providers: [
		{
			id: "claude",
			label: "Claude (subscription)",
			status: { state: "oauth", expiresAt: 3 * HOUR + 60_000, expired: false },
		},
		{
			id: "antigravity",
			label: "Antigravity\x1b]0;evil\x07",
			status: { state: "oauth", expiresAt: 0, expired: true },
		},
		{ id: "synthetic", label: "Synthetic", status: { state: "missing" } },
		{
			id: "codex",
			label: "OpenAI Codex",
			status: { state: "missing" },
			loginHint: "/quota codex login or /login openai-codex",
		},
	],
};

function open(rows = 40, tab: TabId = "providers", data = model) {
	let closed = 0;
	const keys = new KeybindingsManager(TUI_KEYBINDINGS);
	const host = { terminal: { rows }, requestRender: () => {} };
	const panel = new AuthDashboard(
		host,
		theme,
		keys,
		() => closed++,
		staticViews(data),
		tab,
		data.providers.length,
	);
	return { panel, closed: () => closed };
}

const plain = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line));

class DraftView implements TabView {
	dirty = false;
	subeditor = true;
	consumeCtrlC = false;
	readonly inputs: string[] = [];
	localDiscards = 0;
	onDiscard: (() => void) | undefined;
	readonly id: TabId;
	readonly host: TabViewHost;
	readonly events: string[];

	constructor(id: TabId, host: TabViewHost, events: string[]) {
		this.id = id;
		this.host = host;
		this.events = events;
	}

	hasDrafts(): boolean {
		return this.dirty;
	}

	discardDrafts(): void {
		this.events.push(`discard:${this.id}`);
		this.dirty = false;
		this.onDiscard?.();
	}

	handleInput(data: string): boolean {
		this.inputs.push(data);
		if (data === "d") {
			this.host.confirmDiscard?.(() => {
				this.dirty = false;
				this.subeditor = false;
				this.localDiscards++;
			});
			return true;
		}
		if (data === "n") {
			this.host.navigate?.("settings");
			return true;
		}
		if (data === "r" || data === "e") {
			this.host.finish(data === "r" ? { reset: "codex" } : { editSetting: "models.rules" });
			return true;
		}
		return data === "\x03" && this.consumeCtrlC;
	}

	render() {
		return {
			lines: [` ${this.id} subeditor`],
			above: 0,
			below: 0,
			hints: [],
			modal: this.subeditor,
		};
	}

	dispose(): void {
		this.events.push(`dispose:${this.id}`);
	}
}

class TestDashboard extends AuthDashboard {
	requestFinish(result: DashboardResult): void {
		this.finish(result);
	}
}

function draftRig(
	tab: TabId = "providers",
	rows = 40,
	keys = new KeybindingsManager(TUI_KEYBINDINGS),
) {
	const events: string[] = [];
	const results: DashboardResult[] = [];
	const instances = {} as Record<TabId, DraftView>;
	const factories = {} as Record<TabId, TabViewFactory>;
	for (const spec of TABS) {
		factories[spec.id] = (host) => {
			const view = new DraftView(spec.id, host, events);
			instances[spec.id] = view;
			return view;
		};
	}
	const panel = new TestDashboard(
		{ terminal: { rows }, requestRender: () => {} },
		theme,
		keys,
		(result) => {
			events.push("finish");
			results.push(result);
		},
		factories,
		tab,
		0,
	);
	return { panel, instances, events, results };
}

describe("ui/dashboard", () => {
	test("every line fits at the check widths", () => {
		for (const width of [36, 57, 80, 140]) {
			for (const tab of TABS) {
				const lines = open(40, tab.id).panel.render(width);
				for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(plain(lines)[1]).toContain(`▸${tab.label}`);
			}
		}
	});

	test("each tab fits its content without padding and resizes when switching", () => {
		const { panel } = open(80);
		const providers = plain(panel.render(80));
		expect(providers).toHaveLength(10);
		expect(providers).not.toContain("");
		panel.handleInput("\t");
		const quotas = plain(panel.render(80));
		expect(quotas).toHaveLength(7);
		expect(quotas).not.toContain("");
		panel.handleInput("\x1b[Z");
		expect(plain(panel.render(80))).toHaveLength(providers.length);
	});

	test("provider rows show sign-in state as text, with /login for missing credentials", () => {
		const text = plain(open().panel.render(140)).join("\n");
		expect(text).toContain("signed in · expires in 3h 1m");
		expect(text).toContain("token expired, refreshes on next request");
		expect(text).toContain("not signed in · /login synthetic");
		expect(text).toContain("not signed in · /quota codex login or /login openai-codex");
		expect(text).not.toContain("/login codex");
		expect(text).not.toContain("evil");
		expect(dashboardText("quotas", model)).toBe(
			"Auth › Quotas\n  Quota monitoring is not available yet.",
		);
		expect(dashboardText("models", model)).toBe(
			"Auth › Models\n  Model visibility rules are unavailable in this session.",
		);
	});

	test("tab and shift+tab wrap around; cancel closes exactly once", () => {
		const { panel, closed } = open();
		panel.handleInput("\x1b[Z");
		expect(panel.tab).toBe("settings");
		panel.handleInput("\t");
		panel.handleInput("\t");
		expect(panel.tab).toBe("quotas");
		panel.handleInput("\x1b");
		panel.handleInput("\x1b");
		expect(closed()).toBe(1);
	});

	test("all exit paths preserve drafts on cancel and discard every view before one finish", () => {
		const exits: {
			name: string;
			run: (rig: ReturnType<typeof draftRig>) => void;
			result: DashboardResult;
		}[] = [
			{ name: "escape", run: ({ panel }) => panel.handleInput("\x1b"), result: undefined },
			{ name: "ctrl+c", run: ({ panel }) => panel.handleInput("\x03"), result: undefined },
			{ name: "reset", run: ({ panel }) => panel.handleInput("r"), result: { reset: "codex" } },
			{
				name: "edit setting",
				run: ({ panel }) => panel.handleInput("e"),
				result: { editSetting: "models.rules" },
			},
			{
				name: "protected finish",
				run: ({ panel }) => panel.requestFinish({ reset: "codex" }),
				result: { reset: "codex" },
			},
		];
		for (const exit of exits) {
			const rig = draftRig();
			rig.instances.providers.consumeCtrlC = true;
			rig.instances.settings.dirty = true;
			rig.instances.models.dirty = true;
			rig.instances.models.onDiscard = () => rig.instances.models.host.finish({ reset: "ignored" });
			exit.run(rig);
			expect(rig.results, exit.name).toHaveLength(0);
			expect(plain(rig.panel.render(80)).join("\n"), exit.name).toContain("Discard");
			rig.panel.handleInput("\x1b");
			expect(rig.panel.tab, exit.name).toBe("providers");
			expect(rig.instances.providers.subeditor, exit.name).toBe(true);
			expect(rig.instances.settings.dirty, exit.name).toBe(true);
			expect(rig.instances.models.dirty, exit.name).toBe(true);
			expect(rig.events, exit.name).toEqual([]);
			exit.run(rig);
			rig.panel.requestFinish({ editSetting: "ignored" });
			rig.panel.handleInput("\r");
			rig.panel.handleInput("\r");
			expect(rig.results, exit.name).toEqual([exit.result]);
			expect(rig.events, exit.name).toEqual([
				...TABS.map((tab) => `discard:${tab.id}`),
				...TABS.map((tab) => `dispose:${tab.id}`),
				"finish",
			]);
		}
	});

	test("no-draft exits close immediately, including ctrl+c from a consuming subeditor", () => {
		for (const key of ["\x1b", "\x03", "r", "e"]) {
			const { panel, instances, results, events } = draftRig();
			instances.providers.consumeCtrlC = true;
			panel.handleInput(key);
			expect(results).toHaveLength(1);
			expect(events.some((event) => event.startsWith("discard:"))).toBe(false);
		}
	});

	test("local confirmation isolates input and leaves other tabs and the subeditor intact on cancel", () => {
		const { panel, instances, results, events } = draftRig("models");
		const view = instances.models;
		view.dirty = true;
		instances.settings.dirty = true;
		panel.handleInput("d");
		const inputs = [...view.inputs];
		panel.handleInput("x");
		panel.handleInput("\t");
		view.host.navigate?.("settings");
		view.host.finish({ reset: "ignored" });
		expect(view.inputs).toEqual(inputs);
		expect(panel.tab).toBe("models");
		panel.handleInput("\x1b");
		expect(plain(panel.render(80)).join("\n")).toContain("models subeditor");
		expect(view.subeditor).toBe(true);
		expect(view.dirty).toBe(true);
		expect(instances.settings.dirty).toBe(true);
		expect(view.localDiscards).toBe(0);
		panel.handleInput("d");
		panel.handleInput("\r");
		expect(view.localDiscards).toBe(1);
		expect(view.subeditor).toBe(false);
		expect(view.dirty).toBe(false);
		expect(instances.settings.dirty).toBe(true);
		expect(results).toHaveLength(0);
		expect(events).toEqual([]);
	});

	test("confirmation shows both configured bindings at short and narrow sizes", () => {
		const keys = new KeybindingsManager(TUI_KEYBINDINGS);
		keys.setUserBindings({ "tui.select.confirm": ["ctrl+y"], "tui.select.cancel": ["ctrl+n"] });
		const { panel, instances, results } = draftRig("providers", 9, keys);
		instances.settings.dirty = true;
		panel.handleInput("\x03");
		for (const width of [20, 36, 57, 80, 140]) {
			const lines = panel.render(width);
			const text = plain(lines).join("\n");
			expect(text).toContain("Discard all & exit?");
			expect(text).toContain("ctrl+y discard");
			expect(text).toContain("ctrl+n keep");
			expect(lines).toHaveLength(7);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		panel.handleInput("\r");
		expect(results).toHaveLength(0);
		panel.handleInput("\x0e");
		expect(instances.settings.dirty).toBe(true);
		panel.handleInput("\x03");
		panel.handleInput("\x03");
		expect(results).toHaveLength(0);
		expect(instances.settings.dirty).toBe(true);
		panel.handleInput("\x03");
		panel.handleInput("\x19");
		expect(results).toHaveLength(1);
		expect(results[0]).toBeUndefined();
	});

	test("navigation preserves drafts and recreates Tokens only after its draft is gone", () => {
		const { panel, instances, events } = draftRig("tokens");
		const tokens = instances.tokens;
		tokens.dirty = true;
		instances.settings.dirty = true;
		panel.handleInput("\t");
		expect(panel.tab).toBe("models");
		panel.handleInput("\x1b[Z");
		expect(panel.tab).toBe("tokens");
		expect(instances.tokens).toBe(tokens);
		panel.handleInput("n");
		expect(panel.tab).toBe("settings");
		expect(events).toEqual([]);
		tokens.host.navigate?.("tokens");
		expect(instances.tokens).toBe(tokens);
		expect(tokens.dirty).toBe(true);
		expect(instances.settings.dirty).toBe(true);
		tokens.dirty = false;
		tokens.host.navigate?.("settings");
		expect(events).toEqual(["dispose:tokens"]);
		expect(instances.tokens).not.toBe(tokens);
		expect(instances.settings.dirty).toBe(true);
	});

	test("disposal cancels pending confirmations and fences late view callbacks", () => {
		const { panel, instances, events, results } = draftRig("models");
		const view = instances.models;
		view.dirty = true;
		panel.handleInput("d");
		panel.dispose();
		panel.handleInput("\r");
		view.host.confirmDiscard?.(() => view.localDiscards++);
		view.host.navigate?.("settings");
		view.host.finish({ reset: "ignored" });
		panel.dispose();
		expect(view.localDiscards).toBe(0);
		expect(view.dirty).toBe(true);
		expect(panel.tab).toBe("models");
		expect(results).toHaveLength(0);
		expect(events).toEqual(TABS.map((tab) => `dispose:${tab.id}`));
	});

	test("a short terminal scrolls the body and shows the hidden row counts", () => {
		const providers = Array.from({ length: 6 }, (_, index) => ({
			id: `p${index}`,
			label: `Provider ${index}`,
			status: { state: "api_key" as const },
		}));
		const { panel } = open(14, "providers", { nowMs: 0, providers });
		const before = plain(panel.render(80));
		expect(before.find((line) => line.includes("more"))).toContain("↓ 2 more");
		panel.handleInput("\x1b[B");
		panel.handleInput("\x1b[B");
		panel.handleInput("\x1b[B");
		const after = plain(panel.render(80));
		expect(after).toHaveLength(before.length);
		expect(after[0]).toContain("↑ 2 more");
		expect(after.join("\n")).toContain("Provider 5");
		expect(after.filter((line) => line.includes("more"))).toHaveLength(1);
	});
});
