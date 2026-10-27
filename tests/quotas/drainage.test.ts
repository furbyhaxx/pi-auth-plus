import { expect, test } from "bun:test";
import type { DrainageHistory } from "../../src/quotas/drainage.ts";
import {
	getDrainageMetrics,
	mergeDrainageHistory,
	parseDrainageHistory,
	recordDrainageHistory,
} from "../../src/quotas/drainage.ts";
import type { ProviderQuotaSnapshot } from "../../src/quotas/types.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 100 * DAY;

test("lookbacks use actual coverage, zero stays zero, resets suppress ETA", () => {
	const at = NOW;
	let history = recordDrainageHistory([], snapshot(at - 2 * HOUR, 0.1), at);
	history = recordDrainageHistory(history, snapshot(at - HOUR / 2, 0.2), at);
	history = recordDrainageHistory(history, snapshot(at, 0.3), at);
	const metrics = getDrainageMetrics(history[0], at);
	expect(metrics?.window?.coverageSec).toBe(7200);
	expect(metrics?.h1?.coverageSec).toBe(1800);
	expect(metrics?.h1?.perHour).toBeCloseTo(0.2);
	expect(metrics?.etaSec).toBeCloseTo(25200);
	history = recordDrainageHistory(history, snapshot(at + 60_000, 0.3, at + HOUR), at);
	expect(getDrainageMetrics(history[0], at)?.resetsBeforeExhaustion).toBe(true);
	expect(getDrainageMetrics(history[0], at)?.etaSec).toBeUndefined();
	history = recordDrainageHistory(history, snapshot(at + 120_000, 0.3, at + 2 * HOUR), at);
	expect(getDrainageMetrics(history[0], at)?.window).toBeUndefined();
	history = recordDrainageHistory(history, snapshot(at + 180_000, 0.3), at);
	expect(getDrainageMetrics(history[0], at)?.window?.perHour).toBe(0);
	expect(getDrainageMetrics(history[0], at)?.etaSec).toBeUndefined();
});

test("short spans stay unknown and forward gaps do not invent lookback coverage", () => {
	const at = NOW;
	let history = recordDrainageHistory([], snapshot(at - 48 * HOUR, 0.1), at);
	history = recordDrainageHistory(history, snapshot(at - 48 * HOUR + 59_000, 0.11), at);
	expect(getDrainageMetrics(history[0], at)?.window).toBeUndefined();
	history = recordDrainageHistory(history, snapshot(at, 0.2), at);
	const metrics = getDrainageMetrics(history[0], at);
	expect(metrics?.window?.perHour).toBeCloseTo(0.1 / 48);
	expect(metrics?.h1).toBeUndefined();
	expect(metrics?.h24).toBeUndefined();
	expect(mergeDrainageHistory(history, history, at)).toEqual(history);
	expect(parseDrainageHistory(undefined, at)).toEqual([]);
});

test("credits measure consumption separately by currency and top-ups restart", () => {
	const at = NOW;
	let history = recordDrainageHistory([], credit(at - HOUR, 10), at);
	history = recordDrainageHistory(history, credit(at, 8), at);
	expect(getDrainageMetrics(history[0], at)?.window?.perHour).toBe(2);
	expect(getDrainageMetrics(history[0], at)?.etaSec).toBe(14400);
	history = recordDrainageHistory(history, credit(at + 60_000, 12), at);
	expect(getDrainageMetrics(history[0], at)?.window).toBeUndefined();
	history = recordDrainageHistory(history, credit(at + 120_000, 20, "EUR"), at);
	expect(history).toHaveLength(2);
});

test("retains baseline, bounds recent observations, validates disk input and prunes inactive metrics", () => {
	const at = NOW;
	const history = parseDrainageHistory(
		[
			{
				kind: "window",
				id: "5h",
				samples: [
					{ at: at - 48 * HOUR, value: 0.1 },
					...Array.from({ length: 1600 }, (_, i) => ({
						at: at - (1600 - i) * 1000,
						value: 0.2,
					})),
					{ at: "bad", value: 1 },
					{ at, value: Number.NaN },
					{ at: at + 2 * HOUR, value: 0.9 },
				],
			},
			{ kind: "window", id: "5h", samples: "bad" },
			{ kind: "invalid", id: "5h", samples: [] },
		],
		at,
	);
	const retained = mergeDrainageHistory(history, [], at);
	expect(retained[0]?.samples).toHaveLength(1501);
	expect(getDrainageMetrics(retained[0], at)?.window?.coverageSec).toBe(172799);
	expect(getDrainageMetrics(retained[0], at)?.h24?.coverageSec).toBe(1499);
	expect(mergeDrainageHistory(retained, [], at + 8 * DAY)).toEqual([]);
});

