/** Owns Claude usage requests and normalization of server-ordered quota windows. */
import { ProviderHttpError, request } from "../../core/http/index.ts";
import type {
	ProviderQuotaSnapshot,
	QuotaFetchContext,
	QuotaSource,
	QuotaWindow,
} from "../../quotas/types.ts";
import { PROVIDER } from "./provider.ts";
import { PINNED_VERSION, userAgent } from "./version.ts";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fraction(value: number | undefined): number | undefined {
	return value === undefined ? undefined : Math.max(0, Math.min(1, value));
}

function resetAt(value: unknown): number | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const numeric = Number(value);
	if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? numeric : numeric * 1000;
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function displayName(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	const name = value["display_name"];
	return typeof name === "string" && name.trim() ? name : undefined;
}

function limitWindow(raw: unknown): QuotaWindow | undefined {
	if (!isRecord(raw)) return undefined;
	const kind = raw["kind"];
	const group = raw["group"];
	const severity = raw["severity"];
	const active = raw["is_active"];
	const reset = raw["resets_at"];
	if (
		typeof kind !== "string" ||
		typeof group !== "string" ||
		typeof severity !== "string" ||
		typeof active !== "boolean" ||
		(reset !== undefined && reset !== null && typeof reset !== "string")
	)
		return undefined;
	const scope = raw["scope"];
	let name = isRecord(scope)
		? (displayName(scope["model"]) ?? displayName(scope["surface"]))
		: undefined;
	let id = `${kind}:${group}`;
	let shortLabel = kind.slice(0, 3).toLowerCase();
	let label = [kind, group, name].filter(Boolean).join(" ");
	let period: string | undefined;
	if (kind === "session") {
		id = "5h";
		shortLabel = "5h";
		label = "5h session";
		period = "5h";
	} else if (kind === "weekly_all") {
		id = "7d";
		shortLabel = "7d";
		label = "7d weekly";
		period = "7d";
	} else if (kind === "weekly_scoped") {
		name ??= "Scoped";
		id = `scoped:${name.toLowerCase()}`;
		shortLabel = name.slice(0, 3).toLowerCase();
		label = `7d ${name}`;
		period = "7d";
	}
	const percent = finiteNumber(raw["percent"]);
	return {
		id,
		shortLabel,
		label,
		period,
		scope: name,
		usedFraction: fraction(percent === undefined ? undefined : percent / 100),
		resetAtMs: resetAt(reset),
		important: kind === "session" || kind === "weekly_all" || active || severity !== "normal",
	};
}

const LEGACY_WINDOWS = [
	{
		key: "five_hour",
		id: "5h",
		shortLabel: "5h",
		label: "5h session",
		period: "5h",
		important: true,
	},
	{
		key: "seven_day",
		id: "7d",
		shortLabel: "7d",
		label: "7d weekly",
		period: "7d",
		important: true,
	},
	{
		key: "seven_day_opus",
		id: "scoped:opus",
		shortLabel: "opu",
		label: "7d Opus",
		period: "7d",
		scope: "Opus",
		important: false,
	},
	{
		key: "seven_day_sonnet",
		id: "scoped:sonnet",
		shortLabel: "son",
		label: "7d Sonnet",
		period: "7d",
		scope: "Sonnet",
		important: false,
	},
	{
		key: "seven_day_oauth_apps",
		id: "scoped:oauth apps",
		shortLabel: "oau",
		label: "7d OAuth apps",
		period: "7d",
		scope: "OAuth apps",
		important: false,
	},
];

