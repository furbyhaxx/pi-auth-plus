import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { selectBalancedMember } from "../../../src/models/groups/balance.ts";
import type { ProviderQuotaSnapshot, QuotaWindow } from "../../../src/quotas/types.ts";

const usage = { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0 };

function candidate(provider: string, rate: number, quota?: ProviderQuotaSnapshot) {
	const member = { provider, id: "shared", tier: 1 };
	const model: Model<Api> = {
		...member,
		name: provider,
		api: "openai-completions",
		baseUrl: "https://example.invalid",
		input: ["text"],
		cost: { input: rate, output: rate, cacheRead: rate, cacheWrite: rate },
		reasoning: false,
		contextWindow: 100_000,
		maxTokens: 1_000,
	};
	return { member, model, quota };
}

function credits(
	provider: string,
	remaining: number,
	total?: number,
	currency = "$",
): ProviderQuotaSnapshot {
	return {
		provider,
		fetchedAt: 0,
		source: "endpoint",
		credits: { remaining, total, currency },
		windows: [],
	};
}

function windows(
	provider: string,
	...entries: Array<{ usedFraction: number; scope?: string; group?: string }>
): ProviderQuotaSnapshot {
	const windows: QuotaWindow[] = entries.map((entry, index) => ({
		id: String(index),
		shortLabel: "quota",
		label: "quota",
		...entry,
	}));
	return { provider, fetchedAt: 0, source: "endpoint", windows };
}

describe("balance group selection", () => {
	test("compares estimated payable requests rather than balances", () => {
		const a = candidate("a", 10, credits("a", 10));
		const b = candidate("b", 200, credits("b", 50));
		expect(selectBalancedMember({ candidates: [a, b], usage, previous: a.member })).toBe(a.member);
	});

	test("uses cache read and write rates and model cost tiers", () => {
		const a = candidate("a", 1, credits("a", 10));
		const b = candidate("b", 1, credits("b", 10));
		a.model.cost.cacheRead = 100;
		b.model.cost.cacheWrite = 100;
		const sample = { input: 1, output: 0, cacheRead: 2_000, cacheWrite: 100 };
		expect(
			selectBalancedMember({
				candidates: [a, b],
				usage: sample,
				usageModel: a.member,
				previous: a.member,
			}),
		).toBe(b.member);
		expect(
			selectBalancedMember({
				candidates: [a, b],
				usage: { ...sample, cacheRead: 100, cacheWrite: 2_000 },
				previous: b.member,
				usageModel: b.member,
			}),
		).toBe(a.member);
		b.model.cost.tiers = [
			{ inputTokensAbove: 1_000, input: 1, output: 1, cacheRead: 200, cacheWrite: 100 },
		];
		expect(
			selectBalancedMember({
				candidates: [a, b],
				usage: sample,
				usageModel: b.member,
				previous: b.member,
			}),
		).toBe(a.member);
	});

	test("does not use another model's cache rates for a switch", () => {
		const a = candidate("a", 10, credits("a", 10));
		const b = candidate("b", 10, credits("b", 20));
		a.model.cost.cacheRead = 1;
		b.model.cost.cacheRead = 1;
		const sample = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 };
		expect(
			selectBalancedMember({
				candidates: [a, b],
				previous: a.member,
				usage: sample,
				usageModel: a.member,
			}),
		).toBe(a.member);
		expect(selectBalancedMember({ candidates: [a, b], previous: a.member, usage: sample })).toBe(
			b.member,
		);
	});

	test("does not score unrelated model-group windows as plan-wide", () => {
		const a = candidate("a", 1, windows("a", { usedFraction: 1, group: "Gemini Models" }));
		const b = candidate("b", 1, windows("b", { usedFraction: 0.5 }));
		expect(selectBalancedMember({ candidates: [a, b], previous: b.member })).toBe(a.member);
	});

	test("does not invent request size or convert unknown currencies", () => {
		const a = candidate("a", 10, credits("a", 10));
		const b = candidate("b", 200, credits("b", 50));
		expect(selectBalancedMember({ candidates: [a, b], previous: a.member })).toBe(b.member);
		const eur = candidate("b", 200, credits("b", 50, undefined, "EUR"));
		expect(selectBalancedMember({ candidates: [a, eur], previous: a.member, usage })).toBe(
			eur.member,
		);
	});

	test("compares restrictive plan-wide fractions separately from credit fractions", () => {
		const a = candidate(
			"a",
			1,
			windows(
				"a",
				{ usedFraction: 0.1 },
				{ usedFraction: 0.9 },
				{ usedFraction: 1, scope: "search" },
			),
		);
		const b = candidate("b", 1, credits("b", 30, 100));
		expect(selectBalancedMember({ candidates: [a, b], previous: b.member })).toBe(a.member);
		const c = candidate(
			"c",
			1,
			windows("c", { usedFraction: 0.2 }, { usedFraction: 1, scope: "search" }),
		);
		expect(selectBalancedMember({ candidates: [a, c] })).toBe(c.member);
		const d = candidate("d", 1, credits("d", 90, 100));
		expect(selectBalancedMember({ candidates: [b, d] })).toBe(d.member);
	});

	test("round-robins incomplete and incomparable data, including provider in identity", () => {
		const a = candidate("a", 1, windows("a", { usedFraction: 0.1 }));
		const b = candidate("b", 1, credits("b", 50));
		const c = candidate("c", 1);
		expect(selectBalancedMember({ candidates: [a, b, c], usage, previous: b.member })).toBe(
			c.member,
		);
		expect(selectBalancedMember({ candidates: [a, b, c], usage, previous: c.member })).toBe(
			a.member,
		);
		expect(
			selectBalancedMember({ candidates: [a, b], previous: { provider: "other", id: "shared" } }),
		).toBe(a.member);
		expect(selectBalancedMember({ candidates: [] })).toBeUndefined();
	});

	test("rotates ties and recognizes zero USD credit without a sample", () => {
		const a = candidate("a", 1, credits("a", 0));
		const b = candidate("b", 1, credits("b", 0));
		expect(selectBalancedMember({ candidates: [a, b], previous: a.member })).toBe(b.member);
		const c = candidate("c", 1, credits("c", 1));
		expect(selectBalancedMember({ candidates: [a, c], usage, previous: c.member })).toBe(c.member);
	});

	test("invalid counts, rates and fractions remain unknown", () => {
		const a = candidate("a", 1, credits("a", 10));
		const b = candidate("b", 1, credits("b", 20));
		expect(
			selectBalancedMember({
				candidates: [a, b],
				usage: { ...usage, cacheRead: Number.NaN },
				previous: b.member,
			}),
		).toBe(a.member);
		b.model.cost.input = -1;
		expect(selectBalancedMember({ candidates: [a, b], usage, previous: b.member })).toBe(a.member);
		const c = candidate("c", 1, windows("c", { usedFraction: 2 }));
		const d = candidate("d", 1, windows("d", { usedFraction: 0.5 }));
		expect(selectBalancedMember({ candidates: [c, d], previous: d.member })).toBe(c.member);
	});
});
