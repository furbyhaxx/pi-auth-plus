import { describe, expect, test } from "bun:test";
import type { ModelsPublication, RefreshModelsContext } from "@earendil-works/pi-ai";
import fixture from "../../../assets/antigravity/models.json";
import {
	AntigravityCatalogError,
	bundledModels,
	CATALOG_TTL_MS,
	CATALOG_URL,
	type CatalogDeps,
	parseCatalog,
	refreshCatalog,
} from "../../../src/families/google/catalog.ts";
import { decodeLevel } from "../../../src/families/google/levels.ts";

const now = 1_800_000_000_000;
const credential = {
	type: "oauth",
	access: "test-access",
	refresh: "test-refresh",
	expires: now,
} as const;

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

function deps(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
	return {
		now: () => now,
		headers: () => ({ "User-Agent": "test-cli" }),
		project: async () => "test-project",
		fetch: async () => {
			throw new Error("unexpected fetch");
		},
		...overrides,
	};
}

describe("families/google/catalog", () => {
	test("groups only offered agent models in catalog order and maps every wire level", () => {
		const models = parseCatalog(fixture);
		expect(models.map((model) => model.id)).toEqual([
			"gemini-4-argon",
			"gemini-3.8-flash",
			"claude-opus-5-5",
			"claude-sonnet-5-5",
			"gpt-oss-120b",
		]);
		const enums = [
			["M419", "M418", "M417"],
			["M320", "M319", "M318"],
			["M400", "M401", "M402"],
			["M403", "M404", "M405"],
		];
		for (const [index, model] of models.entries()) {
			expect(model).toMatchObject({
				provider: "antigravity",
				api: "google-generative-ai",
				baseUrl: "https://daily-cloudcode-pa.googleapis.com",
				reasoning: true,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			});
			expect(model.name).not.toMatch(/\((Low|Medium|High)\)/);
			expect(model.input).toEqual(index === 4 ? ["text"] : ["text", "image"]);
			expect([model.contextWindow, model.maxTokens]).toEqual(
				index < 2 ? [1048576, 65536] : index < 4 ? [1000000, 128000] : [131072, 32768],
			);
			expect(model.thinkingLevelMap?.off).toBeNull();
			expect(model.thinkingLevelMap?.minimal).toBeNull();
			expect(model.thinkingLevelMap).not.toHaveProperty("xhigh");
			expect(model.thinkingLevelMap).not.toHaveProperty("max");
			for (const [effortIndex, effort] of (["low", "medium", "high"] as const).entries()) {
				const encoded = model.thinkingLevelMap?.[effort];
				if (index === 4 && effort !== "medium") {
					expect(encoded).toBeNull();
					continue;
				}
				if (typeof encoded !== "string") throw new Error("missing encoded level");
				const level = ({ low: "LOW", medium: "MEDIUM", high: "HIGH" } as const)[effort];
				expect(decodeLevel(encoded)).toEqual({
					id: `${model.id}-${effort}`,
					modelEnum:
						index === 4
							? "MODEL_OPENAI_GPT_OSS_120B_MEDIUM"
							: `MODEL_PLACEHOLDER_${enums[index]?.[effortIndex]}`,
					thinking:
						index === 1
							? { kind: "budget", budget: { low: 1000, medium: 4000, high: -1 }[effort] }
							: index === 4
								? { kind: "budget", budget: 8192 }
								: { kind: index === 0 ? "level" : "adaptive", level },
				});
			}
		}
		expect(bundledModels()).toEqual(models);
	});

	test("rejects malformed envelopes and skips unusable rows while taking conservative limits", () => {
		for (const payload of [
			null,
			[],
			{},
			{ models: [], agentModelSorts: [] },
			{ models: {}, agentModelSorts: [{}] },
		]) {
			expect(() => parseCatalog(payload)).toThrow(AntigravityCatalogError);
		}
		const row = fixture.models["gemini-4-argon-low"];
		const models = parseCatalog({
			models: {
				"family-low": row,
				"family-high": { ...row, maxTokens: 100, maxOutputTokens: 10 },
				"bad-medium": { ...row, maxTokens: 0 },
				"bad-low": { ...row, model: "" },
				"bad-high": { ...row, thinkingLevel: 7, thinkingBudget: -2 },
				"unknown-medium": null,
			},
			agentModelSorts: [
				{
					groups: [
						{
							modelIds: [
								"family-low",
								"family-high",
								"bad-medium",
								"bad-low",
								"bad-high",
								"unknown-medium",
								"missing-medium",
							],
						},
					],
				},
			],
		});
		expect(models).toHaveLength(1);
		expect(models[0]).toMatchObject({ id: "family", contextWindow: 100, maxTokens: 10 });
	});

	test("offline and missing OAuth credentials restore without side effects", async () => {
		const models = bundledModels();
		for (const overrides of [
			{ stored: { models }, credential },
			{ allowNetwork: true, stored: { models } },
			{ allowNetwork: true, credential: { type: "api_key", key: "test" } as const },
		]) {
			const { ctx, publications } = context(overrides);
			expect(await refreshCatalog(ctx, deps())).toEqual(models);
			expect(publications).toEqual([]);
		}
		expect(await refreshCatalog(context().ctx, deps())).toEqual(models);
		const initial = models[0];
		if (!initial) throw new Error("missing fixture model");
		const stored = { ...initial, id: "stored-model" };
		const restore = context({
			stored: {
				models: [
					stored,
					{ ...stored, provider: "other" },
					{ ...stored, api: "openai-completions" },
				],
			},
		});
		expect(await refreshCatalog(restore.ctx, deps())).toEqual([stored]);
		expect(restore.publications).toEqual([]);
	});

	test("fresh catalogs skip network; stale, unclocked and forced refreshes persist", async () => {
		const models = bundledModels();
		const fresh = context({
			allowNetwork: true,
			credential,
			stored: { models, checkedAt: now - CATALOG_TTL_MS + 1 },
		});
		expect(await refreshCatalog(fresh.ctx, deps())).toEqual(models);
		expect(fresh.publications).toEqual([]);
		let fetches = 0;
		for (const overrides of [
			{ stored: { models, checkedAt: now - CATALOG_TTL_MS } },
			{ stored: { models } },
			{ stored: { models, checkedAt: now }, force: true },
		]) {
			const { ctx, publications } = context({ allowNetwork: true, credential, ...overrides });
			const dependencies = deps({
				project: async (access, signal) => {
					expect(access).toBe("test-access");
					expect(signal).toBe(ctx.signal);
					return "test-project";
				},
				fetch: async (url, init) => {
					fetches++;
					expect(String(url)).toBe(CATALOG_URL);
					expect(init?.method).toBe("POST");
					expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-access");
					expect(new Headers(init?.headers).get("User-Agent")).toBe("test-cli");
					expect(JSON.parse(String(init?.body))).toEqual({ project: "test-project" });
					expect(init?.signal).toBeInstanceOf(AbortSignal);
					return Response.json(fixture);
				},
			});
			expect(await refreshCatalog(ctx, dependencies)).toEqual(models);
			expect(publications).toEqual([{ persist: { models, checkedAt: now } }]);
		}
		expect(fetches).toBe(3);
	});

	test("caller cancellation reaches the transport without publishing", async () => {
		const controller = new AbortController();
		controller.abort();
		const { ctx, publications } = context({
			allowNetwork: true,
			credential,
			signal: controller.signal,
		});
		await expect(
			refreshCatalog(
				ctx,
				deps({
					fetch: async (_url, init) => {
						expect(init?.signal?.aborted).toBe(true);
						throw controller.signal.reason;
					},
				}),
			),
		).rejects.toThrow("abort");
		expect(publications).toEqual([]);
	});

	test("failed refreshes are typed, redact credentials and never publish", async () => {
		for (const fetch of [
			async () => new Response("test-access", { status: 503 }),
			async () => new Response("not JSON"),
			async () => Response.json({}),
		]) {
			const { ctx, publications } = context({ allowNetwork: true, credential });
			try {
				await refreshCatalog(ctx, deps({ fetch }));
				throw new Error("expected rejection");
			} catch (error) {
				expect(error).toBeInstanceOf(AntigravityCatalogError);
				expect(String(error)).toContain("antigravity");
				expect(String(error)).toContain("fetchAvailableModels");
				expect(String(error)).not.toContain("test-access");
			}
			expect(publications).toEqual([]);
		}
	});
});
