import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { ProviderHttpError } from "../../../src/core/http/index.ts";
import { Registry } from "../../../src/core/registry/index.ts";
import { createOpenaiFamily } from "../../../src/families/openai/index.ts";
import { openaiQuota } from "../../../src/families/openai/quota.ts";
import type { QuotaAuth, QuotaFetchContext } from "../../../src/quotas/types.ts";
import usage from "../../fixtures/quotas/openai-usage.json";

const NOW = 1_790_000_000_000;
const AUTH: QuotaAuth = { token: "test-token", extra: {} };
function context(body: unknown = usage, auth: QuotaAuth | undefined = AUTH): QuotaFetchContext {
	return {
		auth: async () => auth,
		fetch: async () => Response.json(body),
		signal: new AbortController().signal,
		now: () => NOW,
	};
}
function jwt(account: string): string {
	return `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.signature`;
}

describe("OpenAI quota headers", () => {
	test("matches endpoint identities and skips the captured absent secondary window", async () => {
		const snapshot = openaiQuota.headers?.(
			{
				"x-codex-primary-used-percent": "28",
				"x-codex-primary-window-minutes": "10080",
				"x-codex-primary-reset-at": "1793084764",
				"x-codex-secondary-used-percent": "0",
				"x-codex-secondary-window-minutes": "0",
				"x-codex-secondary-reset-at": "",
				"x-codex-plan-type": "pro",
			},
			NOW,
		);
		expect(snapshot).toMatchObject({
			provider: "codex",
			fetchedAt: NOW,
			source: "headers",
			tier: "pro",
		});
		expect(snapshot?.windows).toEqual(
			(await openaiQuota.fetch(context())).windows.map((w) => ({
				...w,
				usedFraction: 0.28,
				resetAtMs: 1793084764000,
			})),
		);
	});

	test.each([undefined, "", "invalid", "Infinity"])(
		"unknown utilization %s stays visible",
		(raw) => {
			expect(
				openaiQuota.headers?.(
					{
						"x-codex-secondary-reset-at": "1793084764",
						...(raw === undefined ? {} : { "x-codex-secondary-used-percent": raw }),
					},
					NOW,
				)?.windows,
			).toMatchObject([
				{
					id: "secondary",
					shortLabel: "secondary",
					label: "Plan (secondary)",
					usedFraction: undefined,
					resetAtMs: 1793084764000,
					important: true,
				},
			]);
		},
	);

	test("missing and invalid durations do not invent a period or hide unknown usage", () => {
		for (const minutes of ["", "invalid", "Infinity"]) {
			expect(
				openaiQuota.headers?.(
					{
						"x-codex-primary-window-minutes": minutes,
						"x-codex-primary-reset-at": "",
					},
					NOW,
				)?.windows,
			).toMatchObject([
				{
					id: "primary",
					period: undefined,
					usedFraction: undefined,
					resetAtMs: undefined,
				},
			]);
		}
	});

	test("keeps a real zero-used window and clamps percentages", () => {
		expect(
			openaiQuota.headers?.(
				{
					"x-codex-primary-used-percent": "0",
					"x-codex-primary-window-minutes": "300",
					"x-codex-secondary-used-percent": "120",
					"x-codex-secondary-window-minutes": "1440",
				},
				NOW,
			)?.windows,
		).toMatchObject([
			{ id: "primary", period: "5h", usedFraction: 0, resetAtMs: undefined, important: true },
			{ id: "secondary", period: "1d", usedFraction: 1, important: false },
		]);
		expect(
			openaiQuota.headers?.({ "x-codex-primary-used-percent": "-2" }, NOW)?.windows,
		).toMatchObject([{ id: "primary", usedFraction: 0 }]);
	});

	test.each([
		{ "content-type": "application/json" },
		{ "anthropic-ratelimit-unified-5h-utilization": "0.2" },
		{ "x-codex-plan-type": "pro" },
	])("does not claim unrelated headers", (headers) => {
		expect(openaiQuota.headers?.(headers, NOW)).toBeUndefined();
	});
});

