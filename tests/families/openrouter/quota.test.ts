import { describe, expect, test } from "bun:test";
import { type FetchFn, ProviderHttpError } from "../../../src/core/http/index.ts";
import { createOpenrouterFamily } from "../../../src/families/openrouter/index.ts";
import { openrouterQuota } from "../../../src/families/openrouter/quota.ts";
import type { QuotaFetchContext } from "../../../src/quotas/types.ts";
import liveCredits from "../../fixtures/quotas/openrouter-credits.json";
import liveKey from "../../fixtures/quotas/openrouter-key.json";

function context(credits: unknown, key: unknown): QuotaFetchContext {
	return {
		auth: async () => ({ token: "test-token", extra: {} }),
		fetch: async (url) => Response.json(String(url).endsWith("/credits") ? credits : key),
		signal: new AbortController().signal,
		now: () => 1234,
	};
}

describe("OpenRouter quota", () => {
	test("parses captured credits and uncapped key fixtures", async () => {
		const snapshot = await openrouterQuota.fetch(context(liveCredits, liveKey));
		expect(snapshot.credits?.total).toBe(liveCredits.data.total_credits);
		expect(snapshot.credits?.used).toBe(liveCredits.data.total_usage);
		expect(snapshot.credits?.remaining).toBeCloseTo(4.418321192999883);
		expect(snapshot.credits?.detailText).toBe("day $3.55 · wk $8.58 · mo $132.69");
		expect(snapshot.windows.map((window) => window.id)).toEqual(["credits"]);
	});

	test("honors caller cancellation on both requests", async () => {
		const controller = new AbortController();
		const ctx = context({}, {});
		const signals: AbortSignal[] = [];
		const fetch: FetchFn = async (_url, init) => {
			const signal = init?.signal;
			if (!signal) throw new Error("missing signal");
			signals.push(signal);
			return new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
		};
		const pending = openrouterQuota.fetch({ ...ctx, signal: controller.signal, fetch });
		await Promise.resolve();
		controller.abort(new Error("cancelled"));
		await expect(pending).rejects.toThrow("cancelled");
		expect(signals).toHaveLength(2);
		expect(signals.every((signal) => signal.aborted)).toBe(true);
	});

	test("names the endpoint when JSON is malformed", async () => {
		const ctx = context({}, {});
		await expect(
			openrouterQuota.fetch({ ...ctx, fetch: async () => new Response("not JSON") }),
		).rejects.toThrow("returned invalid JSON");
	});

	test("contributes quotas without registering a Pi provider", () => {
		const family = createOpenrouterFamily();
		expect(family.register).toBeUndefined();
		expect(family.providers).toEqual([
			{ id: "openrouter", label: "OpenRouter", aliases: ["or"], quota: openrouterQuota },
		]);
		expect(openrouterQuota).toMatchObject({ kind: "credits", shortLabel: "or", parserVersion: 1 });
	});

	test("ports the upstream credits and daily/weekly usage example", async () => {
		const ctx = context(
			{ data: { total_credits: 200, total_usage: 79.92 } },
			{ data: { usage_daily: 1.5, usage_weekly: 10.2 } },
		);
		const snapshot = await openrouterQuota.fetch(ctx);
		expect(snapshot.credits?.remaining).toBeCloseTo(120.08);
		expect(snapshot.credits?.detailText).toBe("day $1.50 · wk $10.20");
		expect(snapshot.windows).toEqual([
			{
				id: "credits",
				shortLabel: "cred",
				label: "Account credits",
				usedFraction: 79.92 / 200,
				valueText: "$120.08 left of $200.00",
				important: true,
			},
		]);
		expect(snapshot.fetchedAt).toBe(1234);
	});

	test("unknown remaining is never zero", async () => {
		const snapshot = await openrouterQuota.fetch(context({ data: { total_credits: 200 } }, {}));
		expect(snapshot.credits?.total).toBe(200);
		expect(snapshot.credits?.remaining).toBeUndefined();
		expect(snapshot.credits?.used).toBeUndefined();
	});

	test("rejects key metadata that would otherwise produce an empty snapshot", async () => {
		await expect(
			openrouterQuota.fetch(context({}, { data: { limit: 10, usage: 1 } })),
		).rejects.toThrow("key remaining cap");
	});

	test("requires login without making requests", async () => {
		const ctx = context({}, {});
		const snapshot = await openrouterQuota.fetch({
			...ctx,
			auth: async () => undefined,
			fetch: async () => {
				throw new Error("unexpected request");
			},
		});
		expect(snapshot).toMatchObject({
			needsAuth: true,
			windows: [],
			error: expect.stringContaining("/login openrouter"),
		});
	});

	test("rejects responses without numeric quota fields", async () => {
		await expect(
			openrouterQuota.fetch(
				context(
					{ data: { total_credits: "200" } },
					{ data: { limit: null, limit_remaining: null } },
				),
			),
		).rejects.toThrow("/api/v1/credits");
	});

	test("uses injected transport, authentication and a composed abort signal", async () => {
		const ctx = context({}, {});
		const calls: string[] = [];
		const fetch: FetchFn = async (url, init) => {
			calls.push(String(url));
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
			expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
			expect(init?.signal).not.toBe(ctx.signal);
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			return Response.json({ data: { usage_daily: 1 } });
		};
		await openrouterQuota.fetch({ ...ctx, fetch });
		expect(calls.sort()).toEqual([
			"https://openrouter.ai/api/v1/credits",
			"https://openrouter.ai/api/v1/key",
		]);
	});

	for (const status of [401, 403, 429, 500]) {
		test(`propagates HTTP ${status} even when the other endpoint works`, async () => {
			const ctx = context({}, {});
			try {
				await openrouterQuota.fetch({
					...ctx,
					fetch: async (url) =>
						String(url).endsWith("/credits")
							? new Response("test-token", { status, headers: { "Retry-After": "7" } })
							: Response.json({ data: { usage: 1 } }),
				});
				throw new Error("expected HTTP failure");
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderHttpError);
				if (!(error instanceof ProviderHttpError)) throw error;
				expect(error.status).toBe(status);
				expect(error.retryAfterMs).toBe(7000);
				expect(error.message).not.toContain("test-token");
			}
		});
	}

	test("preserves key cap labels and usage details without exposing identifiers", async () => {
		const snapshot = await openrouterQuota.fetch(
			context(
				{},
				{
					data: {
						limit: 50,
						limit_remaining: 20,
						usage: 30,
						usage_monthly: 8,
						label: "private-label",
						organization_id: "private-org",
						is_free_tier: false,
					},
				},
			),
		);
		expect(snapshot.credits).toMatchObject({
			remaining: 20,
			currency: "$",
			detailText: "mo $8.00",
		});
		expect(snapshot.windows).toEqual([
			{
				id: "key-cap",
				shortLabel: "key",
				label: "Key spend cap",
				scope: "key cap",
				usedFraction: 0.6,
				valueText: "$20.00 left of $50.00",
				important: false,
			},
		]);
		expect(snapshot.tier).toBeUndefined();
		expect(JSON.stringify(snapshot)).not.toContain("private-");
	});

	test("keeps reported zero and clamps exhausted account credits", async () => {
		const snapshot = await openrouterQuota.fetch(
			context({ data: { total_credits: 10, total_usage: 20 } }, { data: { limit_remaining: 0 } }),
		);
		expect(snapshot.credits?.remaining).toBe(0);
		expect(snapshot.windows[0]?.usedFraction).toBe(1);
	});
});
