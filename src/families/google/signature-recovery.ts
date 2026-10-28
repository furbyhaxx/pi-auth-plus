/** Bounded recovery of rejected Google function-call signatures. */

import type { Api, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { repairThoughtSignaturePayload } from "./thought-repair.ts";

interface Snapshot {
	readonly format: "native" | "chat";
	readonly model: string;
	readonly messages: readonly string[];
	readonly lastToolId: string | undefined;
	readonly lastToolName: string | undefined;
}

interface PendingRecovery {
	readonly entryId: string;
	readonly provider: string;
	readonly model: string;
	readonly snapshot: Snapshot;
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function matchesModel(payload: Record<string, unknown>, model: Model<Api>): boolean {
	const id = payload["model"];
	if (typeof id !== "string") return false;
	if (id === model.id || id === `models/${model.id}`) return true;
	if (model.provider !== "antigravity") return false;
	return Object.values(model.thinkingLevelMap ?? {}).some(
		(level) => typeof level === "string" && level.split("|")[0] === id,
	);
}

function snapshot(payload: unknown, model: Model<Api>): Snapshot | undefined {
	const body = object(payload);
	if (!body || !matchesModel(body, model)) return undefined;
	const request = object(body["request"]);
	const native = request?.["contents"] ?? body["contents"];
	const chat = body["messages"];
	const format = Array.isArray(native) ? "native" : Array.isArray(chat) ? "chat" : undefined;
	const messages = format === "native" ? native : chat;
	if (!format || !Array.isArray(messages)) return undefined;
	let lastToolId: string | undefined;
	let lastToolName: string | undefined;
	for (const value of messages) {
		const message = object(value);
		if (format === "chat" && message?.["role"] === "tool") {
			lastToolId =
				typeof message["tool_call_id"] === "string" ? message["tool_call_id"] : undefined;
			lastToolName = typeof message["name"] === "string" ? message["name"] : undefined;
		} else if (format === "native" && message?.["role"] === "user") {
			const parts = message["parts"];
			if (!Array.isArray(parts)) continue;
			for (const part of parts) {
				const response = object(object(part)?.["functionResponse"]);
				if (!response) continue;
				lastToolId = typeof response["id"] === "string" ? response["id"] : undefined;
				lastToolName = typeof response["name"] === "string" ? response["name"] : undefined;
			}
		}
	}
	try {
		return {
			format,
			model: body["model"] as string,
			messages: messages.map((message) => JSON.stringify(message)),
			lastToolId,
			lastToolName,
		};
	} catch {
		return undefined;
	}
}

function samePrefix(before: Snapshot, current: Snapshot): boolean {
	return (
		before.format === current.format &&
		before.model === current.model &&
		before.messages.length <= current.messages.length &&
		before.messages.every((message, index) => message === current.messages[index])
	);
}

function matchesResult(snapshot: Snapshot, result: ToolResultMessage): boolean {
	if (snapshot.lastToolId) return snapshot.lastToolId === result.toolCallId;
	return snapshot.lastToolName !== undefined && snapshot.lastToolName === result.toolName;
}

function isMissingSignatureError(message: string): boolean {
	return (
		/(?:\bHTTP\s*|\bstatus(?:Code)?["']?\s*[:=]\s*|\bcode["']?\s*[:=]\s*|^\s*)400\b/i.test(
			message,
		) &&
		/\b(?:function\s*call|tool\s*call)\b/i.test(message) &&
		/(?:\bmissing\b[\s\S]{0,200}\bthought[_\s]?signature\b|\bthought[_\s]?signature\b[\s\S]{0,200}\bmissing\b)/i.test(
			message,
		)
	);
}

/** Register a one-attempt continuation from the already persisted tool results. */
export function registerThoughtSignatureRecovery(pi: ExtensionAPI): void {
	let candidates = new Map<string, Snapshot>();
	let pending: PendingRecovery | undefined;
	let active: PendingRecovery | undefined;
	let inTurn = false;

	const clear = () => {
		candidates = new Map();
		pending = undefined;
		active = undefined;
		inTurn = false;
	};
	pi.on("session_start", clear);
	pi.on("session_shutdown", clear);
	pi.on("session_before_switch", clear);
	pi.on("session_tree", clear);
	pi.on("model_select", clear);
	pi.on("before_agent_start", clear);
	pi.on("agent_settled", clear);
	pi.on("turn_start", () => {
		candidates.clear();
		inTurn = true;
	});
	pi.on("before_provider_request", (event, ctx) => {
		if (!inTurn || !ctx.model) return;
		if (!active && !repairThoughtSignaturePayload(event.payload, { history: true })) return;
		const current = snapshot(event.payload, ctx.model);
		if (!current) return;
		if (active) {
			if (
				ctx.model.provider !== active.provider ||
				ctx.model.id !== active.model ||
				!samePrefix(active.snapshot, current)
			)
				return;
			return repairThoughtSignaturePayload(event.payload, {
				prefixLength: active.snapshot.messages.length,
				history: true,
			})?.payload;
		}
		const key = JSON.stringify([current.format, current.model, current.messages]);
		candidates.set(key, current);
		return undefined;
	});
	pi.on("turn_end", (event, ctx) => {
		inTurn = false;
		pending = undefined;
		const message = event.message;
		if (
			active ||
			event.outcome !== "error" ||
			message.role !== "assistant" ||
			message.stopReason !== "error" ||
			!message.errorMessage ||
			!isMissingSignatureError(message.errorMessage) ||
			!ctx.model ||
			message.provider !== ctx.model.provider ||
			message.model !== ctx.model.id ||
			ctx.signal?.aborted
		)
			return;
		const context = event.context.llmMessages;
		const last = context[context.length - 1];
		const prior = context.findLast((item) => item.role === "toolResult");
		if (last?.role !== "assistant" || !prior) return;
		const matches = [...candidates.values()].filter((candidate) => matchesResult(candidate, prior));
		if (matches.length !== 1) return;
		const candidate = matches[0];
		if (!candidate) return;
		pending = {
			entryId: event.messageEntryId,
			provider: message.provider,
			model: message.model,
			snapshot: candidate,
		};
		active = pending;
	});
	pi.on("agent_before_settle", (event, ctx) => {
		if (!pending || !active || event.outcome !== "error" || ctx.signal?.aborted || event.continue)
			return;
		if (
			event.context.pendingMessages.length > 0 ||
			event.entries.some(
				(entry) => entry.type === "context_edit" && entry.targetId === pending?.entryId,
			)
		)
			return;
		const entry = event.context.contextEntries.find(
			(item) => item.sourceEntry.id === pending?.entryId,
		);
		const context = event.context.llmMessages;
		const last = context[context.length - 1];
		const prior = context.findLast((item) => item.role === "toolResult");
		if (
			!entry?.messages.length ||
			last?.role !== "assistant" ||
			last.provider !== pending.provider ||
			last.model !== pending.model ||
			last.stopReason !== "error" ||
			!prior ||
			!matchesResult(pending.snapshot, prior)
		)
			return;
		pending = undefined;
		return {
			entries: [
				...event.entries,
				{ type: "context_edit", targetId: active.entryId, replacement: null },
			],
			continue: true,
		};
	});
}
