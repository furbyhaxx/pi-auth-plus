import { describe, expect, test } from "bun:test";
import { ProviderHttpError } from "../../../src/core/http/index.ts";
import { Registry } from "../../../src/core/registry/index.ts";
import { createDeepseekFamily } from "../../../src/families/deepseek/index.ts";
import { deepseekQuota, parseDeepseekBalance } from "../../../src/families/deepseek/quota.ts";
import type { QuotaFetchContext } from "../../../src/quotas/types.ts";
import balance from "../../fixtures/quotas/deepseek-balance.json";

const NOW = 1_800_000_000_000;
const ENDPOINT = "https://api.deepseek.com/user/balance";

function context(overrides: Partial<QuotaFetchContext> = {}): QuotaFetchContext {
	return {
		auth: async () => ({ token: "test-token", extra: {} }),
		fetch: async () => Response.json(balance),
		signal: new AbortController().signal,
		now: () => NOW,
		...overrides,
	};
}

describe("DeepSeek quota", () => {
	test("contributes quotas and aliases without registering the builtin", () => {
		const family = createDeepseekFamily();
		expect(family.register).toBeUndefined();
		expect(new Registry([family]).resolve("ds")?.provider).toEqual({
			id: "deepseek",
			label: "DeepSeek",
			aliases: ["ds"],
			quota: deepseekQuota,
		});
		expect(deepseekQuota).toMatchObject({ kind: "credits", shortLabel: "ds", parserVersion: 1 });
	});

	test("ports the upstream balance and shapes the authenticated request", async () => {
		const controller = new AbortController();
		const snapshot = await deepseekQuota.fetch(
			context({
				signal: controller.signal,
				fetch: async (input, init) => {
					const request = new Request(input instanceof Request ? input.url : String(input), init);
					expect(request.url).toBe(ENDPOINT);
					expect(request.method).toBe("GET");
					expect(request.headers.get("authorization")).toBe("Bearer test-token");
					expect(request.headers.get("accept")).toBe("application/json");
					expect(init?.signal).not.toBe(controller.signal);
					controller.abort();
					expect(init?.signal?.aborted).toBe(true);
					return Response.json(balance);
				},
			}),
		);
		expect(snapshot).toEqual({
			provider: "deepseek",
			fetchedAt: NOW,
			source: "endpoint",
			windows: [],
			credits: { remaining: 13.2, currency: "$", detailText: "granted $5.00 · topped-up $8.20" },
		});
	});

	test("missing auth points to Pi login without fetching", async () => {
		const snapshot = await deepseekQuota.fetch(
			context({
				auth: async () => undefined,
				fetch: async () => {
					throw new Error("must not fetch");
				},
			}),
		);
		expect(snapshot).toMatchObject({ needsAuth: true, windows: [], provider: "deepseek" });
		expect(snapshot.error).toContain("/login deepseek");
	});

	test.each([403, 429, 503])("HTTP %s preserves status and Retry-After", async (status) => {
		try {
			await deepseekQuota.fetch(
				context({
					fetch: async () => new Response("retry", { status, headers: { "Retry-After": "7" } }),
				}),
			);
			throw new Error("expected HTTP failure");
		} catch (error) {
			expect(error).toBeInstanceOf(ProviderHttpError);
			expect(error).toMatchObject({ status, retryAfterMs: 7000, url: ENDPOINT });
		}
	});

	test("invalid JSON reports the endpoint and recovery", async () => {
		await expect(
			deepseekQuota.fetch(
				context({
					fetch: async () => new Response("not JSON"),
				}),
			),
		).rejects.toThrow(`deepseek: invalid JSON from ${ENDPOINT}; retry the balance request`);
	});

	test("prefers USD and otherwise uses CNY", () => {
		const cny = { currency: "CNY", total_balance: "0" };
		expect(
			parseDeepseekBalance({ balance_infos: [cny, ...balance.balance_infos] }, NOW).credits
				?.remaining,
		).toBe(13.2);
		expect(
			parseDeepseekBalance({ is_available: false, balance_infos: [cny] }, NOW).credits,
		).toEqual({
			remaining: 0,
			currency: "¥",
			detailText: undefined,
		});
	});

	test.each([undefined, null, "", "invalid", "Infinity", "12oops"])(
		"unknown total %s stays undefined when another balance is usable",
		(total_balance) => {
			const snapshot = parseDeepseekBalance(
				{
					balance_infos: [{ currency: "USD", total_balance, granted_balance: "5" }],
				},
				NOW,
			);
			expect(snapshot.credits?.remaining).toBeUndefined();
			expect(snapshot.credits?.detailText).toBe("granted $5.00");
		},
	);

	test.each([
		null,
		{},
		{ balance_infos: [] },
		{ balance_infos: [null] },
		{ balance_infos: [{ currency: "USD", total_balance: "invalid" }] },
		{ balance_infos: [{ total_balance: "10" }] },
	])("rejects unusable payload %j", (body) => {
		expect(() => parseDeepseekBalance(body, NOW)).toThrow(ENDPOINT);
		expect(() => parseDeepseekBalance(body, NOW)).toThrow("missing");
	});

	test("partial top-up does not invent a grant or total", () => {
		const snapshot = parseDeepseekBalance(
			{
				balance_infos: [{ currency: "USD", topped_up_balance: "2.50" }],
			},
			NOW,
		);
		expect(snapshot.credits?.remaining).toBeUndefined();
		expect(snapshot.credits?.detailText).toBe("topped-up $2.50");
		expect(snapshot.tier).toBeUndefined();
	});
});
