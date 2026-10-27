/** Owns quota observation history and net drainage estimates within monotonic segments. */
import type { ProviderQuotaSnapshot } from "./types.ts";

/** A net consumption rate and the sample coverage used to calculate it. */
export interface DrainageRate {
	readonly perHour: number;
	readonly coverageSec: number;
}

/** Drainage rates and exhaustion estimates for the latest observation. */
export interface DrainageMetrics {
	readonly observedAt: number;
	readonly window?: DrainageRate | undefined;
	readonly h1?: DrainageRate | undefined;
	readonly h24?: DrainageRate | undefined;
	readonly etaSec?: number | undefined;
	readonly resetsBeforeExhaustion?: boolean | undefined;
}

interface Observation {
	readonly at: number;
	readonly value: number;
	readonly resetAtMs?: number | undefined;
}

/** Samples for one quota window or credit balance. */
export interface DrainageHistory {
	readonly kind: "window" | "credits";
	readonly id: string;
	readonly samples: readonly Observation[];
}

type MutableDrainageHistory = Omit<DrainageHistory, "samples"> & { samples: Observation[] };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/** Parses cached histories, dropping malformed or implausibly future observations. */
export function parseDrainageHistory(raw: unknown, now: number = Date.now()): DrainageHistory[] {
	if (!Array.isArray(raw)) return [];
	const result: DrainageHistory[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) continue;
		const kind = entry["kind"];
		const id = entry["id"];
		const samples = entry["samples"];
		if (
			(kind !== "window" && kind !== "credits") ||
			typeof id !== "string" ||
			!Array.isArray(samples)
		)
			continue;
		const parsed: Observation[] = [];
		for (const sample of samples) {
			if (!isRecord(sample)) continue;
			const at = sample["at"];
			const value = sample["value"];
			const resetAtMs = sample["resetAtMs"];
			if (
				!finite(at) ||
				at > now + 60_000 ||
				!finite(value) ||
				(resetAtMs !== undefined && !finite(resetAtMs))
			)
				continue;
			if (kind === "window" && (value < 0 || value > 1)) continue;
			parsed.push({ at, value, resetAtMs });
		}
		result.push({ kind, id, samples: parsed });
	}
	return result;
}

function key(entry: Pick<DrainageHistory, "kind" | "id">): string {
	return JSON.stringify([entry.kind, entry.id]);
}

/** Merges histories, retaining the latest monotonic segment and bounded recent observations. */
export function mergeDrainageHistory(
	left: readonly DrainageHistory[],
	right: readonly DrainageHistory[],
	now: number,
): DrainageHistory[] {
	const merged = new Map<string, MutableDrainageHistory>();
	for (const entry of [...left, ...right]) {
		const existing = merged.get(key(entry));
		if (existing) existing.samples.push(...entry.samples);
		else merged.set(key(entry), { ...entry, samples: [...entry.samples] });
	}
	const result: DrainageHistory[] = [];
	for (const entry of merged.values()) {
		entry.samples.sort(
			(a, b) => a.at - b.at || a.value - b.value || (a.resetAtMs ?? 0) - (b.resetAtMs ?? 0),
		);
		let segment: Observation[] = [];
		let previous: Observation | undefined;
		let resetAtMs: number | undefined;
		for (const sample of entry.samples) {
			if (previous?.at === sample.at) continue;
			const reversed =
				previous &&
				(entry.kind === "window" ? sample.value < previous.value : sample.value > previous.value);
			const resetAdvanced =
				resetAtMs !== undefined &&
				sample.resetAtMs !== undefined &&
				sample.resetAtMs - resetAtMs > 60_000;
			if (reversed || resetAdvanced) segment = [];
			resetAtMs = sample.resetAtMs ?? resetAtMs;
			segment.push(sample);
			previous = sample;
		}
		const baseline = segment[0];
		if (!baseline || !previous || previous.at < now - 7 * DAY_MS) continue;
		const recent = segment
			.slice(1)
			.filter((sample) => sample.at >= previous.at - DAY_MS)
			.slice(-1500);
		result.push({ ...entry, samples: [baseline, ...recent] });
	}
	return result.sort((a, b) => key(a).localeCompare(key(b)));
}

/** Records valid snapshot observations and merges them into existing history. */
export function recordDrainageHistory(
	history: readonly DrainageHistory[],
	snapshot: ProviderQuotaSnapshot,
	now: number,
): DrainageHistory[] {
	const incoming: DrainageHistory[] = [];
	if (!snapshot.error && !snapshot.needsAuth && finite(snapshot.fetchedAt)) {
		for (const window of snapshot.windows) {
			if (!finite(window.usedFraction) || window.usedFraction < 0 || window.usedFraction > 1)
				continue;
			incoming.push({
				kind: "window",
				id: window.id,
				samples: [
					{
						at: snapshot.fetchedAt,
						value: window.usedFraction,
						resetAtMs: finite(window.resetAtMs) ? window.resetAtMs : undefined,
					},
				],
			});
		}
		if (snapshot.credits && finite(snapshot.credits.remaining)) {
			incoming.push({
				kind: "credits",
				id: snapshot.credits.currency,
				samples: [{ at: snapshot.fetchedAt, value: snapshot.credits.remaining }],
			});
		}
	}
	const later = incoming.filter((entry) => {
		const last = history.find((existing) => key(existing) === key(entry))?.samples.at(-1);
		return !last || snapshot.fetchedAt > last.at;
	});
	return mergeDrainageHistory(history, later, now);
}

/** Calculates 1 h, 24 h, full-window rates and exhaustion estimates at `now`. */
export function getDrainageMetrics(
	entry: DrainageHistory | undefined,
	now: number = Date.now(),
): DrainageMetrics | undefined {
	const last = entry?.samples.at(-1);
	if (!entry || !last) return undefined;
	function rate(lookback: number): DrainageRate | undefined {
		if (!entry || !last) return undefined;
		const first = entry.samples.find((sample) => sample.at >= last.at - lookback);
		if (!first) return undefined;
		const coverageSec = (last.at - first.at) / 1000;
		if (coverageSec < 60) return undefined;
		const consumed = entry.kind === "window" ? last.value - first.value : first.value - last.value;
		const perHour = (consumed * 3600) / coverageSec;
		return Number.isFinite(perHour) && perHour >= 0 ? { perHour, coverageSec } : undefined;
	}
	const metrics: DrainageMetrics = {
		observedAt: last.at,
		window: rate(Number.POSITIVE_INFINITY),
		h1: rate(HOUR_MS),
		h24: rate(DAY_MS),
	};
	if (last.resetAtMs !== undefined && last.resetAtMs > last.at && last.resetAtMs <= now)
		return metrics;
	const remaining = entry.kind === "window" ? 1 - last.value : last.value;
	const perHour = metrics.window?.perHour;
	if (remaining > 0 && perHour !== undefined && perHour > 0) {
		const etaSec = (remaining / perHour) * 3600;
		if (Number.isFinite(etaSec) && etaSec > 0) {
			if (
				last.resetAtMs !== undefined &&
				last.resetAtMs > last.at &&
				last.resetAtMs - last.at < etaSec * 1000
			)
				return { ...metrics, resetsBeforeExhaustion: true };
			return { ...metrics, etaSec };
		}
	}
	return metrics;
}
