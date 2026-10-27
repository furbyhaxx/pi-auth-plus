/** Owns the plain-text quota summary printed by `/quota show` and non-TUI runs. */
import type { QuotaView } from "../engine.ts";
import { formatPercent, formatResetCountdown, type LineConfig, plainText } from "./values.ts";

/** Summarizes the supplied views in order, optionally filtering by Pi provider id. */
export function formatPlainTextSummary(
	views: readonly QuotaView[],
	config: LineConfig,
	filterId?: string,
	now = Date.now(),
): string {
	const list = filterId ? views.filter((view) => view.provider.id === filterId) : views;
	const parts: string[] = [];
	for (const view of list) {
		const meta = { title: view.provider.label };
		const snap = view.snapshot;
		if (!snap) {
			parts.push(`${meta.title}: (not fetched)`);
			continue;
		}
		if (snap.needsAuth) {
			parts.push(`${meta.title}: needs auth (${snap.error ?? "login required"})`);
			continue;
		}
		if (snap.credits) {
			parts.push(
				`${meta.title}: ${snap.credits.remaining === undefined ? "?" : snap.credits.remaining.toFixed(2)}${snap.credits.currency}${snap.credits.detailText ? ` (${snap.credits.detailText})` : ""}`,
			);
			continue;
		}
		const winSummaries = snap.windows.map((w) => {
			const pct = formatPercent(w.usedFraction, config);
			const rst = formatResetCountdown(w.resetAtMs, now);
			return `${w.shortLabel} ${pct}${rst ? ` (↻ ${rst})` : ""}`;
		});
		const rBadge = snap.resetCredits ? ` (r ${snap.resetCredits})` : "";
		parts.push(`${meta.title}: ${winSummaries.join(", ") || "no windows"}${rBadge}`);
	}
	return parts.map(plainText).join(" | ");
}
