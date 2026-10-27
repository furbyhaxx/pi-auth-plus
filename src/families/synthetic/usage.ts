/** Corrects Synthetic's Anthropic usage, which reports the uncached input twice. */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { PROVIDER } from "./catalog.ts";

/**
 * Synthetic's `message_delta` repeats the uncached input as `cache_creation_input_tokens`
 * (`.project/analyses/tokens/usage-audit/report.md`), so Pi counts it twice in `totalTokens`.
 * The duplicate is dropped from `cacheWrite`; `input` keeps the tokens at the input price.
 */
export function correctSyntheticUsage(message: AssistantMessage): AssistantMessage | undefined {
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
