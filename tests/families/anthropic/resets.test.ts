import { describe, expect, test } from "bun:test";
import { decodeOutcome } from "../../../src/bus/decode.ts";
import type { FetchFn } from "../../../src/core/http/index.ts";
import { Registry } from "../../../src/core/registry/index.ts";
import { claudeQuota, parseClaudeQuota } from "../../../src/families/anthropic/quota.ts";
import {
	consumeClaudeResetCredit,
	listClaudeResetCredits,
	parseClaudeResetCredits,
	parseClaudeResetOutcome,
} from "../../../src/families/anthropic/resets.ts";
import {
	describeResetList,
	describeResetOutcome,
	pickResetCredit,
} from "../../../src/quotas/resets.ts";
import type { QuotaFetchContext } from "../../../src/quotas/types.ts";
import usage from "../../fixtures/claude/usage-cedar-ember-full.json";

const NOW = 1_800_000_000_000;
const GRANT = "launch-2610-fable";
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
function context(fetch: FetchFn): QuotaFetchContext {
	return {
		auth: async () => ({ token: "test-token", extra: {} }),
		fetch,
		signal: new AbortController().signal,
		now: () => NOW,
	};
}

describe("Claude reset grants", () => {
	test("polls once for unchanged windows and three grants in server order", async () => {
		const snapshot = parseClaudeQuota(usage, NOW);
		expect(snapshot.resetCredits).toBe(3);
		expect(snapshot.windows).toMatchObject([
			{ id: "7d", usedFraction: 0.28 },
			{ id: "scoped:fable", usedFraction: 0 },
		]);
		expect(snapshot.windows).toEqual(
			parseClaudeQuota({ ...usage, cedar_ember: undefined }, NOW).windows,
		);
		let calls = 0;
		const ctx = context(async (input, init) => {
			calls++;
			expect(String(input)).toBe("https://api.anthropic.com/api/oauth/usage?cedar_ember=1");
			expect(init?.method).toBe("GET");
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
			expect(new Headers(init?.headers).get("anthropic-beta")).toBe("oauth-2025-04-20");
			return Response.json(usage);
		});
		expect(claudeQuota.resets).toEqual({
			list: listClaudeResetCredits,
			consume: consumeClaudeResetCredit,
		});
		const list = await listClaudeResetCredits(ctx);
		expect(calls).toBe(1);
		expect(list.available).toBe(3);
		expect(list.credits.map(({ id, status }) => ({ id, status }))).toEqual([
			{ id: GRANT, status: "available" },
			{ id: "launch-2610-fable-12mo", status: "queued" },
			{ id: "launch-2610-fable-6mo", status: "queued" },
		]);
		expect(list.credits[0]).toMatchObject({
			type: "full",
			grantedAtMs: Date.parse("2026-11-09T18:00:00Z"),
			expiresAtMs: Date.parse("2027-03-09T07:59:00Z"),
		});
		expect(pickResetCredit(list)?.id).toBe(GRANT);
		expect(pickResetCredit(list, "launch-2610-fable-12mo")).toBeUndefined();
		expect(describeResetList(list, new Registry([]))).toContain(
			"clears seven_day_overage_included",
		);
	});

	test("does not invent counts for absent programs and excludes spent or unavailable grants", () => {
		expect(parseClaudeQuota({ seven_day: { utilization: 0 } }, NOW).resetCredits).toBeUndefined();
		expect(parseClaudeResetCredits({ cedar_ember: null }, NOW).available).toBe(0);
		const grants = usage.cedar_ember.grants;
		const list = parseClaudeResetCredits(
			{
				cedar_ember: {
					next_grant_id: GRANT,
					grants: [
						{ ...grants[0], resets_left: 0 },
						{ ...grants[1], paused: true },
						{ ...grants[2], usable_now: false },
					],
				},
			},
			NOW,
		);
		expect(list.available).toBe(0);
		expect(list.credits.map((g) => g.status)).toEqual(["unavailable", "unavailable"]);
		expect(() => parseClaudeResetCredits({ cedar_ember: {} }, NOW)).toThrow("grants[]");
	});

	test.each([
		["reset", "reset"],
		["already_used", "already_redeemed"],
		["not_limited", "nothing_to_reset"],
		["cooldown", "refused"],
		["ineligible", "refused"],
		["unavailable", "refused"],
		["future_result", "refused"],
	] as const)("claims exactly once and maps %s to %s", async (result, code) => {
		let gets = 0;
		let posts = 0;
		const ctx = context(async (input, init) => {
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer test-token");
			if (String(input) === PROFILE_URL) {
				gets++;
				expect(init?.method).toBe("GET");
				return Response.json({
					account: { uuid: "different-account" },
					organization: { uuid: "fake-org" },
				});
			}
			posts++;
			expect(String(input)).toBe(
				"https://api.anthropic.com/api/organizations/fake-org/reset_rate_limits",
			);
			expect(init?.method).toBe("POST");
			expect(headers.get("Content-Type")).toBe("application/json");
			expect(typeof init?.body === "string" ? JSON.parse(init.body) : undefined).toEqual({
				program: "cedar_ember",
				grant_id: GRANT,
				request_id: expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/),
			});
			return Response.json({ result, reason: "cooldown", cleared: ["seven_day_overage_included"] });
		});
		const outcome = await consumeClaudeResetCredit(ctx, GRANT);
		expect(outcome).toEqual({
			provider: "claude",
			creditId: GRANT,
			code,
			reason: "cooldown",
			windowsReset: result === "reset" ? 1 : 0,
		});
		expect(gets).toBe(1);
		expect(posts).toBe(1);
		expect(decodeOutcome(outcome)).toEqual(outcome);
		if (code === "refused") {
			expect(describeResetOutcome(outcome, new Registry([]))).toMatchObject({
				tone: "warning",
				text: expect.stringContaining("cooldown"),
			});
		}
	});

	test.each(["transport", "invalid JSON", "missing result", 500, 429, 401, 403])(
		"claim failure %s never retries or exposes identity",
		async (failure) => {
			let posts = 0;
			const ctx = context(async (input) => {
				if (String(input) === PROFILE_URL)
					return Response.json({ organization: { uuid: "fake-org" } });
				posts++;
				if (failure === "transport") throw new Error("test-token fake-org");
				if (failure === "invalid JSON") return new Response("{");
				if (failure === "missing result") return Response.json({});
				return new Response("test-token fake-org", { status: failure });
			});
			const error: unknown = await consumeClaudeResetCredit(ctx, GRANT).catch(
				(error: unknown) => error,
			);
			expect(error).toBeInstanceOf(Error);
			if (!(error instanceof Error)) throw new Error("Expected error");
			expect(error.message).not.toContain("test-token");
			expect(error.message).not.toContain("fake-org");
			if (failure === 401 || failure === 403) expect(error.message).toContain("/login claude");
			else if (failure === 429) expect(error.message).toContain("rate limited");
			else expect(error.message).toContain("credit may already be spent");
			expect(posts).toBe(1);
		},
	);

	test("rejects invalid selection and missing profile identity before posting", async () => {
		let calls = 0;
		const ctx = context(async () => {
			calls++;
			return Response.json({ account: { uuid: "not-an-org" } });
		});
		await expect(consumeClaudeResetCredit(ctx, "../invalid")).rejects.toThrow(
			"invalid reset grant id",
		);
		expect(calls).toBe(0);
		await expect(consumeClaudeResetCredit(ctx, GRANT)).rejects.toThrow(PROFILE_URL);
		expect(calls).toBe(1);
		expect(() => parseClaudeResetOutcome({}, GRANT)).toThrow("credit may already be spent");
		expect(
			decodeOutcome({
				provider: "claude",
				creditId: GRANT,
				code: "refused",
				windowsReset: 0,
				reason: 3,
			}),
		).toBeUndefined();
	});
});
