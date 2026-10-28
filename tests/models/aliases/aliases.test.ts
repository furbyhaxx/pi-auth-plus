import { describe, expect, test } from "bun:test";
import {
	expandAliases,
	parseAliases,
	rewriteAliasPayload,
} from "../../../src/models/aliases/index.ts";

const alias = {
	provider: "provider-a",
	source: "base",
	id: "short",
	name: "Short",
	contextWindow: 1000,
	maxTokens: 100,
};

describe("parseAliases", () => {
	test("accepts empty and valid lists", () => {
		expect(parseAliases([])).toEqual([]);
		expect(parseAliases([alias])).toEqual([alias]);
	});

	test("rejects malformed entries and duplicate identities", () => {
		for (const raw of [
			null,
			{},
			[null],
			[{ ...alias, provider: " " }],
			[{ ...alias, source: "" }],
			[{ ...alias, id: "" }],
			[{ ...alias, id: "base" }],
			[{ ...alias, name: 12 }],
			[{ ...alias, name: undefined }],
			[{ ...alias, contextWindow: 0 }],
			[{ ...alias, maxTokens: 1.5 }],
			[{ ...alias, maxTokens: Number.POSITIVE_INFINITY }],
			[{ ...alias, extra: true }],
			[alias, { ...alias, source: "other" }],
		]) {
			expect(parseAliases(raw)).toBeUndefined();
		}
		expect(parseAliases([alias, { ...alias, provider: "provider-b" }])).toHaveLength(2);
	});
});

describe("expandAliases", () => {
	test("copies source metadata, overrides limits and preserves originals", () => {
		const base = {
			provider: "provider-a",
			id: "base",
			name: "Base",
			contextWindow: 5000,
			maxTokens: 500,
			metadata: { capabilities: ["tools"] },
		};
		const existing = { ...base, id: "occupied" };
		const catalog = [base, existing];
		const result = expandAliases(catalog, [
			alias,
			{ provider: "provider-a", source: "base", id: "occupied" },
			{ provider: "provider-b", source: "base", id: "missing" },
			{ provider: "provider-a", source: "short", id: "chain" },
		]);
		expect(result.models).toEqual([
			base,
			existing,
			{ ...base, id: "short", name: "Short", contextWindow: 1000, maxTokens: 100 },
		]);
		expect(catalog).toEqual([base, existing]);
		expect(result.models[0]).toBe(base);
		expect(result.issues).toEqual([
			{ kind: "collision", alias: { provider: "provider-a", source: "base", id: "occupied" } },
			{ kind: "missing-source", alias: { provider: "provider-b", source: "base", id: "missing" } },
			{ kind: "missing-source", alias: { provider: "provider-a", source: "short", id: "chain" } },
		]);
	});

	test("inherits unspecified name and limits", () => {
		const base = { provider: "p", id: "base", name: "Base", contextWindow: 20, maxTokens: 10 };
		expect(expandAliases([base], [{ provider: "p", source: "base", id: "alias" }]).models).toEqual([
			base,
			{ ...base, id: "alias" },
		]);
	});
});

describe("rewriteAliasPayload", () => {
	test("rewrites only the selected alias without mutating caller-transformed fields", () => {
		const body = { model: "short", transformed: { retained: true } };
		const result = rewriteAliasPayload(body, { provider: "provider-a", id: "short" }, [alias]);
		expect(result).toEqual({ model: "base", transformed: body.transformed });
		expect(result).not.toBe(body);
		expect(body.model).toBe("short");
		for (const [payload, selected] of [
			[body, { provider: "provider-b", id: "short" }],
			[body, { provider: "provider-a", id: "base" }],
			[{ model: "other" }, { provider: "provider-a", id: "short" }],
			[null, { provider: "provider-a", id: "short" }],
			[["short"], { provider: "provider-a", id: "short" }],
		] as const) {
			expect(rewriteAliasPayload(payload, selected, [alias])).toBe(payload);
		}
	});
});
