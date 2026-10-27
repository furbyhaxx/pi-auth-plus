/** Owns the shared, credential-free quota report and its derived timing and usage fields. */
import type { AppSettings } from "../core/config/catalog.ts";
import { redactText } from "../core/redact/index.ts";
import { type DrainageMetrics, getDrainageMetrics } from "./drainage.ts";
import type { QuotaEngine, QuotaView } from "./engine.ts";
import type { CreditBalance, QuotaWindow } from "./types.ts";

/** Display state, including active endpoint backoff. */
export type ReportState = "ok" | "stale" | "error" | "needs-auth" | "rate-limited" | "unknown";

/** A normalized window with optional derived percentages and drainage. */
export interface ReportWindow extends QuotaWindow {
	readonly usedPercent?: number | undefined;
	readonly remainingPercent?: number | undefined;
	readonly resetAt?: number | undefined;
	readonly resetInSec?: number | undefined;
	readonly drainage?: DrainageMetrics | undefined;
}

/** A normalized balance with optional drainage. */
export interface ReportCredits extends CreditBalance {
	readonly drainage?: DrainageMetrics | undefined;
}

/** One Pi provider's public quota state; no credential or account identifiers. */
export interface ReportProvider {
	readonly id: string;
	readonly title: string;
	readonly short: string;
	readonly state: ReportState;
	readonly windows: readonly ReportWindow[];
	readonly resets?: { available: number } | undefined;
	readonly credits?: ReportCredits | undefined;
	readonly tier?: string | undefined;
	readonly needsAuth?: boolean | undefined;
	readonly fetchedAt?: number | undefined;
	readonly ageSec?: number | undefined;
	readonly source?: "endpoint" | "headers" | undefined;
	readonly error?: string | undefined;
}

/** Versioned public report shared by the bus and read-only surfaces. */
export interface QuotaReport {
	readonly v: 1;
	readonly generatedAt: number;
	readonly providers: readonly ReportProvider[];
}

/** Optional metrics lookup, keyed by Pi provider id and normalized window or currency. */
export interface ReportDrainageSource {
	getWindowDrainage(provider: string, windowId: string): DrainageMetrics | undefined;
	getCreditDrainage(provider: string, currency: string): DrainageMetrics | undefined;
}

/** Projects engine views without inventing missing usage or balance values. */
export function buildQuotaReport(
	views: readonly QuotaView[],
	settings: AppSettings,
	now: number,
	drainage?: ReportDrainageSource,
): QuotaReport {
	const intervalMs = Math.max(1000, settings.get("quotas.refreshIntervalSec") * 1000);
	const providers = views.map((view): ReportProvider => {
		const { provider, snapshot, backoff } = view;
		// A provider's polling floor delays refreshes, so data within it is still current.
		const staleAfterMs = Math.max(intervalMs, provider.quota?.minPollMs ?? 0) * 2;
		const limited = backoff && backoff.until > now && [403, 429].includes(backoff.status ?? 0);
		const state: ReportState = snapshot?.needsAuth
			? "needs-auth"
			: limited
				? "rate-limited"
				: snapshot?.error || (backoff && backoff.until > now)
					? "error"
					: !snapshot
						? "unknown"
						: now - snapshot.fetchedAt > staleAfterMs
							? "stale"
							: "ok";
		const error = snapshot?.error ?? (backoff && backoff.until > now ? backoff.error : undefined);
		return {
			id: provider.id,
			title: provider.label,
			short: provider.quota?.shortLabel ?? provider.id,
			state,
			tier: snapshot?.tier,
			needsAuth: snapshot?.needsAuth,
			credits: snapshot?.credits
				? {
						...snapshot.credits,
						drainage: drainage?.getCreditDrainage(provider.id, snapshot.credits.currency),
					}
				: undefined,
			windows:
				snapshot?.windows.map((window) => ({
					...window,
					usedPercent: window.usedFraction === undefined ? undefined : window.usedFraction * 100,
					remainingPercent:
						window.usedFraction === undefined ? undefined : (1 - window.usedFraction) * 100,
					resetAt: window.resetAtMs,
					resetInSec:
						window.resetAtMs === undefined
							? undefined
							: Math.max(0, (window.resetAtMs - now) / 1000),
					drainage: drainage?.getWindowDrainage(provider.id, window.id),
				})) ?? [],
			resets:
				typeof snapshot?.resetCredits === "number"
					? { available: snapshot.resetCredits }
					: undefined,
			fetchedAt: snapshot?.fetchedAt,
			ageSec: snapshot ? Math.max(0, Math.round((now - snapshot.fetchedAt) / 1000)) : undefined,
			source: snapshot?.source,
			error: error === undefined ? undefined : redactText(error),
		};
	});
	return { v: 1, generatedAt: now, providers };
}

/** The report for the engine's enabled providers, or only `ids`, with drainage from its cache. */
export function engineReport(
	engine: QuotaEngine,
	settings: AppSettings,
	now: number,
	ids?: readonly string[],
): QuotaReport {
	const metrics = (id: string, kind: "window" | "credits", key: string) =>
		getDrainageMetrics(
			engine.cache.get(id)?.value.drainage.find((entry) => entry.kind === kind && entry.id === key),
			now,
		);
	return buildQuotaReport(
		engine.view().filter((view) => ids === undefined || ids.includes(view.provider.id)),
		settings,
		now,
		{
			getWindowDrainage: (id, key) => metrics(id, "window", key),
			getCreditDrainage: (id, key) => metrics(id, "credits", key),
		},
	);
}
