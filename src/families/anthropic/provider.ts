/**
 * The `claude` provider: Pi's Anthropic catalog and Messages implementation, re-tagged. OAuth
 * turns switch to header-owned auth so Pi's own Claude Code emulation stays out and the
 * transport shapes each request exactly once; API-key turns go through Pi unchanged.
 */

import type {
	Model,
	Provider,
	ProviderAuth,
	StreamOptions,
	TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	anthropicMessagesApi,
	createProvider,
	getCurrentTools,
	getModels,
} from "@earendil-works/pi-ai/compat";
import type { TextRule } from "../../core/config/fields.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import { toolNameRestorer } from "./tool-names.ts";
import { claudeFetch, oauthToken } from "./transport.ts";

export const PROVIDER = "claude";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const FREE_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

type AnthropicModel = Model<"anthropic-messages">;

export interface ClaudeProviderDeps {
	readonly auth: ProviderAuth;
	readonly version: () => Promise<string>;
	/** Read per request, so a settings reload applies to the next turn. */
	readonly rules: () => readonly TextRule[];
	readonly env: PathEnv;
}

/**
 * Wire names the request refers to: the live tools, and the earlier calls the transcript still
 * carries. A tool that a session called and Pi no longer registers is only a historical name:
 * a response never dispatches it, so it must not be able to collide with a live tool.
 */
function transcriptToolNames(context: TranscriptContext): { current: string[]; earlier: string[] } {
	const current = getCurrentTools(context.messages).map((tool) => tool.name);
	const live = new Set(current);
	const earlier: string[] = [];
	for (const message of context.messages) {
		if (message.role !== "assistant") continue;
		for (const block of message.content)
			if (block.type === "toolCall" && !live.has(block.name)) earlier.push(block.name);
	}
	return { current, earlier };
}

/** Subscription turns are prepaid, so their cost reads zero. */
function freeOf<T extends AnthropicModel>(model: T): T {
	return { ...model, cost: { ...FREE_COST } };
}

export function claudeModels(): AnthropicModel[] {
	return getModels("anthropic").map((model) => ({ ...model, provider: PROVIDER }));
}

export function claudeProvider(deps: ClaudeProviderDeps): Provider<"anthropic-messages"> {
	const models = claudeModels();
	const anthropic = anthropicMessagesApi();

	function prepare<T extends StreamOptions>(
		model: AnthropicModel,
		context: TranscriptContext,
		options: T | undefined,
	): { model: AnthropicModel; options: T | undefined } {
		const token = oauthToken(options);
		if (!token) return { model, options };
		const headers = { ...options?.headers };
		let accountUuid = "";
		for (const key of Object.keys(headers)) {
			if (key.toLowerCase() !== "x-auth-plus-account-uuid") continue;
			accountUuid = headers[key] ?? "";
			delete headers[key];
		}
		const names = transcriptToolNames(context);
		const fetch = claudeFetch({
			token,
			accountUuid,
			...(options?.sessionId ? { sessionId: options.sessionId } : {}),
			version: deps.version,
			rules: deps.rules(),
			restore: toolNameRestorer(names.current, names.earlier),
			env: { ...deps.env, ...options?.env },
			...(options?.fetch ? { underlying: options.fetch } : {}),
		});
		return {
			model: freeOf(model),
			options: {
				...(options as T),
				apiKey: undefined,
				headers: { ...headers, Authorization: `Bearer ${token}` },
				fetch,
			},
		};
	}

	return createProvider<"anthropic-messages">({
		id: PROVIDER,
		name: "Claude",
		baseUrl: models[0]?.baseUrl ?? DEFAULT_BASE_URL,
		auth: deps.auth,
		models,
		filterModels: (catalog, credential) =>
			credential?.type === "oauth" ? catalog.map(freeOf) : catalog,
		api: {
			stream(model, context, options) {
				const shaped = prepare(model as AnthropicModel, context, options);
				return anthropic.stream(shaped.model, context, shaped.options);
			},
			streamSimple(model, context, options) {
				const shaped = prepare(model as AnthropicModel, context, options);
				return anthropic.streamSimple(shaped.model, context, shaped.options);
			},
		},
	});
}
