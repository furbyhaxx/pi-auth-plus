import { describe, expect, test } from "bun:test";
import type { FamilyAdapter } from "../../src/core/registry/index.ts";
import { createGoogleFamily } from "../../src/families/google/index.ts";
import { createOpenaiFamily } from "../../src/families/openai/index.ts";
import { createSyntheticFamily } from "../../src/families/synthetic/index.ts";
import { createXaiFamily } from "../../src/families/xai/index.ts";
import type { CounterDeps, TextTokenizer, TokenizerStore } from "../../src/tokens/types.ts";

describe("family token counters", () => {
	test("selects cached counters by provider and model", async () => {
		const tokenizerRepo = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
		const syntheticModel = `hf:${tokenizerRepo}`;
		const loaded = new Map<string, TextTokenizer>();
		const pendingLoads = new Map<string, (tokenizer: TextTokenizer | undefined) => void>();
		const loads: string[] = [];
		const tokenizers: TokenizerStore = {
			peek: (repo) => loaded.get(repo),
			load: (repo) => {
				loads.push(repo);
				return new Promise((resolve) => pendingLoads.set(repo, resolve));
			},
		};
		const deps: CounterDeps = {
			auth: async () => undefined,
			fetch: async () => new Response(),
			tokenizers,
		};
		const google = createGoogleFamily();
		const synthetic = createSyntheticFamily();
		const openai = createOpenaiFamily();
		const xai = createXaiFamily();
		const cases: {
			readonly family: FamilyAdapter;
			readonly provider: string;
			readonly model: string;
			readonly counterId: string | undefined;
		}[] = [
			{
				family: google,
				provider: "antigravity",
				model: "claude-sonnet-5-5",
				counterId: "estimate:antigravity-claude:2.73/2.08",
			},
			{
				family: google,
				provider: "antigravity",
				model: "gemini-3.8-flash",
				counterId: "estimate:antigravity-gemini:4.07/2.88",
			},
			{
				family: google,
				provider: "antigravity",
				model: "gpt-oss-120b",
				counterId: "estimate:antigravity-gpt-oss:4/2.75",
			},
			{
				family: synthetic,
				provider: "synthetic",
				model: syntheticModel,
				counterId: "estimate:synthetic:4/3",
			},
			{
				family: synthetic,
				provider: "synthetic",
				model: "syn:small:text",
				counterId: "estimate:synthetic:4/3",
			},
			{
				family: openai,
				provider: "openai",
				model: "gpt-6-luna",
				counterId: "estimate:openai:4.19/3.51",
			},
			{
				family: openai,
				provider: "openai-codex",
				model: "gpt-6-luna",
				counterId: "estimate:openai:4.19/3.51",
			},
			{
				family: xai,
				provider: "xai",
				model: "grok-4.7",
				counterId: "estimate:xai:4.17/3.31",
			},
			{
				family: google,
				provider: "synthetic",
				model: syntheticModel,
				counterId: undefined,
			},
			{
				family: synthetic,
				provider: "antigravity",
				model: "gemini-3.8-flash",
				counterId: undefined,
			},
			{
				family: openai,
				provider: "xai",
				model: "grok-4.7",
				counterId: undefined,
			},
			{
				family: xai,
				provider: "openai",
				model: "gpt-6-luna",
				counterId: undefined,
			},
		];
		let googleGptOssCounter: ReturnType<NonNullable<FamilyAdapter["tokens"]>>;
		let syntheticCounter: ReturnType<NonNullable<FamilyAdapter["tokens"]>>;
		for (const entry of cases) {
			const model = { provider: entry.provider, id: entry.model };
			const counter = entry.family.tokens?.(model, deps);
			expect(counter?.id).toBe(entry.counterId);
			if (counter) expect(entry.family.tokens?.(model, deps)).toBe(counter);
			if (entry.family === google && entry.model === "gpt-oss-120b") googleGptOssCounter = counter;
			if (entry.family === synthetic && entry.model === syntheticModel) {
				syntheticCounter = counter;
				expect(counter?.anchorSource).toBe("provider");
			}
		}
		if (!googleGptOssCounter || !syntheticCounter) throw new Error("Expected family counters");

		expect(await googleGptOssCounter.count("one two", "prose")).toEqual({
			tokens: 2,
			source: "estimate",
		});
		expect(loads).toContain("openai/gpt-oss-120b");
		releaseTokenizer("openai/gpt-oss-120b");
		expect(googleGptOssCounter.anchorSource).toBe("provider");
		expect(await googleGptOssCounter.count("one two", "prose")).toEqual({
			tokens: 2,
			source: "tokenizer",
		});

		expect(await syntheticCounter.count("one two three", "prose")).toEqual({
			tokens: 4,
			source: "estimate",
		});
		expect(loads).toContain(tokenizerRepo);
		releaseTokenizer(tokenizerRepo);
		expect(syntheticCounter.anchorSource).toBe("tokenizer");
		expect(syntheticCounter.id).toBe(`${tokenizerRepo}@test`);
		expect(await syntheticCounter.count("one two three", "prose")).toEqual({
			tokens: 3,
			source: "tokenizer",
		});

		function releaseTokenizer(repo: string): void {
			const resolve = pendingLoads.get(repo);
			if (!resolve) throw new Error(`No pending tokenizer load for ${repo}`);
			const tokenizer: TextTokenizer = {
				id: `${repo}@test`,
				count: (text) => text.split(" ").length,
			};
			loaded.set(repo, tokenizer);
			resolve(tokenizer);
		}
	});
});
