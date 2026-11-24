import { describe, expect, test } from "bun:test";
import { ompUsageReport } from "../../src/quotas/omp-usage.ts";

describe("quotas/omp-usage", () => {
	test("windows keep their period, reset and used fraction; unknown stays unknown", () => {
		const report = ompUsageReport({
			provider: "antigravity",
			fetchedAt: 5,
			source: "endpoint",
			tier: "pro",
			windows: [
				{
					id: "gemini-weekly",
					shortLabel: "gem",
					label: "Gemini Models (7d)",
					usedFraction: 0.85,
					resetAtMs: 99,
					period: "7d",
				},
				{ id: "third-party", shortLabel: "3p", label: "Third party" },
			],
		});
		expect(report).toEqual({
			provider: "antigravity",
			fetchedAt: 5,
			metadata: { subscriptionPlan: "pro" },
			limits: [
				{
					id: "antigravity:gemini-weekly",
					label: "Gemini Models (7d)",
					scope: { provider: "antigravity", windowId: "gemini-weekly" },
					window: { id: "7d", label: "7d", durationMs: 604_800_000, resetsAt: 99 },
					amount: { unit: "percent", usedFraction: 0.85, remainingFraction: 0.15000000000000002 },
					status: "warning",
				},
				{
					id: "antigravity:third-party",
					label: "Third party",
					scope: { provider: "antigravity", windowId: "third-party" },
					window: { id: "third-party", label: "Third party" },
					amount: { unit: "percent" },
					status: "unknown",
				},
			],
		});
	});

	test("a spent dollar balance reads as exhausted usd credits", () => {
		const report = ompUsageReport({
			provider: "openrouter",
			fetchedAt: 1,
			source: "endpoint",
			credits: { currency: "$", remaining: 0, total: 10, used: 10, detailText: "mo $10" },
			windows: [],
		});
		expect(report?.limits).toEqual([
			{
				id: "openrouter:credits",
				label: "Credits",
				scope: { provider: "openrouter" },
				amount: { unit: "usd", used: 10, limit: 10, remaining: 0, usedFraction: 1 },
				status: "exhausted",
				notes: ["mo $10"],
			},
		]);
	});

	test("a snapshot without data gives omp nothing to cache", () => {
		expect(
			ompUsageReport({
				provider: "claude",
				fetchedAt: 1,
				source: "endpoint",
				windows: [],
				needsAuth: true,
				error: "no credential",
			}),
		).toBeNull();
	});
});
