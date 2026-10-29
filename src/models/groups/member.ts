/** Shared physical-model eligibility and health for group members. */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ProviderQuotaSnapshot } from "../../quotas/types.ts";
import { hasZeroModelRates } from "./balance.ts";

/** Display state and best-effort routing eligibility for a group member. */
export interface GroupMemberHealth {
	readonly state: "healthy" | "unknown" | "unavailable" | "needs-auth" | "exhausted";
	readonly routable: boolean;
}

/** Exclude virtual APIs and the reserved group provider, even when API metadata is absent. */
export function isPhysicalGroupMember(model: {
	readonly provider: string;
	readonly api?: string;
}): boolean {
	return model.provider !== "group" && model.api !== "pi-virtual";
}

/** Report observed member health and best-effort routing eligibility separately. */
export function groupMemberHealth(
	model: Model<Api> | undefined,
	available: boolean,
	quota?: ProviderQuotaSnapshot,
): GroupMemberHealth {
	if (!model || !isPhysicalGroupMember(model) || !available)
		return { state: "unavailable", routable: false };
	if (quota?.needsAuth) return { state: "needs-auth", routable: false };
	if (!quota) return { state: "unknown", routable: true };

	const free = hasZeroModelRates(model);
	let exhausted = false;
	let knownWindow = false;
	for (const window of quota.windows) {
		if (window.scope || window.group || (free && window.id === "credits" && quota.credits))
			continue;
		const fraction = window.usedFraction;
		if (fraction === undefined) continue;
		if (fraction >= 1) exhausted = true;
		if (Number.isFinite(fraction) && fraction >= 0 && fraction < 1) knownWindow = true;
	}
	// Preserve observed exhaustion for routing even when snapshot errors make its state unknown.
	if (quota.error) return { state: "unknown", routable: !exhausted };
	if (exhausted) return { state: "exhausted", routable: false };
	const remaining = quota.credits?.remaining;
	const knownCredits =
		!free && remaining !== undefined && Number.isFinite(remaining) && remaining > 0;
	return { state: knownWindow || knownCredits ? "healthy" : "unknown", routable: true };
}
