/** Pure priority-tier selection for physical model group members. */

/** A physical model identity, scoped by provider. */
export interface ModelIdentity {
	readonly provider: string;
	readonly id: string;
}

/** A distinct physical member with a positive integer priority tier. */
export interface PriorityMember extends ModelIdentity {
	readonly tier: number;
}

/** A member paired with its current caller-derived eligibility. */
export interface MemberEligibility<T extends PriorityMember> {
	readonly member: T;
	readonly eligible: boolean;
}

/** Selection either identifies a member or explicitly reports exhaustion. */
export type PrioritySelection<T extends PriorityMember> =
	| { readonly kind: "selected"; readonly member: T; readonly candidates: readonly T[] }
	| { readonly kind: "no-eligible"; readonly candidates: readonly [] };

function sameIdentity(left: ModelIdentity, right: ModelIdentity): boolean {
	return left.provider === right.provider && left.id === right.id;
}

/** Return eligible, nonfailed members in the lowest available tier, in group order. */
export function eligiblePriorityCandidates<T extends readonly MemberEligibility<PriorityMember>[]>(
	members: T,
	failed?: ModelIdentity,
): readonly T[number]["member"][] {
	let lowestTier = Number.POSITIVE_INFINITY;
	let candidates: T[number]["member"][] = [];
	for (const { member, eligible } of members) {
		if (!eligible || (failed && sameIdentity(member, failed))) continue;
		if (member.tier < lowestTier) {
			lowestTier = member.tier;
			candidates = [member];
		} else if (member.tier === lowestTier) {
			candidates.push(member);
		}
	}
	return candidates;
}

/** Prefer the previous member within the lowest eligible tier, otherwise its first member. */
export function selectPriorityMember<
	T extends readonly MemberEligibility<PriorityMember>[],
>(options: {
	readonly members: T;
	readonly previous?: ModelIdentity;
	readonly failed?: ModelIdentity;
}): PrioritySelection<T[number]["member"]> {
	const candidates = eligiblePriorityCandidates(options.members, options.failed);
	const first = candidates[0];
	if (!first) return { kind: "no-eligible", candidates: [] };
	const previous = options.previous;
	const member =
		(previous && candidates.find((candidate) => sameIdentity(candidate, previous))) || first;
	return { kind: "selected", member, candidates };
}
