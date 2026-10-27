/** Exercises Claude login, refresh, and API-key methods with an isolated transport. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AuthPrompt, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { ClaudeAuthError, claudeAuth } from "../../../src/families/anthropic/oauth.ts";

const signal = new AbortController().signal;
const stored: OAuthCredential = {
	type: "oauth",
	access: "test-old-access",
	refresh: "test-old-refresh",
	expires: 0,
	account: "extra",
	accountUuid: "test-account",
};
const tokens = {
	access_token: "test-new-access",
	refresh_token: "test-new-refresh",
	expires_in: 60,
};

function methods(deps: Parameters<typeof claudeAuth>[0] = {}) {
	const auth = claudeAuth(deps);
	if (!auth.oauth || !auth.apiKey?.login) throw new Error("Missing auth methods");
	return { oauth: auth.oauth, apiKey: auth.apiKey, keyLogin: auth.apiKey.login };
}

function interaction(
	answer: (prompt: AuthPrompt) => string,
	onUrl: (url: URL) => void = () => {},
	loginSignal = signal,
): ProviderAuthInteraction {
	return {
		signal: loginSignal,
		notify(event) {
			if (event.type === "auth_url") onUrl(new URL(event.url));
		},
		prompt: async (prompt) => answer(prompt),
	};
}

test("subscription login sends PKCE, state, scopes and JSON exchange", async () => {
	let url: URL | undefined;
	let calls = 0;
	const { oauth } = methods({
		now: () => 1000,
		random: (length) => new Uint8Array(length).fill(7),
		fetch: async (input, init) => {
			calls++;
			expect(String(input)).toBe("https://platform.claude.com/v1/oauth/token");
			expect(init?.method).toBe("POST");
			expect(new Headers(init?.headers).get("user-agent")).toBe("axios/1.13.6");
			expect(new Headers(init?.headers).get("accept")).toBe("application/json, text/plain, */*");
			const body: unknown = JSON.parse(String(init?.body));
			expect(body).toMatchObject({
				code: "test-code",
				state: url?.searchParams.get("state"),
				grant_type: "authorization_code",
				client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
				redirect_uri: "https://platform.claude.com/oauth/code/callback",
			});
			if (
				typeof body !== "object" ||
				body === null ||
				!("code_verifier" in body) ||
				typeof body.code_verifier !== "string"
			)
				throw new Error("Missing verifier");
			expect(url?.searchParams.get("code_challenge")).toBe(
				createHash("sha256").update(body.code_verifier).digest("base64url"),
			);
			return Response.json({ ...tokens, account: { uuid: "login-account" } });
		},
	});
	const credential = await oauth.login(
		interaction(
			(prompt) => {
				expect(prompt.type).toBe("manual_code");
				expect(prompt.signal).toBe(signal);
				return `test-code#${url?.searchParams.get("state")}`;
			},
			(value) => {
				url = value;
			},
		),
	);
	expect(url?.origin).toBe("https://claude.ai");
	expect(url?.searchParams.get("scope")?.split(" ")).toEqual([
		"org:create_api_key",
		"user:profile",
		"user:inference",
		"user:sessions:claude_code",
		"user:mcp_servers",
		"user:file_upload",
	]);
	expect(url?.searchParams.get("code")).toBe("true");
	expect(url?.searchParams.get("response_type")).toBe("code");
	expect(url?.searchParams.get("code_challenge_method")).toBe("S256");
	expect(credential).toEqual({
		type: "oauth",
		access: tokens.access_token,
		refresh: tokens.refresh_token,
		expires: 61000,
		accountUuid: "login-account",
	});
	expect(await oauth.toAuth(credential)).toEqual({
		headers: {
			Authorization: `Bearer ${tokens.access_token}`,
			"x-auth-plus-account-uuid": "login-account",
		},
	});
	expect(calls).toBe(1);
});

