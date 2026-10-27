import { describe, expect, test } from "bun:test";
import type { Model, ModelsPublication, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FetchFn } from "../../src/core/http/index.ts";
import { CATALOG_TTL_MS, parseCatalog } from "../../src/families/synthetic/catalog.ts";
import { createSyntheticFamily } from "../../src/families/synthetic/index.ts";
import fixture from "../fixtures/synthetic/models.json";

const now = 1_800_000_000_000;
type Config = Parameters<ExtensionAPI["registerProvider"]>[1];

async function registered(fetchFn: FetchFn = async () => Response.json(fixture)) {
	let config: Config | undefined;
	const family = createSyntheticFamily({ SYNTHETIC_API_KEY: "test" }, fetchFn, () => now);
	await family.register?.({
		registerProvider: (_id: string, value: Config) => {
			config = value;
		},
	} as unknown as ExtensionAPI);
	if (!config?.refreshModels) throw new Error("Synthetic was not registered");
	return { family, config, refresh: config.refreshModels };
}

function context(overrides: Partial<RefreshModelsContext> = {}) {
	const publications: ModelsPublication[] = [];
	const ctx: RefreshModelsContext = {
		allowNetwork: false,
		signal: new AbortController().signal,
		publish: async (publication) => {
			publications.push(publication);
			return true;
		},
		...overrides,
	};
	return { ctx, publications };
}

describe("families/synthetic", () => {
	test("maps the live catalog with real prices, limits and modalities", () => {
		const models = parseCatalog(fixture);
		expect(models).toHaveLength(14);
		expect(models.find((model) => model.id === "syn:small:text")).toMatchObject({
			name: "syn:small:text",
			api: "anthropic-messages",
			provider: "synthetic",
			baseUrl: "https://api.synthetic.new/anthropic",
			reasoning: true,
			input: ["text"],
			contextWindow: 196608,
			maxTokens: 65536,
			cost: { output: 0.5, cacheRead: 0.02, cacheWrite: 0 },
		});
		expect(models.find((model) => model.id === "syn:small:text")?.cost.input).toBeCloseTo(0.1, 12);
		expect(models.find((model) => model.id === "syn:large:vision")).toMatchObject({
			input: ["text", "image"],
			contextWindow: 524288,
			cost: { input: 3, output: 15, cacheWrite: 0 },
		});
		expect(models.find((model) => model.id === "syn:large:vision")?.cost.cacheRead).toBeCloseTo(
			0.45,
			12,
		);
	});

	test("filters unavailable, tool-less and invalid rows and preserves name fallbacks", () => {
		const row = {
			id: "valid",
			always_on: true,
			context_length: 100,
			max_output_length: 10,
			pricing: {
				prompt: "$1.50 per million",
				completion: "$2",
				input_cache_reads: "0",
				input_cache_writes: "0",
			},
		};
		const models = parseCatalog({
			data: [
				row,
				{ ...row, id: "off", always_on: false },
				{ ...row, id: "no-tools", supported_features: ["reasoning"] },
				{ ...row, id: "" },
				{ ...row, id: "bad-context", context_length: 0 },
				{ ...row, id: "bad-output", max_output_length: 1.5 },
				{ ...row, id: "fallback", hugging_face_id: "lab/model" },
			],
		});
		expect(models.map((model) => model.id)).toEqual(["valid", "fallback"]);
		expect(models[0]).toMatchObject({
			name: "valid",
			reasoning: false,
			cost: { input: 1.5, output: 2 },
		});
		expect(models[1]?.name).toBe("lab/model");
		expect(() => parseCatalog({ models: [] })).toThrow("synthetic");
		expect(() => parseCatalog({ data: [{ ...row, pricing: {} }] })).toThrow("pricing");
	});

	test("registration and offline restore never fetch or publish, and filter stored entries", async () => {
		let fetches = 0;
		const { config, refresh, family } = await registered(async () => {
			fetches++;
			throw new Error("unexpected fetch");
		});
		expect(fetches).toBe(0);
		expect(config).toMatchObject({
			name: "Synthetic",
			apiKey: "$SYNTHETIC_API_KEY",
			api: "anthropic-messages",
		});
		expect(config.streamSimple).toBeUndefined();
		expect(family.providers[0]?.ambient?.()).toEqual({
			source: "SYNTHETIC_API_KEY",
			limited: false,
		});
		const first = context();
		expect(await refresh(first.ctx)).toEqual(parseCatalog(fixture));
		const initial = parseCatalog(fixture)[0];
		if (!initial) throw new Error("Fixture has no models");
		const stored: Model<"anthropic-messages"> = {
			...initial,
			id: "stored",
		};
		const restore = context({
			stored: {
				models: [
					stored,
					{ ...stored, provider: "other" },
					{ ...stored, api: "openai-completions" },
				],
			},
		});
		expect(await refresh(restore.ctx)).toEqual([stored]);
		expect(first.publications).toEqual([]);
		expect(restore.publications).toEqual([]);
		expect(fetches).toBe(0);
	});

	test("fresh entries skip the network; stale, missing timestamp and forced entries fetch and persist once", async () => {
		let fetches = 0;
		const { refresh } = await registered(async (url, init) => {
			fetches++;
			expect(String(url)).toBe("https://api.synthetic.new/v1/models");
			expect(init?.headers).toEqual({ Accept: "application/json" });
			expect(init?.signal).toBeInstanceOf(AbortSignal);
			return Response.json(fixture);
		});
		const models = parseCatalog(fixture);
		const fresh = context({
			allowNetwork: true,
			stored: { models, checkedAt: now - CATALOG_TTL_MS + 1 },
		});
		expect(await refresh(fresh.ctx)).toEqual(models);
		expect(fetches).toBe(0);
		expect(fresh.publications).toEqual([]);
		for (const stored of [{ models, checkedAt: now - CATALOG_TTL_MS }, { models }]) {
			const stale = context({ allowNetwork: true, stored });
			expect(await refresh(stale.ctx)).toEqual(models);
			expect(stale.publications).toEqual([{ persist: { models, checkedAt: now } }]);
		}
		const forced = context({ allowNetwork: true, stored: { models, checkedAt: now }, force: true });
		await refresh(forced.ctx);
		expect(forced.publications).toEqual([{ persist: { models, checkedAt: now } }]);
		expect(fetches).toBe(3);
		const restored = context({ allowNetwork: true, stored: { models, checkedAt: now } });
		await refresh(restored.ctx);
		expect(fetches).toBe(3);
		expect(restored.publications).toEqual([]);
	});

	test("allowed-network failures reject without publishing and caller cancellation reaches fetch", async () => {
		const controller = new AbortController();
		controller.abort();
		const { refresh } = await registered(async (_url, init) => {
			expect(init?.signal?.aborted).toBe(true);
			throw new Error("cancelled");
		});
		const failed = context({ allowNetwork: true, signal: controller.signal });
		await expect(refresh(failed.ctx)).rejects.toThrow("cancelled");
		expect(failed.publications).toEqual([]);
		const http = await registered(async () => new Response("unavailable", { status: 503 }));
		await expect(http.refresh(context({ allowNetwork: true }).ctx)).rejects.toThrow(
			"synthetic: HTTP 503",
		);
	});
});