/** Parses usage without retaining profile, account or share-breakdown data. */
export function parseClaudeQuota(body: unknown, now: number): ProviderQuotaSnapshot {
	if (!isRecord(body)) {
		throw new Error(
			`Claude usage (GET ${USAGE_URL}): invalid quota JSON; missing usage object; retry later`,
		);
	}
	const windows: QuotaWindow[] = [];
	const limits = body["limits"];
	const extra = body["extra_usage"];
	let recognized =
		Array.isArray(limits) || (isRecord(extra) && typeof extra["is_enabled"] === "boolean");
	if (Array.isArray(limits) && limits.length > 0) {
		const ids = new Set<string>();
		for (const [index, raw] of limits.entries()) {
			const window = limitWindow(raw);
			if (!window) continue;
			const id = ids.has(window.id) ? `${window.id}:${index}` : window.id;
			ids.add(id);
			windows.push({ ...window, id });
		}
	} else {
		for (const { key, ...metadata } of LEGACY_WINDOWS) {
			const bucket = body[key];
			if (!isRecord(bucket)) continue;
			recognized = true;
			const percent = finiteNumber(bucket["utilization"]);
			windows.push({
				...metadata,
				usedFraction: fraction(percent === undefined ? undefined : percent / 100),
				resetAtMs: resetAt(bucket["resets_at"]),
			});
		}
	}
	for (const [key, bucket] of Object.entries(body)) {
		if (!isRecord(bucket)) continue;
		const cap = finiteNumber(bucket["limit_dollars"]);
		if (cap === undefined) continue;
		recognized = true;
		const percent = finiteNumber(bucket["utilization"]);
		const used = finiteNumber(bucket["used_dollars"]);
		const label = typeof bucket["label"] === "string" ? bucket["label"] : `$${cap} cap`;
		windows.push({
			id: key,
			shortLabel: "cap",
			label,
			scope: label,
			usedFraction: fraction(percent === undefined ? undefined : percent / 100),
			valueText: used === undefined ? undefined : `$${used.toFixed(2)} / $${cap.toFixed(0)}`,
			resetAtMs: resetAt(bucket["resets_at"]),
			important: percent !== undefined && percent >= 90,
		});
	}
	if (isRecord(extra) && extra["is_enabled"] === true) {
		const cap = finiteNumber(extra["monthly_limit"]);
		const used = finiteNumber(extra["used_credits"]);
		const percent = finiteNumber(extra["utilization"]);
		if (cap !== undefined && cap > 0) {
			const currency =
				typeof extra["currency"] === "string" ? extra["currency"].toUpperCase() : "USD";
			const prefix = currency === "USD" ? "$" : `${currency} `;
			windows.push({
				id: "extra_usage",
				shortLabel: "ext",
				label: "Extra usage cap",
				period: "1mo",
				scope: "extra usage",
				usedFraction: fraction(
					used !== undefined ? used / cap : percent === undefined ? undefined : percent / 100,
				),
				valueText:
					used === undefined
						? undefined
						: `${prefix}${(used / 100).toFixed(2)} / ${prefix}${(cap / 100).toFixed(2)}`,
				important: false,
			});
		}
	}
	if (!recognized || (Array.isArray(limits) && limits.length > 0 && windows.length === 0)) {
		throw new Error(
			`Claude usage (GET ${USAGE_URL}): missing recognized quota windows or extra_usage; retry later`,
		);
	}
	return { provider: PROVIDER, fetchedAt: now, source: "endpoint", windows };
}

/** Fetches usage, replaying a 401 only when Pi resolves a different credential. */
export async function fetchClaudeQuota(ctx: QuotaFetchContext): Promise<ProviderQuotaSnapshot> {
	const auth = await ctx.auth();
	if (!auth)
		return {
			provider: PROVIDER,
			fetchedAt: ctx.now(),
			source: "endpoint",
			windows: [],
			needsAuth: true,
			error: "Claude: no credential configured; run /login claude",
		};
	const get = (token: string) =>
		request(USAGE_URL, {
			provider: PROVIDER,
			fetch: ctx.fetch,
			signal: ctx.signal,
			now: ctx.now,
			timeoutMs: 10_000,
			secrets: [token],
			method: "GET",
			redirect: "error",
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
				"User-Agent": userAgent(PINNED_VERSION),
				Accept: "application/json",
			},
		});
	let response: Response;
	try {
		response = await get(auth.token);
	} catch (error) {
		if (!(error instanceof ProviderHttpError)) throw error;
		if (error.status !== 401) throw contextualHttpError(error);
		const updated = await ctx.auth();
		if (!updated || updated.token === auth.token) throw contextualHttpError(error);
		try {
			response = await get(updated.token);
		} catch (retryError) {
			throw retryError instanceof ProviderHttpError ? contextualHttpError(retryError) : retryError;
		}
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error(
			`Claude usage (GET ${USAGE_URL}) returned HTTP ${response.status} with invalid quota JSON; retry later`,
		);
	}
	return parseClaudeQuota(body, ctx.now());
}

function contextualHttpError(error: ProviderHttpError): ProviderHttpError {
	const recovery =
		error.status === 401
			? "run /login claude"
			: error.status === 403 || error.status === 429
				? "rate limited; retry after the Retry-After hold expires"
				: "retry later; check the provider service";
	return new ProviderHttpError(
		PROVIDER,
		error.status,
		USAGE_URL,
		`Claude usage; ${recovery}`,
		error.retryAfterMs,
	);
}

/** Claude's pollable usage source; a five-minute floor protects the rate-limited endpoint. */
export const claudeQuota: QuotaSource = {
	kind: "windows",
	shortLabel: "cl",
	parserVersion: 1,
	minPollMs: 300_000,
	fetch: fetchClaudeQuota,
};
