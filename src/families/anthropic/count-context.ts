/** Captures the SDK's Anthropic request without starting a generation request. */
import { normalizeContext } from "@earendil-works/pi-ai";
import { anthropicMessagesApi, getCurrentTools } from "@earendil-works/pi-ai/compat";
import type { TextRule } from "../../core/config/fields.ts";
import type { TokenContextInput } from "../../tokens/types.ts";
import { billingBlock } from "./billing.ts";
import { shapeBody } from "./request.ts";
import { toolNameRestorer } from "./tool-names.ts";

const CAPTURED = new Error("Anthropic count payload captured");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function supported(input: TokenContextInput): boolean {
	for (const message of input.context.messages) {
		if (message.role === "system") continue;
		if (message.role === "user") {
			if (
				!input.model.input.includes("image") &&
				Array.isArray(message.content) &&
				message.content.some((block) => block.type === "image")
			)
				return false;
			continue;
		}
		if (message.role === "toolResult") {
			if (
				!input.model.input.includes("image") &&
				message.content.some((block) => block.type === "image")
			)
				return false;
			continue;
		}
		if (message.role !== "assistant") return false;
		if (
			message.content.some(
				(block) => block.type === "thinking" && (block.redacted || block.thinkingSignature),
			)
		)
			return false;
	}
	return true;
}

export interface CountPayload {
	readonly body: string;
	readonly betas: readonly string[];
}

/** Captures and adapts only a complete supported SDK-serialized request. */
export async function countPayload(
	input: TokenContextInput,
	oauth: boolean,
	version: string,
	rules: readonly TextRule[],
	signal?: AbortSignal,
): Promise<CountPayload | undefined> {
	if (signal?.aborted || !supported(input)) return undefined;
	try {
		const context = normalizeContext(input.context);
		if (oauth) {
			const current = getCurrentTools(context.messages).map((tool) => tool.name);
			const live = new Set(current);
			const earlier: string[] = [];
			for (const message of context.messages) {
				if (message.role !== "assistant") continue;
				for (const block of message.content)
					if (block.type === "toolCall" && !live.has(block.name)) earlier.push(block.name);
			}
			toolNameRestorer(current, earlier);
		}
		let captured: unknown;
		const stream = anthropicMessagesApi().streamSimple(input.model, context, {
			headers: oauth ? { Authorization: "Bearer count-capture" } : { "x-api-key": "count-capture" },
			fetch: Object.assign(
				async () => {
					throw new Error("Anthropic generation network denied during count");
				},
				{
					preconnect: () => {
						throw new Error("Anthropic generation network denied during count");
					},
				},
			),
			onPayload: (payload) => {
				captured = payload;
				throw CAPTURED;
			},
			...(signal ? { signal } : {}),
		});
		const result = await stream.result();
		if (signal?.aborted || result.errorMessage !== CAPTURED.message || !isRecord(captured))
			return undefined;
		if (captured["model"] !== input.model.id || !Array.isArray(captured["messages"]))
			return undefined;
		const betas = captured["betas"];
		if (
			betas !== undefined &&
			(!Array.isArray(betas) || !betas.every((item) => typeof item === "string"))
		)
			return undefined;
		const billing = oauth ? billingBlock(captured["messages"], version) : undefined;
		const shaped: unknown = JSON.parse(
			oauth ? shapeBody(JSON.stringify(captured), version, rules) : JSON.stringify(captured),
		);
		if (!isRecord(shaped)) return undefined;
		if (billing !== undefined && Array.isArray(shaped["system"])) {
			const first: unknown = shaped["system"][0];
			if (isRecord(first) && first["type"] === "text" && first["text"] === billing)
				shaped["system"].shift();
		}
		delete shaped["betas"];
		delete shaped["metadata"];
		delete shaped["max_tokens"];
		delete shaped["stream"];
		delete shaped["temperature"];
		delete shaped["fallbacks"];
		return { body: JSON.stringify(shaped), betas: betas ?? [] };
	} catch {
		return undefined;
	}
}
