import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type ModelsPublication,
	type ModelsSimpleStreamOptions,
	type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	MessageEndEventResult,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { FetchFn } from "../../src/core/http/index.ts";
import {
	type FamilyAdapter,
	type FamilyHost,
	Registry,
	registerFamilyProviders,
} from "../../src/core/registry/index.ts";
import { CATALOG_TTL_MS, parseCatalog } from "../../src/families/synthetic/catalog.ts";
import { createSyntheticFamily, WEB_SEARCH_FLAG } from "../../src/families/synthetic/index.ts";
import { parseResults, TOOL_NAME, truncateHead } from "../../src/families/synthetic/web-search.ts";
import { AliasCatalog } from "../../src/models/aliases/runtime.ts";
import { installPhysicalRequestHooks } from "../../src/models/runtime/physical.ts";
import type { TokenizerStore } from "../../src/tokens/types.ts";
import fixture from "../fixtures/synthetic/models.json";
import search from "../fixtures/synthetic/search.json";
import { testHost } from "../host.ts";

const outputDir = mkdtempSync(join(tmpdir(), "synthetic search  test-"));
afterAll(() => rmSync(outputDir, { recursive: true, force: true }));

const now = 1_800_000_000_000;
type Config = Parameters<ExtensionAPI["registerProvider"]>[1];

type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

async function registered(
	fetchFn: FetchFn = async () => Response.json(fixture),
	options: { setting?: boolean; flag?: boolean; outputDir?: string; onOutputDir?: () => void } = {},
) {
	let config: Config | undefined;
	const tools: Tool[] = [];
	const sessionStart: Array<() => void> = [];
	let activeTools = ["read", "bash"];
	const changes: string[][] = [];
	const family = createSyntheticFamily(
		{ SYNTHETIC_API_KEY: "test" },
		fetchFn,
		() => now,
		() => {
			options.onOutputDir?.();
			return options.outputDir ?? outputDir;
		},
	);
	const host = await testHost(
		options.setting === undefined ? {} : { "synthetic.webSearch": options.setting },
	);
	const pi = {
		registerProvider: (_id: string, value: Config) => {
			config = value;
		},
		registerFlag: () => {},
		getFlag: (name: string) => (name === WEB_SEARCH_FLAG ? options.flag : undefined),
		registerTool: (tool: Tool) => {
			tools.push(tool);
			if (tool.defaultActive !== false) activeTools.push(tool.name);
		},
		getActiveTools: () => [...activeTools],
		setActiveTools: (names: string[]) => {
			activeTools = [...names];
			changes.push([...names]);
		},
		on: (event: string, handler: () => void) => {
			if (event === "session_start") sessionStart.push(handler);
		},
	} as unknown as ExtensionAPI;
	await registerFamilyProviders(pi, new Registry([family]), host);
	await family.register?.(pi, host);
	if (!config?.refreshModels) throw new Error("Synthetic was not registered");
	const startSession = () => {
		for (const handler of sessionStart) handler();
	};
	return {
		family,
		host,
		config,
		refresh: config.refreshModels,
		tools,
		startSession,
		active: pi.getActiveTools,
		setActive: pi.setActiveTools,
		changes,
	};
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

const physicalA = "hf:example/physical-a";
const physicalB = "hf:example/physical-b";
const acceptedAlias = { provider: "synthetic", id: "short-name", source: physicalA };
const collidingAlias = { provider: "synthetic", id: physicalB, source: physicalA };

function aliasModel(id: string): Model<Api> {
	return {
		id,
		name: id,
		provider: "synthetic",
		api: "anthropic-messages",
		baseUrl: "https://example.test",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: false,
		contextWindow: 1000,
		maxTokens: 100,
	};
}

function aliasMessage(id: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "synthetic",
		model: id,
		stopReason: "stop",
		timestamp: 0,
		usage: {
			input: 4,
			output: 2,
			cacheRead: 4,
			cacheWrite: 4,
			totalTokens: 14,
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0, total: 6 },
		},
	};
}

const aliasPayload = (id: string) => ({
	model: id,
	messages: [{ role: "user", content: "abcdef" }],
});

