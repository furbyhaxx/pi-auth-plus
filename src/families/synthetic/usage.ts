/** Corrects Synthetic's Anthropic usage, which reports the uncached input twice. */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TokenizerStore } from "../../tokens/types.ts";
import { PROVIDER } from "./catalog.ts";
import { countSyntheticRequest, requestModel, syntheticTokenizerRepo } from "./request-tokens.ts";

/**
 * Synthetic's `message_delta` repeats the uncached input as `cache_creation_input_tokens`
 * (`.project/analyses/tokens/usage-audit/report.md`), so Pi counts it twice in `totalTokens`.
 * The duplicate is dropped from `cacheWrite`; `input` keeps the tokens at the input price.
 */
export function correctSyntheticUsage(message: AssistantMessage): AssistantMessage | undefined {
	if (message.stopReason === "error") return undefined;
	const { usage } = message;
	if (message.provider !== PROVIDER || usage.cacheWrite <= 0 || usage.cacheWrite !== usage.input)
		return undefined;
	const cost = { ...usage.cost, cacheWrite: 0 };
	cost.total = cost.input + cost.output + cost.cacheRead;
	return {
		...message,
		usage: {
			...usage,
			cacheWrite: 0,
			...(usage.cacheWrite1h === undefined ? {} : { cacheWrite1h: 0 }),
			totalTokens: usage.input + usage.output + usage.cacheRead,
			cost,
		},
	};
}

/** Replaces prompt units with loaded tokenizer counts, retaining deduped billing and output. */
export function correctSyntheticRequestUsage(
	message: AssistantMessage,
	payload: unknown,
	tokenizers?: TokenizerStore,
): AssistantMessage | undefined {
	if (message.provider !== PROVIDER || message.stopReason === "error") return undefined;
	const deduped = correctSyntheticUsage(message);
	const base = deduped ?? message;
	const { usage } = base;
	const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
	if (prompt <= 0) return deduped;
	try {
		const repo = syntheticTokenizerRepo(message.model);
		if (!repo || requestModel(payload) !== message.model) return deduped;
		const tokenizer = tokenizers?.peek(repo);
		if (!tokenizer) return deduped;
		const real = countSyntheticRequest(payload, tokenizer);
		if (real === undefined) return deduped;
		const input = Math.round((usage.input * real) / prompt);
		const cacheWrite = Math.round((usage.cacheWrite * real) / prompt);
		return {
			...base,
			usage: {
				...usage,
				input,
				cacheWrite,
				cacheRead: real - input - cacheWrite,
				totalTokens: real + usage.output,
			},
		};
	} catch {
		return deduped;
	}
}
