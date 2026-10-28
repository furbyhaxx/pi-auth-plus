import { expect, test } from "bun:test";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { BreakdownPart, ContextReport } from "../../src/tokens/engine/index.ts";
import type { TokenTracker } from "../../src/tokens/tracker/types.ts";
import { AuthDashboard, staticViews } from "../../src/ui/dashboard/index.ts";
import { TokensView, tokensText } from "../../src/ui/dashboard/tokens.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";

const report: ContextReport = {
	provider: "test-provider",
	model: "test-model",
	contextWindow: 10000,
	tokens: { tokens: 1200, source: "provider" },
	percent: 12,
	anchor: { tokens: 1000, source: "provider" },
	tail: { tokens: 200, source: "tokenizer" },
	tailMessages: 2,
	pi: 1100,
	computedAt: 0,
};

function open() {
	let current: ContextReport | undefined = report;
	let listener: Parameters<TokenTracker["onChange"]>[0] = () => {};
	let resolve: (parts: readonly BreakdownPart[] | undefined) => void = () => {};
	let signal: AbortSignal | undefined;
	let unsubscribed = 0;
	let renders = 0;
	const tracker: TokenTracker = {
		latest: () => current,
		refresh: async () => current,
		onChange: (next) => {
			listener = next;
			return () => {
				unsubscribed++;
			};
		},
		breakdown: (next) => {
			signal = next;
			return new Promise((done) => {
				resolve = done;
			});
		},
	};
	const host: TabViewHost = {
		theme: { fg: (_token, text) => text, bg: (_token, text) => text, bold: (text) => text },
		keys: new KeybindingsManager(TUI_KEYBINDINGS),
		binding: () => "↑↓",
		refresh: () => {
			renders++;
		},
		finish: () => {},
	};
	const view = new TokensView(host, tracker);
	return {
		view,
		host,
		tracker,
		signal: () => signal,
		unsubscribed: () => unsubscribed,
		renders: () => renders,
		resolve: (parts: readonly BreakdownPart[] | undefined) => resolve(parts),
		change: (next: ContextReport | undefined) => {
			current = next;
			listener(next, "request");
		},
	};
}
const text = (view: TokensView) => view.render(140, 100).lines.join("\n");

test("live context totals, sources, Pi delta and asynchronous contributions fit every width", async () => {
	const f = open();
	const initial = text(f.view);
	expect(tokensText(f.tracker)).toContain("Total: 1.2K · exact (usage)");
	expect(tokensText(f.tracker)).toContain("Delta: +100 vs Pi");
	for (const value of [
		"test-provider",
		"test-model",
		"1.2K",
		"exact (usage)",
		"12.0%",
		"+100 vs Pi",
		"2 messages",
		"tokenizer estimate",
		"counting…",
	])
		expect(initial).toContain(value);
	f.resolve([{ kind: "system", count: { tokens: 200, source: "count-endpoint" }, items: 1 }]);
	await Promise.resolve();
	expect(text(f.view)).toContain("200 · exact (count API) · 1 item");
	for (const width of [36, 57, 80, 140]) {
		for (const line of f.view.render(width, 100).lines)
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
	const renders = f.renders();
	f.change({ ...report, tokens: { tokens: 3000, source: "estimate" }, pi: null });
	expect(f.renders()).toBeGreaterThan(renders);
	expect(text(f.view)).toContain("3K · estimate");
	expect(text(f.view)).toContain("unknown");
	f.view.dispose();
	expect(f.signal()?.aborted).toBe(true);
	f.view.dispose();
	expect(f.unsubscribed()).toBe(1);
	const closed = f.renders();
	f.resolve([]);
	f.change(undefined);
	await Promise.resolve();
	expect(f.renders()).toBe(closed);
});

test("unavailable tracker and no session are explicit; inactive views do not count", () => {
	const f = open();
	expect(f.signal()).toBeUndefined();
	expect(tokensText(undefined)).toContain("tracker unavailable");
	f.change(undefined);
	expect(tokensText(f.tracker)).toContain("No model or session count yet");
	const missing = new TokensView(f.host, undefined);
	expect(text(missing)).toContain("tracker unavailable");
	f.view.dispose();
	missing.dispose();
});

test("switching away cancels counting, returning counts again, and close unsubscribes", () => {
	const f = open();
	const views = staticViews({ providers: [], nowMs: 0 });
	views.tokens = (host) => new TokensView(host, f.tracker);
	const panel = new AuthDashboard(
		{ terminal: { rows: 40 }, requestRender: () => {} },
		f.host.theme,
		f.host.keys,
		() => {},
		views,
		"tokens",
		0,
	);
	panel.render(80);
	const first = f.signal();
	panel.handleInput("\t");
	expect(first?.aborted).toBe(true);
	expect(f.unsubscribed()).toBe(1);
	panel.handleInput("\x1b[Z");
	panel.render(80);
	expect(f.signal()).not.toBe(first);
	panel.dispose();
	expect(f.signal()?.aborted).toBe(true);
	expect(f.unsubscribed()).toBe(2);
	f.view.dispose();
});

test("dashboard grows and shrinks with asynchronous token breakdowns", async () => {
	const f = open();
	const views = staticViews({ providers: [], nowMs: 0 });
	views.tokens = (host) => new TokensView(host, f.tracker);
	const panel = new AuthDashboard(
		{ terminal: { rows: 80 }, requestRender: () => {} },
		f.host.theme,
		f.host.keys,
		() => {},
		views,
		"tokens",
		0,
	);
	const counting = panel.render(80);
	expect(counting).toHaveLength(15);
	expect(counting).not.toContain("");
	f.resolve([
		{ kind: "system", count: { tokens: 200, source: "estimate" }, items: 1 },
		{ kind: "tools", count: { tokens: 100, source: "estimate" }, items: 2 },
	]);
	await Promise.resolve();
	const complete = panel.render(80);
	expect(complete).toHaveLength(17);
	expect(complete.join("\n")).toContain("system");
	f.change(undefined);
	const empty = panel.render(80);
	expect(empty).toHaveLength(7);
	expect(empty.join("\n")).toContain("No model or session count yet");
	panel.dispose();
	f.view.dispose();
});

test("count failures are visible and provider text is sanitized", async () => {
	const f = open();
	const tracker: TokenTracker = {
		...f.tracker,
		latest: () => ({ ...report, provider: "safe\x1b]0;evil\x07", model: "model\nname" }),
		breakdown: async () => {
			throw new Error("offline; retry");
		},
	};
	const view = new TokensView(f.host, tracker);
	expect(text(view)).toContain("counting…");
	await Promise.resolve();
	expect(text(view)).toContain("Counting failed: offline; retry");
	expect(text(view)).not.toContain("evil");
	for (const line of view.render(36, 100).lines) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(36);
		expect(line).not.toContain("\n");
	}
	view.dispose();
	f.view.dispose();
});

test("scroll exposes the breakdown in short terminals", () => {
	const f = open();
	f.view.render(36, 2);
	expect(f.view.handleInput("\x1b[B")).toBe(true);
	expect(f.view.render(36, 2).above).toBe(1);
	expect(f.view.handleInput("\t")).toBe(false);
	f.view.dispose();
});