async function aliasHarness(options: { aliases?: boolean; resolveModel?: boolean } = {}) {
	const base = await testHost({ "models.aliases": [collidingAlias, acceptedAlias] });
	const catalog = new AliasCatalog(() => base.settings().get("models.aliases"));
	catalog.register("synthetic", () => [aliasModel(physicalA), aliasModel(physicalB)]);
	const host: FamilyHost = {
		...base,
		...(options.aliases === false ? {} : { aliases: () => catalog.aliases() }),
		...(options.resolveModel === false ? {} : { resolveModel: catalog.resolve.bind(catalog) }),
	};
	const loads: string[] = [];
	const tokenizers: TokenizerStore = {
		peek: (repo) => {
			if (repo === "example/physical-a") return { id: repo, count: (text) => text.length };
			if (repo === "example/physical-b") return { id: repo, count: (text) => text.length * 2 };
			return undefined;
		},
		load: async (repo) => {
			loads.push(repo);
			return undefined;
		},
	};
	type Handler = (event: ExtensionEvent, ctx: ExtensionContext) => unknown;
	const handlers = new Map<string, Handler>();
	const pi = {
		registerFlag: () => {},
		getFlag: () => false,
		registerTool: () => {},
		getActiveTools: () => [],
		setActiveTools: () => {},
		on: (name: string, handler: Handler) => handlers.set(name, handler),
	} as unknown as ExtensionAPI;
	const family = createSyntheticFamily({}, undefined, undefined, undefined, tokenizers);
	await family.register?.(pi, host);
	const emit = (event: ExtensionEvent, model: Model<Api>) =>
		handlers.get(event.type)?.(event, { model } as ExtensionContext);
	const preload = (model: Model<Api>) => {
		emit({ type: "session_start", reason: "startup" }, model);
		emit({ type: "model_select", model, previousModel: undefined, source: "set" }, model);
	};
	const fallback = (model: Model<Api>) => {
		emit({ type: "before_provider_request", payload: aliasPayload(model.id) }, model);
		return emit({ type: "message_end", message: aliasMessage(model.id) }, model) as
			| MessageEndEventResult
			| undefined;
	};
	const deps = { auth: async () => undefined, fetch: async () => new Response(), tokenizers };
	return { family, host, catalog, loads, deps, preload, fallback };
}

async function aliasPhysicalRequest(family: FamilyAdapter, host: FamilyHost, model: Model<Api>) {
	const requests: { options: ModelsSimpleStreamOptions | undefined }[] = [];
	const source = createAssistantMessageEventStream();
	const runtime = {
		stream(_model: Model<Api>, _context: Context, options?: ModelsSimpleStreamOptions) {
			requests.push({ options });
			return source;
		},
		streamSimple(
			selected: Model<Api>,
			context: Context,
			requestOptions?: ModelsSimpleStreamOptions,
		) {
			return this.stream(selected, context, requestOptions);
		},
	};
	expect(
		installPhysicalRequestHooks({ runtime }, (selected) =>
			family.physical?.(selected, { ...host, cwd: "/" }),
		),
	).toBe(true);
	const stream = runtime.stream(model, { messages: [] });
	const request = requests[0];
	if (!request?.options?.onPayload) throw new Error("missing physical payload hook");
	const payload = aliasPayload(model.id);
	const wire = await request.options.onPayload(payload, model);
	source.push({ type: "done", reason: "stop", message: aliasMessage(model.id) });
	return { payload, wire, message: await stream.result() };
}

