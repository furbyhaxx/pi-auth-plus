/** Virtual model definitions and safe physical routing for configured groups. */

import type {
	Api,
	AssistantMessage,
	Message,
	Model,
	ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionVirtualModel } from "@earendil-works/pi-coding-agent";
import type { ProviderQuotaSnapshot } from "../../quotas/types.ts";
import type { GroupMember, ModelGroup } from "./config.ts";
import { eligiblePriorityCandidates, type ModelIdentity } from "./priority.ts";

/** A resolved member and its current quota, if known. */
export interface GroupRouteCandidate {
	readonly member: GroupMember;
	readonly model: Model<Api>;
	readonly quota?: ProviderQuotaSnapshot;
}

/** Branch-persistent selection and failures within the current user turn. */
export interface GroupRouteState {
	readonly selected: ModelIdentity;
	readonly failed: readonly ModelIdentity[];
}

/** Dependencies supplied by the registration and recovery coordinator. */
export interface GroupRouteDeps {
	readonly catalog: () => readonly Model<Api>[];
	readonly quota: (provider: string) => ProviderQuotaSnapshot | undefined;
	readonly chooseBalance: (
		candidates: readonly GroupRouteCandidate[],
		previous: ModelIdentity | undefined,
		messages: readonly Message[],
	) => GroupMember | undefined;
	readonly takeFailed?: (groupId: string) => ModelIdentity | undefined;
	readonly onSwitch?: (from: ModelIdentity, to: ModelIdentity) => void;
	readonly random: () => number;
}

function same(left: ModelIdentity, right: ModelIdentity): boolean {
	return left.provider === right.provider && left.id === right.id;
}

function hasOutput(message: AssistantMessage): boolean {
	return message.content.some(
		(part) =>
			part.type === "toolCall" ||
			(part.type === "text"
				? part.text.length > 0 || !!part.textSignature
				: part.thinking.length > 0 || !!part.thinkingSignature || !!part.redacted),
	);
}

/** Classify a configured, no-output error eligible for cross-model recovery. */
export function classifyGroupFailure(
	group: ModelGroup,
	message: AssistantMessage,
): "rate-limit" | "quota" | "auth" | undefined {
	if (message.stopReason !== "error" || hasOutput(message) || !message.errorMessage)
		return undefined;
	const text = message.errorMessage.toLowerCase();
	const status = text.match(/\b[45]\d\d\b/)?.[0];
	if (status && status !== "401" && status !== "403" && status !== "402" && status !== "429")
		return undefined;
	const kind =
		status === "401" || status === "403"
			? "auth"
			: status === "402"
				? "quota"
				: /\b(quota|insufficient[_ -]?(?:quota|credits)|usage limit)\b/.test(text)
					? "quota"
					: status === "429" || /rate[_ -]?limit|too many requests/.test(text)
						? "rate-limit"
						: /unauthori[sz]ed|authentication|invalid[_ -]?api[_ -]?key|missing[_ -]?(?:api[_ -]?)?(?:key|credentials)/.test(
									text,
								)
							? "auth"
							: undefined;
	return kind && group.triggers.includes(kind) ? kind : undefined;
}

function positiveMinimum(values: readonly number[]): number | undefined {
	const positive = values.filter((value) => value > 0 && Number.isFinite(value));
	return positive.length ? Math.min(...positive) : undefined;
}

function healthy(candidate: GroupRouteCandidate, available: readonly Model<Api>[]): boolean {
	return (
		available.some((model) => same(model, candidate.member)) &&
		!candidate.quota?.needsAuth &&
		!candidate.quota?.windows.some(
			(window) => !window.scope && !window.group && (window.usedFraction ?? 0) >= 1,
		)
	);
}

