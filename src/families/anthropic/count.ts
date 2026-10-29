/** Counts Claude text and tool schemas through the subscription-compatible native endpoint. */

import type { TextRule } from "../../core/config/fields.ts";
import { ProviderHttpError, request } from "../../core/http/index.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import { estimateCounter } from "../../tokens/estimate/index.ts";
import type {
	CounterDeps,
	TokenContextInput,
	TokenCounter,
	TokenModel,
	ToolSchema,
} from "../../tokens/types.ts";
import { countPayload } from "./count-context.ts";
import { shapeHeaders, shapeUrl } from "./request.ts";
import { sanitizeSystemText, withClaudeCodeIdentity } from "./sanitize.ts";
import { wireToolName } from "./tool-names.ts";
import { oauthToken } from "./transport.ts";

const ENDPOINT = "https://api.anthropic.com/v1/messages/count_tokens";
const MINIMAL_TEXT = "x";
let active = 0;
const waiting: (() => void)[] = [];

async function acquire(signal?: AbortSignal): Promise<boolean> {
	if (signal?.aborted) return false;
	if (active < 2) {
		active++;
		return true;
	}
	return new Promise<boolean>((resolve) => {
		const wake = () => {
			signal?.removeEventListener("abort", abort);
			resolve(true);
		};
		const abort = () => {
			const index = waiting.indexOf(wake);
			if (index >= 0) waiting.splice(index, 1);
			resolve(false);
		};
		waiting.push(wake);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
	});
}

function release(): void {
	const next = waiting.shift();
	if (next) next();
	else active--;
}

async function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
	if (!signal) return promise;
	const cancelled = Promise.withResolvers<undefined>();
	const abort = () => cancelled.resolve(undefined);
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	try {
		return await Promise.race([cancelled.promise, promise]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

/** Shares the family's lazy reported version and environment without probing at construction. */
export interface ClaudeCountOptions {
	readonly version: () => Promise<string>;
	/** The user's system prompt rewrite rules, read per count like the provider reads them. */
	readonly rules?: () => readonly TextRule[];
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
	let baseline: number | undefined;
	let baselinePending: Promise<number | undefined> | undefined;

	type RequestBody = {
		readonly body: string;
		readonly target: string;
		readonly env: PathEnv;
		readonly headers?: Readonly<Record<string, string>>;
		readonly betas?: readonly string[];
	};

	async function performCount(
		build: (
			oauth: boolean,
			version: string,
			signal: AbortSignal,
		) => Promise<RequestBody | undefined>,
		signal?: AbortSignal,
	): Promise<number | undefined> {
		const deadline = AbortSignal.timeout(10_000);
		const activeSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
		if (!(await acquire(activeSignal))) return undefined;
		try {
			if (Date.now() < backoffUntil || activeSignal.aborted) return undefined;
			const auth = await waitFor(deps.auth("claude"), activeSignal);
			if (!auth?.token || activeSignal.aborted) return undefined;
			const oauth = auth.extra["type"] === "oauth" || Boolean(oauthToken({ apiKey: auth.token }));
			const version = oauth ? await waitFor(options.version(), activeSignal) : "";
			if (version === undefined || activeSignal.aborted) return undefined;
			const payload = await waitFor(build(oauth, version, activeSignal), activeSignal);
			if (!payload || activeSignal.aborted) return undefined;
			let headers = new Headers(payload.headers);
			if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
			headers.set("content-type", "application/json");
			if (payload.betas?.length) headers.set("anthropic-beta", payload.betas.join(","));
			for (const key of ["content-length", "content-md5", "content-digest", "digest"])
				headers.delete(key);
			if (oauth) {
				headers = shapeHeaders(headers, auth.token, version);
				headers.set("x-claude-code-session-id", session);
			} else if (!headers.has("x-api-key")) {
				headers.set("x-api-key", auth.token);
			}
			const target = oauth ? shapeUrl(payload.target, payload.env) : payload.target;
			const response = await waitFor(
				request(String(target), {
					provider: "claude",
					fetch: deps.fetch,
					method: "POST",
					headers,
					timeoutMs: 10_000,
					secrets: [auth.token],
					signal: activeSignal,
					body: payload.body,
				}),
				activeSignal,
			);
			if (!response || activeSignal.aborted) return undefined;
			const body: unknown = await waitFor(response.json(), activeSignal);
			if (activeSignal.aborted) return undefined;
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

	async function rawCount(
		text: string,
		tools?: readonly ToolSchema[],
		signal?: AbortSignal,
	): Promise<number | undefined> {
		return performCount(
			async () => ({
				target: String(shapeUrl(ENDPOINT, options.env ?? process.env)),
				env: options.env ?? process.env,
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
			}),
			signal,
		);
	}

	async function getBaseline(signal?: AbortSignal): Promise<number | undefined> {
		if (signal?.aborted) return undefined;
		if (baseline !== undefined) return baseline;
		baselinePending ??= (async () => {
			try {
				const result = await rawCount(MINIMAL_TEXT);
				if (result !== undefined) baseline = result;
				return result;
			} finally {
				baselinePending = undefined;
			}
		})();
		return waitFor(baselinePending, signal);
	}

	return {
		id: `count_tokens:claude:${model.id}`,
		anchorSource: "provider",
		async count(text, kind, signal) {
			if (!text) return { tokens: 0, source: "estimate" };
			const base = await getBaseline(signal);
			const total = base === undefined ? undefined : await rawCount(text, undefined, signal);
			if (base === undefined || total === undefined) return fallback.count(text, kind, signal);
			// Live x/x x/x x x = 33/34/35 (x = 1); prose A+B subtraction residual was -1 token.
			return { tokens: Math.max(0, total - base + 1), source: "estimate" };
		},
		async countContext(input, signal) {
			if (
				signal?.aborted ||
				input.model.provider !== model.provider ||
				input.model.id !== model.id ||
				input.model.api !== "anthropic-messages"
			)
				return undefined;
			try {
				const snapshot: TokenContextInput = JSON.parse(JSON.stringify(input));
				const rules = (options.rules?.() ?? []).map((rule) => ({ ...rule }));
				const env = { ...(options.env ?? process.env) };
				const base = new URL(snapshot.model.baseUrl);
				if (
					(base.protocol !== "https:" && base.protocol !== "http:") ||
					base.username ||
					base.password ||
					base.search ||
					base.hash
				)
					return undefined;
				const target = `${base.href.replace(/\/$/, "")}/v1/messages/count_tokens`;
				const total = await performCount(async (oauth, version, activeSignal) => {
					const payload = await countPayload(snapshot, oauth, version, rules, activeSignal);
					if (!payload) return undefined;
					return {
						...payload,
						target,
						env,
						...(snapshot.model.headers ? { headers: snapshot.model.headers } : {}),
					};
				}, signal);
				return total === undefined || signal?.aborted
					? undefined
					: { tokens: total, source: "count-endpoint" };
			} catch {
				return undefined;
			}
		},
		systemText: (text) => sanitizeSystemText(text, options.rules?.() ?? []),
		async countTools(tools, signal) {
			if (!tools.length) return { tokens: 0, source: "estimate" };
			const base = await getBaseline(signal);
			const total = base === undefined ? undefined : await rawCount(MINIMAL_TEXT, tools, signal);
			if (base === undefined || total === undefined) {
				return fallback.count(JSON.stringify(tools), "json", signal);
			}
			return { tokens: Math.max(0, total - base), source: "estimate" };
		},
	};
}
