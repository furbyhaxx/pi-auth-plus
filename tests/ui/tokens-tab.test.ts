import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	type KeybindingsConfig,
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { BreakdownPart, ContextReport } from "../../src/tokens/engine/index.ts";
import type { TokenTracker } from "../../src/tokens/tracker/types.ts";
import { AuthDashboard, staticViews } from "../../src/ui/dashboard/index.ts";
import { RowsView } from "../../src/ui/dashboard/rows.ts";
import { TokensView, tokensText } from "../../src/ui/dashboard/tokens.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

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

function open(bindings: KeybindingsConfig = {}) {
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
	const keys = new KeybindingsManager(TUI_KEYBINDINGS, bindings);
	const host: TabViewHost = {
		theme: { fg: (_token, text) => text, bg: (_token, text) => text, bold: (text) => text },
		keys,
		binding: (id) => bindingLabel(keys, id),
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
	expect(text(f.view)).toContain("200 · count API · 1 item");
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

test("empty breakdown contributions do not claim provider usage", async () => {
	const f = open();
	f.view.render(140, 100);
	f.change({ ...report, anchor: undefined });
	f.resolve([
		{ kind: "assistant", count: { tokens: 0, source: "provider" }, items: 0 },
		{ kind: "user", count: { tokens: 77, source: "provider" }, items: 1 },
	]);
	await Promise.resolve();

	const lines = text(f.view).split("\n");
	const assistant = lines.find((line) => line.includes("assistant"));
	const user = lines.find((line) => line.includes("user"));
	expect(lines.join("\n")).toContain("No provider usage yet");
	expect(assistant).toContain("none · 0 items");
	expect(assistant).not.toContain("exact (usage)");
	expect(user).toContain("77 · exact (usage) · 1 item");
	f.view.dispose();
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

test("count failures remain complete in narrow help and provider text is sanitized", async () => {
	const f = open();
	const reason = `offline; ${"retry with the provider dashboard ".repeat(3)}\ncheck the account\x1b]0;evil\x07`;
	const tracker: TokenTracker = {
		...f.tracker,
		latest: () => ({ ...report, provider: "safe\x1b]0;evil\x07", model: "model\nname" }),
		breakdown: async () => {
			throw new Error(reason);
		},
	};
	const view = new TokensView(f.host, tracker);
	expect(text(view)).toContain("counting…");
	await Promise.resolve();
	expect(text(view)).toContain("Counting failed: offline; retry with the provider dashboard");
	expect(text(view)).not.toContain("evil");
	const body = view.render(36, 1);
	for (const line of body.lines) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(36);
		expect(line).not.toContain("\n");
	}
	const feedback = body.fullFeedback?.map(stripVTControlCharacters).join("\n") ?? "";
	expect(feedback).toContain(
		`Counting failed: ${reason.replace("\x1b]0;evil\x07", "")}; reopen Tokens to retry.`,
	);
	expect(feedback).toContain(
		`offline; ${"retry with the provider dashboard ".repeat(3)}\ncheck the account; reopen Tokens to retry.`,
	);
	expect(feedback).not.toContain("evil");
	view.dispose();
	f.view.dispose();
});

test("provider help retains the complete login command when a narrow row clips it", () => {
	const f = open();
	const login = `/login ${"long-provider-name-".repeat(5)} --device`;
	const panel = new AuthDashboard(
		{ terminal: { rows: 8 }, requestRender: () => {} },
		f.host.theme,
		f.host.keys,
		() => {},
		staticViews({
			providers: [
				{
					id: "provider",
					label: "A provider with a long display name",
					status: { state: "missing" as const },
					loginHint: login,
				},
			],
			nowMs: 0,
		}),
		"providers",
		1,
	);
	const normal = panel.render(36);
	for (const line of normal) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
	expect(stripVTControlCharacters(normal.join("\n"))).not.toContain(login);
	panel.handleInput("\x1bOP");
	const visited: string[] = [];
	for (let i = 0; i < 40; i++) {
		const frame = panel.render(36);
		for (const line of frame) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
		const body = stripVTControlCharacters(frame.slice(1, -2).join(" ")).replace(/\s+/g, " ");
		if (body === visited.at(-1)) break;
		visited.push(body);
		panel.handleInput("\x1b[6~");
	}
	expect(visited.join("").replace(/\s/g, "")).toContain(login.replace(/\s/g, ""));
	panel.dispose();
	f.view.dispose();
});

test("scroll exposes the breakdown in short terminals", () => {
	const f = open();
	f.view.render(36, 2);
	expect(f.view.handleInput("\x1b[B")).toBe(true);
	expect(f.view.render(36, 2).above).toBe(1);
	expect(f.view.handleInput("\t")).toBe(false);
	const rebound = open({
		"tui.select.up": "ctrl+shift+up",
		"tui.select.down": "ctrl+shift+down",
	});
	expect(rebound.view.render(36, 2).hints).toContainEqual({
		key: "ctrl+shift+up/ctrl+shift+down",
		action: "scroll",
		priority: 2,
	});
	const rows = new RowsView(rebound.host, {
		rows: [
			{ label: "one", value: "value", tone: "muted" },
			{ label: "two", value: "value", tone: "muted" },
		],
		empty: "none",
	});
	expect(rows.render(36, 1).hints).toContainEqual({
		key: "ctrl+shift+up/ctrl+shift+down",
		action: "scroll",
		priority: 2,
	});
	rebound.view.dispose();
	f.view.dispose();
});
