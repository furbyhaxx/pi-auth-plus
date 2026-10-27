import { expect, test } from "bun:test";
import { ProviderHttpError, ProviderTimeoutError } from "../../../src/core/http/index.ts";
import { createGoogleFamily } from "../../../src/families/google/index.ts";
import { antigravityQuota, parseAntigravityQuota } from "../../../src/families/google/quota.ts";
import { cliHeaders } from "../../../src/families/google/transport.ts";
import type { QuotaFetchContext } from "../../../src/quotas/types.ts";
import fullQuota from "../../fixtures/quotas/antigravity-quota.json";
import weeklyOnly from "../../fixtures/quotas/antigravity-weekly-only.json";

function context(body: unknown = fullQuota): QuotaFetchContext {
	return {
		auth: async () => ({ token: "test-token", extra: {} }),
		fetch: async (input) =>
			Response.json(
				String(input).endsWith(":loadCodeAssist")
					? { cloudaicompanionProject: "private-project" }
					: body,
			),
		signal: new AbortController().signal,
		now: () => 1234,
	};
}

test("captured Gemini and Argon buckets have distinct stable template scopes", async () => {
	const snapshot = await antigravityQuota().fetch(context());
	expect(snapshot.windows).toHaveLength(5);
	expect(
		snapshot.windows.filter((window) => window.scope === "gemini").map((window) => window.period),
	).toEqual(["7d", "5h"]);
	expect(snapshot.windows.find((window) => window.scope === "gemini-4-argon")).toMatchObject({
		id: "gemini-argon-wtu-weekly",
		period: "7d",
		usedFraction: 1,
		shortLabel: "arg",
		important: true,
		resetAtMs: Date.parse("2026-10-26T13:39:05Z"),
	});
	expect(snapshot.windows.map((window) => [window.shortLabel, window.important])).toEqual([
		["gem", true],
		["gem:5h", false],
		["3p", true],
		["3p:5h", false],
		["arg", true],
	]);
	expect(snapshot.fetchedAt).toBe(1234);
	expect(snapshot.tier).toBeUndefined();
	expect(JSON.stringify(snapshot)).not.toContain("private-project");
});

test("weekly-only response retains available windows without inventing Argon", async () => {
	const snapshot = await antigravityQuota().fetch(context(weeklyOnly));
	expect(
		snapshot.windows.map((window) => [window.scope, window.period, window.usedFraction]),
	).toEqual([
		["gemini", "7d", 0],
		["3p", "7d", 0],
	]);
});

test("family attaches the versioned quota source", () => {
	expect(createGoogleFamily().providers[0]?.quota).toMatchObject({
		kind: "windows",
		shortLabel: "ag",
		parserVersion: 1,
	});
});

test("missing credentials name Pi login without making requests", async () => {
	const ctx = context();
	const snapshot = await antigravityQuota().fetch({
		...ctx,
		auth: async () => undefined,
		fetch: async () => {
			throw new Error("must not fetch");
		},
	});
	expect(snapshot).toMatchObject({ needsAuth: true, windows: [] });
	expect(snapshot.error).toContain("/login antigravity");
});

test("uses CLI headers, context transport and one project discovery per credential", async () => {
	const sent: { url: string; init: RequestInit | undefined }[] = [];
	const ctx = context();
	const fetch: QuotaFetchContext["fetch"] = async (input, init) => {
		sent.push({ url: String(input), init });
		return ctx.fetch(input, init);
	};
	const source = antigravityQuota();
	await source.fetch({ ...ctx, fetch });
	await source.fetch({ ...ctx, fetch });
	expect(sent.map(({ url }) => url.split(":").at(-1))).toEqual([
		"loadCodeAssist",
		"retrieveUserQuotaSummary",
		"retrieveUserQuotaSummary",
	]);
	for (const { init } of sent) {
		expect(init?.method).toBe("POST");
		expect(new Headers(init?.headers).get("user-agent")).toBe(
			new Headers(cliHeaders()).get("user-agent"),
		);
		expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		expect(init?.signal).not.toBe(ctx.signal);
	}
	expect(JSON.parse(String(sent[1]?.init?.body))).toEqual({ project: "private-project" });
	await source.fetch({ ...ctx, fetch, auth: async () => ({ token: "new-token", extra: {} }) });
	expect(sent.filter(({ url }) => url.endsWith(":loadCodeAssist"))).toHaveLength(2);
});

for (const endpoint of ["loadCodeAssist", "retrieveUserQuotaSummary"]) {
	for (const status of [403, 429, 500]) {
		test(`${endpoint} HTTP ${status} preserves Retry-After`, async () => {
			const ctx = context();
			const source = antigravityQuota();
			const fetch: QuotaFetchContext["fetch"] = async (input, init) =>
				String(input).endsWith(`:${endpoint}`)
					? new Response("unavailable", { status, headers: { "Retry-After": "12" } })
					: ctx.fetch(input, init);
			try {
				await source.fetch({ ...ctx, fetch });
				throw new Error("expected HTTP failure");
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderHttpError);
				expect(error).toMatchObject({ status, retryAfterMs: 12_000 });
			}
		});
	}
}

test("unknown fractions stay unknown and cannot outrank known usage", () => {
	const snapshot = parseAntigravityQuota(
		{
			groups: [
				{
					buckets: [
						{ bucketId: "gemini-weekly", window: "weekly" },
						{ bucketId: "gemini-5h", window: "5h", remainingFraction: 0.8 },
					],
				},
			],
		},
		0,
	);
	expect(snapshot.windows[0]).toMatchObject({ shortLabel: "gem:7d", important: false });
	expect(snapshot.windows[0]?.usedFraction).toBeUndefined();
	expect(snapshot.windows[1]).toMatchObject({ shortLabel: "gem", important: true });
	expect(snapshot.windows[1]?.usedFraction).toBeCloseTo(0.2);
});

