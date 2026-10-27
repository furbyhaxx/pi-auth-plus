/** Owns Claude subscription OAuth, token refresh, and API-key login. */
import { setTimeout as delay } from "node:timers/promises";
import type { OAuthCredential, ProviderAuth, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { parseCodePaste } from "../../core/auth/code-paste.ts";
import { createPkce, randomState } from "../../core/auth/pkce.ts";
import {
	type FetchFn,
	ProviderHttpError,
	ProviderTimeoutError,
	request,
} from "../../core/http/index.ts";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const KEY_URL = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key";
const SCOPES = [
	"org:create_api_key",
	"user:profile",
	"user:inference",
	"user:sessions:claude_code",
	"user:mcp_servers",
	"user:file_upload",
];
const TOKEN_HEADERS = {
	"Content-Type": "application/json",
	Accept: "application/json, text/plain, */*",
	"User-Agent": "axios/1.13.6",
};

/** A credential operation failed without exposing the provider response or tokens. */
export class ClaudeAuthError extends Error {
	override readonly name = "ClaudeAuthError";
	readonly status: number | undefined;

	constructor(operation: string, endpoint: string, status?: number) {
		super(
			`claude: ${operation} at ${endpoint}${status === undefined ? "" : ` (HTTP ${status})`}; run /login claude again`,
		);
		this.status = status;
	}
}

function isNetworkError(error: unknown, seen = new Set<unknown>()): boolean {
	if (error instanceof ProviderTimeoutError) return true;
	if (typeof error !== "object" || error === null || seen.has(error)) return false;
	seen.add(error);
	if ("code" in error && typeof error.code === "string") {
		if (
			["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(error.code)
		) {
			return true;
		}
	}
	if (
		error instanceof Error &&
		(error.message.includes("fetch failed") || error.message.includes("Failed to fetch"))
	) {
		return true;
	}
	return "cause" in error && isNetworkError(error.cause, seen);
}

function parseTokens(value: unknown, now: number): OAuthCredential {
	if (
		typeof value !== "object" ||
		value === null ||
		!("access_token" in value) ||
		typeof value.access_token !== "string" ||
		!value.access_token.trim() ||
		!("refresh_token" in value) ||
		typeof value.refresh_token !== "string" ||
		!value.refresh_token.trim() ||
		!("expires_in" in value) ||
		typeof value.expires_in !== "number" ||
		!Number.isFinite(value.expires_in) ||
		value.expires_in <= 0 ||
		!Number.isFinite(now + value.expires_in * 1000)
	) {
		throw new ClaudeAuthError("invalid OAuth token response", TOKEN_URL);
	}
	return {
		type: "oauth",
		access: value.access_token,
		refresh: value.refresh_token,
		expires: now + value.expires_in * 1000,
	};
}

/** Builds Pi-native auth methods without performing I/O until login or refresh. */
export function claudeAuth(
	deps: { fetch?: FetchFn; now?: () => number; random?: (length: number) => Uint8Array } = {},
): ProviderAuth {
	const fetchFn = deps.fetch ?? fetch;
	const now = deps.now ?? Date.now;

	async function post(
		url: string,
		body: Record<string, string> | undefined,
		secrets: readonly string[],
		signal: AbortSignal,
		headers: Record<string, string> = TOKEN_HEADERS,
	): Promise<unknown> {
		const response = await request(url, {
			provider: "claude",
			fetch: fetchFn,
			now,
			signal,
			secrets,
			method: "POST",
			headers,
			...(body ? { body: JSON.stringify(body) } : {}),
		});
		return response.json();
	}

	function failure(operation: string, endpoint: string, error: unknown): ClaudeAuthError {
		return new ClaudeAuthError(
			operation,
			endpoint,
			error instanceof ProviderHttpError ? error.status : undefined,
		);
	}

	async function login(
		mode: "max" | "console",
		interaction: ProviderAuthInteraction,
	): Promise<OAuthCredential> {
		const { signal } = interaction;
		signal.throwIfAborted();
		const pkce = await createPkce(deps.random);
		const state = randomState(deps.random);
		const url = new URL(
			mode === "max"
				? "https://claude.ai/oauth/authorize"
				: "https://platform.claude.com/oauth/authorize",
		);
		url.search = new URLSearchParams({
			code: "true",
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: REDIRECT_URI,
			scope: SCOPES.join(" "),
			code_challenge: pkce.challenge,
			code_challenge_method: "S256",
			state,
		}).toString();
		signal.throwIfAborted();
		interaction.notify({
			type: "auth_url",
			url: url.toString(),
			instructions: "Paste the authorization code here:",
		});
		const input = await interaction.prompt({
			type: "manual_code",
			message: "Paste the authorization code:",
			signal,
		});
		signal.throwIfAborted();
		const callback = parseCodePaste(input);
		if (!callback || callback.state !== state) {
			throw new ClaudeAuthError("invalid authorization callback or state", REDIRECT_URI);
		}
		try {
			const data = await post(
				TOKEN_URL,
				{
					code: callback.code,
					state,
					grant_type: "authorization_code",
					client_id: CLIENT_ID,
					redirect_uri: REDIRECT_URI,
					code_verifier: pkce.verifier,
				},
				[callback.code, pkce.verifier],
				signal,
			);
			signal.throwIfAborted();
			return parseTokens(data, now());
		} catch (error) {
			signal.throwIfAborted();
			throw failure("authorization exchange failed", TOKEN_URL, error);
		}
	}

	return {
		oauth: {
			name: "Claude Pro/Max",
			loginLabel: "Claude Pro/Max",
			isSubscription: true,
			login: (interaction) => login("max", interaction),
			async refresh(credential, signal) {
				for (let attempt = 0; ; attempt++) {
					signal.throwIfAborted();
					if (attempt > 0) await delay(500 * 2 ** (attempt - 1), undefined, { signal });
					try {
						const data = await post(
							TOKEN_URL,
							{
								grant_type: "refresh_token",
								refresh_token: credential.refresh,
								client_id: CLIENT_ID,
							},
							[credential.refresh, credential.access],
							signal,
						);
						signal.throwIfAborted();
						return { ...credential, ...parseTokens(data, now()) };
					} catch (error) {
						signal.throwIfAborted();
						const retry =
							error instanceof ProviderHttpError
								? error.status >= 500 && error.status < 600
								: isNetworkError(error);
						if (attempt < 2 && retry) continue;
						throw failure("token refresh failed", TOKEN_URL, error);
					}
				}
			},
			toAuth: async (credential) => ({ headers: { Authorization: `Bearer ${credential.access}` } }),
		},
		apiKey: {
			name: "Claude API key",
			async login(interaction) {
				const { signal } = interaction;
				signal.throwIfAborted();
				const method = await interaction.prompt({
					type: "select",
					message: "API key method:",
					signal,
					options: [
						{ id: "manual", label: "Manually enter API Key" },
						{ id: "create", label: "Create an API Key" },
					],
				});
				signal.throwIfAborted();
				if (method === "manual") {
					const key = (
						await interaction.prompt({
							type: "secret",
							message: "Enter Anthropic API key:",
							signal,
						})
					).trim();
					signal.throwIfAborted();
					if (!key) throw new ClaudeAuthError("API key cannot be empty", "manual entry");
					return { type: "api_key", key };
				}
				if (method !== "create") throw new ClaudeAuthError("login cancelled", "API key selection");
				const credential = await login("console", interaction);
				try {
					const data = await post(
						KEY_URL,
						undefined,
						[credential.access, credential.refresh],
						signal,
						{
							"Content-Type": "application/json",
							authorization: `Bearer ${credential.access}`,
						},
					);
					signal.throwIfAborted();
					if (
						typeof data !== "object" ||
						data === null ||
						!("raw_key" in data) ||
						typeof data.raw_key !== "string" ||
						!data.raw_key.trim()
					) {
						throw new ClaudeAuthError("invalid API key creation response", KEY_URL);
					}
					return { type: "api_key", key: data.raw_key };
				} catch (error) {
					signal.throwIfAborted();
					throw failure("API key creation failed", KEY_URL, error);
				}
			},
			async resolve({ ctx, credential, signal }) {
				signal.throwIfAborted();
				if (credential?.key) return { auth: { apiKey: credential.key }, source: "stored API key" };
				const key = await ctx.env("ANTHROPIC_API_KEY");
				signal.throwIfAborted();
				return key ? { auth: { apiKey: key }, source: "ANTHROPIC_API_KEY" } : undefined;
			},
		},
	};
}
