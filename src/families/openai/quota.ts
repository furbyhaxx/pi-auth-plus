/** Owns ChatGPT subscription usage parsing and read-only polling through Pi's credential. */
import { Buffer } from "node:buffer";
import { ProviderHttpError, request } from "../../core/http/index.ts";
import type {
	ProviderQuotaSnapshot,
	QuotaAuth,
	QuotaFetchContext,
	QuotaSource,
	QuotaWindow,
} from "../../quotas/types.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function accountId(auth: QuotaAuth): string | undefined {
	const explicit = text(auth.extra["accountId"]) ?? text(auth.extra["chatgpt_account_id"]);
	if (explicit) return explicit;
	const parts = auth.token.split(".");
	if (parts.length !== 3 || !parts[1]) return undefined;
	try {
		const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		return text(record(record(claims)["https://api.openai.com/auth"])["chatgpt_account_id"]);
	} catch {
		return undefined;
	}
}

function timestamp(raw: unknown): number | undefined {
	const numeric = typeof raw === "string" && raw.trim() ? Number(raw) : finite(raw);
	if (numeric !== undefined && Number.isFinite(numeric) && numeric > 0) {
		return numeric > 1e12 ? numeric : numeric * 1000;
	}
	if (typeof raw === "string" && raw.trim()) {
		const parsed = Date.parse(raw);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function quotaWindow(
	id: string,
	raw: Record<string, unknown>,
	prefix: string,
	important: boolean,
	now: number,
): QuotaWindow {
	const seconds = finite(raw["limit_window_seconds"]);
	const period =
		seconds !== undefined && seconds > 0
			? seconds >= 86400
				? `${Math.round(seconds / 86400)}d`
				: `${Math.max(1, Math.round(seconds / 3600))}h`
			: undefined;
	const used = finite(raw["used_percent"]);
	const after = finite(raw["reset_after_seconds"]);
	return {
		id,
		shortLabel: period ?? id,
		label: `${prefix} (${period ? `${period} window` : id})`,
		period,
		scope: id.startsWith("extra:") ? prefix.toLowerCase() : undefined,
		usedFraction: used === undefined ? undefined : Math.min(1, Math.max(0, used / 100)),
		resetAtMs: timestamp(raw["reset_at"]) ?? (after === undefined ? undefined : now + after * 1000),
		important,
	};
}

function headerNumber(raw: string | undefined): number | undefined {
	return raw?.trim() ? finite(Number(raw)) : undefined;
}

function parseOpenaiHeaders(
	headers: Readonly<Record<string, string>>,
	now: number,
): ProviderQuotaSnapshot | undefined {
	const windows: QuotaWindow[] = [];
	for (const id of ["primary", "secondary"]) {
		const prefix = `x-codex-${id}`;
		const rawUsed = headers[`${prefix}-used-percent`];
		const rawMinutes = headers[`${prefix}-window-minutes`];
		const rawReset = headers[`${prefix}-reset-at`];
		if (rawUsed === undefined && rawMinutes === undefined && rawReset === undefined) continue;
		const used = headerNumber(rawUsed);
		const minutes = headerNumber(rawMinutes);
		const resetAtMs = timestamp(rawReset);
		// Codex emits zeroed placeholders for absent windows, including an empty reset-at.
		if (used === 0 && (minutes === undefined || minutes === 0) && resetAtMs === undefined) continue;
		windows.push(
			quotaWindow(
				id,
				{
					used_percent: used,
					limit_window_seconds: minutes === undefined ? undefined : minutes * 60,
					reset_at: rawReset,
				},
				"Plan",
				windows.length === 0,
				now,
			),
		);
	}
	return windows.length > 0
		? {
				provider: "openai",
				fetchedAt: now,
				source: "headers",
				tier: text(headers["x-codex-plan-type"]),
				windows,
			}
		: undefined;
}

/** Parses usage without copying account identifiers from the response into the snapshot. */
export function parseOpenaiQuota(payload: unknown, now: number): ProviderQuotaSnapshot {
	const body = record(payload);
	const windows: QuotaWindow[] = [];
	const addWindow = (id: string, value: unknown, prefix: string, important: boolean) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return;
		windows.push(quotaWindow(id, record(value), prefix, important, now));
	};
	const limits = record(body["rate_limit"]);
	addWindow("primary", limits["primary_window"], "Plan", true);
	addWindow("secondary", limits["secondary_window"], "Plan", windows.length === 0);
	if (Array.isArray(body["additional_rate_limits"])) {
		for (const value of body["additional_rate_limits"]) {
			const extra = record(value);
			const name = text(extra["limit_name"]) ?? text(extra["metered_feature"]) ?? "extra";
			addWindow(`extra:${name}`, record(extra["rate_limit"])["primary_window"], name, false);
		}
	}
	const count = finite(record(body["rate_limit_reset_credits"])["available_count"]);
	const resetCredits = count !== undefined && count >= 0 ? Math.trunc(count) : undefined;
	if (!windows.some((window) => window.usedFraction !== undefined) && resetCredits === undefined) {
		throw new Error(
			`openai: GET ${USAGE_URL} missing usable used_percent and rate_limit_reset_credits.available_count; retry or check the usage endpoint schema`,
		);
	}
	return {
		provider: "openai",
		fetchedAt: now,
		source: "endpoint",
		tier: text(body["plan_type"]),
		windows,
		resetCredits,
	};
}

function needsLogin(now: number, reason: string): ProviderQuotaSnapshot {
	return {
		provider: "openai",
		fetchedAt: now,
		source: "endpoint",
		windows: [],
		needsAuth: true,
		error: `openai: ${reason}; run /login openai with a ChatGPT login`,
	};
}

async function fetchQuota(ctx: QuotaFetchContext): Promise<ProviderQuotaSnapshot> {
	const auth = await ctx.auth();
	const now = ctx.now();
	if (!auth) return needsLogin(now, "no credential configured");
	if (auth.token.startsWith("sk-") || auth.extra["type"] === "api_key") {
		return needsLogin(now, "subscription usage needs a ChatGPT login, not an API key");
	}
	const account = accountId(auth);
	const headers: Record<string, string> = {
		Authorization: `Bearer ${auth.token}`,
		"User-Agent": "codex_cli_rs/0.60.0",
		originator: "codex_cli_rs",
		Accept: "application/json",
	};
	if (account) headers["ChatGPT-Account-Id"] = account;
	let response: Response;
	try {
		response = await request(USAGE_URL, {
			provider: "openai",
			method: "GET",
			headers,
			fetch: ctx.fetch,
			signal: ctx.signal,
			timeoutMs: 10_000,
			now: ctx.now,
			secrets: account ? [auth.token, account] : [auth.token],
		});
	} catch (error) {
		if (error instanceof ProviderHttpError && (error.status === 401 || error.status === 403)) {
			return needsLogin(now, `GET ${USAGE_URL} rejected authentication (HTTP ${error.status})`);
		}
		throw error;
	}
	ctx.signal.throwIfAborted();
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error(
			`openai: GET ${USAGE_URL} returned invalid JSON (HTTP ${response.status}); retry or check the usage endpoint schema`,
		);
	}
	ctx.signal.throwIfAborted();
	return parseOpenaiQuota(body, now);
}

/** Read-only ChatGPT usage source; reset-credit consumption is deliberately separate. */
export const openaiQuota: QuotaSource = {
	kind: "windows",
	shortLabel: "oai",
	parserVersion: 1,
	fetch: fetchQuota,
	headers: parseOpenaiHeaders,
};
