/** Exercises Antigravity OAuth through Pi's login and refresh seams. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { ProviderTimeoutError } from "../../../src/core/http/index.ts";
import { AntigravityAuthError, antigravityAuth } from "../../../src/families/google/oauth.ts";

const signal = new AbortController().signal;
const stored: OAuthCredential = {
	type: "oauth",
	access: "test-old-access",
	refresh: "test-old-refresh",
	expires: 0,
};
const tokens = {
	access_token: "test-new-access",
	refresh_token: "test-new-refresh",
	expires_in: 60,
};

function oauth(deps: Parameters<typeof antigravityAuth>[0]) {
	const method = antigravityAuth({ sleep: async () => {}, ...deps }).oauth;
	if (!method) throw new Error("Missing OAuth method");
	return method;
}

function interaction(answer: (url: URL) => string): ProviderAuthInteraction {
	let url: URL;
	return {
		signal,
		notify(event) {
			if (event.type === "auth_url") url = new URL(event.url);
		},
		prompt: async () => answer(url),
	};
}

for (const bare of [false, true]) {
	test(`login accepts ${bare ? "bare code" : "redirect URL"} with seven scopes and S256`, async () => {
		let authUrl: URL | undefined;
		const method = oauth({
			now: () => 1000,
			fetch: async (input, init) => {
				expect(String(input)).toBe("https://oauth2.googleapis.com/token");
				expect(init?.method).toBe("POST");
				expect(new Headers(init?.headers).get("content-type")).toContain(
					"application/x-www-form-urlencoded",
				);
				const body = new URLSearchParams(String(init?.body));
				expect(body.get("code")).toBe("test-code");
				expect(body.get("grant_type")).toBe("authorization_code");
				expect(body.get("client_secret")).toBeTruthy();
				expect(body.get("redirect_uri")).toBe("https://antigravity.google/oauth-callback");
				expect(authUrl?.searchParams.get("code_challenge")).toBe(
					createHash("sha256")
						.update(body.get("code_verifier") ?? "")
						.digest("base64url"),
				);
				return Response.json(tokens);
			},
		});
		const credential = await method.login(
			interaction((url) => {
				authUrl = url;
				expect(url.origin).toBe("https://accounts.google.com");
				expect(url.searchParams.get("scope")?.split(" ")).toEqual([
					"https://www.googleapis.com/auth/cloud-platform",
					"https://www.googleapis.com/auth/userinfo.email",
					"https://www.googleapis.com/auth/userinfo.profile",
					"https://www.googleapis.com/auth/cclog",
					"https://www.googleapis.com/auth/experimentsandconfigs",
					"https://www.googleapis.com/auth/aicode",
					"openid",
				]);
				expect(url.searchParams.get("redirect_uri")).toBe(
					"https://antigravity.google/oauth-callback",
				);
				expect(url.searchParams.get("code_challenge_method")).toBe("S256");
				expect(url.searchParams.get("prompt")).toBe("consent");
				expect(url.searchParams.get("access_type")).toBe("offline");
				return bare
					? "test-code"
					: `https://antigravity.google/oauth-callback?code=test-code&state=${url.searchParams.get("state")}`;
			}),
		);
		expect(credential).toEqual({
			type: "oauth",
			access: tokens.access_token,
			refresh: tokens.refresh_token,
			expires: 61000,
		});
		expect(await method.toAuth(credential)).toEqual({
			headers: { Authorization: `Bearer ${tokens.access_token}` },
		});
	});
}

for (const answer of [
	"test-code#wrong",
	"https://antigravity.google/oauth-callback?code=test-code&state=wrong",
	"?code=test-code&state=wrong",
	"https://antigravity.google/oauth-callback?error=access_denied",
]) {
	test(`refuses invalid callback ${answer}`, async () => {
		let calls = 0;
		const method = oauth({
			fetch: async () => {
				calls++;
				return Response.json(tokens);
			},
		});
		await expect(method.login(interaction(() => answer))).rejects.toBeInstanceOf(
			AntigravityAuthError,
		);
		expect(calls).toBe(0);
	});
}

for (const failure of ["http", "timeout", "network"] as const) {
	test(`refresh retries ${failure} and retains an omitted refresh token`, async () => {
		let calls = 0;
		const method = oauth({
			now: () => 2000,
			fetch: async (_input, init) => {
				const body = new URLSearchParams(String(init?.body));
				expect(body.get("refresh_token")).toBe(stored.refresh);
				if (++calls < 3) {
					if (failure === "timeout")
						throw new ProviderTimeoutError(
							"antigravity",
							"https://oauth2.googleapis.com/token",
							30000,
						);
					if (failure === "network") throw new TypeError("fetch failed");
					return new Response("temporary", { status: 503 });
				}
				return Response.json({ access_token: tokens.access_token, expires_in: 60 });
			},
		});
		expect(await method.refresh(stored, signal)).toEqual({
			...stored,
			access: tokens.access_token,
			expires: 62000,
		});
		expect(calls).toBe(3);
	});
}

for (const status of [400, 503]) {
	test(`refresh bounds retries and redacts HTTP ${status}`, async () => {
		let calls = 0;
		const method = oauth({
			fetch: async () => {
				calls++;
				return new Response(`${stored.access} ${stored.refresh}`, { status });
			},
		});
		try {
			await method.refresh(stored, signal);
			throw new Error("Expected failure");
		} catch (error) {
			expect(error).toBeInstanceOf(AntigravityAuthError);
			if (!(error instanceof AntigravityAuthError)) throw error;
			expect(error.message).toContain(`HTTP ${status}`);
			expect(error.message).toContain("run /login antigravity again");
			expect(error.message).not.toContain(stored.access);
			expect(error.message).not.toContain(stored.refresh);
		}
		expect(calls).toBe(status === 400 ? 1 : 3);
	});
}

test("refresh wraps malformed token responses without retry", async () => {
	let calls = 0;
	const method = oauth({
		fetch: async () => {
			calls++;
			return Response.json({ access_token: stored.access, expires_in: -1 });
		},
	});
	await expect(method.refresh(stored, signal)).rejects.toBeInstanceOf(AntigravityAuthError);
	expect(calls).toBe(1);
});

test("caller abort stops refresh before transport", async () => {
	let calls = 0;
	const method = oauth({
		fetch: async () => {
			calls++;
			return Response.json(tokens);
		},
	});
	const controller = new AbortController();
	controller.abort();
	await expect(method.refresh(stored, controller.signal)).rejects.toBeDefined();
	expect(calls).toBe(0);
});
