import { describe, expect, test } from "bun:test";
import type { ProviderEntry } from "../../../src/core/registry/index.ts";
import type { QuotaView } from "../../../src/quotas/engine.ts";
import { formatPlainTextSummary } from "../../../src/quotas/line/summary.ts";
import {
	clamp01,
	creditStress,
	formatPercent,
	formatResetCountdown,
	type LineConfig,
	plainText,
} from "../../../src/quotas/line/values.ts";
import type { ProviderQuotaSnapshot } from "../../../src/quotas/types.ts";

const config: LineConfig = { percentDisplay: "used", creditHealthyUsd: 50, creditCriticalUsd: 5 };
const provider: ProviderEntry = { id: "claude", label: "Claude", aliases: ["cl"] };
function view(snapshot: ProviderQuotaSnapshot | undefined): QuotaView {
	return {
		provider,
		snapshot,
		backoff: undefined,
		refreshing: false,
		fetchedAt: snapshot?.fetchedAt,
	};
}
const snapshot: ProviderQuotaSnapshot = {
	provider: "claude",
	fetchedAt: 0,
	source: "endpoint",
	windows: [],
};

describe("quota values", () => {
	test("formats known, clamped and unknown percentages in both display modes", () => {
		expect([clamp01(-1), clamp01(2), clamp01(Number.NaN)]).toEqual([0, 1, 0]);
		expect(formatPercent(undefined, config)).toBe("?");
		expect(formatPercent(0, config)).toBe("0%");
		expect(formatPercent(1.1, config)).toBe("100%");
		expect(formatPercent(0, { ...config, percentDisplay: "remaining" })).toBe("100%");
		expect(formatPercent(undefined, { ...config, percentDisplay: "remaining" })).toBe("?");
	});
	test("credit stress preserves the original threshold curve", () => {
		expect(creditStress(50, config)).toBe(0);
		expect(creditStress(5, config)).toBeCloseTo(0.8);
		expect(creditStress(0, config)).toBe(1);
		expect(creditStress(-1, config)).toBe(1);
		expect(creditStress(27.5, config)).toBeCloseTo(0.4);
	});
	test("countdowns use an injected clock and retain the original units", () => {
		const now = 100_000;
		expect(formatResetCountdown(undefined, now)).toBe("");
		expect(formatResetCountdown(Number.NaN, now)).toBe("");
		expect(formatResetCountdown(now - 1, now)).toBe("now");
		expect(formatResetCountdown(now + 59_000, now)).toBe("0m");
		expect(formatResetCountdown(now + 125_000, now)).toBe("2m");
		expect(formatResetCountdown(now + 3_725_000, now)).toBe("1h 2m");
		expect(formatResetCountdown(now + 90_000_000, now)).toBe("1d 1h");
	});
	test("provider strings cannot carry terminal sequences or controls", () => {
		expect(plainText("a\u001b_Gf=100;payload\u001b\\b")).toBe("ab");
		expect(plainText("a\u001b_marker\u0007b")).toBe("ab");
		expect(plainText("\u001b[31mred\u001b[0m\nnext\t\u007f\u009f")).toBe("red next   ");
		expect(plainText("\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007")).toBe("link");
	});
});

describe("plain quota summary", () => {
	test("uses view order, Pi ids for filters, labels, and honest unknown values", () => {
		const unknown = {
			...snapshot,
			windows: [
				{ id: "5h", label: "Five hours", shortLabel: "5h" },
				{ id: "7d", label: "Week", shortLabel: "7d", usedFraction: 0, resetAtMs: 3_700_000 },
			],
			resetCredits: 2,
		};
		expect(formatPlainTextSummary([view(unknown)], config, undefined, 100_000)).toBe(
			"Claude: 5h ?, 7d 0% (↻ 1h 0m) (r 2)",
		);
		expect(
			formatPlainTextSummary([view({ ...snapshot, credits: { currency: "$" } })], config),
		).toBe("Claude: ?$");
		expect(
			formatPlainTextSummary(
				[view({ ...snapshot, credits: { currency: "€", remaining: 0, detailText: "prepaid" } })],
				config,
			),
		).toBe("Claude: 0.00€ (prepaid)");
		expect(formatPlainTextSummary([view(snapshot)], config, "codex")).toBe("");
		expect(formatPlainTextSummary([view(snapshot)], config, "claude")).toBe("Claude: no windows");
		expect(
			formatPlainTextSummary(
				[
					view(undefined),
					{ ...view(snapshot), provider: { id: "codex", label: "OpenAI", aliases: [] } },
				],
				config,
			),
		).toBe("Claude: (not fetched) | OpenAI: no windows");
	});
	test("needs-auth and provider text remain readable and sanitized", () => {
		expect(formatPlainTextSummary([view({ ...snapshot, needsAuth: true })], config)).toBe(
			"Claude: needs auth (login required)",
		);
		expect(
			formatPlainTextSummary(
				[view({ ...snapshot, needsAuth: true, error: "\u001b[31mLogin\u001b[0m\nrequired" })],
				config,
			),
		).toBe("Claude: needs auth (Login required)");
	});
});