test("token account uuid is stored, forwarded internally and retained on refresh", async () => {
	let response = { ...tokens, account: { uuid: "test-account" } };
	const { oauth } = methods({
		fetch: async () => Response.json(response),
	});
	const credential = await oauth.refresh(stored, signal);
	expect(credential["accountUuid"]).toBe("test-account");
	expect(await oauth.toAuth(credential)).toEqual({
		headers: {
			Authorization: `Bearer ${tokens.access_token}`,
			"x-auth-plus-account-uuid": "test-account",
		},
	});
	response = { ...tokens, account: { uuid: "updated-account" } };
	const updated = await oauth.refresh(credential, signal);
	expect(updated["accountUuid"]).toBe("updated-account");
	const withoutAccount = methods({ fetch: async () => Response.json(tokens) }).oauth;
	expect((await withoutAccount.refresh(updated, signal))["accountUuid"]).toBe("updated-account");
});

test("state mismatch refuses exchange", async () => {
	let calls = 0;
	const { oauth } = methods({
		fetch: async () => {
			calls++;
			return Response.json(tokens);
		},
	});
	await expect(oauth.login(interaction(() => "test-code#wrong-state"))).rejects.toBeInstanceOf(
		ClaudeAuthError,
	);
	expect(calls).toBe(0);
});

test("login abort before and during URL construction never prompts or exchanges", async () => {
	for (const abortDuringRandom of [false, true]) {
		const controller = new AbortController();
		if (!abortDuringRandom) controller.abort();
		const { oauth } = methods({
			random: (length) => {
				controller.abort();
				return new Uint8Array(length);
			},
			fetch: async () => {
				throw new Error("Unexpected fetch");
			},
		});
		await expect(
			oauth.login(
				interaction(
					() => {
						throw new Error("Unexpected prompt");
					},
					() => {
						throw new Error("Unexpected notify");
					},
					controller.signal,
				),
			),
		).rejects.toThrow();
	}
});

test("refresh retries 503 then nested network failure, preserving credential extras", async () => {
	let calls = 0;
	const { oauth } = methods({
		now: () => 2000,
		fetch: async (_input, init) => {
			expect(JSON.parse(String(init?.body))).toEqual({
				grant_type: "refresh_token",
				refresh_token: stored.refresh,
				client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
			});
			calls++;
			if (calls === 1) return new Response("unavailable", { status: 503 });
			if (calls === 2)
				throw new Error("transport", {
					cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }),
				});
			return Response.json(tokens);
		},
	});
	expect(await oauth.refresh(stored, signal)).toEqual({
		...stored,
		access: tokens.access_token,
		refresh: tokens.refresh_token,
		expires: 62000,
	});
	expect(calls).toBe(3);
});

test("400 fails immediately without leaking request or response tokens", async () => {
	let calls = 0;
	const bodySecret = "test-body-token-never-visible";
	const { oauth } = methods({
		fetch: async () => {
			calls++;
			return Response.json(
				{ refresh_token: stored.refresh, access_token: bodySecret },
				{ status: 400 },
			);
		},
	});
	const error: unknown = await oauth.refresh(stored, signal).catch((value: unknown) => value);
	expect(error).toBeInstanceOf(ClaudeAuthError);
	if (!(error instanceof ClaudeAuthError)) throw new Error("Expected typed error");
	expect(error.status).toBe(400);
	expect(error.message).toContain("run /login claude again");
	expect(error.message).not.toContain(stored.refresh);
	expect(error.message).not.toContain(bodySecret);
	expect(calls).toBe(1);
});

test("refresh stops after three failures and ignores non-network errors", async () => {
	for (const retryable of [true, false]) {
		let calls = 0;
		const { oauth } = methods({
			fetch: async () => {
				calls++;
				throw new Error(retryable ? "fetch failed" : "unrelated");
			},
		});
		await expect(oauth.refresh(stored, signal)).rejects.toBeInstanceOf(ClaudeAuthError);
		expect(calls).toBe(retryable ? 3 : 1);
	}
});

