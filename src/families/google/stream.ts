/** Owns Antigravity SSE decoding and Pi assistant event mapping for one request. */
import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
} from "@earendil-works/pi-ai";
import type { KnownSecrets } from "../../core/redact/index.ts";
import { AntigravityError, parseAntigravityError } from "./errors.ts";
import {
	isThinkingPart,
	mapStopReasonString,
	requiresToolCallId,
	retainThoughtSignature,
} from "./parts.ts";

/** Per-request cancellation, redaction and deterministic identity hooks. */
export interface AntigravityStreamOptions {
	readonly signal?: AbortSignal;
	readonly secrets?: KnownSecrets;
	readonly now?: () => number;
	readonly toolCallId?: () => string;
}

type Chunk = Record<string, unknown>;
function record(value: unknown): Chunk | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Chunk)
		: undefined;
}
function isJson(value: unknown): value is ToolCall["arguments"][string] {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		(Array.isArray(value)
			? value.every(isJson)
			: record(value) !== undefined && Object.values(record(value) ?? {}).every(isJson))
	);
}
function argumentsObject(value: unknown): ToolCall["arguments"] {
	const object = record(value);
	if (!object || !isJson(object)) return {};
	return object as ToolCall["arguments"];
}
function applySignature(block: TextContent | ThinkingContent, signature: string | undefined): void {
	if (block.type === "thinking") {
		const retained = retainThoughtSignature(block.thinkingSignature, signature);
		if (retained) block.thinkingSignature = retained;
	} else {
		const retained = retainThoughtSignature(block.textSignature, signature);
		if (retained) block.textSignature = retained;
	}
}
function normalizeToolCallId(id: string, required: boolean): string {
	return required ? id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) : id;
}
function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Decode SSE frames and throw typed RPC errors before mapping to Pi's error events. */
export async function* parseAntigravitySse(
	response: Response,
	options: AntigravityStreamOptions = {},
): AsyncGenerator<Chunk> {
	if (!response.ok)
		throw parseAntigravityError(await response.text(), {
			status: response.status,
			secrets: options.secrets,
		});
	if (!response.body) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let cancellation: Promise<void> | undefined;
	const abort = () => {
		// The reader loop reports abort; cancellation must not reject outside that loop.
		cancellation = reader.cancel().catch(() => undefined);
	};
	options.signal?.addEventListener("abort", abort, { once: true });
	function parse(frame: string): Chunk | undefined {
		const data = frame
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		if (!data || data.trim() === "[DONE]") return undefined;
		let raw: unknown;
		try {
			raw = JSON.parse(data);
		} catch {
			throw new AntigravityError("INVALID_SSE", "Invalid JSON in stream frame", {
				secrets: options.secrets,
			});
		}
		const outer = record(raw);
		const chunk = record(outer?.["response"]) ?? outer;
		if (!chunk)
			throw new AntigravityError("INVALID_SSE", "Invalid stream chunk", {
				secrets: options.secrets,
			});
		if (chunk["error"] !== undefined)
			throw parseAntigravityError(chunk, { secrets: options.secrets });
		const feedback = record(chunk["promptFeedback"]);
		if (feedback?.["blockReason"] || feedback?.["blockReasonMessage"]) {
			throw new AntigravityError(
				"PROMPT_BLOCKED",
				`${feedback["blockReason"] ?? "Blocked"}: ${feedback["blockReasonMessage"] ?? "Prompt rejected"}`,
				{ secrets: options.secrets },
			);
		}
		return chunk;
	}
	try {
		while (true) {
			if (options.signal?.aborted)
				throw new AntigravityError("ABORTED", "Request was aborted", { secrets: options.secrets });
			const next = await reader.read();
			if (options.signal?.aborted)
				throw new AntigravityError("ABORTED", "Request was aborted", { secrets: options.secrets });
			buffer += decoder.decode(next.value, { stream: !next.done });
			let boundary = /\r?\n\r?\n/.exec(buffer);
			while (boundary) {
				const frame = buffer.slice(0, boundary.index);
				buffer = buffer.slice(boundary.index + boundary[0].length);
				const chunk = parse(frame);
				if (chunk) yield chunk;
				boundary = /\r?\n\r?\n/.exec(buffer);
			}
			if (next.done) break;
		}
		if (buffer.trim()) {
			const chunk = parse(buffer);
			if (chunk) yield chunk;
		}
	} finally {
		options.signal?.removeEventListener("abort", abort);
		try {
			if (cancellation) await cancellation;
			else await reader.cancel();
		} finally {
			reader.releaseLock();
		}
	}
}

