/** Chooses the credential that can read ChatGPT usage; Pi's `openai` login is rejected there. */
import type { QuotaSource } from "../../quotas/types.ts";
import { type CodexOptions, resolveCodexToken } from "./codex-auth/index.ts";

/** The Pi provider whose login carries a ChatGPT account claim the usage endpoints accept. */
export const CODEX_PI_PROVIDER = "openai-codex";

/** What a user can run when no Codex credential exists. */
export const CODEX_LOGIN_HINT = "run /quota codex login or /login openai-codex";

/** Prefers Pi's `openai-codex` login, then the pi-quotas Codex file (refreshed under its lock). */
export function codexQuotaAuth(
	options: Omit<CodexOptions, "signal"> = {},
): NonNullable<QuotaSource["auth"]> {
	return async (lookup, signal) => {
		const pi = await lookup(CODEX_PI_PROVIDER);
		if (pi) return pi;
		const stored = await resolveCodexToken({ ...options, signal });
		if (!stored) return undefined;
		return {
			token: stored.token,
			extra: {
				type: "oauth",
				...(stored.accountId ? { accountId: stored.accountId } : {}),
				...(stored.planType ? { planType: stored.planType } : {}),
			},
		};
	};
}
