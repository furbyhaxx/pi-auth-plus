import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	KeybindingsManager,
	parseColor,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { LineTheme } from "../../src/quotas/line/format.ts";
import type { LineConfig } from "../../src/quotas/line/values.ts";
import type { QuotaReport, ReportProvider } from "../../src/quotas/report.ts";
import { fitLabel, type LinePlacement, QuotasView } from "../../src/ui/dashboard/quotas.ts";
import type { DashboardResult, TabViewHost } from "../../src/ui/dashboard/view.ts";

const theme = {
	colors: {
		success: parseColor("#00ff00"),
		warning: parseColor("#ffff00"),
		error: parseColor("#ff0000"),
	},
	fg: (_token: string, text: string) => `\x1b[90m${text}\x1b[39m`,
	style: (text: string) => text,
} as unknown as LineTheme;

function provider(id: string): ReportProvider {
	return {
		id,
		title: id,
		short: id,
		state: "ok",
		windows: [{ id: "daily", label: "Daily", shortLabel: "day", usedFraction: 0.25 }],
	};
}

function open(providers: readonly ReportProvider[], solo?: string) {
	let report: QuotaReport = { v: 1, generatedAt: 0, providers };
	let placement: LinePlacement = "below-editor-first";
	let listener = () => {};
	let renders = 0;
	let unsubscribed = 0;
	const calls: [string, boolean][] = [];
	const finished: DashboardResult[] = [];
	const busy = new Set<string>();
	let reject = false;
	const config: LineConfig = { percentDisplay: "used", creditHealthyUsd: 50, creditCriticalUsd: 5 };
	const host: TabViewHost = {
		theme: { fg: theme.fg, bg: (_token, text) => text, bold: (text) => text },
		keys: new KeybindingsManager(TUI_KEYBINDINGS),
		binding: (id) => (id === "tui.select.up" ? "↑" : "↓"),
		refresh: () => {
			renders++;
		},
		finish: (result) => finished.push(result),
	};
	const view = new QuotasView(
		host,
		theme,
		{
			report: () => report,
			resetSupport: (id) => id === "one",
			refreshing: (id) => busy.has(id),
			refresh: async (id, force) => {
				calls.push([id, force]);
				if (reject) throw new Error("reported failure");
			},
			onChange: (next) => {
				listener = next;
				return () => {
					unsubscribed++;
				};
			},
			lineConfig: () => config,
			linePlacement: () => placement,
			setLinePlacement: async (next) => {
				if (reject) throw new Error("save failed\x1b]0;evil\x07");
				placement = next;
			},
			now: () => 3_600_000,
		},
		solo,
	);
	return {
		view,
		calls,
		finished,
		busy,
		config,
		placement: () => placement,
		renders: () => renders,
		unsubscribed: () => unsubscribed,
		reject: () => {
			reject = true;
		},
		change: (providers: readonly ReportProvider[]) => {
			report = { ...report, providers };
			listener();
		},
	};
}

const lines = (view: QuotasView, width = 140, rows = 100) =>
	view.render(width, rows).lines.map(stripVTControlCharacters);
const selected = (view: QuotasView) => lines(view).find((line) => line.includes("❯"));