describe("families/synthetic", () => {
	test("rejected physical-id collisions do not rewrite physical requests", async () => {
		const { family, host, catalog } = await aliasHarness();
		expect(catalog.issues()).toEqual([{ kind: "collision", alias: collidingAlias }]);
		expect(catalog.aliases()).toEqual([acceptedAlias]);
		const result = await aliasPhysicalRequest(family, host, aliasModel(physicalB));
		expect(result.wire).toBe(result.payload);
		expect(result.message).toMatchObject({
			model: physicalB,
			usage: { input: 6, cacheRead: 6, cacheWrite: 0, totalTokens: 14 },
		});
	});

	test("rejected identities keep their physical tokenizer in counts, preload and fallback", async () => {
		const { family, deps, loads, preload, fallback } = await aliasHarness();
		const model = aliasModel(physicalB);
		const counter = family.tokens?.(model, deps);
		expect(counter?.id).toBe("example/physical-b");
		expect(await counter?.count("abcdef", "prose")).toEqual({ tokens: 12, source: "tokenizer" });
		preload(model);
		expect(loads).toEqual(["example/physical-b", "example/physical-b"]);
		expect(fallback(model)?.message).toMatchObject({
			model: physicalB,
			usage: { input: 6, cacheRead: 6, cacheWrite: 0, totalTokens: 14 },
		});
	});

	test("accepted aliases use their physical source while retaining logical response identity", async () => {
		const { family, host, deps, loads, preload, fallback } = await aliasHarness();
		const model = aliasModel(acceptedAlias.id);
		const result = await aliasPhysicalRequest(family, host, model);
		expect(result.wire).toEqual({ ...result.payload, model: physicalA });
		expect(result.message).toMatchObject({
			model: acceptedAlias.id,
			usage: { input: 3, cacheRead: 3, cacheWrite: 0, totalTokens: 8 },
		});
		const counter = family.tokens?.(model, deps);
		expect(counter?.id).toBe("example/physical-a");
		expect(await counter?.count("abcdef", "prose")).toEqual({ tokens: 6, source: "tokenizer" });
		preload(model);
		expect(loads).toEqual(["example/physical-a", "example/physical-a", "example/physical-a"]);
		expect(fallback(model)?.message).toMatchObject({
			model: acceptedAlias.id,
			usage: { input: 3, cacheRead: 3, cacheWrite: 0, totalTokens: 8 },
		});
	});

	test.each([true, false])(
		"missing accepted-alias seam never rewrites from raw settings (resolver %s)",
		async (resolveModel) => {
			const { family, host } = await aliasHarness({ aliases: false, resolveModel });
			const result = await aliasPhysicalRequest(family, host, aliasModel(acceptedAlias.id));
			expect(result.wire).toBe(result.payload);
		},
	);

	test("missing resolver never uses raw aliases for counts, preload or fallback", async () => {
		const { family, deps, loads, preload, fallback } = await aliasHarness({ resolveModel: false });
		const model = aliasModel(acceptedAlias.id);
		const counter = family.tokens?.(model, deps);
		expect(counter?.id).toBe("estimate:synthetic:4/3");
		expect(await counter?.count("abcdef", "prose")).toEqual({ tokens: 2, source: "estimate" });
		preload(model);
		expect(loads).toEqual([]);
		expect(fallback(model)?.message).toMatchObject({
			model: acceptedAlias.id,
			usage: { input: 4, cacheRead: 4, cacheWrite: 0, totalTokens: 10 },
		});
	});

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
				{ ...row, id: "bad-price", pricing: { ...row.pricing, completion: "n/a" } },
				{ ...row, id: "no-cache-price", pricing: { prompt: "$1", completion: "$2" } },
				{ ...row, id: "fallback", hugging_face_id: "lab/model" },
			],
		});
		expect(models.map((model) => model.id)).toEqual(["valid", "no-cache-price", "fallback"]);
		expect(models[1]?.cost).toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
		expect(models[0]).toMatchObject({
			name: "valid",
			reasoning: false,
			cost: { input: 1.5, output: 2 },
		});
		expect(models[2]?.name).toBe("lab/model");
		expect(() => parseCatalog({ models: [] })).toThrow("synthetic");
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

	test("registers once and synchronizes live settings without changing unrelated tools", async () => {
		const { family, host, tools, active, setActive, changes, startSession } = await registered();
		const signal = new AbortController().signal;
		expect(tools.map((tool) => tool.name)).toEqual([TOOL_NAME]);
		expect(tools[0]?.defaultActive).toBe(false);
		expect(active()).toEqual(["read", "bash"]);
		startSession();
		startSession();
		expect(active()).toEqual(["read", "bash"]);
		expect(changes).toEqual([]);

		await host.settings().save("runtime", { "synthetic.webSearch": true });
		await family.settingsChanged?.(["unrelated.setting"], signal);
		expect(active()).toEqual(["read", "bash"]);
		const aborted = new AbortController();
		aborted.abort();
		await family.settingsChanged?.(["synthetic.webSearch"], aborted.signal);
		expect(active()).toEqual(["read", "bash"]);
		await family.settingsChanged?.(["synthetic.webSearch"], signal);
		expect(active()).toEqual(["read", "bash", TOOL_NAME]);
		await family.settingsChanged?.(["synthetic.webSearch"], signal);
		startSession();
		expect(active()).toEqual(["read", "bash", TOOL_NAME]);
		setActive(["other", TOOL_NAME, "read", TOOL_NAME, "bash"]);
		await family.settingsChanged?.(["synthetic.webSearch"], signal);
		expect(active()).toEqual(["other", TOOL_NAME, "read", "bash"]);
		setActive(["other", "read", TOOL_NAME, "bash"]);
		await host.settings().save("runtime", { "synthetic.webSearch": false });
		await family.settingsChanged?.(["synthetic.webSearch"], signal);
		expect(active()).toEqual(["other", "read", "bash"]);
		setActive(["other", TOOL_NAME, "read", "bash"]);
		startSession();
		startSession();
		expect(active()).toEqual(["other", "read", "bash"]);
		expect(tools).toHaveLength(1);
	});

	test("the search flag keeps the tool active and executable when settings are disabled", async () => {
		let fetches = 0;
		let authentications = 0;
		const search = await registered(
			async () => {
				fetches++;
				return Response.json({ results: [] });
			},
			{ flag: true },
		);
		search.startSession();
		await search.host.settings().save("runtime", { "synthetic.webSearch": false });
		await search.family.settingsChanged?.(["synthetic.webSearch"], new AbortController().signal);
		search.startSession();
		expect(search.tools).toHaveLength(1);
		expect(search.active()).toEqual(["read", "bash", TOOL_NAME]);
		const tool = search.tools[0];
		if (!tool) throw new Error("tool missing");
		const result = await tool.execute("call", { query: "hello" }, undefined, undefined, {
			modelRegistry: {
				getProviderAuth: async () => {
					authentications++;
					return { auth: { apiKey: "test-key" } };
				},
			},
		} as never);
		expect(result.details).toMatchObject({ kind: "success", resultCount: 0 });
		expect([authentications, fetches]).toEqual([1, 1]);
	});

	test("a disabled stale tool returns actionable failure before auth, network or files", async () => {
		let authentications = 0;
		let fetches = 0;
		let outputDirs = 0;
		const search = await registered(
			async () => {
				fetches++;
				return Response.json({ results: [] });
			},
			{ setting: true, onOutputDir: () => outputDirs++ },
		);
		search.startSession();
		await search.host.settings().save("runtime", { "synthetic.webSearch": false });
		await search.family.settingsChanged?.(["synthetic.webSearch"], new AbortController().signal);
		search.setActive(["read", TOOL_NAME, "bash"]);
		const tool = search.tools[0];
		if (!tool?.renderResult) throw new Error("tool or renderer missing");
		const updates: AgentToolResult<unknown>[] = [];
		const result = await tool.execute(
			"call",
			{ query: "hello" },
			undefined,
			(update) => updates.push(update),
			{
				modelRegistry: {
					getProviderAuth: async () => {
						authentications++;
						return { auth: { apiKey: "test-key" } };
					},
				},
			} as never,
		);
		expect(result).toMatchObject({ isError: true, details: { kind: "error", code: "disabled" } });
		expect(JSON.stringify(result)).toContain("synthetic.webSearch");
		expect(JSON.stringify(result)).toContain("--synthetic-web-search");
		expect([authentications, fetches, outputDirs, updates.length]).toEqual([0, 0, 0, 0]);
		const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
		for (const width of [36, 57, 80, 140]) {
			const context = { state: {}, outputPad: 1, isError: true };
			const component = tool.renderResult(
				result,
				{ expanded: false, isPartial: false },
				theme as never,
				context as never,
			);
			const lines = component.render(width);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			const text = stripVTControlCharacters(lines.join("\n"));
			expect(text).toContain("disabled");
			expect(text).toContain("synthetic.webSearch");
			expect(text).toContain("--synthetic-web-search");
			expect(text).not.toContain("/login synthetic");
		}
	});

	test("disabling during authentication prevents the search request", async () => {
		let finishAuth: ((value: { auth: { apiKey: string } }) => void) | undefined;
		const auth = new Promise<{ auth: { apiKey: string } }>((resolve) => {
			finishAuth = resolve;
		});
		let fetches = 0;
		const search = await registered(
			async () => {
				fetches++;
				return Response.json({ results: [] });
			},
			{ setting: true },
		);
		search.startSession();
		const tool = search.tools[0];
		if (!tool) throw new Error("tool missing");
		const pending = tool.execute("call", { query: "hello" }, undefined, undefined, {
			modelRegistry: { getProviderAuth: () => auth },
		} as never);
		await search.host.settings().save("runtime", { "synthetic.webSearch": false });
		await search.family.settingsChanged?.(["synthetic.webSearch"], new AbortController().signal);
		if (!finishAuth) throw new Error("auth resolver missing");
		finishAuth({ auth: { apiKey: "test-key" } });
		expect(await pending).toMatchObject({ isError: true, details: { code: "disabled" } });
		expect(fetches).toBe(0);
	});

	test("disabling during response parsing prevents a full-text file write", async () => {
		let bodyStarted: (() => void) | undefined;
		let finishBody: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			bodyStarted = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			finishBody = resolve;
		});
		let outputDirs = 0;
		const search = await registered(
			async () => {
				const response = Response.json({
					results: [{ url: "https://example.test", text: "full page", highlights: ["passage"] }],
				});
				const json = response.json.bind(response);
				Object.defineProperty(response, "json", {
					value: async () => {
						bodyStarted?.();
						await gate;
						return await json();
					},
				});
				return response;
			},
			{ setting: true, onOutputDir: () => outputDirs++ },
		);
		search.startSession();
		const tool = search.tools[0];
		if (!tool) throw new Error("tool missing");
		const pending = tool.execute("call", { query: "hello" }, undefined, undefined, {
			modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }) },
		} as never);
		await started;
		await search.host.settings().save("runtime", { "synthetic.webSearch": false });
		await search.family.settingsChanged?.(["synthetic.webSearch"], new AbortController().signal);
		if (!finishBody) throw new Error("body resolver missing");
		finishBody();
		expect(await pending).toMatchObject({ isError: true, details: { code: "disabled" } });
		expect(outputDirs).toBe(0);
	});

	test("head truncation keeps whole lines within 50 KB and 2000 lines", () => {
		expect(truncateHead("a\nb")).toEqual({ content: "a\nb", truncated: false });
		const long = truncateHead(`${"x".repeat(30 * 1024)}\n${"y".repeat(30 * 1024)}`);
		expect(long).toEqual({ content: "x".repeat(30 * 1024), truncated: true });
		const many = truncateHead(Array.from({ length: 2500 }, (_, i) => String(i)).join("\n"));
		expect(many.content.split("\n")).toHaveLength(2000);
	});

	test("keeps results without a publication date and returns passages with the full text saved", async () => {
		expect(parseResults(search).map((result) => result.published ?? null)).toEqual([
			"2025-10-10T20:00:00.000Z",
			"2025-10-10T20:00:00.000Z",
			null,
			null,
			"2025-10-13T15:17:28.000Z",
		]);

		const requests: Request[] = [];
		const fetchFn: FetchFn = async (input, init) => {
			requests.push(new Request(input as string, init));
			return Response.json(search);
		};
		const { tools, startSession } = await registered(fetchFn, { setting: true });
		startSession();
		const tool = tools[0];
		if (!tool) throw new Error("tool missing");
		const ctx = {
			modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "sk-test" } }) },
		};
		const result = await tool.execute(
			"call",
			{ query: "Bun 1.3" },
			undefined,
			undefined,
			ctx as never,
		);

		expect(requests[0]?.headers.get("authorization")).toBe("Bearer sk-test");
		expect(await requests[0]?.json()).toEqual({ query: "Bun 1.3" });
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("## 3. Bun v1.3");
		expect(text).toContain("Published: unknown");
		const details = result.details as { fullOutputPath: string; truncated: boolean };
		expect(details.truncated).toBe(false);
		expect(text.length).toBeLessThan(20_000);
		const full = readFileSync(details.fullOutputPath, "utf8");
		expect(full.length).toBeGreaterThan(200_000);
		expect(statSync(details.fullOutputPath).mode & 0o777).toBe(0o600);

		const anonymous = { modelRegistry: { getProviderAuth: async () => undefined } };
		const missing = await tool.execute(
			"call",
			{ query: "x" },
			undefined,
			undefined,
			anonymous as never,
		);
		expect(missing).toMatchObject({ isError: true, details: { kind: "error", code: "auth" } });
		expect(JSON.stringify(missing)).toContain("/login synthetic");
	});

	test("returns an empty result and persists truncated fallback text with private permissions", async () => {
		const ctx = {
			modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "test" } }) },
		};
		const empty = await registered(async () => Response.json({ results: [] }), { setting: true });
		empty.startSession();
		const emptyTool = empty.tools[0];
		if (!emptyTool) throw new Error("tool missing");
		const noResults = await emptyTool.execute(
			"call",
			{ query: "none" },
			undefined,
			undefined,
			ctx as never,
		);
		expect(noResults.content[0]).toMatchObject({ type: "text", text: "No results found." });
		expect(noResults.details).toMatchObject({
			kind: "success",
			resultCount: 0,
			results: [],
			fullOutputPath: undefined,
		});

		const pageText = `first line\n${"x".repeat(60 * 1024)}`;
		const large = await registered(
			async () =>
				Response.json({
					results: [{ url: "https://example.test", title: "large", text: pageText }],
				}),
			{ setting: true },
		);
		large.startSession();
		const largeTool = large.tools[0];
		if (!largeTool) throw new Error("tool missing");
		const truncated = await largeTool.execute(
			"call",
			{ query: "large" },
			undefined,
			undefined,
			ctx as never,
		);
		const details = truncated.details as { fullOutputPath: string; truncated: boolean };
		expect(details.truncated).toBe(true);
		expect(truncated.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("Output truncated"),
		});
		expect(readFileSync(details.fullOutputPath, "utf8")).toContain(pageText);
		expect(statSync(details.fullOutputPath).mode & 0o777).toBe(0o600);
	});

	test("normalizes missing auth without hiding unrelated resolver bugs", async () => {
		const { tools, startSession } = await registered(undefined, { setting: true });
		startSession();
		const tool = tools[0];
		if (!tool) throw new Error("tool missing");
		const missing = new Error("API key auth failed for provider synthetic", {
			cause: new Error(
				'Failed to resolve API key for provider "synthetic" from environment variable: SYNTHETIC_API_KEY',
			),
		});
		missing.name = "ModelsError";
		Object.assign(missing, { code: "auth" });
		const ctx = {
			modelRegistry: {
				getProviderAuth: async () => {
					throw missing;
				},
			},
		};
		const result = await tool.execute("call", { query: "x" }, undefined, undefined, ctx as never);
		expect(result).toMatchObject({ isError: true, details: { kind: "error", code: "auth" } });
		expect(JSON.stringify(result)).toContain("/login synthetic");
		const bug = {
			modelRegistry: {
				getProviderAuth: async () => {
					throw new TypeError("bug");
				},
			},
		};
		await expect(
			tool.execute("call", { query: "x" }, undefined, undefined, bug as never),
		).rejects.toThrow("bug");
		const wrappedBug = new Error("API key auth failed for provider synthetic", {
			cause: new TypeError("bad resolver"),
		});
		wrappedBug.name = "ModelsError";
		Object.assign(wrappedBug, { code: "auth" });
		const wrapped = {
			modelRegistry: {
				getProviderAuth: async () => {
					throw wrappedBug;
				},
			},
		};
		await expect(
			tool.execute("call", { query: "x" }, undefined, undefined, wrapped as never),
		).rejects.toThrow("API key auth failed");
	});

	test("reports HTTP, network and malformed responses with safe actionable details", async () => {
		const secret = "syn_0123456789abcdefghijkl";
		const ctx = { modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: secret } }) } };
		const cases: Array<{ fetch: FetchFn; code: string; status?: number }> = [
			{
				fetch: async () => new Response(`body ${secret}`, { status: 401 }),
				code: "http",
				status: 401,
			},
			{
				fetch: async () => new Response(`body ${secret}`, { status: 503 }),
				code: "http",
				status: 503,
			},
			{
				fetch: async () => {
					throw new Error(`network ${secret}`);
				},
				code: "network",
			},
			{ fetch: async () => new Response("{invalid"), code: "parse" },
			{ fetch: async () => Response.json({ invalid: true }), code: "parse" },
		];
		for (const item of cases) {
			const { tools, startSession } = await registered(item.fetch, { setting: true });
			startSession();
			const tool = tools[0];
			if (!tool) throw new Error("tool missing");
			const updates: AgentToolResult<unknown>[] = [];
			const result = await tool.execute(
				"call",
				{ query: "x" },
				undefined,
				(update) => updates.push(update),
				ctx as never,
			);
			expect(result).toMatchObject({
				isError: true,
				details: {
					kind: "error",
					code: item.code,
					...(item.status === undefined ? {} : { status: item.status }),
				},
			});
			expect(JSON.stringify(result)).toContain("/login synthetic");
			expect(JSON.stringify(result)).not.toContain(secret);
			expect(JSON.stringify(result)).not.toContain("body ");
			expect(updates).toHaveLength(1);
			expect(updates[0]?.details).toMatchObject({ kind: "progress" });
		}
	});

	test("honors cancellation before and during auth, request, and response parsing", async () => {
		let fetches = 0;
		let enteredFetch: (() => void) | undefined;
		const entered = new Promise<void>((resolve) => {
			enteredFetch = resolve;
		});
		const { tools, startSession } = await registered(
			async (_url, init) => {
				fetches++;
				enteredFetch?.();
				return await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					});
				});
			},
			{ setting: true },
		);
		startSession();
		const tool = tools[0];
		if (!tool) throw new Error("tool missing");
		const ctx = {
			modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }) },
		};
		const early = new AbortController();
		early.abort();
		const before = await tool.execute(
			"call",
			{ query: "x" },
			early.signal,
			undefined,
			ctx as never,
		);
		expect(before).toMatchObject({ isError: true, details: { kind: "aborted" } });
		expect(fetches).toBe(0);
		const authController = new AbortController();
		const waiting = { modelRegistry: { getProviderAuth: () => new Promise(() => {}) } };
		const duringAuth = tool.execute(
			"call",
			{ query: "x" },
			authController.signal,
			undefined,
			waiting as never,
		);
		authController.abort();
		expect(await duringAuth).toMatchObject({ isError: true, details: { kind: "aborted" } });
		const controller = new AbortController();
		const pending = tool.execute(
			"call",
			{ query: "x" },
			controller.signal,
			undefined,
			ctx as never,
		);
		await entered;
		controller.abort();
		expect(await pending).toMatchObject({ isError: true, details: { kind: "aborted" } });
		let enteredIgnored: (() => void) | undefined;
		const ignoredEntered = new Promise<void>((resolve) => {
			enteredIgnored = resolve;
		});
		const ignored = await registered(
			async () => {
				enteredIgnored?.();
				return await new Promise<Response>(() => {});
			},
			{ setting: true },
		);
		ignored.startSession();
		const ignoredTool = ignored.tools[0];
		if (!ignoredTool) throw new Error("tool missing");
		const ignoredController = new AbortController();
		const ignoredPending = ignoredTool.execute(
			"call",
			{ query: "x" },
			ignoredController.signal,
			undefined,
			ctx as never,
		);
		await ignoredEntered;
		ignoredController.abort();
		expect(await ignoredPending).toMatchObject({ isError: true, details: { kind: "aborted" } });
		const bodyController = new AbortController();
		let enteredBody: (() => void) | undefined;
		const bodyEntered = new Promise<void>((resolve) => {
			enteredBody = resolve;
		});
		const body = await registered(
			async () => {
				const response = new Response(
					new ReadableStream({
						start(stream) {
							bodyController.signal.addEventListener(
								"abort",
								() => stream.error(new Error("aborted")),
								{ once: true },
							);
						},
					}),
				);
				const json = response.json.bind(response);
				Object.defineProperty(response, "json", {
					value: async () => {
						enteredBody?.();
						return await json();
					},
				});
				return response;
			},
			{ setting: true },
		);
		body.startSession();
		const bodyTool = body.tools[0];
		if (!bodyTool) throw new Error("tool missing");
		const bodyPending = bodyTool.execute(
			"call",
			{ query: "x" },
			bodyController.signal,
			undefined,
			ctx as never,
		);
		await bodyEntered;
		bodyController.abort();
		expect(await bodyPending).toMatchObject({ isError: true, details: { kind: "aborted" } });
	});

	test("renderer covers every phase, widths and untrusted text without page output", async () => {
		const { tools, startSession } = await registered(undefined, { setting: true });
		startSession();
		const tool = tools[0];
		if (!tool?.renderCall || !tool.renderResult) throw new Error("renderers missing");
		expect(tool.renderShell).toBe("self");
		let tones: string[] = [];
		const theme = {
			fg: (color: string, text: string) => {
				tones.push(color);
				return `\x1b[90m${text}\x1b[39m`;
			},
			bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
		};
		const secret = "syn_0123456789abcdefghijkl";
		const longUrl = "https://example.test/long/path/to/useful/resource?version=1234567890";
		const success: AgentToolResult<unknown> = {
			content: [{ type: "text", text: "PAGE BODY PRIVATE" }],
			details: {
				kind: "success",
				query: "CJK界",
				resultCount: 2,
				truncated: true,
				fullOutputPath: "/tmp/a  b/full-search.md",
				results: [
					{ title: "Title界\x1b]0;EVIL\x07", url: longUrl, published: "2025" },
					{
						title: "Second",
						url: `https://bob:letmein@example.test/?token=${secret}&password=passcode`,
						published: undefined,
					},
				],
			},
		};
		const expectedTone = {
			args: "dim",
			queued: "dim",
			running: "accent",
			empty: "success",
			done: "success",
			error: "error",
			aborted: "warning",
		} as const;
		const cases: Array<{
			label: keyof typeof expectedTone;
			expectText?: string;
			result?: AgentToolResult<unknown>;
			error?: boolean;
			partial?: boolean;
			complete?: boolean;
			started?: boolean;
			expanded?: boolean;
		}> = [
			{ label: "args", complete: false, started: false },
			{ label: "queued", complete: true, started: false },
			{ label: "running", complete: true, started: true },
			{
				label: "running",
				complete: true,
				started: true,
				partial: true,
				result: { content: [], details: { kind: "progress" } },
			},
			{
				label: "empty",
				complete: true,
				started: true,
				result: {
					content: [],
					details: { kind: "success", resultCount: 0, results: [], truncated: false },
				},
			},
			{ label: "done", complete: true, started: true, result: success },
			{ label: "done", complete: true, started: true, result: success, expanded: true },
			{
				label: "done",
				complete: true,
				started: true,
				result: {
					content: [],
					details: { results: [{ title: "Legacy title", url: "https://legacy.test" }] },
				},
				expanded: true,
			},
			{
				label: "error",
				expectText: "credentials missing",
				complete: true,
				started: true,
				error: true,
				result: {
					content: [],
					details: { kind: "error", code: "auth", message: "Run /login synthetic" },
				},
			},
			{
				label: "error",
				expectText: "HTTP 401",
				complete: true,
				started: true,
				error: true,
				result: { content: [], details: { kind: "error", code: "http", status: 401 } },
			},
			{
				label: "error",
				expectText: "network failed",
				complete: true,
				started: true,
				error: true,
				result: { content: [], details: { kind: "error", code: "network" } },
			},
			{
				label: "error",
				expectText: "invalid response",
				complete: true,
				started: true,
				error: true,
				result: { content: [], details: { kind: "error", code: "parse" } },
			},
			{
				label: "error",
				expectText: "timed out",
				complete: true,
				started: true,
				error: true,
				result: { content: [], details: { kind: "error", code: "timeout" } },
			},
			{
				label: "error",
				complete: true,
				started: true,
				error: true,
				result: { content: [{ type: "text", text: secret }], details: {} },
			},
			{
				label: "aborted",
				complete: true,
				started: true,
				error: true,
				result: { content: [{ type: "text", text: "Operation aborted" }], details: {} },
			},
			{
				label: "aborted",
				complete: true,
				started: true,
				error: true,
				result: { content: [], details: { kind: "aborted" } },
			},
		];
		for (const width of [36, 57, 80, 140]) {
			for (const item of cases) {
				tones = [];
				const args = { query: `CJK界 ${secret}\x1b]0;EVIL\x07` };
				const context = {
					args,
					state: {},
					outputPad: 1,
					argsComplete: item.complete,
					executionStarted: item.started,
					isPartial: item.partial ?? false,
					isError: item.error ?? false,
					expanded: item.expanded ?? false,
					durationMs: 120,
					cwd: "/tmp",
					toolCallId: "call",
					lastComponent: undefined,
					showImages: false,
					invalidate: () => {},
				};
				const call = tool.renderCall(args, theme as never, context as never);
				const result = item.result
					? tool.renderResult(
							item.result,
							{ expanded: item.expanded ?? false, isPartial: item.partial ?? false },
							theme as never,
							context as never,
						)
					: undefined;
				const lines = [...call.render(width), ...(result?.render(width) ?? [])];
				for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				const plain = stripVTControlCharacters(lines.join("\n"));
				expect(plain).toContain("synthetic_web_search");
				expect(plain).toContain(item.label);
				if (item.expectText) expect(plain).toContain(item.expectText);
				if (item.label === "error") expect(plain).toContain("/login synthetic");
				expect(tones).toContain(expectedTone[item.label]);
				expect(plain).not.toContain(secret);
				expect(plain).not.toContain("EVIL");
				expect(plain).not.toContain("letmein");
				expect(plain).not.toContain("passcode");
				expect(plain).not.toContain("PAGE BODY PRIVATE");
				if (item.expanded && item.result === success) {
					expect(plain).toContain("Title界");
					expect(plain.replace(/\n\s+/g, "")).toContain(longUrl);
					expect(plain).toContain("full-search.md");
					if (width >= 57) expect(plain).toContain("/tmp/a  b/full-search.md");
				} else if (item.expanded) {
					expect(plain).toContain("Legacy title");
					expect(plain).toContain("https://legacy.test");
				} else if (item.result === success) expect(plain).not.toContain("Title界");
			}
		}
		const manyContext = {
			state: {},
			outputPad: 1,
			argsComplete: true,
			executionStarted: true,
			isError: false,
			expanded: true,
		};
		const many = tool.renderResult(
			{
				content: [],
				details: {
					kind: "success",
					resultCount: 80,
					truncated: true,
					fullOutputPath: "/tmp/full-search.md",
					results: Array.from({ length: 50 }, (_, index) => ({
						title: `Title ${index}`,
						url: `https://example.test/${"x".repeat(280)}`,
					})),
				},
			},
			{ expanded: true, isPartial: false },
			theme as never,
			manyContext as never,
		);
		const manyLines = many.render(36);
		expect(manyLines.length).toBeLessThanOrEqual(204);
		const manyText = stripVTControlCharacters(manyLines.join("\n"));
		expect(manyText).toContain("more results omitted");
		expect(manyText).toContain("30 more results");
		expect(manyText).toContain("full-search.md");
	});

	test("does not render unknown credentials from streamed arguments", async () => {
		const secret = "credential-ABC12345";
		const query = `useful search ${secret}`;
		const { tools, startSession } = await registered(async () => Response.json({ results: [] }), {
			setting: true,
		});
		startSession();
		const tool = tools[0];
		if (!tool?.renderCall || !tool.renderResult) throw new Error("renderers missing");
		const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
		const state = {};
		const context = {
			state,
			outputPad: 0,
			argsComplete: false,
			executionStarted: false,
			isError: false,
			expanded: false,
		};
		const early = tool.renderCall({ query }, theme as never, context as never);
		expect(early.render(140).join("\n")).not.toContain(secret);
		const updates: AgentToolResult<unknown>[] = [];
		const ctx = { modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: secret } }) } };
		const result = await tool.execute(
			"call",
			{ query },
			undefined,
			(update) => updates.push(update),
			ctx as never,
		);
		const progress = updates[0];
		if (!progress) throw new Error("progress missing");
		const running = { ...context, argsComplete: true, executionStarted: true };
		const call = tool.renderCall({ query }, theme as never, running as never);
		tool.renderResult(
			progress,
			{ expanded: false, isPartial: true },
			theme as never,
			running as never,
		);
		expect(call.render(140).join("\n")).toContain("useful search");
		expect(call.render(140).join("\n")).not.toContain(secret);
		const done = tool.renderCall({ query }, theme as never, running as never);
		tool.renderResult(
			result,
			{ expanded: false, isPartial: false },
			theme as never,
			running as never,
		);
		expect(done.render(140).join("\n")).toContain("useful search");
		expect(done.render(140).join("\n")).not.toContain(secret);
	});

	test("caps renderer metadata while retaining model-facing passages", async () => {
		const secret = "credential-ABC12345";
		const payload = {
			results: Array.from({ length: 70 }, (_, index) => ({
				title: `Title ${index} ${secret} ${"large".repeat(2000)}`,
				url: `https://example.test/${index}?token=${secret}`,
				text: "long page body",
				highlights: ["PUBLIC PASSAGE"],
			})),
		};
		const { tools, startSession } = await registered(async () => Response.json(payload), {
			setting: true,
		});
		startSession();
		const tool = tools[0];
		if (!tool) throw new Error("tool missing");
		const ctx = { modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: secret } }) } };
		const result = await tool.execute(
			"call",
			{ query: "many" },
			undefined,
			undefined,
			ctx as never,
		);
		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("PUBLIC PASSAGE"),
		});
		const details = result.details as { resultCount: number; results: unknown[] };
		expect(details.resultCount).toBe(70);
		expect(details.results.length).toBeLessThan(70);
		expect(JSON.stringify(details)).not.toContain(secret);
		expect(JSON.stringify(details).length).toBeLessThan(30_000);
		expect(JSON.stringify(details)).not.toContain("long page body");
		expect(JSON.stringify(details)).not.toContain("PUBLIC PASSAGE");
	});
});
