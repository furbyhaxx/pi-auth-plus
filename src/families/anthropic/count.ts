/** Counts Claude text and tool schemas through the subscription-compatible native endpoint. */
import { ProviderHttpError, request } from "../../core/http/index.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import { estimateCounter } from "../../tokens/estimate/index.ts";
import type { CounterDeps, TokenCounter, TokenModel, ToolSchema } from "../../tokens/types.ts";
import { shapeHeaders, shapeUrl } from "./request.ts";
import { withClaudeCodeIdentity } from "./sanitize.ts";
import { wireToolName } from "./tool-names.ts";
import { oauthToken } from "./transport.ts";

const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";
const MINIMAL_TEXT = "x";
let active = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
	if (active < 2) {
		active++;
		return;
	}
	await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
	const next = waiting.shift();
	if (next) next();
	else active--;
}

/** Shares the family's lazy reported version and environment without probing at construction. */
export interface ClaudeCountOptions {
	readonly version: () => Promise<string>;
	readonly env?: PathEnv;
}

/** Never rejects: unavailable or throttled native counts use the measured Claude estimates. */
export function claudeTokenCounter(
	model: TokenModel,
	deps: CounterDeps,
	options: ClaudeCountOptions,
): TokenCounter {
	const fallback = estimateCounter("claude", { prose: 2.73, json: 2.7 });
	let backoffUntil = 0;
	const session = crypto.randomUUID();
	let baseline: Promise<number | undefined> | undefined;

	async function rawCount(
		text: string,
		tools?: readonly ToolSchema[],
		signal?: AbortSignal,
	): Promise<number | undefined> {
		await acquire();
		try {
			if (Date.now() < backoffUntil || signal?.aborted) return undefined;
			const auth = await deps.auth("claude");
			if (!auth?.token) return undefined;
			let headers = new Headers({
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			});
			if (auth.extra["type"] === "oauth" || oauthToken({ apiKey: auth.token })) {
				headers = shapeHeaders(headers, auth.token, await options.version());
				headers.set("x-claude-code-session-id", session);
			} else {
				headers.set("x-api-key", auth.token);
			}
			const target = shapeUrl(ENDPOINT, options.env ?? process.env);
			const response = await request(String(target), {
				provider: "claude",
				fetch: deps.fetch,
				method: "POST",
				headers,
				timeoutMs: 10_000,
				secrets: [auth.token],
				...(signal ? { signal } : {}),
				body: JSON.stringify({
					model: model.id,
					system: withClaudeCodeIdentity(undefined, []),
					messages: [{ role: "user", content: [{ type: "text", text }] }],
					...(tools
						? {
								tools: tools.map((tool) => ({
									name: wireToolName(tool.name),
									description: tool.description,
									input_schema: tool.parameters,
								})),
							}
						: {}),
				}),
			});
			const body: unknown = await response.json();
			if (
				typeof body === "object" &&
				body !== null &&
				"input_tokens" in body &&
				typeof body.input_tokens === "number" &&
				Number.isSafeInteger(body.input_tokens) &&
				body.input_tokens >= 0
			)
				return body.input_tokens;
			backoffUntil = Date.now() + 60_000;
			return undefined;
		} catch (error) {
			const unauthorized =
				error instanceof ProviderHttpError && (error.status === 401 || error.status === 403);
			if (!signal?.aborted) backoffUntil = Date.now() + (unauthorized ? 600_000 : 60_000);
			return undefined;
		} finally {
			release();
		}
	}

	async function getBaseline(signal?: AbortSignal): Promise<number | undefined> {
		baseline ??= rawCount(MINIMAL_TEXT, undefined, signal);
		const result = await baseline;
		if (result === undefined) baseline = undefined;
		return result;
	}

	return {
		id: `count_tokens:claude:${model.id}`,
		anchorSource: "provider",
		async count(text, kind, signal) {
			if (!text) return { tokens: 0, source: "count-endpoint" };
			const base = await getBaseline(signal);
			const total = base === undefined ? undefined : await rawCount(text, undefined, signal);
			if (base === undefined || total === undefined) return fallback.count(text, kind, signal);
			// Live x/x x/x x x = 33/34/35 (x = 1); prose A+B subtraction residual was -1 token.
			return { tokens: Math.max(0, total - base + 1), source: "count-endpoint" };
		},
		async countTools(tools, signal) {
			if (!tools.length) return { tokens: 0, source: "count-endpoint" };
			const base = await getBaseline(signal);
			const total = base === undefined ? undefined : await rawCount(MINIMAL_TEXT, tools, signal);
			if (base === undefined || total === undefined) {
				return fallback.count(JSON.stringify(tools), "json", signal);
			}
			return { tokens: Math.max(0, total - base), source: "count-endpoint" };
		},
	};
}
