/** Validates the quota cache's endpoint, header and drainage state at the read boundary. */
import { type DrainageHistory, parseDrainageHistory } from "./drainage.ts";
import type { CreditBalance, ProviderQuotaSnapshot, QuotaWindow } from "./types.ts";

export interface QuotaState {
	readonly snapshot?: ProviderQuotaSnapshot | undefined;
	readonly headers?:
		| { readonly snapshot: ProviderQuotaSnapshot; readonly observedAt: number }
		| undefined;
	readonly drainage: DrainageHistory[];
}

function record(raw: unknown): raw is Record<string, unknown> {
	return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function text(raw: unknown): string | undefined {
	return typeof raw === "string" ? raw : undefined;
}

function number(raw: unknown): number | undefined {
	return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function boolean(raw: unknown): boolean | undefined {
	return typeof raw === "boolean" ? raw : undefined;
}

function window(raw: unknown): QuotaWindow | undefined {
	if (!record(raw)) return undefined;
	const { id, shortLabel, label } = raw;
	if (typeof id !== "string" || typeof shortLabel !== "string" || typeof label !== "string")
		return undefined;
	const used = number(raw["usedFraction"]);
	return {
		id,
		shortLabel,
		label,
		usedFraction: used !== undefined && used >= 0 && used <= 1 ? used : undefined,
		valueText: text(raw["valueText"]),
		resetAtMs: number(raw["resetAtMs"]),
		important: boolean(raw["important"]),
		group: text(raw["group"]),
		period: text(raw["period"]),
		scope: text(raw["scope"]),
	};
}

function credits(raw: unknown): CreditBalance | undefined {
	if (!record(raw) || typeof raw["currency"] !== "string") return undefined;
	return {
		currency: raw["currency"],
		remaining: number(raw["remaining"]),
		total: number(raw["total"]),
		used: number(raw["used"]),
		detailText: text(raw["detailText"]),
	};
}

function snapshot(
	raw: unknown,
	source: ProviderQuotaSnapshot["source"],
): ProviderQuotaSnapshot | undefined {
	if (!record(raw)) return undefined;
	const provider = raw["provider"];
	const at = number(raw["fetchedAt"]);
	if (typeof provider !== "string" || at === undefined || raw["source"] !== source)
		return undefined;
	return {
		provider,
		fetchedAt: at,
		source,
		tier: text(raw["tier"]),
		credits: credits(raw["credits"]),
		windows: Array.isArray(raw["windows"])
			? raw["windows"].flatMap((entry) => {
					const parsed = window(entry);
					return parsed ? [parsed] : [];
				})
			: [],
		resetCredits: number(raw["resetCredits"]),
		error: text(raw["error"]),
		needsAuth: boolean(raw["needsAuth"]),
	};
}

/** Drops malformed fields while retaining valid unknown-valued windows and balances. */
export function parseQuotaState(raw: unknown, now: number = Date.now()): QuotaState {
	if (!record(raw)) return { drainage: [] };
	const headers = raw["headers"];
	const headerSnapshot = record(headers) ? snapshot(headers["snapshot"], "headers") : undefined;
	const observedAt = record(headers) ? number(headers["observedAt"]) : undefined;
	return {
		snapshot: snapshot(raw["snapshot"], "endpoint"),
		headers:
			headerSnapshot && observedAt !== undefined
				? { snapshot: headerSnapshot, observedAt }
				: undefined,
		drainage: parseDrainageHistory(raw["drainage"], now),
	};
}
