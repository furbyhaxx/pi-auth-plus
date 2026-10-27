/** The normalized quota contract every family's `quota` part produces and every surface reads. */
import type { FetchFn } from "../core/http/index.ts";

/** One usage window, e.g. a 5 h or 7 d allowance. */
export interface QuotaWindow {
	/** Stable within the provider, e.g. "5h", "7d", "gemini-5h". */
	readonly id: string;
	/** Compact label for the line, e.g. "5h", "gem". */
	readonly shortLabel: string;
	/** Full label for panels. */
	readonly label: string;
	/** Used fraction in [0, 1]; 1 means exhausted. Absent when the provider did not report it. */
	readonly usedFraction?: number | undefined;
	/** Detail text, e.g. "$41.43 / $48.00". */
	readonly valueText?: string | undefined;
	/** Epoch ms when the window resets. */
	readonly resetAtMs?: number | undefined;
	/** Shown in the condensed line by default. */
	readonly important?: boolean | undefined;
	/** Group name, e.g. "Gemini Models". */
	readonly group?: string | undefined;
	/** Window duration as reported, e.g. "5h", "7d", "1mo". */
	readonly period?: string | undefined;
	/** What the window limits when it is not plan-wide, e.g. "search". */
	readonly scope?: string | undefined;
}

/** A prepaid or capped balance. */
export interface CreditBalance {
	/** Remaining balance; absent when the provider did not report it. */
	readonly remaining?: number | undefined;
	readonly total?: number | undefined;
	readonly used?: number | undefined;
	/** Currency symbol or code, e.g. "$". */
	readonly currency: string;
	readonly detailText?: string | undefined;
}

/** One provider's quota state at one point in time. */
export interface ProviderQuotaSnapshot {
	/** Pi provider id. */
	readonly provider: string;
	readonly fetchedAt: number;
	readonly source: "endpoint" | "headers";
	/** Plan badge, e.g. "max 20x". Never an account or project identifier. */
	readonly tier?: string | undefined;
	readonly credits?: CreditBalance | undefined;
	readonly windows: readonly QuotaWindow[];
	/** On-demand rate-limit reset credits available now. */
	readonly resetCredits?: number | undefined;
	/** Why this snapshot is incomplete or failed. */
	readonly error?: string | undefined;
	/** Credentials are missing; the user has to `/login`. */
	readonly needsAuth?: boolean | undefined;
}

/** One on-demand rate-limit reset credit as the provider lists it. */
export interface ResetCredit {
	readonly id: string;
	readonly type: string;
	readonly status: string;
	readonly title?: string | undefined;
	readonly description?: string | undefined;
	readonly grantedAtMs?: number | undefined;
	readonly expiresAtMs?: number | undefined;
	readonly redeemedAtMs?: number | undefined;
	readonly supportedByPlan?: boolean | undefined;
}

export interface ResetCreditList {
	readonly provider: string;
	readonly fetchedAt: number;
	/** Credits redeemable now, as the provider counts them. */
	readonly available: number;
	readonly credits: readonly ResetCredit[];
}

/** Provider verdict for one consume request; only `reset` spends a credit. */
export type ResetOutcomeCode = "reset" | "nothing_to_reset" | "no_credit" | "already_redeemed";

export interface ResetOutcome {
	readonly provider: string;
	readonly code: ResetOutcomeCode;
	readonly creditId: string;
	readonly windowsReset: number;
}

/** The credential a quota fetch authenticates with, resolved through Pi (OAuth already refreshed). */
export interface QuotaAuth {
	readonly token: string;
	/** Credential fields beyond the token, e.g. the ChatGPT account id. */
	readonly extra: Readonly<Record<string, unknown>>;
}

/** What the engine hands a family's quota fetch. */
export interface QuotaFetchContext {
	/** Undefined when the user has no credential for this provider. */
	readonly auth: () => Promise<QuotaAuth | undefined>;
	readonly fetch: FetchFn;
	readonly signal: AbortSignal;
	readonly now: () => number;
}

/** Optional on-demand reset support; consuming spends a credit and needs per-call user approval. */
export interface QuotaResets {
	readonly list: (ctx: QuotaFetchContext) => Promise<ResetCreditList>;
	readonly consume: (ctx: QuotaFetchContext, creditId: string) => Promise<ResetOutcome>;
}

/** A provider's quota part. */
export interface QuotaSource {
	readonly kind: "credits" | "windows";
	/** Compact provider label for small screens, e.g. "cl". */
	readonly shortLabel: string;
	/** Bump when a parser change makes older cached snapshots wrong. */
	readonly parserVersion: number;
	/** Endpoint floor independent of the configured refresh interval. */
	readonly minPollMs?: number;
	/** Throws `ProviderHttpError` for HTTP failures so the engine can back off. */
	readonly fetch: (ctx: QuotaFetchContext) => Promise<ProviderQuotaSnapshot>;
	/**
	 * Parses inference response headers (keys lower-cased) into a `source: "headers"` snapshot;
	 * returns `undefined` when the header set is not this provider's shape.
	 */
	readonly headers?: (
		headers: Readonly<Record<string, string>>,
		now: number,
	) => ProviderQuotaSnapshot | undefined;
	readonly resets?: QuotaResets;
}
