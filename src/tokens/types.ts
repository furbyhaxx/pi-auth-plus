/** Shared token-counting contracts between the token engine, tokenizers and families. */
import type { Api, Context, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";

/** Where a count comes from, in precedence order; native counts describe their supplied request. */
export type TokenSource = "provider" | "count-endpoint" | "tokenizer" | "estimate";

/** A user-actionable explanation for a token count that needs authentication. */
export interface TokenDiagnostic {
	/** The machine-readable diagnostic category. */
	readonly code: "needs-auth";
	/** Pi provider id that requires authentication. */
	readonly provider: string;
	/** Recovery guidance for the user. */
	readonly message: string;
}

/** A token count labelled with its source and any user-actionable diagnostics. */
export interface TokenCount {
	readonly tokens: number;
	readonly source: TokenSource;
	readonly diagnostics?: readonly TokenDiagnostic[];
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

const PRECEDENCE: readonly TokenSource[] = ["provider", "count-endpoint", "tokenizer", "estimate"];

/** The less authoritative of two sources; a sum is only as good as its weakest part. */
export function weakerSource(a: TokenSource, b: TokenSource): TokenSource {
	return PRECEDENCE.indexOf(a) >= PRECEDENCE.indexOf(b) ? a : b;
}

/** Adds counts, labelling the result with the weakest source; an empty list is an exact zero. */
export function sumCounts(counts: readonly TokenCount[]): TokenCount {
	let tokens = 0;
	let source: TokenSource = "provider";
	const diagnostics = new Map<string, TokenDiagnostic>();
	for (const count of counts) {
		tokens += count.tokens;
		source = weakerSource(source, count.source);
		for (const diagnostic of count.diagnostics ?? []) {
			const key = JSON.stringify([diagnostic.provider, diagnostic.code, diagnostic.message]);
			if (!diagnostics.has(key)) diagnostics.set(key, diagnostic);
		}
	}
	return diagnostics.size > 0
		? { tokens, source, diagnostics: [...diagnostics.values()] }
		: { tokens, source };
}

/** How text is shaped; estimates use a different chars-per-token ratio for each. */
export type TextKind = "prose" | "json";

/** A tool definition as the model sees it. */
export interface ToolSchema {
	readonly name: string;
	readonly description: string;
	readonly parameters: unknown;
}

/** The model a counter is asked for. */
export interface TokenModel {
	/** Pi provider id, e.g. `claude`, `antigravity`, `openai`. */
	readonly provider: string;
	readonly id: string;
}

/** A complete supported request snapshot for native counting, before family-specific shaping. */
export interface TokenContextInput {
	readonly model: Model<Api>;
	readonly context: Context;
	/** The session's effective thinking level; absence cannot imply off for reasoning models. */
	readonly thinkingLevel?: ModelThinkingLevel;
}

/** Counts content for one model; the engine memoizes results by counter id and content hash. */
export interface TokenCounter {
	/** Identifies the counting method; equal ids must give equal counts for equal input. */
	readonly id: string;
	/** Where the persisted assistant `usage` of this model comes from. */
	readonly anchorSource: TokenSource;
	/** Counts plain text with the best source available now; never rejects. */
	count(text: string, kind: TextKind, signal?: AbortSignal): Promise<TokenCount>;
	/** Counts a complete supported request; undefined retains the engine's estimated fallback. */
	countContext?(input: TokenContextInput, signal?: AbortSignal): Promise<TokenCount | undefined>;
	/** Counts tool definitions as the provider encodes them; without it the engine counts their JSON. */
	countTools?(tools: readonly ToolSchema[], signal?: AbortSignal): Promise<TokenCount>;
	/** Rewrites system prompt text into what the provider sends, before counting. */
	systemText?(text: string): string;
}

/** The credential a counter authenticates with, resolved through Pi. */
export interface CounterAuth {
	readonly token: string;
	readonly extra: Readonly<Record<string, unknown>>;
}

/** Shared services a family's counter may use. */
export interface CounterDeps {
	/** Pi's refreshed credential for a provider id; undefined when not signed in. */
	readonly auth: (providerId: string) => Promise<CounterAuth | undefined>;
	readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	readonly tokenizers: TokenizerStore;
}
