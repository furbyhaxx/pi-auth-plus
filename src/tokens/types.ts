/** Shared token-counting contracts between the token engine, tokenizers and families. */

/** Where a count comes from, in precedence order; only the first two are exact. */
export type TokenSource = "provider" | "count-endpoint" | "tokenizer" | "estimate";

/** A token count labelled with its source. */
export interface TokenCount {
	readonly tokens: number;
	readonly source: TokenSource;
}

/** A loaded tokenizer that counts plain text, without special tokens or chat template. */
export interface TextTokenizer {
	/** Hugging Face repo and pinned revision, e.g. `deepseek-ai/DeepSeek-V4.1-Flash-1017@1bae0e1`. */
	readonly id: string;
	count(text: string): number;
}

/** Hugging Face tokenizers fetched on first use and served offline from the cache after that. */
export interface TokenizerStore {
	/** The tokenizer for a Hugging Face repo if this process already loaded it; never does I/O. */
	peek(repo: string): TextTokenizer | undefined;
	/** Loads from the disk cache or downloads it; resolves undefined when unavailable, never rejects. */
	load(repo: string): Promise<TextTokenizer | undefined>;
}
