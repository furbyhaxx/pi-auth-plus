/** Synthetic's zero-data-retention web search, exposed as the opt-in `synthetic_web_search` tool. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { atomicWriteFile } from "../../core/fs/index.ts";
import {
	type FetchFn,
	ProviderHttpError,
	ProviderTimeoutError,
	request,
} from "../../core/http/index.ts";
import { redactText } from "../../core/redact/index.ts";
import { PROVIDER } from "./catalog.ts";
import {
	MAX_PREVIEW_RESULTS,
	previewText,
	renderSearchCall,
	renderSearchResult,
	type SearchDetails,
	type SearchRowState,
} from "./search-renderer.ts";

export const TOOL_NAME = "synthetic_web_search";
export const SEARCH_URL = "https://api.synthetic.new/v2/search";
const SEARCH_TIMEOUT_MS = 60_000;
/** Pi's own tool-output limits (`DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`). */
const MAX_BYTES = 50 * 1024;
const MAX_LINES = 2000;
const SEARCH_PARAMS = Type.Object({
	query: Type.String({ minLength: 1, description: "Focused web search query" }),
});

class SearchParseError extends Error {}

export interface SearchResult {
	readonly url: string;
	readonly title: string;
	readonly text: string;
	readonly highlights: readonly string[];
	readonly published: string | undefined;
}

/** Maps the API response; rows without a URL are dropped, a missing `published` is kept as unknown. */
export function parseResults(payload: unknown): SearchResult[] {
	const rows = (payload as { results?: unknown } | null)?.results;
	if (!Array.isArray(rows))
		throw new SearchParseError(`${PROVIDER}: search response has no results array`);
	const results: SearchResult[] = [];
	for (const row of rows as Array<Record<string, unknown> | null>) {
		const url = text(row?.["url"]);
		if (!url) continue;
		const highlights = row?.["highlights"];
		results.push({
			url,
			title: text(row?.["title"]) ?? url,
			text: text(row?.["text"]) ?? "",
			highlights: Array.isArray(highlights)
				? highlights.filter(
						(item): item is string => typeof item === "string" && item.trim() !== "",
					)
				: [],
			published: text(row?.["published"]),
		});
	}
	return results;
}

/** Highlights per result, falling back to the page text when a result has none. */
export function formatResults(results: readonly SearchResult[], full: boolean): string {
	if (results.length === 0) return "No results found.";
	return results
		.map((result, index) => {
			const body =
				full || result.highlights.length === 0 ? result.text : result.highlights.join("\n\n");
			return `## ${index + 1}. ${result.title}\nURL: ${result.url}\nPublished: ${result.published ?? "unknown"}\n\n${body}`;
		})
		.join("\n\n---\n\n");
}

export interface SearchDeps {
	readonly fetch: FetchFn;
	/** Directory for the full page text of each search. */
	readonly outputDir: () => string;
}

