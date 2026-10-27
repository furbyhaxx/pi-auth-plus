import { describe, expect, test } from "bun:test";
import type { ThemeStyle } from "@earendil-works/pi-coding-agent";
import { parseColor } from "@earendil-works/pi-tui";
import { type ProviderEntry, Registry } from "../../../src/core/registry/index.ts";
import type { QuotaView } from "../../../src/quotas/engine.ts";
import { type LineTheme, renderGradientBar } from "../../../src/quotas/line/format.ts";
import {
	compileLineTemplate as compile,
	renderLineTemplate,
} from "../../../src/quotas/line/template.ts";
import type { LineConfig } from "../../../src/quotas/line/values.ts";
import type { ProviderQuotaSnapshot, QuotaWindow } from "../../../src/quotas/types.ts";

const DEFAULT_QUOTAS_CONFIG: LineConfig = {
	percentDisplay: "used",
	creditHealthyUsd: 50,
	creditCriticalUsd: 5,
};
const providers: readonly ProviderEntry[] = [
	{
		id: "codex",
		label: "OpenAI Codex",
		aliases: ["openai", "openai-codex", "chatgpt", "cx", "cox", "oai"],
		quota: { kind: "windows", shortLabel: "cox", parserVersion: 1, fetch: async () => snapshot() },
	},
	{
		id: "claude",
		label: "Claude",
		aliases: ["cl", "cc"],
		quota: { kind: "windows", shortLabel: "cl", parserVersion: 1, fetch: async () => snapshot() },
	},
	{
		id: "antigravity",
		label: "Antigravity",
		aliases: ["ag", "agy"],
		quota: { kind: "windows", shortLabel: "ag", parserVersion: 1, fetch: async () => snapshot() },
	},
	{
		id: "xai",
		label: "xAI",
		aliases: ["grok"],
		quota: { kind: "credits", shortLabel: "xai", parserVersion: 1, fetch: async () => snapshot() },
	},
];
const registry = new Registry([{ id: "test", label: "Test", providers }]);
const resolve = (token: string) => registry.resolve(token)?.provider.id;
const compileLineTemplate = (source: string) => compile(source, resolve);
const styles: { text: string; options: ThemeStyle }[] = [];
const theme: LineTheme = {
	colors: {
		accent: parseColor("#f00"),
		border: parseColor("#f00"),
		borderAccent: parseColor("#f00"),
		borderMuted: parseColor("#f00"),
		success: parseColor("#0f0"),
		error: parseColor("#f00"),
		warning: parseColor("#ff0"),
		muted: parseColor("#aaa"),
		dim: parseColor("#f00"),
		text: parseColor("#f00"),
		thinkingText: parseColor("#f00"),
		scrollbarTrack: parseColor("#f00"),
		scrollbarThumb: parseColor("#f00"),
		selectedBg: parseColor("#123"),
		searchMatchBg: parseColor("#f00"),
		searchMatchText: parseColor("#f00"),
		userMessageBg: parseColor("#f00"),
		userMessageText: parseColor("#f00"),
		customMessageBg: parseColor("#f00"),
		customMessageText: parseColor("#f00"),
		customMessageLabel: parseColor("#f00"),
		toolPendingBg: parseColor("#f00"),
		toolSuccessBg: parseColor("#f00"),
		toolErrorBg: parseColor("#f00"),
		toolTitle: parseColor("#f00"),
		toolOutput: parseColor("#f00"),
		mdHeading: parseColor("#f00"),
		mdLink: parseColor("#f00"),
		mdLinkUrl: parseColor("#f00"),
		mdCode: parseColor("#f00"),
		mdCodeBlock: parseColor("#f00"),
		mdCodeBlockBorder: parseColor("#f00"),
		mdQuote: parseColor("#f00"),
		mdQuoteBorder: parseColor("#f00"),
		mdHr: parseColor("#f00"),
		mdListBullet: parseColor("#f00"),
		toolDiffAdded: parseColor("#f00"),
		toolDiffRemoved: parseColor("#f00"),
		toolDiffContext: parseColor("#f00"),
		syntaxComment: parseColor("#f00"),
		syntaxKeyword: parseColor("#f00"),
		syntaxFunction: parseColor("#f00"),
		syntaxVariable: parseColor("#f00"),
		syntaxString: parseColor("#f00"),
		syntaxNumber: parseColor("#f00"),
		syntaxType: parseColor("#f00"),
		syntaxOperator: parseColor("#f00"),
		syntaxPunctuation: parseColor("#f00"),
		thinkingOff: parseColor("#f00"),
		thinkingMinimal: parseColor("#f00"),
		thinkingLow: parseColor("#f00"),
		thinkingMedium: parseColor("#f00"),
		thinkingHigh: parseColor("#f00"),
		thinkingXhigh: parseColor("#f00"),
		thinkingMax: parseColor("#f00"),
		bashMode: parseColor("#f00"),
	},
	fg: (_, text) => text,
	style: (text, options) => {
		styles.push({ text, options });
		return text;
	},
};
function win(period: string, scope?: string, usedFraction = 0.25): QuotaWindow {
	return {
		id: `${period}-${scope ?? "plan"}`,
		shortLabel: period,
		label: period,
		period,
		scope,
		usedFraction,
	};
}
function snapshot(windows: QuotaWindow[] = []): ProviderQuotaSnapshot {
	return { provider: "codex", fetchedAt: 0, source: "endpoint", windows };
}
function views(value: ProviderQuotaSnapshot | undefined): QuotaView[] {
	return providers.map((provider) => ({
		provider,
		snapshot: value,
		backoff: undefined,
		refreshing: false,
		fetchedAt: value?.fetchedAt,
	}));
}
function render(
	source: string,
	value: ProviderQuotaSnapshot | undefined = undefined,
	short = false,
) {
	return renderLineTemplate(
		theme,
		compileLineTemplate(source),
		views(value),
		DEFAULT_QUOTAS_CONFIG,
		0,
		short,
	);
}
describe("quota templates", () => {
	test("aliases resolve to Pi ids and resolver caches stay independent", () => {
		const value = snapshot([win("5h")]);
		expect(render("{cl:pct}/{claude:pct}/{cc:pct}", value)).toEqual(["25%/25%/25%"]);
		expect([...compileLineTemplate("{cl}{claude}{cc}{codex}").explicit]).toEqual([
			"claude",
			"codex",
		]);
		expect(compile("{codex:pct}", () => undefined).unknown).toEqual(["{codex:pct}"]);
		expect(compileLineTemplate("{google:pct}").unknown).toEqual(["{google:pct}"]);
		expect(
			renderLineTemplate(
				theme,
				compileLineTemplate("{cl:pct}{all}"),
				[],
				DEFAULT_QUOTAS_CONFIG,
				0,
				false,
			),
		).toEqual([]);
	});
	test("canonical and legacy Codex tokens render the same usage", () => {
		expect(render("{codex:pct}/{openai:pct}/{cx:pct}", snapshot([win("5h")]))).toEqual([
			"25%/25%/25%",
		]);
	});
	test("unknown usage and balance never become zero or an empty bar", () => {
		const value = snapshot([{ id: "5h", label: "Five hours", shortLabel: "5h", period: "5h" }]);
		for (const field of [
			"pct",
			"bar",
			"window-5h-used-percent",
			"window-5h-remaining-percent",
			"credits",
			"credits-remaining",
		]) {
			const output = render(`{codex:${field}}`, { ...value, credits: { currency: "$" } });
			expect(output).toEqual(["?"]);
			expect(output.join("")).not.toContain("0%");
		}
		expect(render("{codex:wins}", value)).toEqual(["5h ?"]);
		expect(render("{codex:wins}", value, true)).toEqual(["?"]);
		expect(renderGradientBar(theme, undefined)).toBe("?");
		expect(renderGradientBar(theme, 0, 3)).toBe("▕░░░▏");
		expect(render("{codex:bar}", snapshot([win("5h", undefined, 0)]))).toEqual(["▕░░░░░░▏"]);
	});
	test("antigravity's normalized scopes and legacy Argon ids keep their keys", () => {
		expect(
			render(
				"{ag:window-7d-gemini-used-percent}/{ag:window-5h-3p-used-percent}/{ag:window-7d-gemini-4-argon-used-percent}",
				snapshot([
					{ ...win("7d", "gemini", 0.2), id: "gemini-weekly" },
					{ ...win("5h", "3p", 0.4), id: "3p-5h" },
					{ ...win("7d", "gemini-4-argon", 0.6), id: "gemini-argon-wtu-weekly" },
				]),
			),
		).toEqual(["20%/40%/60%"]);
		expect(
			render(
				"{ag:window-7d-gemini-4-argon-used-percent}",
				snapshot([
					{
						id: "gemini-argon-wtu-weekly",
						shortLabel: "arg",
						label: "Argon",
						scope: "gemini-argon-wtu",
						usedFraction: 0.7,
					},
				]),
			),
		).toEqual(["70%"]);
	});
	test("deeply nested or nested malformed tokens never throw", () => {
		for (const source of [
			`${"[".repeat(65)}{cl:pct}${"]".repeat(65)}`,
			"{cl:{codex:pct}",
			"{cl:pct,}",
			"{all|bold}",
			"{sep:pct}",
			"]",
		]) {
			expect(compileLineTemplate(source).unknown.length).toBeGreaterThan(0);
		}
	});
	test("matches exact periods and scopes, never a sibling or ambiguous window", () => {
		const value = snapshot([win("7d"), win("7d", "gemini", 0.4), win("7d", "gemini-4-argon", 0.7)]);
		expect(
			render(
				"{codex:window-7d-used-percent}/{codex:window-7d-gemini-remaining-percent}/{codex:window-7d-gemini-4-argon-used-percent}",
				value,
			),
		).toEqual(["25%/60%/70%"]);
		expect(
			render("{codex:window-7d-gemini-4-argon-used-percent}", snapshot([win("7d", "gemini")])),
		).toEqual(["?"]);
		expect(render("{codex:window-7d-used-percent}", snapshot([win("7d"), win("7d")]))).toEqual([
			"?",
		]);
		const sibling = { ...win("7d", undefined, 0.9), id: "7d_oi" };
		expect(
			render("{codex:window-7d-used-percent}", snapshot([sibling, { ...win("7d"), id: "7d" }])),
		).toEqual(["25%"]);
		expect(render("{codex:window-5h-used-percent}", snapshot([win("7d")]))).toEqual(["?"]);
	});
	test("named percentages ignore the display mode and unscoped fields require plan windows", () => {
		const snapshots = views(snapshot([win("7d", "model", 0.2)]));
		expect(
			renderLineTemplate(
				theme,
				compileLineTemplate(
					"{codex:window-7d-model-used-percent}/{codex:window-7d-model-remaining-percent}/{codex:window-7d-used-percent}",
				),
				snapshots,
				{ ...DEFAULT_QUOTAS_CONFIG, percentDisplay: "remaining" },
				0,
				false,
			),
		).toEqual(["20%/80%/?"]);
	});
	test("all and short forms preserve every important window and authentication state", () => {
		const snapshots = views(snapshot([win("5h"), win("7d", undefined, 0.5)]))
			.filter((view) => view.provider.id === "codex" || view.provider.id === "claude")
			.map((view) =>
				view.provider.id === "claude"
					? { ...view, snapshot: { ...snapshot(), provider: "claude", needsAuth: true } }
					: view,
			);
		const config = DEFAULT_QUOTAS_CONFIG;
		expect(
			renderLineTemplate(theme, compileLineTemplate("{all}"), snapshots, config, 0, false),
		).toEqual(["OpenAI Codex: 5h 25% 7d 50%", "Claude: login"]);
		expect(
			renderLineTemplate(theme, compileLineTemplate("{all:short}"), snapshots, config, 0, false),
		).toEqual(["cox: 25%/50%", "cl: login"]);
	});
	test("accepts exact legacy ids only when period is absent", () => {
		expect(
			render(
				"{codex:window-5h-used-percent}",
				snapshot([{ id: "5h", shortLabel: "h", label: "hour", usedFraction: 0 }]),
			),
		).toEqual(["0%"]);
		expect(
			render(
				"{antigravity:window-7d-gemini-used-percent}",
				snapshot([
					{
						id: "gemini-weekly",
						shortLabel: "gem",
						label: "Gemini",
						scope: "gemini models",
						usedFraction: 0.2,
					},
				]),
			),
		).toEqual(["20%"]);
	});
	test("optional reset punctuation disappears, real zero usage and credits stay", () => {
		const value = {
			...snapshot([win("5h", undefined, 0)]),
			resetCredits: 0,
			credits: { remaining: 0, currency: "€" },
		};
		expect(
			render(
				"{codex:id}[ ({codex:resets-available}r)] [{codex:window-5h-used-percent}] [{codex:credits-remaining}]",
				value,
			),
		).toEqual(["codex 0% 0.00€"]);
		expect(render("x[ ({codex:resets-available}r)]", snapshot())).toEqual(["x"]);
		expect(render("{codex:resets-available}", { ...value, resetCredits: 2 })).toEqual(["2"]);
		for (const missing of [
			undefined,
			snapshot(),
			{ ...snapshot(), needsAuth: true },
			{ ...snapshot(), error: "failed" },
		]) {
			expect(render("{codex:resets-available}", missing)).toEqual([]);
			expect(render("x[ ({codex:resets-available}r)]", missing)).toEqual(["x"]);
		}
	});
	test("nested children suppress only themselves; direct missing fields suppress their group", () => {
		expect(render("[ok[ {codex:tier}]] [hide {codex:tier}[ok]]")).toEqual(["ok "]);
		expect(render(String.raw`\[\{literal\}\]\\`)).toEqual(["[{literal}]\\"]);
	});
	test("identities survive missing snapshots and preserve alias spelling", () => {
		expect(render("{grok:id}/{grok:name}/{grok:short}", undefined)).toEqual(["grok/xAI/xai"]);
		expect(render("{grok:id}", undefined, true)).toEqual(["xai"]);
		expect(render("{codex:pct}", undefined)).toEqual(["…"]);
		expect(render("{codex:pct}", { ...snapshot(), needsAuth: true })).toEqual(["login"]);
		expect(render("{codex:pct}", { ...snapshot(), error: "failed" })).toEqual(["err"]);
		expect(render("[{codex:pct}]", { ...snapshot(), needsAuth: true })).toEqual([]);
	});
	test("separators yield segments without punctuation", () => {
		expect(render("a · b{sep}c")).toEqual(["a", "b", "c"]);
		expect(compileLineTemplate("{codex:id}")).toBe(compileLineTemplate("{codex:id}"));
		expect(compileLineTemplate("[{grok:id}]").explicit.has("xai")).toBe(true);
	});
	test("malformed syntax and styles produce diagnostics without throwing", () => {
		for (const source of [
			"{wat}",
			"{codex:nope}",
			"[unclosed",
			"{codex:id",
			"}",
			"{codex:id|fg=wat}",
			"{codex:id|fg=#12}",
			"{codex:id|bold=false}",
			"{codex:id|fg=red|bold}",
			"{codex:id|}",
		])
			expect(compileLineTemplate(source).unknown.length).toBeGreaterThan(0);
	});
	test("custom styles use concrete colors and replace inner stress styles", () => {
		styles.length = 0;
		expect(
			render(
				"{codex:window-7d-used-percent|fg=#cba6f7,bg=selectedBg,bold,italic,underline,strikethrough}",
				snapshot([win("7d")]),
			),
		).toEqual(["25%"]);
		expect(styles).toEqual([
			{
				text: "25%",
				options: {
					fg: parseColor("#cba6f7"),
					bg: parseColor("#123"),
					bold: true,
					italic: true,
					underline: true,
					strikethrough: true,
				},
			},
		]);
		styles.length = 0;
		render("{codex:pct|bold}", snapshot([win("7d")]));
		expect(styles.at(-1)?.options.fg).toBeDefined();
		styles.length = 0;
		render("{codex:id|fg=muted}");
		expect(styles.at(-1)?.options.fg).toEqual(parseColor("#aaa"));
	});
});
