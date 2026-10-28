import { describe, expect, test } from "bun:test";
import { parseGroups } from "../../../src/models/groups/config.ts";

const member = { provider: "provider-a", id: "vendor/model" };
const group = { id: "pool", members: [member] };

describe("parseGroups", () => {
	test("normalizes defaults, priorities, mappings and all supported strategies", () => {
		const raw = [
			{
				...group,
				name: "Pool",
				contextWindow: 12000,
				strategy: "failover",
				triggers: ["auth", "quota"],
				members: [
					{ ...member, tier: 3, cost: "paid", thinking: { off: "minimal", max: "high" } },
					{ provider: "provider-b", id: "vendor/model", cost: "free", thinking: {} },
					{ provider: "provider-c", id: "other", cost: "included" },
				],
			},
			{ ...group, id: "default" },
			{ ...group, id: "balance", strategy: "balance", triggers: [] },
			{ ...group, id: "random", strategy: "random" },
		];
		const original = structuredClone(raw);
		expect(parseGroups(raw)).toEqual([
			{
				id: "pool",
				name: "Pool",
				contextWindow: 12000,
				strategy: "failover",
				triggers: ["auth", "quota"],
				members: [
					{ ...member, tier: 3, cost: "paid", thinking: { off: "minimal", max: "high" } },
					{ provider: "provider-b", id: "vendor/model", tier: 1, cost: "free", thinking: {} },
					{ provider: "provider-c", id: "other", tier: 1, cost: "included" },
				],
			},
			{
				id: "default",
				strategy: "sticky",
				triggers: ["rate-limit", "quota", "auth"],
				members: [{ ...member, tier: 1 }],
			},
			{
				id: "balance",
				strategy: "balance",
				triggers: [],
				members: [{ ...member, tier: 1 }],
			},
			{
				id: "random",
				strategy: "random",
				triggers: ["rate-limit", "quota", "auth"],
				members: [{ ...member, tier: 1 }],
			},
		]);
		expect(raw).toEqual(original);
	});

	test("accepts empty lists and every thinking level", () => {
		expect(parseGroups([])).toEqual([]);
		const thinking = {
			off: "off",
			minimal: "minimal",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		};
		expect(parseGroups([{ ...group, members: [{ ...member, thinking }] }])).toMatchObject([
			{ members: [{ thinking }] },
		]);
	});

	test("rejects duplicate group IDs and physical identities atomically", () => {
		expect(parseGroups([group, group])).toBeUndefined();
		expect(
			parseGroups([group, { id: "other", members: [member, { ...member, tier: 2 }] }]),
		).toBeUndefined();
		expect(
			parseGroups([{ ...group, members: [member, { ...member, provider: "provider-b" }] }]),
		).toHaveLength(1);
	});

	test("rejects malformed fields, mappings, triggers and limits atomically", () => {
		for (const invalid of [
			null,
			{},
			[],
			{ ...group, id: "" },
			{ ...group, id: " " },
			{ ...group, id: "bad/id" },
			{ ...group, name: 1 },
			{ ...group, name: undefined },
			{ ...group, strategy: "unknown" },
			{ ...group, strategy: undefined },
			{ ...group, triggers: ["auth", "auth"] },
			{ ...group, triggers: ["other"] },
			{ ...group, triggers: "auth" },
			{ ...group, triggers: undefined },
			...[0, -1, 1.5, Infinity, NaN, "1", undefined].map((contextWindow) => ({
				...group,
				contextWindow,
			})),
			{ ...group, extra: true },
			{ ...group, members: [] },
			{ ...group, members: null },
			...[
				{ ...member, provider: "" },
				{ ...member, id: " " },
				{ ...member, extra: true },
				{ ...member, cost: "unknown" },
				{ ...member, cost: undefined },
				{ ...member, thinking: null },
				{ ...member, thinking: [] },
				{ ...member, thinking: { other: "high" } },
				{ ...member, thinking: { low: "other" } },
				{ ...member, thinking: { low: undefined } },
				...[0, -1, 1.5, Infinity, NaN, "1", undefined].map((tier) => ({ ...member, tier })),
			].map((entry) => ({ ...group, members: [entry] })),
		]) {
			expect(parseGroups([{ ...group, id: "valid" }, invalid])).toBeUndefined();
		}
		for (const raw of [null, {}, "groups"]) expect(parseGroups(raw)).toBeUndefined();
	});
});
