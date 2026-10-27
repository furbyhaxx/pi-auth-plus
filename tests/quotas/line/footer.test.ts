import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import {
	createFooterWithQuotaLine,
	type FooterContext,
	type FooterLayout,
} from "../../../src/quotas/line/footer.ts";

// Layout and theme are injected so these tests never load a host runtime.
const layout: FooterLayout = {
	visibleWidth: (text) => [...stripVTControlCharacters(text)].length,
	truncateToWidth(text, width, ellipsis = "...") {
		const plain = stripVTControlCharacters(text);
		if ([...plain].length <= width) return text;
		return (
			[...plain].slice(0, Math.max(0, width - ellipsis.length)).join("") + ellipsis.slice(0, width)
		);
	},
};
const theme = { fg: (_color: string, text: string) => text } as Theme;

function message(id: string, input: number, read = 0, write = 0): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00Z",
		message: {
			role: "assistant",
			api: "anthropic-messages",
			provider: "test",
			model: "test-model",
			content: [],
			stopReason: "stop",
			timestamp: 0,
			usage: {
				input,
				output: 100,
				cacheRead: read,
				cacheWrite: write,
				totalTokens: input + read + write + 100,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.123 },
			},
		},
	};
}

function rig(activeTheme = theme, thinking: "off" | "high" = "off") {
	let entries: SessionEntry[] = [message("a", 1000, 2000, 1000)];
	let leaf = "a";
	let percent: number | null = 75;
	let scans = 0;
	let renders = 0;
	let unsubscribed = 0;
	let branchChanged = () => {};
	const ctx: FooterContext = {
		model: undefined,
		getContextUsage: () => ({ tokens: 100, percent, contextWindow: 200_000 }),
		sessionManager: {
			getEntries() {
				scans++;
				return entries;
			},
			getLeafId: () => leaf,
			getCwd: () => `${process.env["HOME"]}/project`,
			getSessionName: () => "named",
		},
	};
	const rowsCalls: number[][] = [];
	const footer = createFooterWithQuotaLine(
		{ getThinkingLevel: () => thinking },
		ctx,
		{
			terminal: { rows: 40 },
			requestRender() {
				renders++;
			},
		},
		activeTheme,
		{
			getGitBranch: () => "dev",
			getAvailableProviderCount: () => 2,
			getExtensionStatuses: () =>
				new Map([
					["z", "last\nstatus"],
					["a", "first\x1b]0;evil\x07\tstatus"],
				]),
			onBranchChange(callback) {
				branchChanged = callback;
				return () => {
					unsubscribed++;
				};
			},
		},
		(width, _theme, terminalRows) => {
			rowsCalls.push([width, terminalRows]);
			return ["quota one", "quota two"];
		},
		layout,
	);
	return {
		footer,
		ctx,
		rowsCalls,
		change: (next: SessionEntry[], id: string) => {
			entries = next;
			leaf = id;
		},
		setPercent: (value: number | null) => {
			percent = value;
		},
		scans: () => scans,
		branchChanged: () => branchChanged(),
		renders: () => renders,
		unsubscribed: () => unsubscribed,
	};
}

test("footer preserves cwd, session, usage, cache-hit, cost, statuses and appended rows", () => {
	const r = rig();
	const lines = r.footer.render(140);
	expect(lines[0]).toBe("~/project (dev) • named");
	expect(lines[1]).toContain("↑1.0k ↓100 R2.0k W1.0k CH50.0% $0.123 75.0%/200k (auto)");
	expect(lines[1]).toContain("no-model");
	expect(lines[2]).toBe("first status last status");
	expect(lines.slice(-2)).toEqual(["quota one", "quota two"]);
	expect(r.rowsCalls).toEqual([[140, 40]]);
	r.branchChanged();
	expect(r.renders()).toBe(1);
	r.footer.dispose();
	expect(r.unsubscribed()).toBe(1);
});

test("footer rows fit the check widths and unknown context remains unknown", () => {
	const r = rig();
	for (const width of [36, 57, 80, 140]) {
		for (const line of r.footer.render(width))
			expect(layout.visibleWidth(line)).toBeLessThanOrEqual(width);
	}
	expect(r.footer.render(36)[1]).toEndWith("...");
	r.setPercent(null);
	expect(r.footer.render(140)[1]).toContain("?%/200k (auto)");
});

test("model thinking and provider are shown when they fit, and context uses stress colors", () => {
	const colors: string[] = [];
	const coloredTheme = {
		fg: (color: string, text: string) => {
			colors.push(color);
			return text;
		},
	} as Theme;
	for (const thinking of ["off", "high"] as const) {
		const r = rig(coloredTheme, thinking);
		r.ctx.model = {
			id: "test-model",
			name: "Test",
			provider: "test-provider",
			api: "anthropic-messages",
			baseUrl: "https://example.invalid",
			input: ["text"],
			reasoning: true,
			contextWindow: 200_000,
			maxTokens: 1000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		expect(r.footer.render(140)[1]).toContain(
			`(test-provider) test-model • ${thinking === "off" ? "thinking off" : thinking}`,
		);
		expect(colors).toContain("warning");
		colors.length = 0;
		r.setPercent(95);
		r.footer.render(140);
		expect(colors).toContain("error");
		colors.length = 0;
		r.setPercent(0);
		expect(r.footer.render(140)[1]).toContain("0.0%/200k");
		expect(colors).not.toContain("warning");
		expect(colors).not.toContain("error");
		r.ctx.model.reasoning = false;
		expect(r.footer.render(140)[1]).not.toContain(" • high");
		r.footer.dispose();
	}
});

test("usage totals refresh on entry count, branch leaf and explicit invalidation", () => {
	const r = rig();
	r.footer.render(140);
	const scans = r.scans();
	r.footer.render(140);
	expect(r.scans() - scans).toBe(1);
	r.change([message("a", 1000), message("b", 5000)], "b");
	expect(r.footer.render(140)[1]).toContain("↑6.0k");
	r.change([message("a", 1000), message("c", 9000)], "c");
	expect(r.footer.render(140)[1]).toContain("↑10k");
	r.change([message("a", 1000), message("c", 10000)], "c");
	r.footer.invalidate();
	expect(r.footer.render(140)[1]).toContain("↑11k");
	r.change([], "empty");
	const line = r.footer.render(140)[1];
	expect(line).not.toContain("↑");
	expect(line).not.toContain("CH");
	expect(line).not.toContain("$");
});
