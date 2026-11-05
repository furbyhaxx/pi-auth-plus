/** Folds Synthetic's multiplexed reasoning and answer fragments back into one block each. */
import type {
	AssistantMessage,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@earendil-works/pi-ai";
import { PROVIDER } from "./catalog.ts";

type Content = TextContent | ThinkingContent | ToolCall;

/**
 * Synthetic streams some models (DeepSeek V4) as alternating thinking and text blocks, so one
 * answer arrives as several of each and renders as reasoning interleaved with prose. Fold every
 * thinking block into one and every text block into one, anchored where that kind first appears,
 * and leave tool calls and their order alone. Signed or redacted reasoning is opaque replay data,
 * so such a message is left untouched.
 */
export function foldInterleavedBlocks(message: AssistantMessage): AssistantMessage | undefined {
	if (message.provider !== PROVIDER) return undefined;
	if (message.content.length < 2) return undefined;
	const thinking: ThinkingContent[] = [];
	const text: TextContent[] = [];
	for (const block of message.content) {
		if (block.type === "thinking") {
			if (block.thinkingSignature || block.redacted) return undefined;
			thinking.push(block);
		} else if (block.type === "text") text.push(block);
	}
	if (thinking.length < 2 && text.length < 2) return undefined;
	const folded: Content[] = [];
	for (const block of message.content) {
		if (block.type === "thinking") {
			if (folded.some((entry) => entry.type === "thinking")) continue;
			folded.push({ type: "thinking", thinking: thinking.map((entry) => entry.thinking).join("") });
		} else if (block.type === "text") {
			if (folded.some((entry) => entry.type === "text")) continue;
			folded.push({ type: "text", text: text.map((entry) => entry.text).join("") });
		} else folded.push(block);
	}
	return { ...message, content: folded };
}
