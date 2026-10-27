/** xAI billing endpoint transport and quota normalization. */
import { ProviderHttpError, request } from "../../core/http/index.ts";
import type {
	ProviderQuotaSnapshot,
	QuotaFetchContext,
	QuotaSource,
	QuotaWindow,
} from "../../quotas/types.ts";

const CREDITS_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const MONTHLY_URL = "https://cli-chat-proxy.grok.com/v1/billing";

/** Billing windows exposed by Pi's builtin xAI subscription. */
export const xaiQuota: QuotaSource = {
	kind: "windows",
	shortLabel: "xai",
	parserVersion: 1,
	fetch: fetchQuota,
};

async function fetchQuota(ctx: QuotaFetchContext): Promise<ProviderQuotaSnapshot> {
	const auth = await ctx.auth();
	const fetchedAt = ctx.now();
	if (!auth) {
		return {
			provider: "xai",
			fetchedAt,
			source: "endpoint",
			windows: [],
			needsAuth: true,
			error: "No credential configured; run /login xai",
		};
	}
	const headers = { Authorization: `Bearer ${auth.token}`, Accept: "application/json" };
	const load = async (url: string): Promise<unknown> => {
		const response = await request(url, {
			provider: "xai",
			headers,
			timeoutMs: 10_000,
			secrets: [auth.token],
			fetch: ctx.fetch,
			signal: ctx.signal,
			now: ctx.now,
		});
		try {
			return await response.json();
		} catch {
			throw new Error(`xai: invalid JSON from ${url}; retry billing quotas later`);
		}
	};
	const [credits, monthly] = await Promise.allSettled([load(CREDITS_URL), load(MONTHLY_URL)]);
	ctx.signal.throwIfAborted();
	const snapshot = parseBilling(
		credits.status === "fulfilled" ? credits.value : undefined,
		monthly.status === "fulfilled" ? monthly.value : undefined,
		fetchedAt,
	);
	if (snapshot.windows.length > 0) return snapshot;
	for (const result of [credits, monthly]) {
		if (result.status === "rejected" && result.reason instanceof ProviderHttpError) {
			throw result.reason;
		}
	}
	throw new Error(
		`xai: no usable billing quota from ${CREDITS_URL} or ${MONTHLY_URL}; ` +
			"missing currentPeriod.end, positive onDemandCap.val or positive monthlyLimit.val " +
			"(or invalid JSON/transport failure); retry billing quotas later",
	);
}

function object(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fraction(used: number | undefined, limit: number): number | undefined {
	return used === undefined ? undefined : Math.max(0, Math.min(1, used / limit));
}

function timestamp(value: unknown): number | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const numeric = Number(value);
	if (Number.isFinite(numeric) && numeric > 0) {
		return numeric > 1e12 ? numeric : numeric * 1000;
	}
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function dollars(used: number | undefined, limit: number): string | undefined {
	return used === undefined ? undefined : `$${used.toFixed(2)} / $${limit.toFixed(2)}`;
}

function parseBilling(
	creditsBody: unknown,
	monthlyBody: unknown,
	fetchedAt: number,
): ProviderQuotaSnapshot {
	const credits = object(object(creditsBody)["config"]);
	const monthly = object(object(monthlyBody)["config"]);
	const period = object(credits["currentPeriod"]);
	const windows: QuotaWindow[] = [];
	const resetAtMs = timestamp(period["end"]);
	if (typeof period["end"] === "string" && period["end"].trim()) {
		const periodType = typeof period["type"] === "string" ? period["type"].toUpperCase() : "";
		const weekly = periodType.includes("WEEK");
		const month = periodType.includes("MONTH");
		windows.push({
			id: weekly ? "7d" : "period",
			shortLabel: weekly ? "7d" : "per",
			label: weekly ? "7d weekly quota" : "Current period",
			period: weekly ? "7d" : month ? "1mo" : undefined,
			scope: weekly || month ? undefined : "current period",
			usedFraction: fraction(number(credits["creditUsagePercent"]), 100),
			resetAtMs,
			important: true,
		});
	}
	const cap = number(object(credits["onDemandCap"])["val"]);
	if (cap !== undefined && cap > 0) {
		const used = number(object(credits["onDemandUsed"])["val"]);
		windows.push({
			id: "ondemand",
			shortLabel: "cap",
			label: "On-demand cap",
			scope: "on-demand cap",
			usedFraction: fraction(used, cap),
			valueText: dollars(used, cap),
			important: false,
		});
	}
	const limit = number(object(monthly["monthlyLimit"])["val"]);
	if (limit !== undefined && limit > 0) {
		const used = number(object(monthly["used"])["val"]);
		windows.push({
			id: "monthly",
			shortLabel: "mo",
			label: "Monthly included",
			period: "1mo",
			scope: "included",
			usedFraction: fraction(used, limit),
			valueText: dollars(used, limit),
			resetAtMs: timestamp(monthly["billingPeriodEnd"]),
			important: windows.length === 0,
		});
	}
	return {
		provider: "xai",
		fetchedAt,
		source: "endpoint",
		tier: credits["isUnifiedBillingUser"] === true ? "unified" : undefined,
		windows,
	};
}
