/** Owns DeepSeek balance fetching and normalization. */
import { request } from "../../core/http/index.ts";
import type { ProviderQuotaSnapshot, QuotaSource } from "../../quotas/types.ts";

const ENDPOINT = "https://api.deepseek.com/user/balance";

/** DeepSeek's account balance source. */
export const deepseekQuota: QuotaSource = {
	kind: "credits",
	shortLabel: "ds",
	parserVersion: 1,
	async fetch(ctx) {
		const auth = await ctx.auth();
		if (!auth) {
			return {
				provider: "deepseek",
				fetchedAt: ctx.now(),
				source: "endpoint",
				windows: [],
				needsAuth: true,
				error: "deepseek: no credential configured; use /login deepseek",
			};
		}
		const response = await request(ENDPOINT, {
			provider: "deepseek",
			headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
			fetch: ctx.fetch,
			signal: ctx.signal,
			timeoutMs: 10_000,
			now: ctx.now,
			secrets: [auth.token],
		});
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new Error(`deepseek: invalid JSON from ${ENDPOINT}; retry the balance request`);
		}
		return parseDeepseekBalance(body, ctx.now());
	},
};

/** Parses a balance response, preserving unknown amounts instead of fabricating zero. */
export function parseDeepseekBalance(body: unknown, fetchedAt: number): ProviderQuotaSnapshot {
	const infos =
		isRecord(body) && Array.isArray(body["balance_infos"])
			? body["balance_infos"].filter(isRecord)
			: [];
	const info = infos.find((entry) => entry["currency"] === "USD") ?? infos[0];
	const code = info?.["currency"];
	if (!info || (code !== "USD" && code !== "CNY")) {
		throw new Error(
			`deepseek: ${ENDPOINT} missing balance_infos with a supported currency (USD/CNY); retry the balance request`,
		);
	}
	const remaining = amount(info["total_balance"]);
	const granted = amount(info["granted_balance"]);
	const toppedUp = amount(info["topped_up_balance"]);
	if (remaining === undefined && granted === undefined && toppedUp === undefined) {
		throw new Error(
			`deepseek: ${ENDPOINT} missing usable total_balance, granted_balance and topped_up_balance; retry the balance request`,
		);
	}
	const currency = code === "CNY" ? "¥" : "$";
	const details: string[] = [];
	if (granted !== undefined) details.push(`granted ${currency}${granted.toFixed(2)}`);
	if (toppedUp !== undefined) details.push(`topped-up ${currency}${toppedUp.toFixed(2)}`);
	return {
		provider: "deepseek",
		fetchedAt,
		source: "endpoint",
		credits: { remaining, currency, detailText: details.length ? details.join(" · ") : undefined },
		windows: [],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function amount(value: unknown): number | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}
