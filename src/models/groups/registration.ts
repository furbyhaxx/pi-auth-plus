/** Registers configured groups as Pi virtual models and keeps that registration current. */
import type { Api, AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProviderQuotaSnapshot } from "../../quotas/types.ts";
import { type BalanceCandidate, selectBalancedMember } from "./balance.ts";
import type { GroupMember, ModelGroup } from "./config.ts";
import type { ModelIdentity } from "./priority.ts";
import { createGroupDefinition, type GroupRouteCandidate } from "./route.ts";

/** The live state a group reads while routing. */
export interface GroupRegistrationDeps {
	groups(): readonly ModelGroup[];
	visible?(groupId: string): boolean;
	quota(provider: string): ProviderQuotaSnapshot | undefined;
	/** The member that failed at the previous turn's settlement, once per failure. */
	takeFailed(groupId: string): ModelIdentity | undefined;
	onSwitch?(group: ModelGroup, from: ModelIdentity, to: ModelIdentity): void;
	random?: () => number;
}

/** The latest assistant usage, which prices the next request for balance selection. */
function lastAssistant(messages: readonly Message[]): AssistantMessage | undefined {
	const last = messages.findLast((message) => message.role === "assistant");
	return last?.role === "assistant" ? last : undefined;
}

function balanced(
	candidates: readonly GroupRouteCandidate[],
	previous: ModelIdentity | undefined,
	messages: readonly Message[],
	random: () => number,
): GroupMember | undefined {
	const last = lastAssistant(messages);
	const ranked: BalanceCandidate[] = candidates.map(({ member, model, quota }) => ({
		member,
		model,
		...(quota ? { quota } : {}),
	}));
	const chosen = selectBalancedMember({
		candidates: ranked,
		...(previous ? { previous } : {}),
		...(last ? { usage: last.usage, usageModel: { provider: last.provider, id: last.model } } : {}),
	});
	if (chosen) return chosen;
	if (candidates.length === 0) return undefined;
	return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]
		?.member;
}

/**
 * Registers, replaces and removes virtual models so that `models.groups` is the only source.
 * Registration is safe to repeat: Pi replaces a virtual model registered under the same ids.
 */
export class GroupRegistrations {
	readonly #pi: ExtensionAPI;
	readonly #deps: GroupRegistrationDeps;
	#registered = new Map<string, ModelGroup>();

	constructor(pi: ExtensionAPI, deps: GroupRegistrationDeps) {
		this.#pi = pi;
		this.#deps = deps;
	}

	/** Registers visible groups, optionally sizing each one from the current catalog. */
	apply(catalog: readonly Model<Api>[] = []): void {
		const groups = this.#deps.groups().filter((group) => this.#deps.visible?.(group.id) ?? true);
		const ids = new Set(groups.map((group) => group.id));
		for (const id of this.#registered.keys()) {
			if (ids.has(id)) continue;
			this.#pi.unregisterVirtualModel("group", id);
		}
		const random = this.#deps.random ?? Math.random;
		const next = new Map<string, ModelGroup>();
		for (const group of groups) {
			try {
				this.#pi.registerVirtualModel(
					createGroupDefinition(group, {
						catalog: () => catalog,
						quota: (provider) => this.#deps.quota(provider),
						chooseBalance: (candidates, previous, messages) =>
							balanced(candidates, previous, messages, random),
						takeFailed: (id) => this.#deps.takeFailed(id),
						...(this.#deps.onSwitch
							? {
									onSwitch: (from, to) => {
										const current = next.get(group.id) ?? group;
										this.#deps.onSwitch?.(current, from, to);
									},
								}
							: {}),
						random,
					}),
				);
				next.set(group.id, group);
			} catch {
				// A malformed group must not prevent the others from registering.
			}
		}
		this.#registered = next;
	}

	/** The group ids currently registered as virtual models. */
	get ids(): readonly string[] {
		return [...this.#registered.keys()];
	}
}
