/** Owns pure quota value formatting and stress math shared by the line, panel and CLI. */
import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** Settings needed by quota-line formatting. */
export interface LineConfig {
	percentDisplay: "used" | "remaining";
	creditHealthyUsd: number;
	creditCriticalUsd: number;
}

/** Clamps a known fraction for display; non-finite inputs retain the upstream zero fallback. */
export function clamp01(v: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.min(1, Math.max(0, v));
}

/** Converts a known remaining balance to stress using configured healthy and critical thresholds. */
export function creditStress(remaining: number, config: LineConfig): number {
	const healthy = Math.max(1, config.creditHealthyUsd);
	const crit = Math.max(0, Math.min(healthy - 0.01, config.creditCriticalUsd));
	if (remaining <= crit) {
		return remaining <= 0 ? 1 : 0.8 + 0.2 * (1 - remaining / Math.max(0.01, crit));
	}
	if (remaining >= healthy) return 0;
	return clamp01(((healthy - remaining) / (healthy - crit)) * 0.8);
}

/** Formats usage in the configured direction, preserving unknown usage. */
export function formatPercent(usedFraction: number | undefined, config: LineConfig): string {
	if (usedFraction === undefined) return "?";
	const u = clamp01(usedFraction);
	const pct =
		config.percentDisplay === "remaining" ? Math.round((1 - u) * 100) : Math.round(u * 100);
	return `${pct}%`;
}

/** Formats a reset time relative to the supplied clock. */
export function formatResetCountdown(resetAtMs: number | undefined, now = Date.now()): string {
	if (!resetAtMs || !Number.isFinite(resetAtMs)) return "";
	const diffSec = Math.max(0, Math.floor((resetAtMs - now) / 1000));
	if (diffSec <= 0) return "now";
	const days = Math.floor(diffSec / 86400);
	const hours = Math.floor((diffSec % 86400) / 3600);
	const mins = Math.floor((diffSec % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${mins}m`;
	return `${mins}m`;
}

/** Strips terminal sequences and C0/C1 controls from provider-supplied text before display. */
export function plainText(text: string): string {
	let result = "";
	for (const char of stripTerminalSequences(text)) {
		const code = char.codePointAt(0) ?? 0;
		result += code < 32 || (code >= 127 && code <= 159) ? " " : char;
	}
	return result;
}
