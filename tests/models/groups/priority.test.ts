import { describe, expect, test } from "bun:test";
import {
	eligiblePriorityCandidates,
	selectPriorityMember,
} from "../../../src/models/groups/priority.ts";

const paid = { provider: "one", id: "shared", tier: 1, cost: "paid" } as const;
const free = { provider: "two", id: "shared", tier: 1, cost: "free" } as const;
const fallback = { provider: "three", id: "fallback", tier: 2, cost: "paid" } as const;

describe("priority group selection", () => {
	test("returns equally ranked paid and free members in group order, regardless of tier order", () => {
		const members = [
			{ member: fallback, eligible: true },
			{ member: paid, eligible: true },
			{ member: free, eligible: true },
		];
		expect(eligiblePriorityCandidates(members)).toEqual([paid, free]);
		expect(selectPriorityMember({ members })).toEqual({
			kind: "selected",
			member: paid,
			candidates: [paid, free],
		});
	});

	test("falls through when every tier-1 member is ineligible", () => {
		const members = [
			{ member: paid, eligible: false },
			{ member: free, eligible: false },
			{ member: fallback, eligible: true },
		];
		expect(selectPriorityMember({ members })).toEqual({
			kind: "selected",
			member: fallback,
			candidates: [fallback],
		});
		expect(
			selectPriorityMember({
				members: [
					{ member: paid, eligible: false },
					{ member: free, eligible: true },
					{ member: fallback, eligible: true },
				],
				failed: free,
			}),
		).toEqual({ kind: "selected", member: fallback, candidates: [fallback] });
	});

	test("keeps a sticky member only within the lowest eligible tier", () => {
		const members = [
			{ member: paid, eligible: true },
			{ member: free, eligible: true },
			{ member: fallback, eligible: true },
		];
		expect(selectPriorityMember({ members, previous: fallback })).toMatchObject({ member: paid });
		expect(selectPriorityMember({ members, previous: free })).toMatchObject({ member: free });
		expect(
			selectPriorityMember({
				members: [
					{ member: free, eligible: false },
					{ member: paid, eligible: true },
				],
				previous: free,
			}),
		).toMatchObject({ member: paid });
	});

	test("excludes the failed provider and id on retry, even when it was sticky", () => {
		const members = [
			{ member: paid, eligible: true },
			{ member: free, eligible: true },
			{ member: fallback, eligible: true },
		];
		expect(selectPriorityMember({ members, failed: paid, previous: paid })).toEqual({
			kind: "selected",
			member: free,
			candidates: [free],
		});
		expect(eligiblePriorityCandidates(members, free)).toEqual([paid]);
	});

	test("reports no eligible member when empty, ineligible, or excluded by retry", () => {
		expect(selectPriorityMember({ members: [] })).toEqual({ kind: "no-eligible", candidates: [] });
		expect(selectPriorityMember({ members: [{ member: paid, eligible: false }] })).toEqual({
			kind: "no-eligible",
			candidates: [],
		});
		expect(
			selectPriorityMember({ members: [{ member: paid, eligible: true }], failed: paid }),
		).toEqual({
			kind: "no-eligible",
			candidates: [],
		});
	});
});