test("header fallback, failures and out-of-order samples never create observations; instances merge", () => {
	const at = NOW - 2 * HOUR;
	let instanceA = recordDrainageHistory([], snapshot(at, 0.1), NOW);
	let instanceB = parseDrainageHistory(JSON.parse(JSON.stringify(instanceA)), NOW);
	instanceA = recordDrainageHistory(
		instanceA,
		{ provider: "codex", fetchedAt: at + HOUR, source: "headers", windows: [] },
		NOW,
	);
	expect(getDrainageMetrics(instanceA[0], NOW)?.window).toBeUndefined();
	instanceB = recordDrainageHistory(instanceB, snapshot(at + 2 * HOUR, 0.3), NOW);
	instanceA = mergeDrainageHistory(instanceA, instanceB, NOW);
	expect(getDrainageMetrics(instanceA[0], NOW)?.window?.perHour).toBeCloseTo(0.1);
	instanceA = recordDrainageHistory(
		instanceA,
		{ ...snapshot(at + 3 * HOUR, 0.9), error: "failed" },
		NOW,
	);
	instanceA = recordDrainageHistory(
		instanceA,
		{ ...snapshot(at + 4 * HOUR, 0.9), needsAuth: true },
		NOW,
	);
	instanceA = recordDrainageHistory(instanceA, snapshot(at + 2 * HOUR, 0.9), NOW);
	instanceA = recordDrainageHistory(instanceA, snapshot(at + HOUR, 0.8), NOW);
	instanceB = mergeDrainageHistory(instanceB, instanceA, NOW);
	expect(getDrainageMetrics(instanceB[0], NOW)?.window?.coverageSec).toBe(7200);
	expect(getDrainageMetrics(instanceB[0], NOW)?.window?.perHour).toBeCloseTo(0.1);
	instanceB = recordDrainageHistory(instanceB, credit(at, 10), NOW);
	instanceA = recordDrainageHistory(instanceA, credit(at + HOUR, 9), NOW);
	instanceA = mergeDrainageHistory(instanceA, instanceB, NOW);
	expect(
		getDrainageMetrics(
			instanceA.find((entry) => entry.kind === "credits"),
			NOW,
		)?.window?.perHour,
	).toBe(1);
});

test("cached lookbacks survive later reads and omitted reset fields stay absent", () => {
	const at = NOW;
	let history = recordDrainageHistory([], snapshot(at - 48 * HOUR, 0.1), at);
	history = recordDrainageHistory(history, snapshot(at - 2 * HOUR, 0.2, at + HOUR), at);
	history = recordDrainageHistory(history, snapshot(at - HOUR, 0.3), at);
	const reread = mergeDrainageHistory(history, [], at + 23 * HOUR);
	expect(getDrainageMetrics(reread[0], at + 23 * HOUR)?.h24?.coverageSec).toBe(3600);
	expect(reread[0]?.samples.at(-1)?.resetAtMs).toBeUndefined();
	expect(getDrainageMetrics(reread[0], at + 23 * HOUR)?.resetsBeforeExhaustion).toBeUndefined();
	const expiredReset = history[0];
	if (expiredReset && expiredReset.samples.length > 0) {
		const entry: DrainageHistory = {
			...expiredReset,
			samples: expiredReset.samples.map((sample, index) =>
				index === expiredReset.samples.length - 1 ? { ...sample, resetAtMs: at + HOUR } : sample,
			),
		};
		expect(getDrainageMetrics(entry, at + 23 * HOUR)?.etaSec).toBeUndefined();
		expect(getDrainageMetrics(entry, at + 23 * HOUR)?.resetsBeforeExhaustion).toBeUndefined();
	}
});

test("a window with undefined usedFraction records no sample", () => {
	const at = NOW;
	let history = recordDrainageHistory([], snapshot(at, 0.1), at);
	history = recordDrainageHistory(
		history,
		{
			provider: "codex",
			fetchedAt: at + HOUR,
			source: "endpoint",
			windows: [{ id: "5h", shortLabel: "5h", label: "Five hours", usedFraction: undefined }],
		},
		at,
	);
	expect(history[0]?.samples).toHaveLength(1);
	expect(history[0]?.samples[0]?.value).toBe(0.1);
});

function snapshot(at: number, used: number, resetAtMs?: number): ProviderQuotaSnapshot {
	return {
		provider: "codex",
		fetchedAt: at,
		source: "endpoint",
		windows: [
			{
				id: "5h",
				shortLabel: "5h",
				label: "Five hours",
				usedFraction: used,
				...(resetAtMs === undefined ? {} : { resetAtMs }),
			},
		],
	};
}

function credit(at: number, remaining: number, currency = "$"): ProviderQuotaSnapshot {
	return {
		provider: "openrouter",
		fetchedAt: at,
		source: "endpoint",
		windows: [],
		credits: { remaining, currency },
	};
}

test("actual hourly samples persist, and a drop starts unknown", () => {
	const at = NOW - HOUR;
	let history = recordDrainageHistory([], snapshot(at, 0.1), NOW);
	expect(getDrainageMetrics(history[0], NOW)?.window).toBeUndefined();
	history = recordDrainageHistory(history, snapshot(at + HOUR, 0.2), NOW);
	const reopened = parseDrainageHistory(JSON.parse(JSON.stringify(history)), NOW);
	expect(getDrainageMetrics(reopened[0], NOW)?.window).toEqual({
		perHour: 0.1,
		coverageSec: 3600,
	});
	history = recordDrainageHistory(reopened, snapshot(at + HOUR + 60_000, 0.01), NOW);
	expect(getDrainageMetrics(history[0], NOW)?.window).toBeUndefined();
});