/** Construct a group virtual model; physical models are resolved on each route. */
export function createGroupDefinition(
	group: ModelGroup,
	deps: GroupRouteDeps,
): ExtensionVirtualModel<GroupRouteState> {
	const catalog = deps.catalog();
	const models = group.members.flatMap((member) => {
		const model = catalog.find((entry) => same(entry, member));
		return model ? [model] : [];
	});
	const contextWindow = positiveMinimum([
		...models.map((model) => model.contextWindow),
		...(group.contextWindow ? [group.contextWindow] : []),
	]);
	const maxTokens = positiveMinimum(models.map((model) => model.maxTokens));
	const levels: ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	const supported = new Set(models.flatMap(getSupportedThinkingLevels));
	// With no catalog yet (factory time) Pi clamps whatever the user picks to the routed model.
	const thinkingLevels =
		supported.size === 0 ? levels : levels.filter((level) => supported.has(level));
	return {
		provider: "group",
		id: group.id,
		name: group.name ?? group.id,
		...(contextWindow === undefined ? {} : { contextWindow }),
		...(maxTokens === undefined ? {} : { maxTokens }),
		thinkingLevels,
		route(request, ctx) {
			const candidates: GroupRouteCandidate[] = group.members.flatMap((member) => {
				const model = ctx.modelRegistry.find(member.provider, member.id);
				if (!model || model.api === "pi-virtual") return [];
				const quota = deps.quota(member.provider);
				return [{ member, model, ...(quota ? { quota } : {}) }];
			});
			if (!candidates.length)
				throw new Error(
					`Group ${group.id} has no physical models in the catalog; configure an available member.`,
				);
			const previous =
				request.state?.selected ??
				(request.previous && {
					provider: request.previous.model.provider,
					id: request.previous.model.id,
				});
			const retryFailure =
				request.reason === "retry" &&
				request.failed &&
				classifyGroupFailure(group, request.failed.message)
					? request.failed.model
					: undefined;
			const settledFailure =
				request.reason === "user" || request.reason === "continuation"
					? deps.takeFailed?.(group.id)
					: undefined;
			const failed =
				request.reason === "direct" || (request.reason === "user" && !settledFailure)
					? []
					: [...(request.state?.failed ?? [])];
			const newlyFailed = retryFailure ?? settledFailure;
			if (newlyFailed && !failed.some((identity) => same(identity, newlyFailed)))
				failed.push({ provider: newlyFailed.provider, id: newlyFailed.id });
			const retained = request.reason === "retry" ? (request.failed?.model ?? previous) : previous;
			let selected =
				(request.reason === "continuation" || request.reason === "retry") &&
				!newlyFailed &&
				retained
					? candidates.find((candidate) => same(candidate.member, retained))
					: undefined;
			if (!selected) {
				const remaining = candidates.filter(
					(candidate) => !failed.some((identity) => same(candidate.member, identity)),
				);
				const available = ctx.modelRegistry.getAvailable();
				const healthyCandidates = remaining.filter((candidate) => healthy(candidate, available));
				const pool = healthyCandidates.length ? healthyCandidates : remaining;
				const members = eligiblePriorityCandidates(
					pool.map((candidate) => ({ member: candidate.member, eligible: true })),
				);
				const tier = pool.filter((candidate) =>
					members.some((member) => same(member, candidate.member)),
				);
				let member: GroupMember | undefined;
				if (group.strategy === "sticky" && previous)
					member = members.find((item) => same(item, previous));
				if (group.strategy === "balance")
					member = deps.chooseBalance(tier, previous, request.messages);
				if (group.strategy === "random")
					member =
						members[
							Math.max(0, Math.min(members.length - 1, Math.floor(deps.random() * members.length)))
						];
				selected =
					tier.find((candidate) => member && same(candidate.member, member)) ??
					tier[0] ??
					candidates.find((candidate) => retained && same(candidate.member, retained)) ??
					candidates[0];
			}
			if (!selected)
				throw new Error(
					`Group ${group.id} has no physical models in the catalog; configure an available member.`,
				);
			const identity = { provider: selected.member.provider, id: selected.member.id };
			if (newlyFailed && !same(newlyFailed, identity)) {
				try {
					deps.onSwitch?.(newlyFailed, identity);
				} catch {
					// A notification failure must not block the selected route.
				}
			}
			const nextState =
				request.state &&
				same(request.state.selected, identity) &&
				request.state.failed.length === failed.length &&
				request.state.failed.every((item, index) => {
					const next = failed[index];
					return next && same(item, next);
				})
					? request.state
					: { selected: identity, failed };
			return {
				model: selected.model,
				thinkingLevel: clampThinkingLevel(
					selected.model,
					selected.member.thinking?.[request.thinkingLevel] ?? request.thinkingLevel,
				),
				state: nextState,
			};
		},
	};
}
