/** The `antigravity` provider: agy's Cloud Code PA backend behind Pi's OAuth and model store. */
import {
	type AssistantMessageEvent,
	createProvider,
	lazyStream,
	type Model,
	type ModelThinkingLevel,
	type Provider,
	type ProviderAuth,
	type SimpleStreamOptions,
	type ThinkingLevel,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { type FetchFn, parseRetryAfter } from "../../core/http/index.ts";
import { bundledModels, PROVIDER, refreshCatalog } from "./catalog.ts";
import { AntigravityError, parseAntigravityError } from "./errors.ts";
import { decodeLevel, type WireLevel } from "./levels.ts";
import { buildRequest, RequestSessions } from "./request.ts";
import { streamAntigravityResponse } from "./stream.ts";
import { BASE_URL, cliHeaders } from "./transport.ts";

type AntigravityModel = Model<"google-generative-ai">;

const STREAM_URL = `${BASE_URL}/v1internal:streamGenerateContent?alt=sse`;
// The fork's agy transport waited this long for headers and between body bytes.
const STALL_TIMEOUT_MS = 180_000;
const LEVELS: readonly ModelThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

export interface AntigravityProviderDeps {
	readonly auth: ProviderAuth;
	readonly project: { resolve(accessToken: string, signal: AbortSignal): Promise<string> };
	readonly fetch?: FetchFn;
	readonly now?: () => number;
}

/** Safe setup failure: the stream never started, so Pi shows this as the turn's error. */
export class AntigravityStreamSetupError extends Error {
	override readonly name = "AntigravityStreamSetupError";
}

/**
 * The requested level, else the next offered one above it (Pi clamps upward), else the
 * highest offered. No requested level (compaction, titles) takes the cheapest.
 */
export function pickLevel(
	model: AntigravityModel,
	requested: ThinkingLevel | undefined,
): WireLevel | undefined {
	const offered = LEVELS.map((level) => {
		const encoded = model.thinkingLevelMap?.[level];
		return typeof encoded === "string" ? decodeLevel(encoded) : undefined;
	});
	const start = requested ? LEVELS.indexOf(requested) : 0;
	return (
		offered.slice(start).find((level) => level !== undefined) ??
		offered.slice(0, start).findLast((level) => level !== undefined)
	);
}

function bearer(options: SimpleStreamOptions | undefined): string | undefined {
	for (const [key, value] of Object.entries(options?.headers ?? {})) {
		if (key.toLowerCase() === "authorization" && value?.startsWith("Bearer "))
			return value.slice("Bearer ".length);
	}
	return undefined;
}

export function antigravityProvider(
	deps: AntigravityProviderDeps,
): Provider<"google-generative-ai"> {
	const fetchFn = deps.fetch ?? fetch;
	const now = deps.now ?? Date.now;
	const sessions = new RequestSessions({ now });
	let current: AntigravityModel[] | undefined;

	async function open(
		model: AntigravityModel,
		context: TranscriptContext,
		options: SimpleStreamOptions | undefined,
	): Promise<AsyncIterable<AssistantMessageEvent>> {
		const signal = options?.signal ?? new AbortController().signal;
		const token = bearer(options);
		if (!token)
			throw new AntigravityStreamSetupError("antigravity: no OAuth login; run /login antigravity");
		const level = pickLevel(model, options?.reasoning);
		if (!level)
			throw new AntigravityStreamSetupError(
				`antigravity: model ${model.id} has no usable thinking level; refresh models with /models`,
			);
		const project = await deps.project.resolve(token, signal);
		const { body } = buildRequest({
			model,
			context,
			options: options ?? {},
			level,
			project,
			sessions,
		});
		const payload = (await options?.onPayload?.(body, model)) ?? body;
		const secrets = [token, project];
		const timeoutMs = options?.timeoutMs ?? STALL_TIMEOUT_MS;
		// Bounds the wait for headers only; aborting later would cut a long, live stream.
		const deadline = new AbortController();
		const timer = setTimeout(() => deadline.abort(), timeoutMs);
		let response: Response;
		try {
			response = await (options?.fetch ?? fetchFn)(STREAM_URL, {
				method: "POST",
				headers: cliHeaders(token),
				body: JSON.stringify(payload),
				signal: AbortSignal.any([signal, deadline.signal]),
			});
		} catch (error) {
			if (!deadline.signal.aborted || signal.aborted) throw error;
			throw new AntigravityError("RESPONSE_TIMEOUT", `No response within ${timeoutMs} ms`, {
				secrets,
			});
		} finally {
			clearTimeout(timer);
		}
		await options?.onResponse?.(
			{ status: response.status, headers: Object.fromEntries(response.headers) },
			model,
		);
		if (!response.ok) {
			throw parseAntigravityError(await response.text(), {
				status: response.status,
				retryAfterMs: parseRetryAfter(response.headers.get("retry-after"), now()),
				secrets,
			});
		}
		return streamAntigravityResponse(model, response, {
			signal,
			secrets,
			now,
			idleTimeoutMs: timeoutMs,
		});
	}

	const provider = createProvider<"google-generative-ai">({
		id: PROVIDER,
		name: "Antigravity",
		baseUrl: BASE_URL,
		auth: deps.auth,
		models: [],
		api: {
			stream: (model, context, options) =>
				lazyStream(model, () => open(model as AntigravityModel, context, options)),
			streamSimple: (model, context, options) =>
				lazyStream(model, () => open(model as AntigravityModel, context, options)),
		},
	});

	const models = () => current ?? bundledModels();
	return {
		...provider,
		getModels: models,
		getAllModels: models,
		async refreshModels(ctx) {
			const models = await refreshCatalog(ctx, {
				fetch: fetchFn,
				now,
				headers: () => cliHeaders(),
				project: (access, signal) => deps.project.resolve(access, signal),
			});
			await ctx.publish({
				update: () => {
					current = models;
				},
			});
		},
	};
}
