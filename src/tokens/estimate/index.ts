/** Character-ratio estimates and tokenizer-backed counters that fall back to them. */
import type { TextKind, TokenCount, TokenCounter, TokenizerStore } from "../types.ts";

/** Characters per token for prose and for JSON, measured per route. */
export interface CharRatios {
	readonly prose: number;
	readonly json: number;
}

/** Used when a family has no measured ratios; JSON packs fewer characters into a token. */
export const DEFAULT_RATIOS: CharRatios = { prose: 4, json: 3 };

/** JSON objects and arrays tokenize denser than prose. */
export function textKind(text: string): TextKind {
	const first = text.trimStart()[0];
	return first === "{" || first === "[" ? "json" : "prose";
}

/** Rounds up, so non-empty text never counts as zero tokens. */
export function estimateTokens(text: string, kind: TextKind, ratios: CharRatios): number {
	return Math.ceil(text.length / ratios[kind]);
}

/** A counter that only estimates; its id carries the ratios so memo entries stay distinct. */
export function estimateCounter(name: string, ratios: CharRatios = DEFAULT_RATIOS): TokenCounter {
	return {
		id: `estimate:${name}:${ratios.prose}/${ratios.json}`,
		anchorSource: "provider",
		count: async (text, kind) => ({
			tokens: estimateTokens(text, kind, ratios),
			source: "estimate",
		}),
	};
}

/**
 * Counts with a Hugging Face tokenizer once loaded and with `fallback` until then; the first
 * count starts the load in the background, so counting never waits for a download.
 */
export function tokenizerCounter(
	repo: string,
	store: TokenizerStore,
	fallback: TokenCounter,
	anchorSource: TokenCounter["anchorSource"] = "provider",
): TokenCounter {
	let loading = false;
	return {
		get id() {
			return store.peek(repo)?.id ?? fallback.id;
		},
		anchorSource,
		async count(text, kind, signal): Promise<TokenCount> {
			const tokenizer = store.peek(repo);
			if (tokenizer) return { tokens: tokenizer.count(text), source: "tokenizer" };
			if (!loading) {
				loading = true;
				void store.load(repo).finally(() => {
					loading = false;
				});
			}
			return fallback.count(text, kind, signal);
		},
	};
}
