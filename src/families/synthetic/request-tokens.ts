/** Counts Synthetic Messages payloads blockwise so the tokenizer can reuse cached text counts. */
import type { TextTokenizer } from "../../tokens/types.ts";

// The measured 16,235-token Pi request summed content and tools without chat-template tokens.
const MESSAGE_OVERHEAD = 0;
const TOOL_OVERHEAD = 0;

/** Extracts only explicit HF repos; catalog aliases do not expose their underlying tokenizer. */
export function syntheticTokenizerRepo(model: string): string | undefined {
	return /^hf:[^/\s]+\/[^/\s]+$/.test(model) ? model.slice(3) : undefined;
}

/** Reads the model at the unknown request boundary without assuming an Anthropic payload. */
export function requestModel(payload: unknown): unknown {
	return record(payload)?.["model"];
}

/** Returns no estimate for unsupported content or a failed tokenizer, preserving provider usage. */
export function countSyntheticRequest(
	payload: unknown,
	tokenizer: TextTokenizer,
): number | undefined {
	try {
		const body = record(payload);
		if (!body || !Array.isArray(body["messages"])) return undefined;
		let total = body["system"] === undefined ? 0 : countContent(body["system"], tokenizer);
		for (const value of body["messages"]) {
			const message = record(value);
			if (!message) return undefined;
			total += countContent(message["content"], tokenizer) + MESSAGE_OVERHEAD;
		}
		const tools = body["tools"];
		if (tools !== undefined) {
			if (!Array.isArray(tools)) return undefined;
			for (const value of tools) {
				const tool = record(value);
				if (
					!tool ||
					typeof tool["name"] !== "string" ||
					(tool["description"] !== undefined && typeof tool["description"] !== "string") ||
					!record(tool["input_schema"])
				)
					return undefined;
				// Serialize definitions like the capture probe, excluding transport-only cache controls.
				total +=
					tokenizer.count(
						JSON.stringify({
							name: tool["name"],
							description: tool["description"],
							input_schema: tool["input_schema"],
						}),
					) + TOOL_OVERHEAD;
			}
		}
		return Number.isSafeInteger(total) && total > 0 ? total : undefined;
	} catch {
		return undefined;
	}
}

function countContent(content: unknown, tokenizer: TextTokenizer): number {
	if (typeof content === "string") return tokenizer.count(content);
	if (!Array.isArray(content)) throw new Error("Synthetic: unsupported message content");
	let total = 0;
	for (const value of content) {
		const block = record(value);
		if (!block) throw new Error("Synthetic: invalid content block");
		switch (block["type"]) {
			case "text":
				total += countString(block["text"], tokenizer);
				break;
			case "thinking":
				total += countString(block["thinking"], tokenizer);
				break;
			case "tool_use":
				if (!record(block["input"])) throw new Error("Synthetic: invalid tool input");
				total += countString(block["name"], tokenizer);
				total += tokenizer.count(JSON.stringify(block["input"]));
				break;
			case "tool_result":
				total += countContent(block["content"], tokenizer);
				break;
			default:
				// Images and opaque thinking cannot be counted by a plain text tokenizer.
				throw new Error("Synthetic: unsupported content block");
		}
	}
	return total;
}

function countString(text: unknown, tokenizer: TextTokenizer): number {
	if (typeof text !== "string") throw new Error("Synthetic: invalid text block");
	return tokenizer.count(text);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
