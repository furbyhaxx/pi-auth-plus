/** Owns Synthetic quota fetching and normalization. */
import { ProviderHttpError, request } from "../../core/http/index.ts";
import type {
	ProviderQuotaSnapshot,
	QuotaFetchContext,
	QuotaSource,
	QuotaWindow,
} from "../../quotas/types.ts";
import { PROVIDER } from "./catalog.ts";

const QUOTAS_URL = "https://api.synthetic.new/v2/quotas";
const RECOVERY = "check the Synthetic API key or /login synthetic";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestampMs(raw: unknown): number | undefined {
	if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
		return raw > 1e12 ? raw : raw * 1000;
	}
	if (typeof raw !== "string" || !raw.trim()) return undefined;
	const value = raw.trim();
	const numeric = Number(value);
	if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function requestWindow(
	meter: Record<string, unknown> | undefined,
	metadata: Pick<QuotaWindow, "id" | "shortLabel" | "label" | "period" | "scope" | "important">,
): QuotaWindow | undefined {
	if (!meter) return undefined;
	const limit = finiteNumber(meter["limit"]);
	const requests = finiteNumber(meter["requests"]);
	const resetAtMs = timestampMs(meter["renewsAt"]);
	if (limit === undefined || limit <= 0 || requests === undefined)
		return { ...metadata, resetAtMs };
	return {
		...metadata,
		usedFraction: clamp01(requests / limit),
		valueText: `${requests}/${limit} used`,
		resetAtMs,
	};
}

/** Parses the endpoint payload without carrying account metadata into snapshots. */
export function parseSyntheticQuota(
	payload: unknown,
	now: number,
	status = 200,
): ProviderQuotaSnapshot {
	const body = record(payload);
	const subscription = record(body?.["subscription"]);
	const weekly = record(body?.["planWeeklyLimit"]);
	const hourly = record(record(body?.["search"])?.["hourly"]);
	if (!subscription && !weekly && !hourly) {
		throw new Error(
			`Synthetic quotas (GET ${QUOTAS_URL}) returned HTTP ${status} with an unrecognized quota payload: missing subscription, planWeeklyLimit and search.hourly objects; ${RECOVERY}`,
		);
	}
	const windows: QuotaWindow[] = [];
	const subscriptionWindow = requestWindow(subscription, {
		id: "subscription",
		shortLabel: "sub",
		label: "Subscription requests",
		period: undefined,
		important: true,
	});
	if (subscriptionWindow) windows.push(subscriptionWindow);
	const percentRemaining = finiteNumber(weekly?.["percentRemaining"]);
	if (weekly) {
		windows.push({
			id: "7d",
			shortLabel: "7d",
			label: "7d plan budget",
			period: "7d",
			...(percentRemaining === undefined
				? {}
				: {
						usedFraction: clamp01(1 - percentRemaining / 100),
						valueText: `${Number(percentRemaining.toFixed(2))}% left`,
					}),
			resetAtMs: timestampMs(weekly["nextRegenAt"]),
			important: true,
		});
	}
	const searchWindow = requestWindow(hourly, {
		id: "search-1h",
		shortLabel: "srch",
		label: "1h search requests",
		period: "1h",
		scope: "search",
		important: false,
	});
	if (searchWindow) windows.push(searchWindow);
	return { provider: PROVIDER, fetchedAt: now, source: "endpoint", windows };
}

async function fetchSyntheticQuota(ctx: QuotaFetchContext): Promise<ProviderQuotaSnapshot> {
	const auth = await ctx.auth();
	const now = ctx.now();
	if (!auth) {
		return {
			provider: PROVIDER,
			fetchedAt: now,
			source: "endpoint",
			windows: [],
			needsAuth: true,
			error: `Synthetic quotas: credentials missing; ${RECOVERY}`,
		};
	}
	let response: Response;
	try {
		response = await request(QUOTAS_URL, {
			provider: PROVIDER,
			method: "GET",
			headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
			fetch: ctx.fetch,
			signal: ctx.signal,
			timeoutMs: 10_000,
			now: ctx.now,
			secrets: [auth.token],
		});
	} catch (error) {
		if (error instanceof ProviderHttpError) {
			throw new ProviderHttpError(PROVIDER, error.status, error.url, RECOVERY, error.retryAfterMs);
		}
		throw error;
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new Error(
			`Synthetic quotas (GET ${QUOTAS_URL}) returned HTTP ${response.status} with invalid quota JSON; ${RECOVERY}`,
		);
	}
	return parseSyntheticQuota(payload, now, response.status);
}

/** Synthetic's endpoint-backed windows, with stable line-template labels. */
export const syntheticQuota: QuotaSource = {
	kind: "windows",
	shortLabel: "syn",
	parserVersion: 1,
	fetch: fetchSyntheticQuota,
};