/** Consume one fetch response synchronously into Pi's asynchronous assistant event stream. */
export function streamAntigravityResponse(
	model: Model<"google-generative-ai">,
	response: Response,
	options: AntigravityStreamOptions = {},
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const now = options.now ?? Date.now;
	const needsToolCallId = requiresToolCallId(model.id);
	const output: AssistantMessage = {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content: [],
		stopReason: "pending",
		timestamp: now(),
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	void (async () => {
		const controller = new AbortController();
		const signal = options.signal
			? AbortSignal.any([options.signal, controller.signal])
			: controller.signal;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let graceExpired = false;
		let terminal = false;
		let current: TextContent | ThinkingContent | undefined;
		let pendingSignature: string | undefined;
		let idCounter = 0;
		const close = () => {
			if (!current) return;
			const contentIndex = output.content.length - 1;
			if (current.type === "text")
				stream.push({ type: "text_end", contentIndex, content: current.text, partial: output });
			else
				stream.push({
					type: "thinking_end",
					contentIndex,
					content: current.thinking,
					partial: output,
				});
			current = undefined;
		};
		try {
			stream.push({ type: "start", partial: output });
			try {
				for await (const chunk of parseAntigravitySse(response, { ...options, signal })) {
					if (typeof chunk["responseId"] === "string" && !output.responseId)
						output.responseId = chunk["responseId"];
					const usage = record(chunk["usageMetadata"]);
					if (usage) {
						const cacheRead = count(usage["cachedContentTokenCount"]);
						output.usage = {
							input: count(usage["promptTokenCount"]) - cacheRead,
							output: count(usage["candidatesTokenCount"]) + count(usage["thoughtsTokenCount"]),
							reasoning: count(usage["thoughtsTokenCount"]),
							cacheRead,
							cacheWrite: 0,
							totalTokens: count(usage["totalTokenCount"]),
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						};
					}
					if (terminal) {
						if (usage) break;
						continue;
					}
					const candidates = chunk["candidates"];
					const candidate = Array.isArray(candidates) ? record(candidates[0]) : undefined;
					const parts = record(candidate?.["content"])?.["parts"];
					for (const value of Array.isArray(parts) ? parts : []) {
						const part = record(value);
						if (!part) continue;
						const signature =
							typeof part["thoughtSignature"] === "string" ? part["thoughtSignature"] : undefined;
						const text = typeof part["text"] === "string" ? part["text"] : undefined;
						const call = record(part["functionCall"]);
						if (!text && signature && !call) {
							if (current && (current.type === "thinking") === isThinkingPart(part))
								applySignature(current, signature);
							if (isThinkingPart(part) || current?.type !== "text") pendingSignature = signature;
							continue;
						}
						if (text !== undefined && text.length > 0) {
							const thinking = isThinkingPart(part);
							if (!current || (current.type === "thinking") !== thinking) {
								close();
								current = thinking
									? { type: "thinking", thinking: "" }
									: { type: "text", text: "" };
								output.content.push(current);
								stream.push({
									type: thinking ? "thinking_start" : "text_start",
									contentIndex: output.content.length - 1,
									partial: output,
								});
							}
							if (current.type === "thinking") {
								current.thinking += text;
								applySignature(current, signature);
								stream.push({
									type: "thinking_delta",
									contentIndex: output.content.length - 1,
									delta: text,
									partial: output,
								});
							} else {
								current.text += text;
								applySignature(current, signature ?? pendingSignature);
								pendingSignature = undefined;
								stream.push({
									type: "text_delta",
									contentIndex: output.content.length - 1,
									delta: text,
									partial: output,
								});
							}
						}
						if (call) {
							close();
							let id = normalizeToolCallId(
								typeof call["id"] === "string" ? call["id"] : "",
								needsToolCallId,
							);
							if (
								!id ||
								output.content.some((block) => block.type === "toolCall" && block.id === id)
							) {
								id = normalizeToolCallId(
									options.toolCallId?.() ?? `call_${now()}_${++idCounter}`,
									needsToolCallId,
								);
								while (
									!id ||
									output.content.some((block) => block.type === "toolCall" && block.id === id)
								)
									id = `call_${now()}_${++idCounter}`;
							}
							const thoughtSignature = signature ?? pendingSignature;
							const toolCall = {
								type: "toolCall" as const,
								id,
								name: typeof call["name"] === "string" ? call["name"] : "",
								arguments: argumentsObject(call["args"]),
								...(thoughtSignature ? { thoughtSignature } : {}),
							};
							pendingSignature = undefined;
							output.content.push(toolCall);
							const contentIndex = output.content.length - 1;
							stream.push({ type: "toolcall_start", contentIndex, partial: output });
							stream.push({
								type: "toolcall_delta",
								contentIndex,
								delta: JSON.stringify(toolCall.arguments),
								partial: output,
							});
							stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
						}
					}
					if (typeof candidate?.["finishReason"] === "string") {
						close();
						terminal = true;
						output.rawStopReason = candidate["finishReason"];
						output.stopReason = mapStopReasonString(candidate["finishReason"]);
						if (
							output.stopReason === "stop" &&
							output.content.some((block) => block.type === "toolCall")
						)
							output.stopReason = "toolUse";
						if (!model.id.includes("gpt-oss") || usage) break;
						timer = setTimeout(() => {
							graceExpired = true;
							controller.abort();
						}, 1000);
					}
				}
			} catch (error) {
				if (!graceExpired || options.signal?.aborted) throw error;
			}
			close();
			if (options.signal?.aborted)
				throw new AntigravityError("ABORTED", "Request was aborted", { secrets: options.secrets });
			if (!terminal)
				throw new AntigravityError(
					"TRUNCATED_STREAM",
					"Stream ended without a terminal candidate",
					{ secrets: options.secrets },
				);
			if (!output.content.length)
				throw new AntigravityError("EMPTY_RESPONSE", "Received an empty response", {
					secrets: options.secrets,
				});
			if (
				output.stopReason === "error" ||
				output.stopReason === "aborted" ||
				output.stopReason === "pending"
			)
				throw new AntigravityError(
					"FINISH_REASON",
					`Provider stopped with ${output.rawStopReason}`,
					{ secrets: options.secrets },
				);
			stream.push({ type: "done", reason: output.stopReason, message: output });
		} catch (error) {
			const safe =
				error instanceof AntigravityError
					? error
					: parseAntigravityError(
							{ message: error instanceof Error ? error.message : String(error) },
							{ secrets: options.secrets },
						);
			output.stopReason = options.signal?.aborted ? "aborted" : "error";
			output.errorMessage = safe.message;
			stream.push({ type: "error", reason: output.stopReason, error: output });
		} finally {
			if (timer) clearTimeout(timer);
			stream.end();
		}
	})();
	return stream;
}
