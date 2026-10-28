/** Pure quota-aware selection within an already eligible priority tier. */
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ProviderQuotaSnapshot } from "../../quotas/types.ts";
import type { GroupMember } from "./config.ts";
import type { ModelIdentity } from "./priority.ts";

/** An eligible physical member, its model rates and its available quota. */
export interface BalanceCandidate {
	readonly member: GroupMember;
	readonly model: Model<Api>;
	readonly quota?: ProviderQuotaSnapshot | undefined;
}

/** The four observed token categories used for request cost estimation. */
export type BalanceUsage = Pick<
	AssistantMessage["usage"],
	"input" | "output" | "cacheRead" | "cacheWrite"
>;

/** Ordered eligible candidates from one tier and optional previous request context. */
export interface BalanceOptions {
	readonly candidates: readonly BalanceCandidate[];
	readonly previous?: ModelIdentity;
	readonly usage?: BalanceUsage;
}

function nonnegative(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value) && value >= 0;
}

function capacity(
	candidate: BalanceCandidate,
	usage: BalanceUsage | undefined,
): number | undefined {
	const credits = candidate.quota?.credits;
	if (!credits || (credits.currency !== "$" && credits.currency !== "USD")) return undefined;
	if (!nonnegative(credits.remaining)) return undefined;
	if (credits.remaining === 0) return 0;
	if (!usage) return undefined;
	const keys = ["input", "output", "cacheRead", "cacheWrite"] as const;
	if (keys.some((key) => !nonnegative(usage[key]))) return undefined;
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	if (!Number.isFinite(inputTokens)) return undefined;
	let rates = candidate.model.cost;
	let threshold = -1;
	for (const tier of candidate.model.cost.tiers ?? []) {
		if (!nonnegative(tier.inputTokensAbove)) return undefined;
		if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > threshold) {
			rates = tier;
			threshold = tier.inputTokensAbove;
		}
	}
	if (keys.some((key) => !nonnegative(rates[key]))) return undefined;
	const cost = keys.reduce((sum, key) => sum + (usage[key] * rates[key]) / 1_000_000, 0);
	if (!Number.isFinite(cost) || cost <= 0) return undefined;
	const result = credits.remaining / cost;
	return Number.isFinite(result) ? result : undefined;
}

function headroom(candidate: BalanceCandidate): number | undefined {
	const quota = candidate.quota;
	if (!quota) return undefined;
	if (quota.credits) {
		const { remaining, total } = quota.credits;
		if (!nonnegative(remaining) || !nonnegative(total) || total === 0 || remaining > total)
			return undefined;
		return remaining / total;
	}
	let result: number | undefined;
	for (const window of quota.windows) {
		const fraction = window.usedFraction;
		if (window.scope !== undefined || !nonnegative(fraction) || fraction > 1) continue;
		const remaining = 1 - fraction;
		result = result === undefined ? remaining : Math.min(result, remaining);
	}
	return result;
}

/** Select the greatest comparable capacity or headroom, rotating ties and unknowns in order. */
export function selectBalancedMember(options: BalanceOptions): GroupMember | undefined {
	const { candidates, previous, usage } = options;
	if (candidates.length === 0) return undefined;
	const previousIndex = previous
		? candidates.findIndex(
				({ member }) => member.provider === previous.provider && member.id === previous.id,
			)
		: -1;
	const capacities = candidates.map((candidate) => capacity(candidate, usage));
	const values = capacities.every((value) => value !== undefined)
		? capacities
		: candidates.map(headroom);
	const comparable = values.every((value) => value !== undefined);
	const best = comparable ? Math.max(...values.filter((value) => value !== undefined)) : undefined;
	for (let offset = 1; offset <= candidates.length; offset++) {
		const index = (previousIndex + offset) % candidates.length;
		const candidate = candidates[index];
		if (candidate && (best === undefined || values[index] === best)) return candidate.member;
	}
	return undefined;
}
