import { describe, expect, test } from "bun:test";
import type { ModelsPublication, RefreshModelsContext } from "@earendil-works/pi-ai";
import {
	bundledModels,
	CATALOG_TTL_MS,
	CATALOG_URL,
	type CatalogDeps,
	ClaudeCatalogError,
	parseCatalog,
	refreshCatalog,
} from "../../../src/families/anthropic/catalog.ts";
import fixture from "../../fixtures/claude/v1-models.json";

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
		fetch: async () => {
			throw new Error("unexpected fetch");
		},
		...overrides,
	};
}

describe("families/anthropic/catalog", () => {
	test("persists the account listing with derived metadata and OAuth identity", async () => {
		const { ctx, publications } = context({ allowNetwork: true, credential });
		const models = await refreshCatalog(
			ctx,
			deps({
				fetch: async (url, init) => {
					expect(String(url)).toBe(CATALOG_URL);
					const headers = new Headers(init?.headers);
					expect(headers.get("Authorization")).toBe("Bearer test-access");
					expect(headers.get("anthropic-version")).toBe("2023-06-01");
					expect(headers.get("anthropic-beta")).toBe("oauth-2025-04-20");
					expect(headers.get("User-Agent")).toMatch(/^claude-cli\//);
					return Response.json(fixture);
				},
			}),
		);
		const template = bundledModels().find((model) => model.id === "claude-fable-5-1");
		expect(models.find((model) => model.id === "claude-fable-5-2")).toMatchObject({
			name: "Claude Fable 5.2",
			contextWindow: 1000000,
			maxTokens: 128000,
			cost: template?.cost,
			promptCache: template?.promptCache,
			inputLimits: template?.inputLimits,
			input: ["text", "image"],
			reasoning: true,
			thinkingLevelMap: {
				off: null,
				low: "low",
				medium: "medium",
				high: "high",
				xhigh: "xhigh",
				max: "max",
			},
			compat: { forceAdaptiveThinking: true },
		});
		expect(models.find((model) => model.id === "claude-fable-5-2")?.compat).not.toHaveProperty(
			"allowedFallbackModels",
		);
		expect(models.some((model) => model.id === "claude-sonnet-4-5-20250929")).toBe(false);
		expect(publications).toEqual([{ persist: { models, checkedAt: now } }]);
	});

	test("restores offline, filters foreign rows and uses the bundled first-run fallback", async () => {
		const models = bundledModels();
		const initial = models[0];
		if (!initial) throw new Error("missing bundled model");
		const { ctx, publications } = context({
			stored: { models: [initial, { ...initial, provider: "other" }] },
		});
		expect(await refreshCatalog(ctx, deps())).toEqual([initial]);
		expect(publications).toEqual([]);
		expect(await refreshCatalog(context().ctx, deps())).toEqual(models);
	});

	test("honors freshness, forced refresh and API-key auth", async () => {
		const models = bundledModels();
		const fresh = context({
			allowNetwork: true,
			credential,
			stored: { models, checkedAt: now - CATALOG_TTL_MS + 1 },
		});
		expect(await refreshCatalog(fresh.ctx, deps())).toEqual(models);
		for (const overrides of [
			{ stored: { models, checkedAt: now - CATALOG_TTL_MS } },
			{ stored: { models, checkedAt: now }, force: true },
			{ credential: { type: "api_key", key: "test-key" } as const },
		]) {
			const { ctx, publications } = context({ allowNetwork: true, credential, ...overrides });
			await refreshCatalog(
				ctx,
				deps({
					fetch: async (_url, init) => {
						if (ctx.credential?.type === "api_key")
							expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
						return Response.json(fixture);
					},
				}),
			);
			expect(publications).toHaveLength(1);
		}
	});

	test("matches dated ids, keeps known metadata, selects newest templates and skips unknown lines", () => {
		const template = bundledModels().find((model) => model.id === "claude-fable-5-1");
		if (!template) throw new Error("missing template");
		const row = fixture.data[0];
		if (!row) throw new Error("missing fixture row");
		const models = parseCatalog(
			{
				data: [
					{ ...row, id: `${template.id}-20261109`, max_input_tokens: 100 },
					{ ...row, id: "claude-fable-6" },
					{ ...row, id: "claude-unknown-1", line: "unknown" },
				],
				has_more: false,
			},
			[
				{
					...template,
					id: "claude-fable-4",
					cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
				},
				template,
			],
		);
		expect(models).toHaveLength(2);
		expect(models[0]).toMatchObject({
			id: `${template.id}-20261109`,
			name: template.name,
			contextWindow: 100,
			thinkingLevelMap: template.thinkingLevelMap,
		});
		expect(models[1]?.cost).toEqual(template.cost);
	});

	test("errors never expose response bodies or credentials and do not publish", async () => {
		for (const fetch of [
			async () => new Response("test-access", { status: 503 }),
			async () => new Response("not JSON"),
			async () => Response.json({ data: [], has_more: true }),
		]) {
			const { ctx, publications } = context({ allowNetwork: true, credential });
			try {
				await refreshCatalog(ctx, deps({ fetch }));
				throw new Error("expected failure");
			} catch (error) {
				expect(error).toBeInstanceOf(ClaudeCatalogError);
				expect(String(error)).toContain(CATALOG_URL);
				expect(String(error)).not.toContain("test-access");
			}
			expect(publications).toEqual([]);
		}
	});

	test("propagates caller cancellation without publishing", async () => {
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
});