describe("quotas tab", () => {
	test("reset finishes only for supported providers and hints follow selection", () => {
		const f = open([provider("one"), provider("two")]);
		expect(f.view.render(80, 10).hints).toContainEqual({ key: "x", action: "reset", priority: 3 });
		expect(f.view.handleInput("x")).toBe(true);
		expect(f.finished).toEqual([{ reset: "one" }]);
		f.view.handleInput("j");
		expect(f.view.render(80, 10).hints?.some((hint) => hint.key === "x")).toBe(false);
		f.view.handleInput("x");
		expect(f.finished).toEqual([{ reset: "one" }]);
		expect(f.view.render(80, 10).description).toContain(
			"two exposes no verified on-demand reset endpoint. Supported: one.",
		);
		f.view.dispose();
	});
	test("unknown usage and credits stay unknown, and every window remains visible", () => {
		const fixture = open([
			{
				...provider("one"),
				credits: { currency: "USD" },
				windows: [
					{ id: "credits", label: "Unknown window", shortLabel: "?" },
					{ id: "other", label: "Other unknown", shortLabel: "?" },
				],
			},
		]);
		const text = lines(fixture.view).join("\n");
		expect(text).toContain("Unknown window");
		expect(text).toContain("Other unknown");
		expect(text).toContain("? used");
		expect(text).toContain("? USD");
		expect(text).not.toContain("0%");
		expect(text).not.toContain("█");
		fixture.view.dispose();
	});

	test("selection follows provider identity across reorder, removal, and solo toggling", () => {
		const f = open([provider("one"), provider("two"), provider("three")]);
		f.view.handleInput("j");
		f.change([provider("two"), provider("three"), provider("one")]);
		expect(selected(f.view)).toContain("two");
		f.view.handleInput("a");
		expect(lines(f.view).join("\n")).not.toContain("three");
		f.view.handleInput("a");
		expect(selected(f.view)).toContain("two");
		f.view.handleInput("k");
		expect(selected(f.view)).toContain("one");
		f.change([provider("three")]);
		expect(selected(f.view)).toContain("three");
		expect(f.renders()).toBe(2);
		f.view.dispose();
		f.view.dispose();
		expect(f.unsubscribed()).toBe(1);
	});

	test("manual refresh forces the selected provider and R includes providers outside solo", async () => {
		const f = open([provider("one"), provider("two")], "two");
		f.view.handleInput("r");
		expect(f.calls).toEqual([["two", true]]);
		f.reject();
		f.view.handleInput("R");
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(f.calls).toEqual([
			["two", true],
			["one", true],
			["two", true],
		]);
		f.view.dispose();
	});

	test("placement cycles, refresh state wins, and reserved keys reach the dashboard", async () => {
		const f = open([provider("one")]);
		for (const placement of [
			"below-editor-last",
			"above-editor",
			"off",
			"below-editor-first",
		] as const) {
			expect(f.view.handleInput("p")).toBe(true);
			await Promise.resolve();
			expect(f.placement()).toBe(placement);
			expect(stripVTControlCharacters(f.view.render(80, 10).state ?? "")).toBe(placement);
		}
		f.busy.add("one");
		expect(f.view.render(80, 10).state).toContain("refreshing");
		for (const key of ["\t", "\x1b[Z", "\x1b[D", "\x1b[C", "\x1b", "l"])
			expect(f.view.handleInput(key)).toBe(false);
		f.view.dispose();
	});

	test("all rows fit at check widths, sanitize text, and show balance, countdown and drainage units", () => {
		const f = open([
			{
				...provider("one"),
				title: "Title\x1b]0;evil\x07",
				tier: "pro\nplan",
				ageSec: 90,
				credits: {
					remaining: 12,
					currency: "USD",
					detailText: "balance",
					drainage: { observedAt: 0, h1: { perHour: 2, coverageSec: 3600 }, etaSec: 21600 },
				},
				windows: [
					{
						id: "daily",
						shortLabel: "day",
						label: "Daily",
						usedFraction: 0.25,
						valueText: "25/100",
						resetAtMs: 7_200_000,
						drainage: {
							observedAt: 0,
							window: { perHour: 0.1, coverageSec: 100 },
							resetsBeforeExhaustion: true,
						},
					},
				],
			},
			{ ...provider("auth"), state: "needs-auth", needsAuth: true },
			{
				...provider("codex"),
				state: "needs-auth",
				needsAuth: true,
				loginHint: "/quota codex login or /login openai-codex",
			},
			{ ...provider("error"), state: "error", error: "HTTP 500; retry" },
			{ ...provider("loading"), state: "unknown", windows: [] },
		]);
		for (const width of [36, 57, 80, 140])
			for (const line of f.view.render(width, 100).lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(line).not.toContain("\n");
				expect(line).not.toContain("evil");
			}
		const text = lines(f.view).join("\n");
		expect(text).not.toContain("/login codex");
		for (const part of [
			"12.00 USD",
			"25% used",
			"25/100",
			"↻ 1h 0m",
			"2.00 USD/h",
			"empty in 5h 0m",
			"10.0%/h",
			"resets first",
			"/login auth",
			"⚠ /quota codex login or /login openai-codex",
			"✗",
			"Loading quota…",
			"1m ago",
		])
			expect(text).toContain(part);
		f.config.percentDisplay = "remaining";
		expect(lines(f.view).join("\n")).toContain("75% left");
		f.view.dispose();
	});

	test("placement failures are visible and late completions do not redraw disposed views", async () => {
		const f = open([provider("one")]);
		f.reject();
		f.view.handleInput("p");
		await Promise.resolve();
		expect(f.view.render(80, 10).description).toContain(
			"Line placement failed: save failed; retry p.",
		);
		expect(f.placement()).toBe("below-editor-first");
		f.view.handleInput("r");
		f.view.dispose();
		const renders = f.renders();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		f.change([]);
		expect(f.renders()).toBe(renders);
	});

	test("missing solo providers fall back to all; empty reports have no refresh target", () => {
		const f = open([provider("one")], "missing");
		expect(selected(f.view)).toContain("one");
		f.change([]);
		expect(lines(f.view).join("\n")).toContain("No quota providers enabled.");
		f.view.handleInput("j");
		f.view.handleInput("r");
		expect(f.calls).toEqual([]);
		f.view.dispose();
	});

	test("scroll follows selection and tall providers can expose every row", () => {
		const f = open([
			provider("one"),
			provider("two"),
			{
				...provider("three"),
				windows: Array.from({ length: 8 }, (_, i) => ({
					id: `${i}`,
					label: `Window ${i}`,
					shortLabel: `${i}`,
				})),
			},
		]);
		f.view.render(57, 3);
		f.view.handleInput("\x1b[B");
		expect(f.view.render(57, 3).above).toBeGreaterThan(0);
		f.view.handleInput("\x1b[B");
		const seen = new Set<string>();
		for (let i = 0; i < 10; i++) {
			for (const line of lines(f.view, 57, 3)) seen.add(line);
			f.view.handleInput("j");
		}
		for (let i = 0; i < 8; i++) expect([...seen].join("\n")).toContain(`Window ${i}`);
		f.view.dispose();
	});
});

test("clipped window labels keep the qualifier that tells sibling windows apart", () => {
	expect(stripVTControlCharacters(fitLabel("Claude and GPT models (5h)", 19))).toBe(
		"Claude and GP… (5h)",
	);
	expect(fitLabel("Claude and GPT models (7d)", 19)).toEndWith(" (7d)");
	expect(fitLabel("Short (7d)", 19)).toBe("Short (7d)");
});
