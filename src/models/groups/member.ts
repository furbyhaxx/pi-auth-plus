/** Shared physical-model eligibility for group members. */

/** Exclude virtual APIs and the reserved group provider, even when API metadata is absent. */
export function isPhysicalGroupMember(model: {
	readonly provider: string;
	readonly api?: string;
}): boolean {
	return model.provider !== "group" && model.api !== "pi-virtual";
}