test("all unknown windows remain visible without choosing an important bucket", () => {
	const snapshot = parseAntigravityQuota(
		{
			groups: [
				{ buckets: [{ bucketId: "3p-weekly", remainingFraction: null, resetTime: "invalid" }] },
			],
		},
		0,
	);
	expect(snapshot.windows).toHaveLength(1);
	expect(snapshot.windows[0]).toMatchObject({ important: false });
	expect(snapshot.windows[0]?.usedFraction).toBeUndefined();
	expect(snapshot.windows[0]?.valueText).toBeUndefined();
	expect(snapshot.windows[0]?.resetAtMs).toBeUndefined();
});

for (const body of [{}, { groups: [] }, { groups: [{ buckets: [{}] }] }]) {
	test(`unrecognized payload fails explicitly: ${JSON.stringify(body)}`, () => {
		expect(() => parseAntigravityQuota(body, 0)).toThrow(/retrieveUserQuotaSummary.*missing/);
	});
}

test("flat buckets stay grouped and do not duplicate grouped windows", () => {
	const buckets = [
		{ bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.9 },
		{ bucketId: "gemini-5h", window: "5h", remainingFraction: 0.1 },
		{ bucketId: "3p-weekly", window: "weekly", remainingFraction: 1 },
	];
	const snapshot = parseAntigravityQuota({ buckets }, 0);
	expect(snapshot.windows.map((window) => window.shortLabel)).toEqual(["gem:7d", "gem", "3p"]);
	expect(parseAntigravityQuota({ groups: [{ buckets }], buckets }, 0).windows).toHaveLength(3);
});

test("absolute or disabled buckets do not fabricate a percentage", () => {
	const snapshot = parseAntigravityQuota(
		{
			buckets: [
				{ bucketId: "custom-cap", window: "monthly", remainingAmount: "24", disabled: true },
			],
		},
		0,
	);
	expect(snapshot.windows[0]).toMatchObject({ id: "custom-cap", period: "monthly" });
	expect(snapshot.windows[0]?.usedFraction).toBeUndefined();
});

test("failed project discovery is not cached or replaced by a fallback", async () => {
	const ctx = context();
	const source = antigravityQuota();
	let discoveryCalls = 0;
	const fetch: QuotaFetchContext["fetch"] = async (input, init) => {
		if (String(input).endsWith(":loadCodeAssist") && ++discoveryCalls === 1) {
			return new Response("busy", {
				status: 429,
				headers: {
					"Retry-After": "Thu, 01 Jan 1970 00:00:10 GMT",
				},
			});
		}
		return ctx.fetch(input, init);
	};
	await expect(source.fetch({ ...ctx, fetch })).rejects.toMatchObject({
		status: 429,
		retryAfterMs: 8766,
	});
	expect((await source.fetch({ ...ctx, fetch })).windows).toHaveLength(5);
	expect(discoveryCalls).toBe(2);
});

test("a missing project fails instead of making a quota request", async () => {
	let calls = 0;
	await expect(
		antigravityQuota().fetch({
			...context(),
			fetch: async () => {
				calls++;
				return Response.json({});
			},
		}),
	).rejects.toThrow("loadCodeAssist returned no project");
	expect(calls).toBe(1);
});

test("invalid quota JSON names the endpoint", async () => {
	const ctx = context();
	await expect(
		antigravityQuota().fetch({
			...ctx,
			fetch: async (input, init) =>
				String(input).endsWith(":retrieveUserQuotaSummary")
					? new Response("not JSON")
					: ctx.fetch(input, init),
		}),
	).rejects.toThrow(/retrieveUserQuotaSummary.*valid JSON/);
});

test("concurrent refreshes and changing transport closures share credential discovery", async () => {
	const ctx = context();
	const source = antigravityQuota();
	let discoveries = 0;
	const fetch: QuotaFetchContext["fetch"] = async (input, init) => {
		if (String(input).endsWith(":loadCodeAssist")) discoveries++;
		return ctx.fetch(input, init);
	};
	await Promise.all([
		source.fetch({ ...ctx, fetch }),
		source.fetch({ ...ctx, fetch: (input, init) => fetch(input, init) }),
	]);
	expect(discoveries).toBe(1);
});

for (const endpoint of ["loadCodeAssist", "retrieveUserQuotaSummary"]) {
	test(`${endpoint} has a typed 10-second deadline`, async () => {
		const ctx = context();
		const pending = antigravityQuota().fetch({
			...ctx,
			fetch: async (input, init) => {
				if (!String(input).endsWith(`:${endpoint}`)) return ctx.fetch(input, init);
				return new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
						once: true,
					});
				});
			},
		});
		try {
			await pending;
			throw new Error("expected timeout");
		} catch (error) {
			expect(error).toBeInstanceOf(ProviderTimeoutError);
			expect(error).toMatchObject({ provider: "antigravity", timeoutMs: 10_000 });
			expect(error instanceof Error ? error.message : "").toContain(endpoint);
		}
	}, 15_000);
}

test("caller cancellation reaches transport", async () => {
	const controller = new AbortController();
	const ctx = context();
	const pending = antigravityQuota().fetch({
		...ctx,
		signal: controller.signal,
		fetch: async (_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
				controller.abort(new Error("caller stopped"));
			}),
	});
	await expect(pending).rejects.toThrow("caller stopped");
});