export function registerWebSearch(pi: ExtensionAPI, deps: SearchDeps): void {
	pi.registerTool<typeof SEARCH_PARAMS, SearchDetails, SearchRowState>({
		name: TOOL_NAME,
		label: "Synthetic Web Search",
		description:
			"Search the public web through Synthetic's zero-data-retention search API. Returns titles, URLs, publication dates and the relevant passages of each page; the full page text is saved to a file whose path the result names.",
		promptSnippet: "Search the public web through Synthetic's zero-data-retention API",
		promptGuidelines: [
			"Use synthetic_web_search only when current public web information is needed.",
			"Give synthetic_web_search focused queries containing relevant names, versions, or dates.",
			"Read the saved full-text file only when the passages are not enough.",
		],
		parameters: SEARCH_PARAMS,
		renderShell: "self",
		renderCall: (_args, theme, context) => renderSearchCall(TOOL_NAME, theme, context),
		renderResult: renderSearchResult,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) return aborted();
			let apiKey: string | undefined;
			try {
				apiKey = (await waitForAbort(ctx.modelRegistry.getProviderAuth(PROVIDER), signal))?.auth
					.apiKey;
			} catch (error) {
				if (signal?.aborted) return aborted();
				if (missingEnvironmentAuth(error)) return failure("auth");
				throw error;
			}
			if (signal?.aborted) return aborted();
			if (!apiKey) return failure("auth");
			onUpdate?.({
				content: [{ type: "text", text: "Searching Synthetic…" }],
				details: { kind: "progress", query: previewText(params.query, 160, apiKey) },
			});
			if (signal?.aborted) return aborted();
			let response: Response;
			try {
				response = await waitForAbort(
					request(SEARCH_URL, {
						provider: PROVIDER,
						method: "POST",
						headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
						body: JSON.stringify({ query: params.query }),
						timeoutMs: SEARCH_TIMEOUT_MS,
						secrets: [apiKey],
						signal: signal ?? null,
						fetch: deps.fetch,
					}),
					signal,
				);
			} catch (error) {
				if (signal?.aborted) return aborted();
				if (error instanceof ProviderHttpError) return failure("http", error.status);
				if (error instanceof ProviderTimeoutError) return failure("timeout");
				return failure("network");
			}
			let payload: unknown;
			try {
				payload = await waitForAbort(response.json(), signal);
			} catch (error) {
				if (signal?.aborted) return aborted();
				return failure(error instanceof SyntaxError ? "parse" : "network");
			}
			if (signal?.aborted) return aborted();
			let results: SearchResult[];
			try {
				results = parseResults(payload);
			} catch (error) {
				if (error instanceof SearchParseError) return failure("parse");
				throw error;
			}
			const summary = formatResults(results, false);
			const truncation = truncateHead(summary);
			let output = truncation.content;
			let fullOutputPath: string | undefined;
			const full = formatResults(results, true);
			if (truncation.truncated || full !== summary) {
				if (signal?.aborted) return aborted();
				fullOutputPath = join(deps.outputDir(), `pi-synthetic-search-${randomUUID()}.md`);
				await atomicWriteFile(fullOutputPath, full, { mode: 0o600 });
				const shown = truncation.truncated
					? `Output truncated to ${formatSize(byteLength(output))} of ${formatSize(byteLength(summary))}. `
					: "";
				output += `\n\n[${shown}Full page text (${formatSize(byteLength(full))}) saved to: ${fullOutputPath}]`;
			}
			if (signal?.aborted) return aborted();
			return {
				content: [{ type: "text", text: output }],
				details: {
					kind: "success",
					query: previewText(params.query, 160, apiKey),
					resultCount: results.length,
					results: results.slice(0, MAX_PREVIEW_RESULTS).map(({ title, url, published }) => ({
						title: previewText(title, 160, apiKey),
						url: previewText(url, 320, apiKey),
						published: published === undefined ? undefined : previewText(published, 80, apiKey),
					})),
					fullOutputPath:
						fullOutputPath === undefined ? undefined : redactText(fullOutputPath, [apiKey]),
					truncated: truncation.truncated,
				},
			};
		},
	});
}

function failure(
	code: "auth" | "http" | "network" | "timeout" | "parse",
	status?: number,
): AgentToolResult<SearchDetails> {
	const reason = {
		auth: "credentials are missing",
		http: `HTTP ${status ?? "error"}`,
		network: "network request failed",
		timeout: "request timed out",
		parse: "invalid search response",
	}[code];
	const message = `${PROVIDER}: ${reason} at ${SEARCH_URL}; retry or run /login synthetic.`;
	return {
		content: [{ type: "text", text: message }],
		details: { kind: "error", code, message, ...(status === undefined ? {} : { status }) },
		isError: true,
	};
}

function aborted(): AgentToolResult<SearchDetails> {
	return {
		content: [{ type: "text", text: "Operation aborted" }],
		details: { kind: "aborted" },
		isError: true,
	};
}

function missingEnvironmentAuth(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.name === "ModelsError" &&
		"code" in error &&
		error.code === "auth" &&
		error.cause instanceof Error &&
		/^Failed to resolve API key for provider "synthetic" from environment variables?: /.test(
			error.cause.message,
		)
	);
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return operation;
	return new Promise((resolve, reject) => {
		const cancel = () => {
			signal.removeEventListener("abort", cancel);
			reject(new Error("Operation aborted"));
		};
		signal.addEventListener("abort", cancel, { once: true });
		operation.then(
			(value) => {
				signal.removeEventListener("abort", cancel);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", cancel);
				reject(error);
			},
		);
		if (signal.aborted) cancel();
	});
}

/** The leading whole lines of `value` within Pi's tool-output limits. */
export function truncateHead(value: string): { content: string; truncated: boolean } {
	const lines = value.split("\n");
	let bytes = 0;
	let kept = 0;
	for (const line of lines) {
		const next = bytes + byteLength(line) + (kept > 0 ? 1 : 0);
		if (kept === MAX_LINES || next > MAX_BYTES) break;
		bytes = next;
		kept += 1;
	}
	return kept === lines.length
		? { content: value, truncated: false }
		: { content: lines.slice(0, kept).join("\n"), truncated: true };
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function formatSize(bytes: number): string {
	return bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
