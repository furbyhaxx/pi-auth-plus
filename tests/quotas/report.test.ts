import { describe, expect, test } from "bun:test";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { SettingsStore } from "../../src/core/config/index.ts";
import type { ProviderEntry } from "../../src/core/registry/index.ts";
import type { QuotaView } from "../../src/quotas/engine.ts";
import { buildQuotaReport, type ReportState } from "../../src/quotas/report.ts";
import type { ProviderQuotaSnapshot } from "../../src/quotas/types.ts";

const now = 1_000_000;
const settings = new SettingsStore(SETTINGS, { user: "/unused/settings.json" });
const provider: ProviderEntry = {
	id: "claude",
	label: "Claude",
	aliases: ["cc"],
	quota: { kind: "windows", shortLabel: "cl", parserVersion: 1, fetch: async () => snapshot },
};
const snapshot: ProviderQuotaSnapshot = {
	provider: "claude",
	fetchedAt: now - 10_000,
	source: "headers",
	tier: "Pro",
	windows: [
		{ id: "unknown", label: "Unknown", shortLabel: "?" },
		{ id: "5h", label: "Five hours", shortLabel: "5h", usedFraction: 0, resetAtMs: now + 5000 },
	],
	credits: { currency: "$", total: 100 },
};
function view(snap: ProviderQuotaSnapshot | undefined = snapshot): QuotaView {
	return {
		provider,
		snapshot: snap,
		backoff: undefined,
		refreshing: false,
		fetchedAt: now - 10_000,
	};
}

describe("quota report", () => {
	test("preserves unknown usage and balances, zero, identity and timing", () => {
		const report = buildQuotaReport([view()], settings, now);
		expect(report.v).toBe(1);
		expect(report.generatedAt).toBe(now);
		const row = report.providers[0];
		expect(row).toMatchObject({
			id: "claude",
			title: "Claude",
			short: "cl",
			state: "ok",
			ageSec: 10,
			fetchedAt: now - 10_000,
			source: "headers",
			tier: "Pro",
		});
		expect(row?.windows[0]?.usedFraction).toBeUndefined();
		expect(row?.windows[0]?.usedPercent).toBeUndefined();
		expect(row?.windows[0]?.remainingPercent).toBeUndefined();
		expect(row?.windows[1]).toMatchObject({
			usedFraction: 0,
			usedPercent: 0,
			remainingPercent: 100,
			resetInSec: 5,
		});
		expect(row?.credits?.remaining).toBeUndefined();
		expect(JSON.stringify(report)).not.toContain("NaN");
	});

	test("staleness waits for the provider's polling floor", () => {
		const floored: QuotaView = {
			...view({ ...snapshot, fetchedAt: now - 300_000 }),
			provider: {
				...provider,
				quota: {
					kind: "windows",
					shortLabel: "cl",
					parserVersion: 1,
					fetch: async () => snapshot,
					minPollMs: 300_000,
				},
			},
		};
		const old: QuotaView = { ...floored, snapshot: { ...snapshot, fetchedAt: now - 600_001 } };
		expect(buildQuotaReport([floored, old], settings, now).providers.map((p) => p.state)).toEqual([
			"ok",
			"stale",
		]);
	});

	test("distinguishes unknown, stale, error, auth and active rate limits", () => {
		const cases: [QuotaView, ReportState][] = [
			[{ ...view(), snapshot: undefined }, "unknown"],
			[view({ ...snapshot, fetchedAt: now - 120_001 }), "stale"],
			[view({ ...snapshot, error: "Fetch failed" }), "error"],
			[view({ ...snapshot, error: "Login required", needsAuth: true }), "needs-auth"],
			[
				{ ...view(), backoff: { until: now + 1000, status: 429, error: "Retry later" } },
				"rate-limited",
			],
			[{ ...view(), snapshot: undefined, backoff: { until: now + 1000, status: 500 } }, "error"],
			[{ ...view(), backoff: { until: now, status: 403 } }, "ok"],
		];
		for (const [input, state] of cases)
			expect(buildQuotaReport([input], settings, now).providers[0]?.state).toBe(state);
	});

	test("attaches optional window and credit drainage by Pi id", () => {
		const metrics = { observedAt: now, window: { perHour: 0.1, coverageSec: 3600 } };
		const seen: string[] = [];
		const report = buildQuotaReport([view()], settings, now, {
			getWindowDrainage: (id, key) => {
				seen.push(`${id}:${key}`);
				return metrics;
			},
			getCreditDrainage: (id, key) => {
				seen.push(`${id}:${key}`);
				return metrics;
			},
		});
		expect(report.providers[0]?.windows[1]?.drainage).toEqual(metrics);
		expect(report.providers[0]?.credits?.drainage).toEqual(metrics);
		expect(seen).toEqual(["claude:$", "claude:unknown", "claude:5h"]);
	});
});
