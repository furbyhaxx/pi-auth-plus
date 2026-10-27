import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import {
	AuthDashboard,
	type DashboardModel,
	dashboardText,
	staticViews,
	TABS,
	type TabId,
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

describe("ui/dashboard", () => {
	test("every line fits at the check widths and the frame height is constant across tabs", () => {
		for (const width of [36, 57, 80, 140]) {
			const heights = new Set<number>();
			for (const tab of TABS) {
				const lines = open(40, tab.id).panel.render(width);
				heights.add(lines.length);
				for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(plain(lines)[1]).toContain(`▸${tab.label}`);
			}
			expect(heights.size).toBe(1);
		}
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
