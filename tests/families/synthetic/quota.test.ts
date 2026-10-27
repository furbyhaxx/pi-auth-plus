import { describe, expect, test } from "bun:test";
import { type FetchFn, ProviderHttpError } from "../../../src/core/http/index.ts";
import { syntheticQuota } from "../../../src/families/synthetic/quota.ts";
import type { QuotaFetchContext } from "../../../src/quotas/types.ts";
import liveQuota from "../../fixtures/quotas/synthetic-quotas.json";

const now = 1_800_000_000_000;
let fetchFn: FetchFn;
const URL = "https://api.synthetic.new/v2/quotas";

function respond(body: unknown, status = 200): void {
	fetchFn = async (_input: string | URL | Request) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		});
}

function context(signal = new AbortController().signal): QuotaFetchContext {
	return {
		auth: async () => ({ token: "test-key", extra: {} }),
		fetch: (...args) => fetchFn(...args),
		signal,
		now: () => now,
	};
}
const fetchQuota = () => syntheticQuota.fetch(context());

describe("Synthetic quotas", () => {
	test("returns login guidance without a request when credentials are missing", async () => {
		const snapshot = await syntheticQuota.fetch({
			...context(),
			auth: async () => undefined,
			fetch: async () => {
				throw new Error("unexpected request");
			},
		});
		expect(snapshot).toMatchObject({
			provider: "synthetic",
			fetchedAt: now,
			source: "endpoint",
			needsAuth: true,
			windows: [],
		});
		expect(snapshot.error).toContain("/login synthetic");
	});

	test("throws typed HTTP failures with seconds and date Retry-After delays", async () => {
		for (const [status, retryAfter] of [
			[403, "7"],
			[429, new Date(now + 9000).toUTCString()],
		] as const) {
			fetchFn = async () =>
				new Response("test-key", { status, headers: { "Retry-After": retryAfter } });
			try {
				await fetchQuota();
				throw new Error("expected HTTP failure");
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderHttpError);
				if (!(error instanceof ProviderHttpError)) throw error;
				expect(error.status).toBe(status);
				expect(error.retryAfterMs).toBe(status === 403 ? 7000 : 9000);
				expect(error.message).not.toContain("test-key");
			}
		}
	});

	test("parses numeric reset timestamps and excludes account metadata", async () => {
		for (const renewsAt of [1_800_000_000, 1_800_000_000_000, "1800000000", "1800000000000"]) {
			respond({
				subscription: { limit: 10, requests: 2, renewsAt },
				tier: "account@example.com",
				account: "account-id",
			});
			const snapshot = await fetchQuota();
			expect(snapshot.windows[0]?.resetAtMs).toBe(now);
			expect(snapshot.tier).toBeUndefined();
			expect(JSON.stringify(snapshot)).not.toContain("account");
		}
	});

	test("parses the captured live response without dropping the primary budgets", async () => {
		respond(liveQuota);
		const snapshot = await fetchQuota();
		expect(snapshot.provider).toBe("synthetic");
		expect(snapshot.fetchedAt).toBe(now);
		expect(snapshot.source).toBe("endpoint");
		expect(snapshot.windows).toHaveLength(3);
		expect(snapshot.windows[0]).toEqual({
			id: "subscription",
			shortLabel: "sub",
			label: "Subscription requests",
			period: undefined,
			usedFraction: 0,
			valueText: "0/500 used",
			resetAtMs: Date.parse(liveQuota.subscription.renewsAt),
			important: true,
		});
		expect(snapshot.windows[1]).toMatchObject({
			id: "7d",
			shortLabel: "7d",
			period: "7d",
			important: true,
			valueText: "16% left",
			resetAtMs: Date.parse(liveQuota.planWeeklyLimit.nextRegenAt),
		});
		expect(snapshot.windows[1]?.usedFraction).toBeCloseTo(0.8400019296346414);
		expect(snapshot.windows[2]).toMatchObject({
			id: "search-1h",
			shortLabel: "srch",
			label: "1h search requests",
			period: "1h",
			scope: "search",
			important: false,
			usedFraction: 0,
			valueText: "0/250 used",
			resetAtMs: Date.parse(liveQuota.search.hourly.renewsAt),
		});
	});

	test("rounds the weekly percentage for display and drops trailing zeros", async () => {
		respond({ planWeeklyLimit: { percentRemaining: 15.5 } });
		const window = (await fetchQuota()).windows[0];
		expect(window?.valueText).toBe("15.5% left");
		expect(window?.usedFraction).toBe(1 - 15.5 / 100);
	});

	test("accepts the documented subscription-only response without inventing a weekly budget", async () => {
		respond({ subscription: { limit: 135, requests: 27 } });
		const snapshot = await fetchQuota();
		expect(snapshot.windows).toHaveLength(1);
		expect(snapshot.windows[0]?.usedFraction).toBeCloseTo(0.2);
		expect(snapshot.windows[0]?.resetAtMs).toBeUndefined();
	});

	test("accepts a missing subscription", async () => {
		respond({ planWeeklyLimit: liveQuota.planWeeklyLimit, search: liveQuota.search });
		expect((await fetchQuota()).windows.map((window) => window.id)).toEqual(["7d", "search-1h"]);
	});

	test("keeps windows with zero limits or absent counts visible with unknown usage", async () => {
		for (const subscription of [{ limit: 0, requests: 0 }, { limit: 500 }, { requests: 2 }]) {
			respond({ subscription, planWeeklyLimit: liveQuota.planWeeklyLimit });
			const windows = (await fetchQuota()).windows;
			expect(windows.map((window) => window.id)).toEqual(["subscription", "7d"]);
			expect(windows[0]?.usedFraction).toBeUndefined();
		}
		for (const hourly of [{ limit: 0, requests: 0 }, { limit: 250 }, { requests: 2 }]) {
			respond({ subscription: liveQuota.subscription, search: { hourly } });
			const windows = (await fetchQuota()).windows;
			expect(windows.map((window) => window.id)).toEqual(["subscription", "search-1h"]);
			expect(windows[1]?.usedFraction).toBeUndefined();
		}
	});

	test("leaves missing weekly fields unknown and rejects nonnumeric percentages", async () => {
		for (const planWeeklyLimit of [{}, { percentRemaining: "16" }, { nextRegenAt: "invalid" }]) {
			respond({ subscription: liveQuota.subscription, planWeeklyLimit });
			const weekly = (await fetchQuota()).windows.find((window) => window.id === "7d");
			expect(weekly?.usedFraction).toBeUndefined();
		}
		respond({ planWeeklyLimit: { percentRemaining: 16 } });
		const window = (await fetchQuota()).windows[0];
		expect(window?.usedFraction).toBeCloseTo(0.84);
		expect(window?.resetAtMs).toBeUndefined();
	});

	test("preserves a past regeneration timestamp and clamps percentages and count ratios", async () => {
		respond({
			subscription: { limit: 100, requests: 200 },
			planWeeklyLimit: { percentRemaining: -10, nextRegenAt: "2020-01-01T00:00:00Z" },
			search: { hourly: { limit: 100, requests: 25 } },
		});
		const snapshot = await fetchQuota();
		expect(snapshot.windows.map((window) => window.usedFraction)).toEqual([1, 1, 0.25]);
		expect(snapshot.windows[1]?.resetAtMs).toBe(Date.parse("2020-01-01T00:00:00Z"));
		respond({ planWeeklyLimit: { percentRemaining: 110 } });
		expect((await fetchQuota()).windows[0]?.usedFraction).toBe(0);
	});

	test("names the provider, endpoint, status and recovery action on HTTP failure", async () => {
		respond({ error: "unauthorized" }, 401);
		await expect(fetchQuota()).rejects.toThrow(
			`synthetic: HTTP 401 from ${URL}: check the Synthetic API key or /login synthetic`,
		);
	});

	test("rejects unrecognized successful bodies with actionable context", async () => {
		for (const body of [null, [], {}, { subscription: "invalid" }]) {
			respond(body);
			await expect(fetchQuota()).rejects.toThrow(
				`Synthetic quotas (GET ${URL}) returned HTTP 200 with an unrecognized quota payload: missing subscription, planWeeklyLimit and search.hourly objects; check the Synthetic API key or /login synthetic`,
			);
		}
	});

	test("rejects invalid JSON with endpoint and recovery context", async () => {
		fetchFn = async (_input: string | URL | Request) => new Response("not JSON");
		await expect(fetchQuota()).rejects.toThrow(
			`Synthetic quotas (GET ${URL}) returned HTTP 200 with invalid quota JSON; check the Synthetic API key or /login synthetic`,
		);
	});

	test("combines the caller cancellation signal with a bounded request signal", async () => {
		const caller = new AbortController();
		let requestSignal: AbortSignal | null | undefined;
		fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
			expect(String(input)).toBe(URL);
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key");
			expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
			expect(init?.method).toBe("GET");
			requestSignal = init?.signal;
			return new Response(JSON.stringify(liveQuota));
		};
		await syntheticQuota.fetch(context(caller.signal));
		expect(requestSignal).toBeInstanceOf(AbortSignal);
		expect(requestSignal).not.toBe(caller.signal);
		caller.abort();
		expect(requestSignal?.aborted).toBe(true);
	});
});
