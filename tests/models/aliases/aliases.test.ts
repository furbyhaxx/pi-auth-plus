import { describe, expect, test } from "bun:test";
import type { Model, Provider } from "@earendil-works/pi-ai";
import {
	expandAliases,
	parseAliases,
	resolveAliases,
	rewriteAliasPayload,
} from "../../../src/models/aliases/index.ts";
import { wrapNamedAliases } from "../../../src/models/aliases/named.ts";
import { wrapNativeAliases } from "../../../src/models/aliases/native.ts";
import { filterNativeProvider } from "../../../src/models/catalog/owned-filter.ts";

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

describe("resolveAliases", () => {
	test("resolves against the original provider-scoped physical catalog", () => {
		const catalog = [
			{ provider: "p", id: "base" },
			{ provider: "p", id: "explicit", type: "chat" },
			{ provider: "p", id: "occupied" },
			{ provider: "p", id: "image", type: "image" },
			{ provider: "p", id: "duplicate" },
			{ provider: "p", id: "duplicate", type: "image" },
			{ provider: "other", id: "short" },
		];
		const valid = { provider: "p", source: "base", id: "short" };
		const explicit = { provider: "p", source: "explicit", id: "explicit-alias" };
		const collisions = [{ ...valid, id: "occupied" }, { ...valid, id: "image" }, { ...valid }];
		const invalidSources = [
			{ ...valid, id: "from-image", source: "image" },
			{ ...valid, id: "ambiguous", source: "duplicate" },
			{ ...valid, id: "chain", source: "short" },
			{ ...valid, id: "foreign", source: "absent" },
		];
		const result = resolveAliases(catalog, [valid, explicit, ...collisions, ...invalidSources]);
		expect(result.aliases).toEqual([valid, explicit]);
		expect(result.issues).toEqual([
			...collisions.map((entry) => ({ kind: "collision" as const, alias: entry })),
			...invalidSources.map((entry) => ({ kind: "missing-source" as const, alias: entry })),
		]);
		const payload = { model: "occupied" };
		expect(rewriteAliasPayload(payload, { provider: "p", id: "occupied" }, result.aliases)).toBe(
			payload,
		);
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

	test("does not expand ambiguous, nonchat or alias sources", () => {
		const base = { provider: "p", id: "base", name: "Base", contextWindow: 20, maxTokens: 10 };
		const image = { ...base, id: "image", type: "image" };
		const duplicated = { ...base, id: "duplicate" };
		const valid = { provider: "p", source: "base", id: "short" };
		const rejected = [
			{ provider: "p", source: "image", id: "image-alias" },
			{ provider: "p", source: "duplicate", id: "ambiguous" },
			{ provider: "p", source: "short", id: "chain" },
		];
		const result = expandAliases([base, image, duplicated, duplicated], [valid, ...rejected]);
		expect(result.models.map((model) => model.id)).toEqual([
			"base",
			"image",
			"duplicate",
			"duplicate",
			"short",
		]);
		expect(result.issues).toEqual(
			rejected.map((entry) => ({ kind: "missing-source", alias: entry })),
		);
	});
});

describe("native alias visibility", () => {
	const base: Model<"anthropic-messages"> = {
		provider: "test",
		id: "base",
		name: "Base",
		api: "anthropic-messages",
		baseUrl: "https://example.invalid",
		input: ["text"],
		reasoning: false,
		contextWindow: 5000,
		maxTokens: 500,
		cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
	};
	const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const aliases = [
		{ provider: "test", source: "base", id: "short", name: "Short", maxTokens: 100 },
		{ provider: "test", source: "denied", id: "denied-alias" },
		{ provider: "test", source: "base", id: "omitted-alias" },
	];

	test("rejects collisions and ambiguous sources from the complete catalog", () => {
		const other = { ...base, id: "other" };
		const occupied = { ...base, id: "occupied" };
		const image = { ...base, id: "image", type: "image" as const, output: ["image" as const] };
		const duplicate = { ...image, id: "base" };
		const chat = [base, other, occupied];
		const physical = [...chat, image, duplicate];
		const rejected = [
			{ provider: "test", source: "other", id: "occupied" },
			{ provider: "test", source: "other", id: "image" },
			{ provider: "test", source: "base", id: "ambiguous" },
		];
		const provider: Provider<"anthropic-messages"> = {
			id: "test",
			name: "Test",
			auth: {},
			getModels: () => chat,
			getAllModels: () => physical,
			stream: () => {
				throw new Error("unused");
			},
			streamSimple: () => {
				throw new Error("unused");
			},
		};
		const issues: string[] = [];
		const wrapped = wrapNativeAliases(
			provider,
			() => rejected,
			(found) => {
				issues.push(...found.map((issue) => issue.kind));
			},
		);
		expect(wrapped.getModels()).toEqual(chat);
		expect(issues).toEqual(["collision", "collision", "missing-source"]);
		const onlyOther = [other];
		expect(wrapped.filterModels?.(onlyOther, undefined)).toEqual(onlyOther);
	});

	test("named catalogs use the same physical source boundary", () => {
		const image = { ...base, id: "image", type: "image" as const, output: ["image" as const] };
		const other = { ...base, id: "other" };
		const physical = [base, other, image, { ...image, id: "base" }];
		const aliases = [
			{ provider: "test", source: "other", id: "base" },
			{ provider: "test", source: "other", id: "image" },
			{ provider: "test", source: "base", id: "ambiguous" },
		];
		const issues: string[] = [];
		const wrapped = wrapNamedAliases(
			"test",
			{ models: physical },
			() => aliases,
			(found) => {
				issues.push(...found.map((issue) => issue.kind));
			},
		);
		expect(wrapped.models).toEqual(physical);
		expect(issues).toEqual(["collision", "collision", "missing-source"]);
	});

	for (const allPolicy of [false, true]) {
		test(`uses the hidden physical source for credential policy (all policy: ${allPolicy})`, () => {
			const denied = { ...base, id: "denied" };
			const image = { ...base, id: "image", type: "image" as const, output: ["image" as const] };
			const deniedImage = { ...image, id: "denied-image" };
			const credential = { type: "api_key" as const };
			const policyCalls: string[][] = [];
			const provider: Provider<"anthropic-messages"> = {
				id: "test",
				name: "Test",
				auth: {},
				getModels: () => [base, denied],
				getAllModels: () => [base, denied, image, deniedImage],
				filterModels: (models, received) => {
					expect(received).toBe(credential);
					expect(models.find((model) => model.id === "base")).toBe(base);
					policyCalls.push(models.map((model) => model.id));
					return models
						.filter((model) => model.id !== "denied")
						.map((model) => ({ ...model, cost: zeroCost }));
				},
				...(allPolicy
					? {
							filterAllModels: (models, received) => {
								expect(received).toBe(credential);
								expect(models.find((model) => model.id === "base")).toBe(base);
								policyCalls.push(models.map((model) => model.id));
								return models
									.filter((model) => model.id !== "denied" && model.id !== "denied-image")
									.map((model) => ({ ...model, cost: zeroCost }));
							},
						}
					: {}),
				stream: () => {
					throw new Error("unused");
				},
				streamSimple: () => {
					throw new Error("unused");
				},
			};
			const aliased = wrapNativeAliases(provider, () => aliases);
			const wrapped = filterNativeProvider(
				aliased,
				(model) => model.id !== "base" && model.id !== "denied",
			);
			const models = wrapped.getModels().filter((model) => model.id !== "omitted-alias");
			const available = wrapped.filterModels?.(models, credential) ?? [];
			expect(available.map((model) => model.id)).toEqual(["short"]);
			expect(available[0]).toMatchObject({ name: "Short", maxTokens: 100, cost: zeroCost });
			const all = (wrapped.getAllModels?.() ?? []).filter((model) => model.id !== "omitted-alias");
			const allAvailable = wrapped.filterAllModels?.(all, credential) ?? [];
			expect(allAvailable.map((model) => model.id)).toEqual(
				allPolicy ? ["image", "short"] : ["image", "denied-image", "short"],
			);
			expect(allAvailable.find((model) => model.id === "image")?.cost).toEqual(
				allPolicy ? zeroCost : image.cost,
			);
			expect(allAvailable.find((model) => model.id === "short")).toMatchObject({
				name: "Short",
				maxTokens: 100,
				cost: zeroCost,
			});
			expect(aliased.filterModels?.([base], credential)).toEqual([{ ...base, cost: zeroCost }]);
			expect(aliased.filterAllModels?.([base], credential)).toEqual([{ ...base, cost: zeroCost }]);
			expect(policyCalls).toEqual([
				["base", "denied"],
				allPolicy ? ["image", "denied-image", "base", "denied"] : ["base", "denied"],
				["base"],
				["base"],
			]);
		});
	}
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
