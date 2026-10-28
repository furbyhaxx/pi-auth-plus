import { describe, expect, test } from "bun:test";
import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { AliasIssue, ModelAlias } from "../../../src/models/aliases/index.ts";
import { wrapNamedAliases } from "../../../src/models/aliases/named.ts";

const source = {
	id: "base",
	name: "Base",
	api: "openai-completions",
	baseUrl: "https://model.example.invalid",
	headers: { "x-model": "value" },
	compat: { supportsStore: false },
	input: ["text", "image"],
	cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
	reasoning: true,
	contextWindow: 5000,
	maxTokens: 500,
	samplingParams: { temperature: 0.5 },
} satisfies ProviderModelConfig;
const image = {
	id: "image",
	name: "Image",
	type: "image",
	api: "openai-images",
	input: ["text"],
	output: ["image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} satisfies ProviderModelConfig;
const alias: ModelAlias = {
	provider: "synthetic",
	source: "base",
	id: "short",
	name: "Short",
	contextWindow: 1000,
	maxTokens: 100,
};

describe("named provider aliases", () => {
	test("leaves an absent catalog and refresh absent", () => {
		const wrapped = wrapNamedAliases("synthetic", { apiKey: "$TEST_KEY" }, () => [alias]);
		expect(wrapped.models).toBeUndefined();
		expect(wrapped.refreshModels).toBeUndefined();
	});

	test("preserves models and metadata while reporting conflicts and invalid sources", () => {
		const models: ProviderModelConfig[] = [
			source,
			image,
			{ ...source, id: "duplicate" },
			{ ...source, id: "duplicate" },
		];
		const collision = { ...alias, id: "image" };
		const physicalCollision = { ...alias, id: "base" };
		const repeated = { ...alias, source: "base" };
		const missing = { ...alias, id: "missing", source: "absent" };
		const chained = { ...alias, id: "chain", source: "short" };
		const nonChat = { ...alias, id: "image-alias", source: "image" };
		const duplicate = { ...alias, id: "ambiguous", source: "duplicate" };
		const foreign = { ...alias, provider: "other", id: "foreign" };
		const reported: AliasIssue[] = [];
		const config: ProviderConfig = {
			apiKey: "$TEST_KEY",
			baseUrl: "https://provider.example.invalid",
			models,
		};
		const wrapped = wrapNamedAliases(
			"synthetic",
			config,
			() => [
				alias,
				collision,
				physicalCollision,
				repeated,
				missing,
				chained,
				nonChat,
				duplicate,
				foreign,
			],
			(issues) => reported.push(...issues),
		);
		expect(wrapped.models).toEqual([
			...models,
			{ ...source, id: "short", name: "Short", contextWindow: 1000, maxTokens: 100 },
		]);
		expect(wrapped.models?.[0]).toBe(source);
		expect(models).toEqual([
			source,
			image,
			{ ...source, id: "duplicate" },
			{ ...source, id: "duplicate" },
		]);
		expect(wrapped.apiKey).toBe(config.apiKey);
		expect(reported).toEqual([
			{ kind: "collision", alias: collision },
			{ kind: "collision", alias: physicalCollision },
			{ kind: "collision", alias: repeated },
			{ kind: "missing-source", alias: missing },
			{ kind: "missing-source", alias: chained },
			{ kind: "missing-source", alias: nonChat },
			{ kind: "missing-source", alias: duplicate },
		]);
	});

	test("uses current aliases on refresh and preserves auth, context and publication", async () => {
		let aliases: readonly ModelAlias[] = [alias];
		const refreshed = { ...source, id: "new", type: "chat" } satisfies ProviderModelConfig;
		const publication = { update: () => {} };
		const oauth: NonNullable<ProviderConfig["oauth"]> = {
			name: "Auth",
			login: async () => ({ access: "access", refresh: "refresh", expires: 1 }),
			refreshToken: async (credentials) => credentials,
			getApiKey: (credentials) => credentials.access,
		};
		let seenSignal: AbortSignal | undefined;
		const config: ProviderConfig = {
			name: "Synthetic",
			apiKey: "$TEST_KEY",
			oauth,
			headers: { "x-provider": "value" },
			models: [source, image],
			async refreshModels(ctx) {
				seenSignal = ctx.signal;
				await ctx.publish(publication);
				return [refreshed, image];
			},
		};
		const wrapped = wrapNamedAliases("synthetic", config, () => aliases);
		expect(wrapped.models).toEqual([
			source,
			image,
			{ ...source, id: "short", name: "Short", contextWindow: 1000, maxTokens: 100 },
		]);
		expect(wrapped.oauth).toBe(oauth);
		expect(wrapped.headers).toBe(config.headers);
		expect(wrapped.apiKey).toBe(config.apiKey);
		aliases = [{ provider: "synthetic", source: "new", id: "next" }];
		const signal = new AbortController().signal;
		const publications: unknown[] = [];
		const result = await wrapped.refreshModels?.({
			allowNetwork: false,
			signal,
			publish: async (value) => {
				publications.push(value);
				return true;
			},
		});
		expect(result).toEqual([refreshed, image, { ...refreshed, id: "next" }]);
		expect(seenSignal).toBe(signal);
		expect(publications).toEqual([publication]);
		expect(config.models).toEqual([source, image]);
	});
});
