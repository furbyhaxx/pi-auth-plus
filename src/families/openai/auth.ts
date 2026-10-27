/** Chooses the credential that can read ChatGPT usage; Pi's `openai` login is rejected there. */
import { type CredentialStatus, credentialStatus, readCredential } from "../../core/auth/index.ts";
import type { QuotaSource } from "../../quotas/types.ts";
import {
	type CodexOptions,
	readCodexCredentialSync,
	resolveCodexToken,
} from "./codex-auth/index.ts";

/** The Pi provider whose login carries a ChatGPT account claim the usage endpoints accept. */
export const CODEX_PI_PROVIDER = "openai-codex";

/** The commands that create a Codex credential. */
export const CODEX_LOGIN_COMMANDS = "/quota codex login or /login openai-codex";

/** What a user can run when no Codex credential exists. */
export const CODEX_LOGIN_HINT = `run ${CODEX_LOGIN_COMMANDS}`;

/** Sign-in state from Pi's `openai-codex` slot, else the Codex file; refresh happens on fetch. */
export function codexCredentialStatus(nowMs: number, path?: string): CredentialStatus {
	const pi = credentialStatus(readCredential(CODEX_PI_PROVIDER), nowMs);
	if (pi.state !== "missing") return pi;
	const stored = readCodexCredentialSync(path);
	return stored
		? { state: "oauth", expiresAt: stored.expires, expired: stored.expires <= nowMs }
		: { state: "missing" };
}

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