test("abort interrupts refresh backoff without another request", async () => {
	const controller = new AbortController();
	let calls = 0;
	const { oauth } = methods({
		fetch: async () => {
			calls++;
			setTimeout(() => controller.abort(), 20);
			return new Response("", { status: 503 });
		},
	});
	await expect(oauth.refresh(stored, controller.signal)).rejects.toThrow();
	expect(calls).toBe(1);
});

test("malformed tokens and JSON are rejected without retries or token text", async () => {
	for (const value of [
		null,
		{},
		{ ...tokens, access_token: "" },
		{ ...tokens, refresh_token: "" },
		{ ...tokens, expires_in: 0 },
		{ ...tokens, expires_in: -1 },
		{ ...tokens, expires_in: "60" },
		{ ...tokens, expires_in: Number.MAX_VALUE },
	]) {
		let calls = 0;
		const { oauth } = methods({
			fetch: async () => {
				calls++;
				return Response.json(value);
			},
		});
		await expect(oauth.refresh(stored, signal)).rejects.toBeInstanceOf(ClaudeAuthError);
		expect(calls).toBe(1);
	}
	const { oauth } = methods({ fetch: async () => new Response("invalid test-secret-json") });
	const error: unknown = await oauth.refresh(stored, signal).catch((value: unknown) => value);
	expect(String(error)).not.toContain("test-secret-json");
});

test("API key manual entry trims keys and refuses empty or cancelled selections", async () => {
	const { keyLogin } = methods();
	expect(
		await keyLogin(interaction((prompt) => (prompt.type === "select" ? "manual" : " test-key "))),
	).toEqual({ type: "api_key", key: "test-key" });
	for (const method of ["manual", "cancel"]) {
		await expect(
			keyLogin(interaction((prompt) => (prompt.type === "select" ? method : " "))),
		).rejects.toBeInstanceOf(ClaudeAuthError);
	}
});

test("API key creation uses console authorization and validates raw_key", async () => {
	for (const valid of [true, false]) {
		let url: URL | undefined;
		let calls = 0;
		const { keyLogin } = methods({
			fetch: async (input, init) => {
				calls++;
				if (calls === 1) return Response.json(tokens);
				expect(String(input)).toBe("https://api.anthropic.com/api/oauth/claude_cli/create_api_key");
				expect(new Headers(init?.headers).get("authorization")).toBe(
					`Bearer ${tokens.access_token}`,
				);
				return Response.json({ raw_key: valid ? "test-created-key" : 42 });
			},
		});
		const pending = keyLogin(
			interaction(
				(prompt) =>
					prompt.type === "select" ? "create" : `test-code#${url?.searchParams.get("state")}`,
				(value) => {
					url = value;
				},
			),
		);
		if (valid) expect(await pending).toEqual({ type: "api_key", key: "test-created-key" });
		else await expect(pending).rejects.toBeInstanceOf(ClaudeAuthError);
		expect(url?.origin).toBe("https://platform.claude.com");
		expect(calls).toBe(2);
	}
});

test("API key resolution prefers stored key then environment, with source labels", async () => {
	const { apiKey } = methods();
	let calls = 0;
	const ctx = {
		env: async (name: string) => {
			calls++;
			expect(name).toBe("ANTHROPIC_API_KEY");
			return "test-env-key";
		},
		fileExists: async () => false,
	};
	expect(
		await apiKey.resolve({ ctx, credential: { type: "api_key", key: "test-stored-key" }, signal }),
	).toEqual({ auth: { apiKey: "test-stored-key" }, source: "stored API key" });
	expect(calls).toBe(0);
	expect(await apiKey.resolve({ ctx, signal })).toEqual({
		auth: { apiKey: "test-env-key" },
		source: "ANTHROPIC_API_KEY",
	});
	expect(
		await apiKey.resolve({ ctx: { ...ctx, env: async () => undefined }, signal }),
	).toBeUndefined();
});
