import { describe, expect, test } from "bun:test";
import type { FetchFn } from "../../../src/core/http/index.ts";
import { openaiQuota } from "../../../src/families/openai/quota.ts";
import {
	consumeOpenaiResetCredit,
	listOpenaiResetCredits,
	parseOpenaiResetCredits,
	parseOpenaiResetOutcome,
} from "../../../src/families/openai/resets.ts";
import type { QuotaAuth, QuotaFetchContext } from "../../../src/quotas/types.ts";
import liveList from "../../fixtures/quotas/openai-reset-credits.json";

const NOW = 1_790_000_000_000;
const AUTH: QuotaAuth = { token: "test-token", extra: { accountId: "account-test-1" } };
const LIST_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

function context(fetch: FetchFn, auth: QuotaAuth | undefined = AUTH): QuotaFetchContext {
	return { auth: async () => auth, fetch, signal: new AbortController().signal, now: () => NOW };
}

describe("OpenAI reset credits", () => {
	test("attaches list and consume to the quota source", () => {
		expect(openaiQuota.resets).toEqual({
			list: listOpenaiResetCredits,
			consume: consumeOpenaiResetCredit,
		});
	});

	test("parses the captured list without inventing optional fields", () => {
		const list = parseOpenaiResetCredits(liveList, NOW);
		expect(list).toMatchObject({ provider: "codex", fetchedAt: NOW, available: 1 });
		expect(list.credits).toEqual([
			{
				id: "RateLimitResetCredit_964ef9f41ca081918e9be9293ca7e29b",
				type: "codex_rate_limits",
				status: "available",
				title: "Full reset",
				description: "Thanks for using Codex! You've been granted one free rate limit reset.",
				grantedAtMs: Date.parse("2026-10-07T23:17:42.446Z"),
				expiresAtMs: Date.parse("2026-11-06T23:17:42.446Z"),
				redeemedAtMs: undefined,
				supportedByPlan: true,
			},
		]);
		expect(
			parseOpenaiResetCredits({ credits: [{ id: "c", status: "available" }] }, NOW),
		).toMatchObject({
			available: 1,
			credits: [
				{
					id: "c",
					type: "unknown",
					status: "available",
					title: undefined,
					description: undefined,
					grantedAtMs: undefined,
					expiresAtMs: undefined,
					redeemedAtMs: undefined,
					supportedByPlan: undefined,
				},
			],
		});
	});

	test.each([undefined, null, "3", -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"invalid available_count %s falls back to available statuses",
		(available_count) => {
			expect(
				parseOpenaiResetCredits(
					{
						available_count,
						credits: [
							{ id: "a", status: "available", is_supported_by_plan: false },
							{ id: "b", status: "redeemed", redeemed_at: 1790000000 },
							{ id: "c", status: "available" },
							{ id: "", status: "available" },
							{ id: "d" },
							null,
						],
					},
					NOW,
				).available,
			).toBe(2);
		},
	);

	test.each([0, 4])("uses the provider's available_count %s", (available_count) => {
		expect(parseOpenaiResetCredits({ ...liveList, available_count }, NOW).available).toBe(
			available_count,
		);
	});

	test("rejects a changed list contract and parses optional values", () => {
		expect(() => parseOpenaiResetCredits({ available_count: 1 }, NOW)).toThrow("credits[]");
		const list = parseOpenaiResetCredits(
			{
				credits: [
					{
						id: "c",
						status: "redeemed",
						reset_type: " ",
						title: "",
						description: null,
						granted_at: "1790000000",
						expires_at: 1790000000000,
						redeemed_at: "2026-10-07T23:17:42.446Z",
						is_supported_by_plan: "false",
					},
				],
			},
			NOW,
		);
		expect(list.credits[0]).toMatchObject({
			type: "unknown",
			title: undefined,
			description: undefined,
			grantedAtMs: NOW,
			expiresAtMs: NOW,
			redeemedAtMs: Date.parse("2026-10-07T23:17:42.446Z"),
			supportedByPlan: undefined,
		});
		expect(list.available).toBe(0);
	});

	test("lists once with the shared usage headers and injected clock", async () => {
		let calls = 0;
		const ctx = context(async (input, init) => {
			calls++;
			expect(String(input)).toBe(LIST_URL);
			expect(init?.method).toBe("GET");
			expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
				authorization: "Bearer test-token",
				"chatgpt-account-id": "account-test-1",
				"user-agent": "codex_cli_rs/0.60.0",
				originator: "codex_cli_rs",
				accept: "application/json",
			});
			return Response.json(liveList);
		});
		expect(await listOpenaiResetCredits(ctx)).toEqual(parseOpenaiResetCredits(liveList, NOW));
		expect(calls).toBe(1);
	});

	test.each([401, 403])("HTTP %s names /login openai", async (status) => {
		for (const consume of [false, true]) {
			let calls = 0;
			const ctx = context(async () => {
				calls++;
				return Response.json({ detail: "nope" }, { status });
			});
			await expect(
				consume ? consumeOpenaiResetCredit(ctx, "c") : listOpenaiResetCredits(ctx),
			).rejects.toThrow(`HTTP ${status}; run /login openai`);
			expect(calls).toBe(1);
		}
	});

	test.each([
		{ token: "sk-test", extra: {} },
		{ token: "key", extra: { type: "api_key" } },
	])("refuses API-key credentials before requesting", async (auth) => {
		let calls = 0;
		const ctx = context(async () => {
			calls++;
			return Response.json(liveList);
		}, auth);
		await expect(listOpenaiResetCredits(ctx)).rejects.toThrow(
			"/quota codex login or /login openai-codex",
		);
		await expect(consumeOpenaiResetCredit(ctx, "c")).rejects.toThrow(
			"/quota codex login or /login openai-codex",
		);
		expect(calls).toBe(0);
	});

	test("refuses missing credentials before requesting", async () => {
		let calls = 0;
		const ctx = {
			...context(async () => {
				calls++;
				return Response.json(liveList);
			}),
			auth: async () => undefined,
		};
		await expect(listOpenaiResetCredits(ctx)).rejects.toThrow("/login openai");
		await expect(consumeOpenaiResetCredit(ctx, "c")).rejects.toThrow("/login openai");
		expect(calls).toBe(0);
	});

	test.each(["reset", "nothing_to_reset", "no_credit", "already_redeemed"])(
		"consumes once and maps %s",
		async (code) => {
			const bodies: unknown[] = [];
			const ctx = context(async (input, init) => {
				expect(String(input)).toBe(`${LIST_URL}/consume`);
				expect(init?.method).toBe("POST");
				expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
				bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
				return Response.json({ code, windows_reset: 2 });
			});
			expect(await consumeOpenaiResetCredit(ctx, "credit-a")).toEqual({
				provider: "codex",
				creditId: "credit-a",
				code,
				windowsReset: 2,
			});
			expect(bodies).toHaveLength(1);
			expect(bodies[0]).toEqual({
				credit_id: "credit-a",
				redeem_request_id: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
				),
			});
			await consumeOpenaiResetCredit(ctx, "credit-a");
			expect(bodies).toHaveLength(2);
			expect(bodies[1]).not.toEqual(bodies[0]);
		},
	);

	test("missing or invalid windows_reset defaults to zero", () => {
		for (const windows_reset of [undefined, -1, "2"]) {
			expect(parseOpenaiResetOutcome({ code: "no_credit", windows_reset }, "c")).toEqual({
				provider: "codex",
				creditId: "c",
				code: "no_credit",
				windowsReset: 0,
			});
		}
	});

	test.each(["transport", "500", "unknown", "invalid JSON"])(
		"%s failure never retries and warns that the credit may be spent",
		async (failure) => {
			let calls = 0;
			const ctx = context(async () => {
				calls++;
				if (failure === "transport")
					throw new TypeError("socket hang up test-token account-test-1");
				if (failure === "500") return new Response("test-token account-test-1", { status: 500 });
				if (failure === "invalid JSON") return new Response("{");
				return Response.json({ code: "maybe" });
			});
			const error = await consumeOpenaiResetCredit(ctx, "c").catch((error: unknown) => error);
			expect(error).toBeInstanceOf(Error);
			if (!(error instanceof Error)) throw new Error("Expected consume to fail");
			expect(error.message).toContain("credit may already be spent");
			expect(error.message).toContain("Check /quotas reset codex before retrying");
			expect(error.message).not.toContain("test-token");
			expect(error.message).not.toContain("account-test-1");
			expect(calls).toBe(1);
		},
	);
});
