/** Owns Claude cedar_ember grant parsing, listing and irreversible claims. */
import { randomUUID } from "node:crypto";
import { ProviderHttpError, request } from "../../core/http/index.ts";
import { redactText } from "../../core/redact/index.ts";
import type {
	QuotaFetchContext,
	ResetCredit,
	ResetCreditList,
	ResetOutcome,
} from "../../quotas/types.ts";
import { PROVIDER } from "./provider.ts";
import { claudeQuotaHeaders, fetchClaudeUsage } from "./quota.ts";

const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const RESET_ENDPOINT =
	"https://api.anthropic.com/api/organizations/<organization>/reset_rate_limits";
const CHECK_LIST = "Check /quotas reset claude before approving another attempt.";
const POSSIBLY_SPENT = `the credit may already be spent. ${CHECK_LIST}`;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function date(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parses remaining grants, preserving the server's next-grant order restriction. */
export function parseClaudeResetCredits(body: unknown, fetchedAt: number): ResetCreditList {
	if (!record(body)) throw new Error(`Claude: invalid usage JSON; ${CHECK_LIST}`);
	const program = body["cedar_ember"];
	if (program == null) return { provider: PROVIDER, fetchedAt, available: 0, credits: [] };
	if (!record(program) || !Array.isArray(program["grants"])) {
		throw new Error(`Claude: usage cedar_ember has no grants[]; ${CHECK_LIST}`);
	}
	const credits: ResetCredit[] = [];
	let available = 0;
	for (const grant of program["grants"]) {
		if (!record(grant)) continue;
		const id = grant["id"];
		const left = grant["resets_left"];
		if (
			typeof id !== "string" ||
			!/^[a-z0-9_-]{1,40}$/.test(id) ||
			typeof left !== "number" ||
			!Number.isInteger(left) ||
			left <= 0
		)
			continue;
		const usable = grant["usable_now"] === true && grant["paused"] === false;
		if (usable) available += left;
		const clears = grant["clears"];
		const windows = Array.isArray(clears)
			? clears.filter((v): v is string => typeof v === "string")
			: [];
		credits.push({
			id,
			type: typeof grant["type"] === "string" ? grant["type"] : "unknown",
			title: typeof grant["label"] === "string" ? grant["label"] : undefined,
			description: windows.length ? `clears ${windows.join(", ")}` : undefined,
			status: usable ? (id === program["next_grant_id"] ? "available" : "queued") : "unavailable",
			grantedAtMs: date(grant["starts_at"]),
			expiresAtMs: date(grant["ends_at"]),
		});
	}
	return { provider: PROVIDER, fetchedAt, available, credits };
}

/** Lists grants from the same usage payload as the quota poll. */
export async function listClaudeResetCredits(ctx: QuotaFetchContext): Promise<ResetCreditList> {
	const body = await fetchClaudeUsage(ctx);
	if (body === undefined) throw new Error("Claude: no credential configured; run /login claude");
	return parseClaudeResetCredits(body, ctx.now());
}

/** Maps a claim verdict; unknown result values are refusals, never confirmed spends. */
export function parseClaudeResetOutcome(body: unknown, creditId: string): ResetOutcome {
	if (!record(body) || typeof body["result"] !== "string") {
		throw new Error(
			`Claude: POST ${RESET_ENDPOINT} returned invalid reset JSON; ${POSSIBLY_SPENT}`,
		);
	}
	const result = body["result"];
	const cleared = body["cleared"];
	return {
		provider: PROVIDER,
		creditId,
		code:
			result === "reset"
				? "reset"
				: result === "already_used"
					? "already_redeemed"
					: result === "not_limited"
						? "nothing_to_reset"
						: "refused",
		windowsReset:
			result === "reset" && Array.isArray(cleared)
				? cleared.filter((v) => typeof v === "string").length
				: 0,
		reason: typeof body["reason"] === "string" ? redactText(body["reason"]) : undefined,
	};
}

/** Resolves the organization transiently and submits exactly one claim, without retries. */
export async function consumeClaudeResetCredit(
	ctx: QuotaFetchContext,
	creditId: string,
): Promise<ResetOutcome> {
	if (!/^[a-z0-9_-]{1,40}$/.test(creditId))
		throw new Error("Claude: invalid reset grant id; list grants again");
	const auth = await ctx.auth();
	if (!auth || auth.extra["type"] === "api_key" || auth.token.startsWith("sk-")) {
		throw new Error("Claude: reset grants require OAuth; run /login claude");
	}
	const headers = claudeQuotaHeaders(auth.token);
	const options = {
		provider: PROVIDER,
		fetch: ctx.fetch,
		signal: ctx.signal,
		now: ctx.now,
		timeoutMs: 10_000,
		redirect: "error" as const,
	};
	let posting = false;
	try {
		const response = await request(PROFILE_URL, {
			...options,
			method: "GET",
			headers,
			secrets: [auth.token],
		});
		const profile: unknown = await response.json().catch(() => undefined);
		const organization = record(profile) ? profile["organization"] : undefined;
		const uuid = record(organization) ? organization["uuid"] : undefined;
		if (typeof uuid !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(uuid)) {
			throw new Error("Claude: profile has no valid organization; run /login claude");
		}
		ctx.signal.throwIfAborted();
		posting = true;
		const claim = await request(
			`https://api.anthropic.com/api/organizations/${uuid}/reset_rate_limits`,
			{
				...options,
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				secrets: [auth.token, uuid],
				body: JSON.stringify({
					program: "cedar_ember",
					grant_id: creditId,
					request_id: randomUUID(),
				}),
			},
		);
		const body: unknown = await claim.json().catch(() => undefined);
		const outcome = parseClaudeResetOutcome(body, creditId);
		return {
			...outcome,
			reason:
				outcome.reason === undefined ? undefined : redactText(outcome.reason, [auth.token, uuid]),
		};
	} catch (error) {
		const endpoint = posting ? RESET_ENDPOINT : PROFILE_URL;
		if (error instanceof ProviderHttpError) {
			const hint =
				error.status === 401 || error.status === 403
					? "run /login claude"
					: error.status === 429
						? `rate limited; wait for Retry-After. ${CHECK_LIST}`
						: posting
							? POSSIBLY_SPENT
							: CHECK_LIST;
			throw new ProviderHttpError(PROVIDER, error.status, endpoint, hint, error.retryAfterMs);
		}
		throw new Error(
			`Claude: ${posting ? "POST" : "GET"} ${endpoint} did not complete; ${posting ? POSSIBLY_SPENT : "check /login claude and retry later"}`,
		);
	}
}
