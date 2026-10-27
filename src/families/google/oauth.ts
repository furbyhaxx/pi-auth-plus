/** Owns Antigravity consumer OAuth login and refresh through Pi. */
import { setTimeout as delay } from "node:timers/promises";
import type { OAuthCredential, ProviderAuth } from "@earendil-works/pi-ai";
import { parseCodePaste } from "../../core/auth/code-paste.ts";
import { createPkce, randomState } from "../../core/auth/pkce.ts";
import {
	type FetchFn,
	ProviderHttpError,
	ProviderTimeoutError,
	request,
} from "../../core/http/index.ts";

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
// Installed-app protocol constant shared with the public CLI, not a user credential.
const CLIENT_SECRET = "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";
const REDIRECT_URI = "https://antigravity.google/oauth-callback";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
	"https://www.googleapis.com/auth/aicode",
	"openid",
];

/** A safe OAuth failure with an operation, endpoint, status and recovery. */
export class AntigravityAuthError extends Error {
	override readonly name = "AntigravityAuthError";
	readonly status: number | undefined;

	constructor(operation: string, endpoint: string, status?: number) {
		super(
			`antigravity: ${operation} at ${endpoint}${status === undefined ? "" : ` (HTTP ${status})`}; run /login antigravity again`,
		);
		this.status = status;
	}
}

function retryableTransport(error: unknown, seen = new Set<unknown>()): boolean {
	if (error instanceof ProviderTimeoutError) return true;
	if (typeof error !== "object" || error === null || seen.has(error)) return false;
	seen.add(error);
	if (
		error instanceof Error &&
		(error.name === "ProviderTimeoutError" ||
			error.message.includes("fetch failed") ||
			error.message.includes("Failed to fetch"))
	)
		return true;
	if (
		"code" in error &&
		typeof error.code === "string" &&
		[
			"ECONNRESET",
			"ECONNREFUSED",
			"ETIMEDOUT",
			"ENOTFOUND",
			"EAI_AGAIN",
			"UND_ERR_CONNECT_TIMEOUT",
			"ConnectionClosed",
			"ConnectionRefused",
		].includes(error.code)
	)
		return true;
	return "cause" in error && retryableTransport(error.cause, seen);
}

function parseTokens(value: unknown, now: number, refresh?: string): OAuthCredential {
	if (
		typeof value !== "object" ||
		value === null ||
		!("access_token" in value) ||
		typeof value.access_token !== "string" ||
		!value.access_token.trim() ||
		!("expires_in" in value) ||
		typeof value.expires_in !== "number" ||
		!Number.isFinite(value.expires_in) ||
		value.expires_in <= 0 ||
		!Number.isFinite(now + value.expires_in * 1000)
	) {
		throw new AntigravityAuthError("invalid OAuth token response", TOKEN_URL);
	}
	const refreshToken = "refresh_token" in value ? value.refresh_token : refresh;
	if (typeof refreshToken !== "string" || !refreshToken.trim()) {
		throw new AntigravityAuthError("missing OAuth refresh token", TOKEN_URL);
	}
	return {
		type: "oauth",
		access: value.access_token,
		refresh: refreshToken,
		expires: now + value.expires_in * 1000,
	};
}

/** Builds Pi-native login without performing I/O until login or refresh. */
export function antigravityAuth(
	deps: {
		fetch?: FetchFn;
		now?: () => number;
		random?: (length: number) => Uint8Array;
		sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	} = {},
): ProviderAuth {
	const fetchFn = deps.fetch ?? fetch;
	const now = deps.now ?? Date.now;
	const sleep = deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));

	async function exchange(
		body: Record<string, string>,
		secrets: readonly string[],
		signal: AbortSignal,
	): Promise<unknown> {
		const response = await request(TOKEN_URL, {
			provider: "antigravity",
			fetch: fetchFn,
			signal,
			secrets: [...secrets, CLIENT_SECRET],
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				...body,
			}).toString(),
		});
		return response.json();
	}

	return {
		oauth: {
			name: "Antigravity",
			loginLabel: "Antigravity (Google)",
			isSubscription: true,
			async login(interaction) {
				const { signal } = interaction;
				signal.throwIfAborted();
				const pkce = await createPkce(deps.random);
				const state = randomState(deps.random);
				const url = new URL("https://accounts.google.com/o/oauth2/auth");
				url.search = new URLSearchParams({
					client_id: CLIENT_ID,
					response_type: "code",
					redirect_uri: REDIRECT_URI,
					scope: SCOPES.join(" "),
					code_challenge: pkce.challenge,
					code_challenge_method: "S256",
					state,
					access_type: "offline",
					prompt: "consent",
				}).toString();
				signal.throwIfAborted();
				interaction.notify({
					type: "auth_url",
					url: url.toString(),
					instructions: "Paste the redirected URL or authorization code here:",
				});
				const input = (
					await interaction.prompt({
						type: "manual_code",
						message: "Paste the Antigravity callback URL or code:",
						signal,
					})
				).trim();
				signal.throwIfAborted();
				const callback = parseCodePaste(input);
				// A bare code has no returned state; PKCE still binds it to this login attempt.
				const code =
					callback?.state === state
						? callback.code
						: !callback && /^[A-Za-z0-9_./~-]+$/.test(input)
							? input
							: undefined;
				if (!code)
					throw new AntigravityAuthError("invalid authorization callback or state", REDIRECT_URI);
				try {
					const data = await exchange(
						{
							code,
							grant_type: "authorization_code",
							redirect_uri: REDIRECT_URI,
							code_verifier: pkce.verifier,
						},
						[code, pkce.verifier],
						signal,
					);
					signal.throwIfAborted();
					return parseTokens(data, now());
				} catch (error) {
					signal.throwIfAborted();
					throw new AntigravityAuthError(
						"authorization exchange failed",
						TOKEN_URL,
						error instanceof ProviderHttpError ? error.status : undefined,
					);
				}
			},
			async refresh(credential, signal) {
				for (let attempt = 0; ; attempt++) {
					signal.throwIfAborted();
					if (attempt > 0) await sleep(500 * 2 ** (attempt - 1), signal);
					try {
						const data = await exchange(
							{ grant_type: "refresh_token", refresh_token: credential.refresh },
							[credential.access, credential.refresh],
							signal,
						);
						signal.throwIfAborted();
						return parseTokens(data, now(), credential.refresh);
					} catch (error) {
						signal.throwIfAborted();
						const retry =
							error instanceof ProviderHttpError
								? error.status >= 500 && error.status < 600
								: retryableTransport(error);
						if (attempt < 2 && retry) continue;
						throw new AntigravityAuthError(
							"token refresh failed",
							TOKEN_URL,
							error instanceof ProviderHttpError ? error.status : undefined,
						);
					}
				}
			},
			toAuth: async (credential) => ({ headers: { Authorization: `Bearer ${credential.access}` } }),
		},
	};
}
