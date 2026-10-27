import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ProviderHttpError } from "../../../src/core/http/index.ts";
import { claudeQuota, fetchClaudeQuota } from "../../../src/families/anthropic/quota.ts";
import type { QuotaFetchContext } from "../../../src/quotas/types.ts";
import usage from "../../fixtures/quotas/claude-usage.json";

const endpoint = "https://api.anthropic.com/api/oauth/usage";
const now = 1_800_000_000_000;
let ctx: { -readonly [Key in keyof QuotaFetchContext]: QuotaFetchContext[Key] };
beforeEach(() => {
	ctx = {
		auth: async () => ({ token: "test-token", extra: {} }),
		fetch: async () => Response.json(usage),
		signal: new AbortController().signal,
		now: () => now,
	};
});
function respond(body: unknown, status = 200, headers?: Record<string, string>) {
	ctx.fetch = async () =>
		new Response(JSON.stringify(body), { status, ...(headers ? { headers } : {}) });
}
const fetchQuota = () => fetchClaudeQuota(ctx);

test("quota metadata and missing auth", async () => {
	expect(claudeQuota).toMatchObject({
		kind: "windows",
		shortLabel: "cl",
		parserVersion: 1,
		minPollMs: 300_000,
	});
	ctx.auth = async () => undefined;
	ctx.fetch = async () => {
		throw new Error("must not fetch");
	};
	expect(await claudeQuota.fetch(ctx)).toMatchObject({
		provider: "claude",
		fetchedAt: now,
		source: "endpoint",
		needsAuth: true,
		windows: [],
		error: expect.stringContaining("/login claude"),
	});
});
test.each(["different", "same", "missing", "retry-fails", "403"])(
	"401 replay: %s",
	async (scenario) => {
		let calls = 0;
		let authCalls = 0;
		ctx.auth = async () => {
			authCalls++;
			if (authCalls === 1 || scenario === "same") return { token: "test-token", extra: {} };
			return scenario === "missing" ? undefined : { token: "second-token", extra: {} };
		};
		ctx.fetch = async (_input, init) => {
			calls++;
			if (calls === 1) return new Response("", { status: scenario === "403" ? 403 : 401 });
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer second-token");
			return scenario === "retry-fails" ? new Response("", { status: 401 }) : Response.json(usage);
		};
		if (scenario === "different") expect((await fetchQuota()).windows).toHaveLength(3);
		else await expect(fetchQuota()).rejects.toBeInstanceOf(ProviderHttpError);
		expect(calls).toBe(scenario === "different" || scenario === "retry-fails" ? 2 : 1);
	},
);
test.each([
	{},
	{ account: { email: "private@example.test" } },
	{ limits: [{}] },
	{ extra_usage: {} },
])("unrecognized payload fails", async (body) => {
	respond(body);
	await expect(fetchQuota()).rejects.toThrow(endpoint);
	await expect(fetchQuota()).rejects.toThrow("missing");
});
test("missing normalized utilization remains unknown", async () => {
	respond({
		limits: [
			{ kind: "session", group: "session", severity: "normal", is_active: true, resets_at: null },
		],
	});
	expect((await fetchQuota()).windows[0]).toMatchObject({ id: "5h", usedFraction: undefined });
});
describe("Claude usage contract", () => {
	test("normalized limits replace legacy buckets in server order", async () => {
		respond(usage);
		const snapshot = await fetchQuota();
		expect(snapshot.windows.map((w) => w.id)).toEqual(["scoped:fable", "5h", "7d"]);
		expect(snapshot.windows[0]).toMatchObject({
			label: "7d Fable",
			scope: "Fable",
			period: "7d",
			usedFraction: 0.42,
			important: false,
		});
		expect(snapshot.windows[1]?.resetAtMs).toBe(Date.parse("2026-10-26T18:00:00Z"));
		expect(snapshot.windows[2]?.important).toBe(true);
	});
	test("usage request has a ten-second budget", async () => {
		const timeout = spyOn(AbortSignal, "timeout");
		try {
			respond(usage);
			await fetchQuota();
			expect(timeout).toHaveBeenCalledWith(10_000);
		} finally {
			timeout.mockRestore();
		}
	});
	test("plain GET refuses redirects and honors caller cancellation", async () => {
		const controller = new AbortController();
		ctx.fetch = async (input: string | URL | Request, init?: RequestInit) => {
			expect(input).toBe(endpoint);
			expect(init?.method).toBe("GET");
			expect(init?.redirect).toBe("error");
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
			controller.abort();
			expect(init?.signal?.aborted).toBe(true);
			return Response.json(usage);
		};
		await fetchClaudeQuota({ ...ctx, signal: controller.signal });
	});
	test("open kinds, surface scopes, collisions and server importance", async () => {
		const row = {
			kind: "weekly_scoped",
			group: "weekly",
			severity: "normal",
			percent: 15,
			resets_at: null,
			is_active: false,
		};
		respond({
			limits: [
				{ ...row, scope: { surface: { display_name: "Workbench" } } },
				{ ...row, scope: { model: { display_name: "Workbench" } }, is_active: true, percent: 150 },
				{
					...row,
					kind: "future",
					group: "daily",
					severity: "warning",
					scope: { model: { display_name: "Fable" } },
					percent: -10,
				},
				null,
				{},
				{ ...row, percent: null },
				{ ...row, kind: 3 },
				{ ...row, group: null },
				{ ...row, severity: null },
				{ ...row, is_active: "yes" },
				{ ...row, resets_at: 3 },
			],
			five_hour: { utilization: 80 },
		});
		const { windows } = await fetchQuota();
		expect(windows.map((w) => w.id)).toEqual([
			"scoped:workbench",
			"scoped:workbench:1",
			"future:daily",
			"scoped:scoped",
		]);
		expect(windows.map((w) => w.usedFraction)).toEqual([0.15, 1, 0, undefined]);
		expect(windows.map((w) => w.important)).toEqual([false, true, true, false]);
		expect(windows[2]).toMatchObject({ label: "future daily Fable", period: undefined });
	});
	test("scoped rows without a display name retain a generic scoped window", async () => {
		respond({
			limits: [
				{
					kind: "weekly_scoped",
					group: "weekly",
					severity: "normal",
					percent: 10,
					resets_at: null,
					is_active: false,
					scope: null,
				},
			],
		});
		expect((await fetchQuota()).windows[0]).toMatchObject({
			id: "scoped:scoped",
			label: "7d Scoped",
			scope: "Scoped",
			usedFraction: 0.1,
		});
	});
	test("unknown limit kinds need no scope or known group", async () => {
		respond({
			limits: [
				{
					kind: "future",
					group: "custom",
					severity: "normal",
					percent: 10,
					resets_at: null,
					is_active: false,
					scope: null,
				},
			],
		});
		expect((await fetchQuota()).windows[0]).toMatchObject({
			id: "future:custom",
			label: "future custom",
			scope: undefined,
			period: undefined,
			important: false,
		});
	});
	test("invalid JSON has contextual recovery instructions", async () => {
		ctx.fetch = async (_input: string | URL | Request) => new Response("{");
		await expect(fetchQuota()).rejects.toThrow(
			`Claude usage (GET ${endpoint}) returned HTTP 200 with invalid quota JSON; retry`,
		);
	});
	test.each([undefined, []])("legacy fallback when limits are %j", async (limits) => {
		respond({
			limits,
			five_hour: { utilization: 0 },
			seven_day: { utilization: 25 },
			seven_day_opus: { utilization: 40 },
			seven_day_sonnet: { utilization: 50 },
			seven_day_oauth_apps: { utilization: 60 },
		});
		const { windows } = await fetchQuota();
		expect(windows.map((w) => w.id)).toEqual([
			"5h",
			"7d",
			"scoped:opus",
			"scoped:sonnet",
			"scoped:oauth apps",
		]);
		expect(windows.map((w) => w.usedFraction)).toEqual([0, 0.25, 0.4, 0.5, 0.6]);
		expect(windows[0]?.resetAtMs).toBeUndefined();
	});
	test("invalid legacy values and non-cap objects do not invent usage", async () => {
		respond({
			five_hour: { utilization: null },
			seven_day: [],
			seven_day_opus: { utilization: "20" },
			unrelated: { utilization: 40 },
		});
		expect((await fetchQuota()).windows.map((w) => w.usedFraction)).toEqual([undefined, undefined]);
	});
	test("typed dollar caps use provider labels and dollar amounts", async () => {
		respond({
			wattle_ember: { label: "Team budget", utilization: 95, used_dollars: 9.5, limit_dollars: 10 },
			iguana_necktie: { utilization: 10, limit_dollars: 20 },
			invalid: { utilization: 30, limit_dollars: "10" },
			unknown: { limit_dollars: 20, utilization: null },
		});
		const { windows } = await fetchQuota();
		expect(windows[0]).toMatchObject({
			id: "wattle_ember",
			label: "Team budget",
			valueText: "$9.50 / $10",
			usedFraction: 0.95,
			important: true,
		});
		expect(windows[1]).toMatchObject({ label: "$20 cap", valueText: undefined, important: false });
		expect(windows).toHaveLength(3);
		expect(windows[2]?.usedFraction).toBeUndefined();
	});
	test.each([null, 0, -1, "1000"])("extra usage skips invalid cap %j", async (monthly_limit) => {
		respond({ extra_usage: { is_enabled: true, monthly_limit, used_credits: 0 } });
		expect((await fetchQuota()).windows).toEqual([]);
	});
	test("extra usage uses minor units with currency", async () => {
		respond({
			extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: 250, currency: "EUR" },
		});
		expect((await fetchQuota()).windows[0]).toMatchObject({
			usedFraction: 0.25,
			valueText: "EUR 2.50 / EUR 10.00",
		});
		respond({ extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: 0 } });
		expect((await fetchQuota()).windows[0]).toMatchObject({
			usedFraction: 0,
			valueText: "$0.00 / $10.00",
		});
	});
	test("null extra usage uses percent without inventing spent money", async () => {
		respond({
			extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: null, utilization: 42 },
		});
		expect((await fetchQuota()).windows[0]).toMatchObject({
			usedFraction: 0.42,
			valueText: undefined,
		});
		for (const extra_usage of [
			{ is_enabled: false, monthly_limit: 1000, used_credits: 200 },
			{ is_enabled: true, monthly_limit: 1000, used_credits: null, utilization: null },
		]) {
			respond({ extra_usage });
			expect((await fetchQuota()).windows.map((w) => w.usedFraction)).toEqual(
				extra_usage.is_enabled ? [undefined] : [],
			);
		}
	});
	test.each([401, 403, 429, 500])(
		"HTTP %i is a contextual typed error without retries",
		async (status) => {
			let calls = 0;
			ctx.fetch = async (_input: string | URL | Request) => {
				calls++;
				return new Response("", { status, headers: { "Retry-After": "120" } });
			};
			try {
				await fetchQuota();
				throw new Error("expected failure");
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderHttpError);
				if (!(error instanceof ProviderHttpError)) throw error;
				expect(error.status).toBe(status);
				expect(error.retryAfterMs).toBe(120000);
				expect(error.message).toContain(endpoint);
				expect(error.message).toContain("Claude");
				expect(error.message).toContain(String(status));
				expect(error.message).toContain(
					status === 401 ? "/login" : status === 403 || status === 429 ? "rate limited" : "retry",
				);
			}
			expect(calls).toBe(1);
		},
	);
	test("404 is a typed HTTP failure", async () => {
		respond({}, 404);
		await expect(fetchQuota()).rejects.toBeInstanceOf(ProviderHttpError);
	});
	test.each([null, [], "bad"])("malformed body %j is an explicit parse failure", async (body) => {
		respond(body);
		await expect(fetchQuota()).rejects.toThrow("invalid quota JSON");
	});
});
