/** Synthetic's zero-data-retention web search, exposed as the opt-in `synthetic_web_search` tool. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { atomicWriteFile } from "../../core/fs/index.ts";
import { type FetchFn, request } from "../../core/http/index.ts";
import { PROVIDER } from "./catalog.ts";

export const TOOL_NAME = "synthetic_web_search";
export const SEARCH_URL = "https://api.synthetic.new/v2/search";
const SEARCH_TIMEOUT_MS = 60_000;
/** Pi's own tool-output limits (`DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`). */
const MAX_BYTES = 50 * 1024;
const MAX_LINES = 2000;

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
	if (!Array.isArray(rows)) throw new Error(`${PROVIDER}: search response has no results array`);
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
	pi.registerTool({
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
		parameters: Type.Object({
			query: Type.String({ minLength: 1, description: "Focused web search query" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const apiKey = (await ctx.modelRegistry.getProviderAuth(PROVIDER))?.auth.apiKey;
			if (!apiKey) {
				throw new Error(`${TOOL_NAME} needs /login synthetic or SYNTHETIC_API_KEY`);
			}
			const response = await request(SEARCH_URL, {
				provider: PROVIDER,
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
				body: JSON.stringify({ query: params.query }),
				timeoutMs: SEARCH_TIMEOUT_MS,
				secrets: [apiKey],
				signal: signal ?? null,
				fetch: deps.fetch,
			});
			const results = parseResults(await response.json());
			const summary = formatResults(results, false);
			const truncation = truncateHead(summary);
			let output = truncation.content;
			let fullOutputPath: string | undefined;
			const full = formatResults(results, true);
			if (truncation.truncated || full !== summary) {
				fullOutputPath = join(deps.outputDir(), `pi-synthetic-search-${randomUUID()}.md`);
				await atomicWriteFile(fullOutputPath, full, { mode: 0o600 });
				const shown = truncation.truncated
					? `Output truncated to ${formatSize(byteLength(output))} of ${formatSize(byteLength(summary))}. `
					: "";
				output += `\n\n[${shown}Full page text (${formatSize(byteLength(full))}) saved to: ${fullOutputPath}]`;
			}
			return {
				content: [{ type: "text", text: output }],
				details: {
					query: params.query,
					results: results.map(({ title, url, published }) => ({ title, url, published })),
					fullOutputPath,
					truncated: truncation.truncated,
				},
			};
		},
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
