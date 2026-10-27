/** Transcript normalization for Google wire conversion. */
// Behaviour ported from pi-ai 1.4.0 api/transform-messages.js (MIT).
import type {
	Api,
	AssistantMessage,
	ImageContent,
	Message,
	Model,
	TextContent,
	ToolCall,
} from "@earendil-works/pi-ai";

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";
function replaceImagesWithPlaceholder(
	content: (TextContent | ImageContent)[],
	placeholder: string,
): TextContent[] {
	const result: TextContent[] = [];
	let previousWasPlaceholder = false;
	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) {
				result.push({ type: "text", text: placeholder });
			}
			previousWasPlaceholder = true;
			continue;
		}
		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}
	return result;
}
function downgradeUnsupportedImages<TApi extends Api>(
	messages: Message[],
	model: Model<TApi>,
): Message[] {
	if (model.input.includes("image")) {
		return messages;
	}
	return messages.map((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) {
			return {
				...msg,
				content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER),
			};
		}
		if (msg.role === "toolResult") {
			return {
				...msg,
				content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER),
			};
		}
		return msg;
	});
}
/** Normalize model-specific content and IDs, then close orphaned tool calls. */
export function transformMessages<TApi extends Api>(
	messages: Message[],
	model: Model<TApi>,
	normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): Message[] {
	const toolCallIdMap = new Map<string, string>();
	const normalizedMessages = messages.map((msg) =>
		msg.content == null ? { ...msg, content: [] } : msg,
	);
	const imageAwareMessages = downgradeUnsupportedImages(normalizedMessages, model);
	const transformed = imageAwareMessages.map((msg) => {
		if (msg.role === "system" || msg.role === "user") {
			return msg;
		}
		if (msg.role === "toolResult") {
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) {
				return { ...msg, toolCallId: normalizedId };
			}
			return msg;
		}
		if (msg.role === "assistant") {
			const assistantMsg = msg;
			const isSameModel =
				assistantMsg.provider === model.provider &&
				assistantMsg.api === model.api &&
				assistantMsg.model === model.id;
			const transformedContent = assistantMsg.content.flatMap<AssistantMessage["content"][number]>(
				(block) => {
					if (block.type === "thinking") {
						if (!isSameModel) return [];
						if (block.redacted || block.thinkingSignature) return block;
						if (!block.thinking || block.thinking.trim() === "") return [];
						return block;
					}
					if (block.type === "text") {
						if (isSameModel) return block;
						return {
							type: "text" as const,
							text: block.text,
						};
					}
					if (block.type === "toolCall") {
						const toolCall = block;
						let normalizedToolCall: ToolCall = toolCall;
						if (!isSameModel && toolCall.thoughtSignature) {
							normalizedToolCall = { ...toolCall };
							delete normalizedToolCall.thoughtSignature;
						}
						if (!isSameModel && normalizeToolCallId) {
							const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
							if (normalizedId !== toolCall.id) {
								toolCallIdMap.set(toolCall.id, normalizedId);
								normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
							}
						}
						return normalizedToolCall;
					}
					return block;
				},
			);
			return {
				...assistantMsg,
				content: transformedContent,
			};
		}
		return msg;
	});
	const result: Message[] = [];
	let pendingToolCalls: ToolCall[] = [];
	let existingToolResultIds = new Set<string>();
	const heldSystemMessages: Message[] = [];
	const closePendingToolCalls = () => {
		if (pendingToolCalls.length > 0) {
			for (const tc of pendingToolCalls) {
				if (!existingToolResultIds.has(tc.id)) {
					result.push({
						role: "toolResult",
						toolCallId: tc.id,
						toolName: tc.name,
						content: [{ type: "text", text: "No result provided" }],
						isError: true,
						timestamp: Date.now(),
					});
				}
			}
			pendingToolCalls = [];
			existingToolResultIds = new Set();
		}
		result.push(...heldSystemMessages);
		heldSystemMessages.length = 0;
	};
	for (const msg of transformed) {
		if (msg.role === "assistant") {
			closePendingToolCalls();
			const assistantMsg = msg;
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
				continue;
			}
			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = new Set();
			}
			result.push(msg);
		} else if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === "system") {
			if (pendingToolCalls.length > 0) {
				heldSystemMessages.push(msg);
			} else {
				result.push(msg);
			}
		} else if (msg.role === "user") {
			closePendingToolCalls();
			result.push(msg);
		} else {
			result.push(msg);
		}
	}
	closePendingToolCalls();
	return result;
}
