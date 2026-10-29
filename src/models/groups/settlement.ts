/** Safe, bounded group failover at the final agent settlement boundary. */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelGroup } from "./config.ts";
import { isPhysicalGroupMember } from "./member.ts";
import type { ModelIdentity } from "./priority.ts";
import { classifyGroupFailure } from "./route.ts";
import { readGroupRouteFailures } from "./state.ts";

interface Pending {
	readonly groupId: string;
	readonly entryId: string;
	readonly message: AssistantMessage;
}

function same(left: ModelIdentity, right: ModelIdentity): boolean {
	return left.provider === right.provider && left.id === right.id;
}

/** Register settlement recovery and return the one-shot failed-member queue for group routing. */
export function registerGroupSettlement(
	pi: ExtensionAPI,
	groups: () => readonly ModelGroup[],
): { takeFailed(groupId: string): ModelIdentity | undefined } {
	let pending: Pending | undefined;
	const failed = new Map<string, ModelIdentity[]>();
	const queue = new Map<string, ModelIdentity>();
	const clear = () => {
		pending = undefined;
		failed.clear();
		queue.clear();
	};
	pi.on("before_agent_start", clear);
	pi.on("session_start", clear);
	pi.on("session_shutdown", clear);
	pi.on("session_before_switch", clear);
	pi.on("session_tree", clear);
	pi.on("model_select", clear);

	function eligible(group: ModelGroup, message: AssistantMessage, ctx: ExtensionContext): boolean {
		const identity = { provider: message.provider, id: message.model };
		if (!group.members.some((member) => same(member, identity))) return false;
		if (!classifyGroupFailure(group, message)) return false;
		const excluded = [
			...readGroupRouteFailures(ctx.sessionManager.getBranch(), group.id),
			...(failed.get(group.id) ?? []),
		];
		if (excluded.some((item) => same(item, identity))) return false;
		excluded.push(identity);
		const available = ctx.modelRegistry.getAvailable();
		return group.members.some((member) => {
			if (excluded.some((item) => same(item, member))) return false;
			const model = ctx.modelRegistry.find(member.provider, member.id);
			return (
				model !== undefined &&
				isPhysicalGroupMember(model) &&
				available.some((item) => same(item, member))
			);
		});
	}

	pi.on("turn_end", (event, ctx) => {
		pending = undefined;
		if (event.outcome !== "error" || event.message.role !== "assistant" || ctx.signal?.aborted)
			return;
		const group =
			ctx.model?.provider === "group"
				? groups().find((item) => item.id === ctx.model?.id)
				: undefined;
		if (!group || !eligible(group, event.message, ctx)) return;
		pending = { groupId: group.id, entryId: event.messageEntryId, message: event.message };
	});
	pi.on("agent_before_settle", (event, ctx) => {
		const candidate = pending;
		pending = undefined;
		if (
			!candidate ||
			event.outcome !== "error" ||
			event.continue ||
			ctx.signal?.aborted ||
			event.context.pendingMessages.length ||
			ctx.hasPendingMessages()
		)
			return;
		const group =
			ctx.model?.provider === "group" && ctx.model.id === candidate.groupId
				? groups().find((item) => item.id === candidate.groupId)
				: undefined;
		if (!group || !eligible(group, candidate.message, ctx)) return;
		if (
			event.entries.some(
				(entry) => entry.type === "context_edit" && entry.targetId === candidate.entryId,
			)
		)
			return;
		const projected = event.context.contextEntries.findLast((entry) => entry.messages.length > 0);
		const last = event.context.llmMessages.at(-1);
		if (
			projected?.sourceEntry.id !== candidate.entryId ||
			projected.messages.length !== 1 ||
			JSON.stringify(projected.messages[0]) !== JSON.stringify(candidate.message) ||
			JSON.stringify(last) !== JSON.stringify(candidate.message)
		)
			return;
		const identity = { provider: candidate.message.provider, id: candidate.message.model };
		failed.set(group.id, [...(failed.get(group.id) ?? []), identity]);
		queue.set(group.id, identity);
		return {
			entries: [
				...event.entries,
				{ type: "context_edit", targetId: candidate.entryId, replacement: null },
			],
			continue: true,
		};
	});
	return {
		takeFailed(groupId) {
			const identity = queue.get(groupId);
			queue.delete(groupId);
			return identity;
		},
	};
}
