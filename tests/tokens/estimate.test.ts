import { describe, expect, test } from "bun:test";
import { estimateCounter, textKind, tokenizerCounter } from "../../src/tokens/estimate/index.ts";
import type { TextTokenizer, TokenizerStore } from "../../src/tokens/types.ts";
import { sumCounts } from "../../src/tokens/types.ts";

describe("token estimates", () => {
	test("a sum carries its weakest source", () => {
		expect(
			sumCounts([
				{ tokens: 100, source: "provider" },
				{ tokens: 7, source: "tokenizer" },
				{ tokens: 3, source: "count-endpoint" },
			]),
		).toEqual({ tokens: 110, source: "tokenizer" });
		expect(sumCounts([])).toEqual({ tokens: 0, source: "provider" });
	});

	test("JSON is estimated denser than prose", async () => {
		const counter = estimateCounter("x", { prose: 4, json: 2 });
		const json = '{"a":[1,2,3]}';
		expect(textKind(`  ${json}`)).toBe("json");
		expect(await counter.count(json, textKind(json))).toEqual({ tokens: 7, source: "estimate" });
		expect(await counter.count("hello world!", "prose")).toEqual({ tokens: 3, source: "estimate" });
	});

	test("a tokenizer counter estimates until its tokenizer loads, then counts exactly", async () => {
		let loaded: TextTokenizer | undefined;
		const loads: string[] = [];
		const store: TokenizerStore = {
			peek: () => loaded,
			load: async (repo) => {
				loads.push(repo);
				loaded = { id: `${repo}@abc1234`, count: (text) => text.split(" ").length };
				return loaded;
			},
		};
		const counter = tokenizerCounter("org/model", store, estimateCounter("fallback"), true);
		expect(counter.anchorSource).toBe("provider");
		expect(await counter.count("one two three", "prose")).toEqual({
			tokens: 4,
			source: "estimate",
		});
		await Promise.resolve();
		expect(loads).toEqual(["org/model"]);
		expect(counter.id).toBe("org/model@abc1234");
		expect(counter.anchorSource).toBe("tokenizer");
		expect(await counter.count("one two three", "prose")).toEqual({
			tokens: 3,
			source: "tokenizer",
		});
	});
});
