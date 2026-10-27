import { expect, test } from "bun:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { renderQuotaDiagnostics, renderQuotaTable, timestamp } from "../../src/cli/table.ts";
import type { QuotaReport } from "../../src/quotas/report.ts";

test("unknown usage and balance remain visible and never render as zero", () => {
	const report: QuotaReport = {
		v: 1,
		generatedAt: 0,
		providers: [
			{
				id: "claude",
				title: "Claude",
				short: "cc",
				state: "ok",
				credits: { currency: "$" },
				windows: [{ id: "5h", label: "Session", shortLabel: "5h" }],
			},
		],
	};
	const text = renderQuotaTable(report, { color: false });
	expect(text).toContain("claude");
	expect(text).toContain("Session");
	expect(text).toContain("credits");
	expect(text).toContain("?");
	expect(text).not.toContain("0%");
	expect(text).not.toContain("undefined");
	expect(text).not.toContain("\x1b");
});

test("renders scoped windows, boundary rounding, credits and color without changing text", () => {
	const report: QuotaReport = {
		v: 1,
		generatedAt: 0,
		providers: [
			{
				id: "openrouter",
				title: "OpenRouter",
				short: "or",
				state: "ok",
				credits: { remaining: 12.5, currency: "$" },
				windows: [
					{ id: "credits", label: "Credits", shortLabel: "c" },
					{
						id: "tiny",
						label: "Tiny",
						shortLabel: "t",
						period: "5h",
						scope: "search",
						usedFraction: 0.000001,
						usedPercent: 0.0001,
						remainingPercent: 99.9999,
					},
				],
			},
		],
	};
	const text = renderQuotaTable(report, { color: false });
	expect(text).toContain("5h (search)");
	expect(text).toContain("<0.01%");
	expect(text).toContain(">99.99%");
	expect(text).toContain("12.50$");
	expect(text.match(/credits/g)).toHaveLength(1);
	const colored = renderQuotaTable(report, { color: true });
	expect(colored).toContain("\x1b[");
	expect(stripTerminalSequences(colored)).toBe(text);
	expect(renderQuotaDiagnostics(report)).toBe("");
});

test("diagnostics sanitize provider errors and distinguish unknown from stale", () => {
	expect(
		renderQuotaDiagnostics({
			v: 1,
			generatedAt: 0,
			providers: [
				{ id: "claude", title: "", short: "", state: "unknown", windows: [] },
				{
					id: "openai",
					title: "",
					short: "",
					state: "stale",
					windows: [],
					error: "bad\nresponse",
					fetchedAt: Date.parse("2026-01-01T12:00:00Z"),
				},
			],
		}),
	).toBe(
		"claude: not fetched yet\nopenai: stale: bad response; data from 2026-01-01 13:00:00 +01:00\n",
	);
});

test("timestamps use Zurich offset in both seasons", () => {
	expect(timestamp(Date.parse("2026-01-01T12:00:00Z"))).toBe("2026-01-01 13:00:00 +01:00");
	expect(timestamp(Date.parse("2026-07-01T12:00:00Z"))).toBe("2026-07-01 14:00:00 +02:00");
});
