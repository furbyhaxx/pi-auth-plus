/** Projects our quota snapshots onto oh-my-pi's usage report, for its status line and `/usage`. */
import type {
	OmpUsageLimit,
	OmpUsageReport,
	OmpUsageStatus,
	OmpUsageWindow,
} from "../core/host/omp.ts";
import type { QuotaEngine } from "./engine.ts";
import type { ProviderQuotaSnapshot, QuotaWindow } from "./types.ts";

const PERIOD_RE = /^(\d+)(h|d|w)$/;
const UNIT_MS: Readonly<Record<string, number>> = { h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function durationMs(period: string | undefined): number | undefined {
	const match = period ? PERIOD_RE.exec(period) : null;
	if (!match) return undefined;
	const [, count, unit] = match;
	const size = unit ? UNIT_MS[unit] : undefined;
	return size === undefined ? undefined : Number(count) * size;
}

function status(usedFraction: number | undefined): OmpUsageStatus {
	if (usedFraction === undefined) return "unknown";
	if (usedFraction >= 1) return "exhausted";
	return usedFraction >= 0.8 ? "warning" : "ok";
}

function windowLimit(provider: string, window: QuotaWindow): OmpUsageLimit {
	const duration = durationMs(window.period);
	const span: OmpUsageWindow = {
		id: window.period ?? window.id,
		label: window.period ?? window.label,
		...(duration === undefined ? {} : { durationMs: duration }),
		...(window.resetAtMs === undefined ? {} : { resetsAt: window.resetAtMs }),
	};
	const used = window.usedFraction;
	return {
		id: `${provider}:${window.id}`,
		label: window.label,
		scope: { provider, windowId: window.id },
		window: span,
		amount:
			used === undefined
				? { unit: "percent" }
				: { unit: "percent", usedFraction: used, remainingFraction: 1 - used },
		status: status(used),
		...(window.valueText ? { notes: [window.valueText] } : {}),
	};
}

function creditLimit(snapshot: ProviderQuotaSnapshot): OmpUsageLimit | undefined {
	const credits = snapshot.credits;
	if (!credits) return undefined;
	const { remaining, total, used } = credits;
	const usedFraction =
		total !== undefined && total > 0 && remaining !== undefined
			? Math.min(1, Math.max(0, 1 - remaining / total))
			: undefined;
	return {
		id: `${snapshot.provider}:credits`,
		label: "Credits",
		scope: { provider: snapshot.provider },
		amount: {
			unit: credits.currency === "$" ? "usd" : "credits",
			...(used === undefined ? {} : { used }),
			...(total === undefined ? {} : { limit: total }),
			...(remaining === undefined ? {} : { remaining }),
			...(usedFraction === undefined ? {} : { usedFraction }),
		},
		status: remaining !== undefined && remaining <= 0 ? "exhausted" : status(usedFraction),
		...(credits.detailText ? { notes: [credits.detailText] } : {}),
	};
}

/**
 * omp's report for one snapshot. Null when the snapshot carries no data: omp then keeps its last
 * good report, and a missing login stays omp's to show.
 */
export function ompUsageReport(snapshot: ProviderQuotaSnapshot): OmpUsageReport | null {
	const credits = creditLimit(snapshot);
	const limits = [
		...(credits ? [credits] : []),
		...snapshot.windows.map((window) => windowLimit(snapshot.provider, window)),
	];
	if (limits.length === 0) return null;
	return {
		provider: snapshot.provider,
		fetchedAt: snapshot.fetchedAt,
		limits,
		...(snapshot.error ? { notes: [snapshot.error] } : {}),
		...(snapshot.tier ? { metadata: { subscriptionPlan: snapshot.tier } } : {}),
	};
}

/** Serves omp's usage calls from the engine's shared cache, refreshing only when it is stale. */
export function engineUsageReport(
	engine: QuotaEngine,
	enabled: () => boolean,
): (providerId: string) => Promise<OmpUsageReport | null> {
	return async (providerId) => {
		if (!enabled()) return null;
		await engine.refresh(providerId);
		const snapshot = engine.view().find((view) => view.provider.id === providerId)?.snapshot;
		return snapshot ? ompUsageReport(snapshot) : null;
	};
}
