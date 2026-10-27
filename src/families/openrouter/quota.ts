/** OpenRouter account credits and key spending caps, normalized for the quota engine. */
import { request } from "../../core/http/index.ts";
import type {
	ProviderQuotaSnapshot,
	QuotaFetchContext,
	QuotaSource,
	QuotaWindow,
} from "../../quotas/types.ts";

const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const KEY_URL = "https://openrouter.ai/api/v1/key";

/** Quotas for Pi's builtin OpenRouter provider. */
export const openrouterQuota: QuotaSource = {
	kind: "credits",
	shortLabel: "or",
	parserVersion: 1,
	fetch: fetchQuota,
};

async function fetchQuota(ctx: QuotaFetchContext): Promise<ProviderQuotaSnapshot> {
	const auth = await ctx.auth();
	if (!auth) {
		return {
			provider: "openrouter",
			fetchedAt: ctx.now(),
			source: "endpoint",
			windows: [],
			needsAuth: true,
			error: "OpenRouter: no credential configured; use /login openrouter",
		};
	}
	const bodies = await Promise.all(
		[CREDITS_URL, KEY_URL].map(async (url) => {
			const response = await request(url, {
				provider: "openrouter",
				headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
				fetch: ctx.fetch,
				signal: ctx.signal,
				timeoutMs: 10_000,
				now: ctx.now,
				secrets: [auth.token],
			});
			try {
				return (await response.json()) as unknown;
			} catch {
				throw new Error(`OpenRouter: ${url} returned invalid JSON; retry quota refresh`);
			}
		}),
	);
	return parseOpenrouterQuota(bodies[0], bodies[1], ctx.now());
}

/** Parses the two endpoint envelopes without retaining key or account identifiers. */
export function parseOpenrouterQuota(
	creditsBody: unknown,
	keyBody: unknown,
	fetchedAt: number,
): ProviderQuotaSnapshot {
	const credits = record(record(creditsBody)?.["data"]);
	const key = record(record(keyBody)?.["data"]);
	const total = number(credits?.["total_credits"]);
	const used = number(credits?.["total_usage"]);
	const limit = number(key?.["limit"]);
	const keyRemaining = number(key?.["limit_remaining"]);
	const details: string[] = [];
	for (const [field, label] of [
		["usage_daily", "day"],
		["usage_weekly", "wk"],
		["usage_monthly", "mo"],
	] as const) {
		const usage = number(key?.[field]);
		if (usage !== undefined) details.push(`${label} $${usage.toFixed(2)}`);
	}
	if (
		total === undefined &&
		used === undefined &&
		keyRemaining === undefined &&
		details.length === 0
	) {
		throw new Error(
			`OpenRouter: ${CREDITS_URL} and ${KEY_URL} returned no numeric account credits/usage, key remaining cap or daily/weekly/monthly usage; retry quota refresh`,
		);
	}
	const accountRemaining =
		total !== undefined && used !== undefined ? Math.max(0, total - used) : undefined;
	const remaining =
		accountRemaining ?? (keyRemaining !== undefined ? Math.max(0, keyRemaining) : undefined);
	const windows: QuotaWindow[] = [];
	if (total !== undefined && total > 0 && used !== undefined && accountRemaining !== undefined) {
		windows.push({
			id: "credits",
			shortLabel: "cred",
			label: "Account credits",
			usedFraction: Math.min(1, Math.max(0, used / total)),
			valueText: `$${accountRemaining.toFixed(2)} left of $${total.toFixed(2)}`,
			important: true,
		});
	}
	if (limit !== undefined && limit > 0 && keyRemaining !== undefined) {
		windows.push({
			id: "key-cap",
			shortLabel: "key",
			label: "Key spend cap",
			scope: "key cap",
			usedFraction: Math.min(1, Math.max(0, (limit - keyRemaining) / limit)),
			valueText: `$${keyRemaining.toFixed(2)} left of $${limit.toFixed(2)}`,
			important: false,
		});
	}
	return {
		provider: "openrouter",
		fetchedAt,
		source: "endpoint",
		credits: {
			remaining,
			total,
			used,
			currency: "$",
			detailText: details.length > 0 ? details.join(" · ") : undefined,
		},
		windows,
	};
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