describe("OpenAI quota", () => {
	test("contributes Pi ids and aliases without registering a model provider", () => {
		const family = createOpenaiFamily();
		// The family hooks request shaping; it never registers a model provider of its own.
		let providerRegistrations = 0;
		const pi = {
			on: () => () => {},
			registerProvider: () => {
				providerRegistrations++;
			},
		};
		family.register?.(
			pi as never,
			{
				settings: () => ({ get: () => undefined }),
			} as never,
		);
		expect(providerRegistrations).toBe(0);
		const registry = new Registry([family]);
		for (const name of ["codex", "openai", "openai-codex", "chatgpt", "cx", "cox", "oai"]) {
			expect(registry.resolve(name)?.provider.id).toBe("codex");
		}
		expect(openaiQuota).toMatchObject({ kind: "windows", shortLabel: "cox", parserVersion: 1 });
	});

	test("ports the upstream usage case and reset-credit 1, 0, unknown semantics", async () => {
		const snapshot = await openaiQuota.fetch(context());
		expect(snapshot).toMatchObject({
			provider: "codex",
			fetchedAt: NOW,
			source: "endpoint",
			tier: "pro",
			resetCredits: 1,
		});
		expect(snapshot.windows).toEqual([
			{
				id: "primary",
				shortLabel: "7d",
				label: "Plan (7d window)",
				period: "7d",
				scope: undefined,
				usedFraction: 0.27,
				resetAtMs: NOW + 3600_000,
				important: true,
			},
		]);
		for (const count of [0, undefined, -1, "0"]) {
			const result = await openaiQuota.fetch(
				context({ ...usage, rate_limit_reset_credits: { available_count: count } }),
			);
			expect(result.resetCredits).toBe(count === 0 ? 0 : undefined);
		}
	});

	test("preserves secondary and extra window ids, periods, scopes and importance", async () => {
		const snapshot = await openaiQuota.fetch(
			context({
				plan_type: "plus",
				user_id: "private-user",
				account_id: "private-account",
				email: "private@example.test",
				rate_limit: {
					primary_window: null,
					secondary_window: {
						used_percent: 120,
						limit_window_seconds: 18000,
						reset_at: 1790000001,
					},
				},
				additional_rate_limits: [
					{
						limit_name: "Review",
						rate_limit: {
							primary_window: {
								used_percent: -2,
								limit_window_seconds: 3600,
								reset_at: "1790000002000",
							},
						},
					},
					{
						metered_feature: "Search",
						rate_limit: { primary_window: { used_percent: 20, reset_at: "2026-10-28T00:00:00Z" } },
					},
					{ rate_limit: { primary_window: { used_percent: 30 } } },
				],
			}),
		);
		expect(snapshot.windows).toMatchObject([
			{
				id: "secondary",
				shortLabel: "5h",
				important: true,
				usedFraction: 1,
				resetAtMs: 1790000001000,
			},
			{
				id: "extra:Review",
				shortLabel: "1h",
				scope: "review",
				important: false,
				usedFraction: 0,
				resetAtMs: 1790000002000,
			},
			{
				id: "extra:Search",
				shortLabel: "extra:Search",
				scope: "search",
				resetAtMs: Date.parse("2026-10-28T00:00:00Z"),
			},
			{ id: "extra:extra" },
		]);
		expect(JSON.stringify(snapshot)).not.toContain("private");
	});

	test("unknown usage remains undefined and exposed windows remain visible", async () => {
		const result = await openaiQuota.fetch(
			context({
				...usage,
				rate_limit: {
					primary_window: { limit_window_seconds: 18000 },
					secondary_window: { used_percent: 0 },
				},
			}),
		);
		expect(result.windows[0]?.usedFraction).toBeUndefined();
		expect(result.windows[1]?.usedFraction).toBe(0);
		expect(result.windows[1]?.important).toBe(false);
	});

	test("unusable responses fail with endpoint and missing fields", async () => {
		for (const body of [
			{},
			null,
			[],
			{ plan_type: "pro" },
			{ rate_limit: { primary_window: { used_percent: "0" } } },
		]) {
			await expect(openaiQuota.fetch(context(body))).rejects.toThrow(
				"wham/usage missing usable used_percent",
			);
		}
	});

	test("missing credentials and API keys do not issue a request", async () => {
		for (const auth of [
			undefined,
			{ token: "sk-example", extra: {} },
			{ token: "key", extra: { type: "api_key" } },
		]) {
			let calls = 0;
			const ctx = context();
			const snapshot = await openaiQuota.fetch({
				...ctx,
				auth: async () => auth,
				fetch: async () => {
					calls++;
					return Response.json(usage);
				},
			});
			expect(snapshot).toMatchObject({ needsAuth: true, windows: [] });
			expect(snapshot.error).toContain("/login openai");
			expect(calls).toBe(0);
		}
	});

	test("uses Codex headers, prefers extra account id, then decodes JWT", async () => {
		for (const extra of [{ accountId: "explicit" }, { chatgpt_account_id: "explicit" }, {}]) {
			const auth = { token: jwt("from-jwt"), extra };
			const ctx = context(usage, auth);
			await openaiQuota.fetch({
				...ctx,
				fetch: async (url, init) => {
					expect(String(url)).toBe("https://chatgpt.com/backend-api/wham/usage");
					const headers = new Headers(init?.headers);
					expect(headers.get("Authorization")).toBe(`Bearer ${auth.token}`);
					expect(headers.get("User-Agent")).toBe("codex_cli_rs/0.60.0");
					expect(headers.get("originator")).toBe("codex_cli_rs");
					expect(headers.get("Accept")).toBe("application/json");
					expect(headers.get("ChatGPT-Account-Id")).toBe(
						Object.keys(extra).length ? "explicit" : "from-jwt",
					);
					expect(init?.signal).toBeInstanceOf(AbortSignal);
					expect(init?.signal).not.toBe(ctx.signal);
					return Response.json(usage);
				},
			});
		}
	});

	test("missing or malformed JWT claims allow a request without an account header", async () => {
		for (const token of ["opaque", "h.invalid.s", "h.e30.s"]) {
			await openaiQuota.fetch({
				...context(),
				auth: async () => ({ token, extra: {} }),
				fetch: async (_url, init) => {
					expect(new Headers(init?.headers).has("ChatGPT-Account-Id")).toBe(false);
					return Response.json(usage);
				},
			});
		}
	});

	test("401 and 403 direct users to Pi login without retrying", async () => {
		for (const status of [401, 403]) {
			let calls = 0;
			const snapshot = await openaiQuota.fetch({
				...context(),
				fetch: async () => {
					calls++;
					return new Response("rejected", { status });
				},
			});
			expect(snapshot.needsAuth).toBe(true);
			expect(snapshot.error).toContain(`/login openai`);
			expect(snapshot.error).toContain(`HTTP ${status}`);
			expect(calls).toBe(1);
		}
	});

	test("other HTTP errors preserve status and Retry-After", async () => {
		for (const status of [429, 500]) {
			try {
				await openaiQuota.fetch({
					...context(),
					fetch: async () => new Response("hold", { status, headers: { "Retry-After": "12" } }),
				});
				throw new Error("expected HTTP error");
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderHttpError);
				if (!(error instanceof ProviderHttpError)) throw error;
				expect(error.status).toBe(status);
				expect(error.retryAfterMs).toBe(12_000);
			}
		}
	});

	test("invalid JSON identifies the endpoint", async () => {
		await expect(
			openaiQuota.fetch({ ...context(), fetch: async () => new Response("not json") }),
		).rejects.toThrow("wham/usage returned invalid JSON");
	});

	test("caller cancellation reaches the injected transport", async () => {
		const controller = new AbortController();
		const reason = new Error("cancelled");
		await expect(
			openaiQuota.fetch({
				...context(),
				signal: controller.signal,
				fetch: async (_url, init) => {
					controller.abort(reason);
					init?.signal?.throwIfAborted();
					return Response.json(usage);
				},
			}),
		).rejects.toBe(reason);
	});
});
