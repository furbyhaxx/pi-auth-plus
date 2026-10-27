/** Owns ChatGPT reset-credit parsing, listing and irreversible consumption. */
import { randomUUID } from "node:crypto";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { ProviderHttpError, request } from "../../core/http/index.ts";
import type {
	QuotaFetchContext,
	ResetCredit,
	ResetCreditList,
	ResetOutcome,
	ResetOutcomeCode,
} from "../../quotas/types.ts";
import { CODEX_LOGIN_HINT } from "./auth.ts";
import { CODEX_PROVIDER_ID } from "./identity.ts";
import { openaiQuotaHeaders, timestamp } from "./quota.ts";

const LIST_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const CONSUME_URL = `${LIST_URL}/consume`;
const CHECK_LIST = `Check /quotas reset ${CODEX_PROVIDER_ID} before retrying.`;
const POSSIBLY_SPENT = `the credit may already be spent. ${CHECK_LIST}`;
const OUTCOME_CODES: readonly ResetOutcomeCode[] = [
	"reset",
	"nothing_to_reset",
	"no_credit",
	"already_redeemed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function parseCredit(raw: unknown): ResetCredit | undefined {
	if (!isRecord(raw)) return undefined;
	const id = optionalText(raw["id"]);
	const status = optionalText(raw["status"]);
	if (!id || !status) return undefined;
	const supported = raw["is_supported_by_plan"];
	return {
		id,
		type: optionalText(raw["reset_type"]) ?? "unknown",
		status,
		title: optionalText(raw["title"]),
		description: optionalText(raw["description"]),
		grantedAtMs: timestamp(raw["granted_at"]),
		expiresAtMs: timestamp(raw["expires_at"]),
		redeemedAtMs: timestamp(raw["redeemed_at"]),
		supportedByPlan: typeof supported === "boolean" ? supported : undefined,
	};
}

/** Parses the reset inventory, falling back to available statuses only for an invalid count. */
export function parseOpenaiResetCredits(body: unknown, fetchedAt: number): ResetCreditList {
	if (!isRecord(body) || !Array.isArray(body["credits"])) {
		throw new Error(
			`${CODEX_PROVIDER_ID}: GET ${LIST_URL} has no credits[] array; check the reset endpoint schema`,
		);
	}
	const credits = body["credits"].map(parseCredit).filter((credit) => credit !== undefined);
	const reported = body["available_count"];
	const available =
		typeof reported === "number" && Number.isInteger(reported) && reported >= 0
			? reported
			: credits.filter((credit) => credit.status === "available").length;
	return { provider: CODEX_PROVIDER_ID, fetchedAt, available, credits };
}

/** Parses a consume verdict without treating an unknown response as success. */
export function parseOpenaiResetOutcome(body: unknown, creditId: string): ResetOutcome {
	const code = isRecord(body) ? body["code"] : undefined;
	const outcome = OUTCOME_CODES.find((known) => known === code);
	if (!isRecord(body) || !outcome) {
		throw new Error(
			`${CODEX_PROVIDER_ID}: POST ${CONSUME_URL} returned an unrecognized result; ${POSSIBLY_SPENT}`,
		);
	}
	const windows = body["windows_reset"];
	return {
		provider: CODEX_PROVIDER_ID,
		creditId,
		code: outcome,
		windowsReset: typeof windows === "number" && windows >= 0 ? windows : 0,
	};
}

async function credential(ctx: QuotaFetchContext) {
	const auth = await ctx.auth();
	if (!auth || auth.token.startsWith("sk-") || auth.extra["type"] === "api_key") {
		throw new Error(
			`${CODEX_PROVIDER_ID}: reset credits require a ChatGPT login; ${CODEX_LOGIN_HINT}`,
		);
	}
	return openaiQuotaHeaders(auth);
}

function httpFailure(
	error: ProviderHttpError,
	method: string,
	url: string,
	consume: boolean,
): Error {
	const auth = error.status === 401 || error.status === 403;
	const hint = auth
		? "run /login openai"
		: consume && error.status >= 500
			? POSSIBLY_SPENT
			: CHECK_LIST;
	const body = stripTerminalSequences(error.body).replaceAll(/\s+/g, " ").trim().slice(0, 200);
	return new Error(
		`${CODEX_PROVIDER_ID}: ${method} ${url} returned HTTP ${error.status}; ${hint}${body ? `: ${body}` : ""}`,
	);
}

/** Lists credits using Pi's refreshed ChatGPT credential and the caller's transport. */
export async function listOpenaiResetCredits(ctx: QuotaFetchContext): Promise<ResetCreditList> {
	const { headers, secrets } = await credential(ctx);
	let response: Response;
	try {
		response = await request(LIST_URL, {
			provider: CODEX_PROVIDER_ID,
			method: "GET",
			headers,
			secrets,
			fetch: ctx.fetch,
			signal: ctx.signal,
			now: ctx.now,
			timeoutMs: 10_000,
		});
	} catch (error) {
		if (error instanceof ProviderHttpError) throw httpFailure(error, "GET", LIST_URL, false);
		throw error;
	}
	ctx.signal.throwIfAborted();
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error(
			`${CODEX_PROVIDER_ID}: GET ${LIST_URL} returned invalid JSON (HTTP ${response.status}); ${CHECK_LIST}`,
		);
	}
	ctx.signal.throwIfAborted();
	return parseOpenaiResetCredits(body, ctx.now());
}

/** Spends one credit exactly once; redeem_request_id idempotency is unverified. */
export async function consumeOpenaiResetCredit(
	ctx: QuotaFetchContext,
	creditId: string,
): Promise<ResetOutcome> {
	const { headers, secrets } = await credential(ctx);
	let response: Response;
	try {
		response = await request(CONSUME_URL, {
			provider: CODEX_PROVIDER_ID,
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ redeem_request_id: randomUUID(), credit_id: creditId }),
			secrets,
			fetch: ctx.fetch,
			signal: ctx.signal,
			now: ctx.now,
			timeoutMs: 10_000,
		});
	} catch (error) {
		if (error instanceof ProviderHttpError) throw httpFailure(error, "POST", CONSUME_URL, true);
		throw new Error(
			`${CODEX_PROVIDER_ID}: POST ${CONSUME_URL} did not complete; ${POSSIBLY_SPENT}`,
		);
	}
	const body: unknown = await response.json().catch(() => undefined);
	return parseOpenaiResetOutcome(body, creditId);
}
