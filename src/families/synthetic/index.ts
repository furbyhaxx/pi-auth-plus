/** Synthetic registers an Anthropic Messages endpoint using Pi's native transport and login. */
import { tmpdir } from "node:os";
import type { FetchFn } from "../../core/http/index.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import type { FamilyAdapter, FamilyHost } from "../../core/registry/index.ts";
import { estimateCounter, tokenizerCounter } from "../../tokens/estimate/index.ts";
import type { TokenCounter, TokenizerStore } from "../../tokens/types.ts";
import { BASE_URL, bundledModels, PROVIDER, refreshCatalog } from "./catalog.ts";
import { syntheticQuota } from "./quota.ts";
import { requestModel, syntheticTokenizerRepo } from "./request-tokens.ts";
import { correctSyntheticRequestUsage } from "./usage.ts";
import { registerWebSearch } from "./web-search.ts";

/** Enables the web-search tool for one run, next to the `synthetic.webSearch` setting. */
export const WEB_SEARCH_FLAG = "synthetic-web-search";

/** Creates the family without fetching; Pi controls the catalog refresh lifecycle. */
export function createSyntheticFamily(
	env: PathEnv = process.env,
	fetchFn: FetchFn = fetch,
	now: () => number = Date.now,
	outputDir: () => string = tmpdir,
	tokenizers?: TokenizerStore,
): FamilyAdapter {
	const counters = new Map<string, TokenCounter>();
	let host: FamilyHost | undefined;
	const sourceModel = (id: string): string =>
		host
			?.settings()
			.get("models.aliases")
			.find((alias) => alias.provider === PROVIDER && alias.id === id)?.source ?? id;
	return {
		id: PROVIDER,
		label: "Synthetic",
		providers: [
			{
				id: PROVIDER,
				label: "Synthetic",
				aliases: [],
				quota: syntheticQuota,
				ambient: () =>
					env["SYNTHETIC_API_KEY"] ? { source: "SYNTHETIC_API_KEY", limited: false } : undefined,
			},
		],
		tokens: (model, deps) => {
			if (model.provider !== PROVIDER) return undefined;
			const source = sourceModel(model.id);
			const cached = counters.get(source);
			if (cached) return cached;
			const repo = syntheticTokenizerRepo(source);
			const counter = repo
				? tokenizerCounter(repo, deps.tokenizers, estimateCounter("synthetic"), true)
				: estimateCounter("synthetic");
			counters.set(source, counter);
			return counter;
		},
		providerRegistrations: () => [
			{
				name: PROVIDER,
				config: {
					name: "Synthetic",
					baseUrl: BASE_URL,
					api: "anthropic-messages",
					apiKey: "$SYNTHETIC_API_KEY",
					models: bundledModels(),
					refreshModels: (ctx) => refreshCatalog(ctx, fetchFn, now),
				},
			},
		],
		register: (pi, familyHost) => {
			host = familyHost;
			pi.registerFlag(WEB_SEARCH_FLAG, {
				description: "Offer the Synthetic web search tool for this run",
				type: "boolean",
			});
			let payload: unknown;
			const preload = (model: { provider: string; id: string } | undefined): void => {
				payload = undefined;
				if (model?.provider !== PROVIDER) return;
				const repo = syntheticTokenizerRepo(sourceModel(model.id));
				if (repo) void tokenizers?.load(repo);
			};
			pi.on("model_select", ({ model }) => preload(model));
			pi.on("before_provider_request", (event, ctx) => {
				payload = undefined;
				if (ctx.model?.provider !== PROVIDER || requestModel(event.payload) !== ctx.model.id)
					return;
				payload = event.payload;
			});
			pi.on("message_end", ({ message }) => {
				if (message.role !== "assistant") return;
				const request = payload;
				payload = undefined;
				const corrected = correctSyntheticRequestUsage(
					message,
					request,
					tokenizers,
					sourceModel(message.model),
				);
				return corrected && { message: corrected };
			});
			let searchRegistered = false;
			// The project setting needs the session's cwd and trust before tool registration.
			pi.on("session_start", (_event, ctx) => {
				if (tokenizers) preload(ctx.model);
				if (searchRegistered) return;
				const enabled =
					pi.getFlag(WEB_SEARCH_FLAG) === true || familyHost.settings().get("synthetic.webSearch");
				if (!enabled) return;
				registerWebSearch(pi, { fetch: fetchFn, outputDir });
				searchRegistered = true;
			});
		},
	};
}
