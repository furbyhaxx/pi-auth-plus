import { describe, expect, test } from "bun:test";
import { type FetchFn, ProviderHttpError } from "../../../src/core/http/index.ts";
import { createXaiFamily } from "../../../src/families/xai/index.ts";
import { xaiQuota } from "../../../src/families/xai/quota.ts";
import type { QuotaFetchContext } from "../../../src/quotas/types.ts";
import credits from "../../fixtures/quotas/xai-credits.json";
import monthly from "../../fixtures/quotas/xai-monthly.json";

const NOW = Date.parse("2026-10-27T00:00:00Z");
const BASE = "https://cli-chat-proxy.grok.com/v1/billing";

function context(fetch: FetchFn, overrides: Partial<QuotaFetchContext> = {}): QuotaFetchContext {
	return {
		auth: async () => ({ token: "test-token", extra: {} }),
		fetch,
		signal: new AbortController().signal,
		now: () => NOW,
		...overrides,
	};
}

function bodies(creditBody: unknown, monthlyBody: unknown = monthly): FetchFn {
	return async (url) => Response.json(String(url).includes("?") ? creditBody : monthlyBody);
}

describe("families/xai quota", () => {
	test("contributes quota only for Pi's builtin id", () => {
		const family = createXaiFamily();
		expect(family.id).toBe("xai");
		expect(family.register).toBeUndefined();
		expect(family.providers).toEqual([
			{ id: "xai", label: "xAI", aliases: ["grok"], quota: xaiQuota },
		]);
		expect(xaiQuota).toMatchObject({ kind: "windows", shortLabel: "xai", parserVersion: 1 });
	});

	test("ports the weekly source mock and treats the zero monthly fixture as unprovisioned", async () => {
		const calls: string[] = [];
		const ctx = context(async (url, init) => {
			calls.push(String(url));
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
			expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			expect(init?.signal).not.toBe(ctx.signal);
			return bodies(credits)(url, init);
		});
		const snapshot = await xaiQuota.fetch(ctx);
		expect(calls).toEqual([`${BASE}?format=credits`, BASE]);
		expect(snapshot).toMatchObject({
			provider: "xai",
			fetchedAt: NOW,
			source: "endpoint",
			tier: "unified",
		});
		expect(snapshot.windows).toEqual([
			{
				id: "7d",
				shortLabel: "7d",
				label: "7d weekly quota",
				period: "7d",
				scope: undefined,
				usedFraction: 0.12,
				resetAtMs: Date.parse("2026-10-28T00:00:00Z"),
				important: true,
			},
		]);
	});

	test("missing credentials name Pi login without fetching", async () => {
		const snapshot = await xaiQuota.fetch(
			context(
				async () => {
					throw new Error("unexpected fetch");
				},
				{
					auth: async () => undefined,
				},
			),
		);
		expect(snapshot.needsAuth).toBe(true);
		expect(snapshot.windows).toEqual([]);
		expect(snapshot.error).toContain("/login xai");
	});

	test("preserves unknown usage rather than inventing zero", async () => {
		const snapshot = await xaiQuota.fetch(
			context(
				bodies(
					{
						config: { currentPeriod: credits.config.currentPeriod, onDemandCap: { val: 10 } },
					},
					{ config: { monthlyLimit: { val: 20 } } },
				),
			),
		);
		expect(snapshot.windows.map((window) => window.id)).toEqual(["7d", "ondemand", "monthly"]);
		for (const window of snapshot.windows) {
			expect(window.usedFraction).toBeUndefined();
			expect(window.valueText).toBeUndefined();
		}
	});

	test("keeps period labels, dollar units, clamping and importance", async () => {
		const snapshot = await xaiQuota.fetch(
			context(
				bodies(
					{
						config: {
							currentPeriod: { end: "2026-11-01T00:00:00Z", type: "MONTHLY" },
							creditUsagePercent: 120,
							onDemandCap: { val: 10 },
							onDemandUsed: { val: 2.5 },
						},
					},
					{
						config: {
							monthlyLimit: { val: 20 },
							used: { val: 0 },
							billingPeriodEnd: "2026-11-01T00:00:00Z",
						},
					},
				),
			),
		);
		expect(snapshot.windows[0]).toMatchObject({
			id: "period",
			shortLabel: "per",
			period: "1mo",
			usedFraction: 1,
			important: true,
		});
		expect(snapshot.windows[0]?.scope).toBeUndefined();
		expect(snapshot.windows[1]).toMatchObject({
			id: "ondemand",
			shortLabel: "cap",
			usedFraction: 0.25,
			valueText: "$2.50 / $10.00",
			important: false,
		});
		expect(snapshot.windows[2]).toMatchObject({
			id: "monthly",
			shortLabel: "mo",
			usedFraction: 0,
			valueText: "$0.00 / $20.00",
			important: false,
		});
	});

	test("uses a generic current-period scope for other period types", async () => {
		const snapshot = await xaiQuota.fetch(
			context(
				bodies({
					config: {
						currentPeriod: { end: "2026-11-01T00:00:00Z", type: "CUSTOM" },
						creditUsagePercent: -5,
					},
				}),
			),
		);
		expect(snapshot.windows[0]).toMatchObject({
			id: "period",
			scope: "current period",
			usedFraction: 0,
		});
		expect(snapshot.windows[0]?.period).toBeUndefined();
	});

	test("keeps a declared period visible when its reset timestamp is invalid", async () => {
		const snapshot = await xaiQuota.fetch(
			context(
				bodies({
					config: { currentPeriod: { end: "invalid", type: "WEEKLY" }, creditUsagePercent: "12" },
				}),
			),
		);
		expect(snapshot.windows[0]).toMatchObject({ id: "7d", important: true });
		expect(snapshot.windows[0]?.resetAtMs).toBeUndefined();
		expect(snapshot.windows[0]?.usedFraction).toBeUndefined();
	});

	test.each(["1793145600", "1793145600000"])(
		"parses numeric reset timestamps (%s)",
		async (end) => {
			const snapshot = await xaiQuota.fetch(
				context(
					bodies({
						config: { currentPeriod: { end, type: "WEEKLY" }, creditUsagePercent: 0 },
					}),
				),
			);
			expect(snapshot.windows[0]?.resetAtMs).toBe(1793145600000);
			expect(snapshot.windows[0]?.usedFraction).toBe(0);
		},
	);

	test("keeps monthly fallback when credits endpoint fails", async () => {
		const snapshot = await xaiQuota.fetch(
			context(async (url) =>
				String(url).includes("?")
					? new Response("not found", { status: 404 })
					: Response.json({ config: { monthlyLimit: { val: 10 }, used: { val: 4 } } }),
			),
		);
		expect(snapshot.windows[0]).toMatchObject({
			id: "monthly",
			usedFraction: 0.4,
			important: true,
		});
	});

	test("keeps credits fallback when monthly endpoint fails", async () => {
		const snapshot = await xaiQuota.fetch(
			context(async (url) =>
				String(url).includes("?")
					? Response.json(credits)
					: new Response("not found", { status: 404 }),
			),
		);
		expect(snapshot.windows[0]?.usedFraction).toBe(0.12);
	});

	test.each([403, 429])(
		"throws first HTTP failure with Retry-After when both endpoints fail (%s)",
		async (status) => {
			try {
				await xaiQuota.fetch(
					context(
						async () =>
							new Response("test-token", {
								status,
								headers: { "Retry-After": "3" },
							}),
					),
				);
				throw new Error("expected HTTP failure");
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderHttpError);
				if (!(error instanceof ProviderHttpError)) throw error;
				expect(error.status).toBe(status);
				expect(error.url).toBe(`${BASE}?format=credits`);
				expect(error.retryAfterMs).toBe(3000);
				expect(error.message).not.toContain("test-token");
			}
		},
	);

	test("names endpoints and missing fields for unusable payloads", async () => {
		await expect(xaiQuota.fetch(context(bodies({}, monthly)))).rejects.toThrow("monthlyLimit");
		await expect(xaiQuota.fetch(context(bodies({}, monthly)))).rejects.toThrow(BASE);
	});

	test("rejects malformed JSON with endpoint context when neither endpoint is usable", async () => {
		await expect(xaiQuota.fetch(context(async () => new Response("{")))).rejects.toThrow(BASE);
	});

	test("honors caller cancellation", async () => {
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(
			xaiQuota.fetch(
				context(
					async (_url, init) => {
						init?.signal?.throwIfAborted();
						return Response.json(credits);
					},
					{ signal: controller.signal },
				),
			),
		).rejects.toThrow("cancelled");
	});
});
