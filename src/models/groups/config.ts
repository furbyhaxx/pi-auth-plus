/** Pure parsing and validation of model group configuration. */
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

/** A physical model and its group-specific preferences. */
export interface GroupMember {
	readonly provider: string;
	readonly id: string;
	readonly tier: number;
	readonly cost?: "included" | "free" | "paid";
	readonly thinking?: Partial<Record<ModelThinkingLevel, ModelThinkingLevel>>;
}

/** A virtual model group and its ordered physical members. */
export interface ModelGroup {
	readonly id: string;
	readonly name?: string;
	readonly strategy: "sticky" | "failover" | "balance" | "random";
	readonly contextWindow?: number;
	readonly triggers: readonly ("rate-limit" | "quota" | "auth")[];
	readonly members: readonly GroupMember[];
}

const GROUP_FIELDS = new Set(["id", "name", "strategy", "contextWindow", "triggers", "members"]);
const MEMBER_FIELDS = new Set(["provider", "id", "tier", "cost", "thinking"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentity(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isThinkingLevel(value: unknown): value is ModelThinkingLevel {
	return (
		value === "off" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
	);
}

function parseThinking(raw: unknown): GroupMember["thinking"] {
	if (!isRecord(raw)) return undefined;
	const thinking: Partial<Record<ModelThinkingLevel, ModelThinkingLevel>> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!isThinkingLevel(key) || !isThinkingLevel(value)) return undefined;
		thinking[key] = value;
	}
	return thinking;
}

function parseMember(raw: unknown): GroupMember | undefined {
	if (!isRecord(raw) || Object.keys(raw).some((key) => !MEMBER_FIELDS.has(key))) return undefined;
	const { provider, id, tier, cost } = raw;
	if (!isIdentity(provider) || !isIdentity(id)) return undefined;
	if ("tier" in raw && !isPositiveInteger(tier)) return undefined;
	if ("cost" in raw && cost !== "included" && cost !== "free" && cost !== "paid") return undefined;
	const thinking = "thinking" in raw ? parseThinking(raw["thinking"]) : undefined;
	if ("thinking" in raw && thinking === undefined) return undefined;
	return {
		provider,
		id,
		tier: isPositiveInteger(tier) ? tier : 1,
		...(cost === "included" || cost === "free" || cost === "paid" ? { cost } : {}),
		...(thinking === undefined ? {} : { thinking }),
	};
}

function parseGroup(raw: unknown): ModelGroup | undefined {
	if (!isRecord(raw) || Object.keys(raw).some((key) => !GROUP_FIELDS.has(key))) return undefined;
	const { id, name, strategy, contextWindow, members } = raw;
	if (!isIdentity(id) || id.includes("/")) return undefined;
	if ("name" in raw && typeof name !== "string") return undefined;
	if (
		"strategy" in raw &&
		strategy !== "sticky" &&
		strategy !== "failover" &&
		strategy !== "balance" &&
		strategy !== "random"
	)
		return undefined;
	if ("contextWindow" in raw && !isPositiveInteger(contextWindow)) return undefined;
	if (!Array.isArray(members) || members.length === 0) return undefined;

	const triggers: ModelGroup["triggers"][number][] = [];
	if ("triggers" in raw) {
		if (!Array.isArray(raw["triggers"])) return undefined;
		for (const trigger of raw["triggers"]) {
			if (trigger !== "rate-limit" && trigger !== "quota" && trigger !== "auth") return undefined;
			if (triggers.includes(trigger)) return undefined;
			triggers.push(trigger);
		}
	} else {
		triggers.push("rate-limit", "quota", "auth");
	}

	const parsedMembers: GroupMember[] = [];
	const identities = new Map<string, Set<string>>();
	for (const entry of members) {
		const member = parseMember(entry);
		if (!member) return undefined;
		const ids = identities.get(member.provider) ?? new Set<string>();
		if (ids.has(member.id)) return undefined;
		ids.add(member.id);
		identities.set(member.provider, ids);
		parsedMembers.push(member);
	}
	return {
		id,
		...(typeof name === "string" ? { name } : {}),
		strategy:
			strategy === "failover" || strategy === "balance" || strategy === "random"
				? strategy
				: "sticky",
		...(isPositiveInteger(contextWindow) ? { contextWindow } : {}),
		triggers,
		members: parsedMembers,
	};
}

/** Parse the complete group list, rejecting invalid groups without partial results. */
export function parseGroups(raw: unknown): readonly ModelGroup[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const groups: ModelGroup[] = [];
	const ids = new Set<string>();
	for (const entry of raw) {
		const group = parseGroup(entry);
		if (!group || ids.has(group.id)) return undefined;
		ids.add(group.id);
		groups.push(group);
	}
	return groups;
}
