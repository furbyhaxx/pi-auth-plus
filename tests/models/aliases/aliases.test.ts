import { describe, expect, spyOn, test } from "bun:test";
import { unlink } from "node:fs/promises";
import {
	type Api,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type Provider,
} from "@earendil-works/pi-ai";
import {
	createEventBus,
	type ExtensionAPI,
	type ProviderConfig,
	type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { userSettingsPath } from "../../../src/core/paths/index.ts";
import type { FamilyHost } from "../../../src/core/registry/index.ts";
import { FAMILIES } from "../../../src/families/index.ts";
import { bundledModels } from "../../../src/families/synthetic/catalog.ts";
import piAuthPlus from "../../../src/index.ts";
import {
	expandAliases,
	type ModelAlias,
	parseAliases,
	resolveAliases,
	rewriteAliasPayload,
} from "../../../src/models/aliases/index.ts";
import { wrapNamedAliases } from "../../../src/models/aliases/named.ts";
import { wrapNativeAliases } from "../../../src/models/aliases/native.ts";
import { AliasCatalog } from "../../../src/models/aliases/runtime.ts";
import { filterNativeProvider } from "../../../src/models/catalog/owned-filter.ts";
import type { AuthCommandDeps } from "../../../src/ui/commands/index.ts";
import * as commands from "../../../src/ui/commands/index.ts";

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

describe("runtime alias identities", () => {
	test("keeps colliding physical IDs unchanged and follows settings immediately", () => {
		const collision = { provider: "p", id: "occupied", source: "first" };
		let configured: readonly ModelAlias[] = [
			collision,
			{ provider: "p", id: "short", source: "first" },
		];
		const catalog = new AliasCatalog(() => configured);
		catalog.register("p", () => [
			{ provider: "p", id: "first" },
			{ provider: "p", id: "second" },
			{ provider: "p", id: "occupied", type: "image" },
		]);
		const occupied = { provider: "p", id: "occupied" };
		expect(catalog.resolve(occupied)).toBe(occupied);
		expect(catalog.issues()).toEqual([{ kind: "collision", alias: collision }]);
		expect(catalog.resolve({ provider: "p", id: "short" })).toEqual({
			provider: "p",
			id: "first",
		});
		configured = [{ provider: "p", id: "short", source: "second" }];
		expect(catalog.aliases()).toEqual(configured);
		expect(catalog.resolve({ provider: "p", id: "short" })).toEqual({
			provider: "p",
			id: "second",
		});
	});

	test("rejects ambiguous, nonchat, missing and alias sources", () => {
		const configured = [
			{ provider: "p", source: "duplicate", id: "ambiguous" },
			{ provider: "p", source: "image", id: "nonchat" },
			{ provider: "p", source: "absent", id: "missing" },
			{ provider: "p", source: "base", id: "valid" },
			{ provider: "p", source: "valid", id: "chain" },
		] as const;
		const catalog = new AliasCatalog(() => configured);
		catalog.register("p", () => [
			{ provider: "p", id: "base" },
			{ provider: "p", id: "duplicate" },
			{ provider: "p", id: "duplicate", type: "image" },
			{ provider: "p", id: "image", type: "image" },
		]);
		expect(catalog.aliases()).toEqual([configured[3]]);
		expect(catalog.issues()).toEqual(
			[configured[0], configured[1], configured[2], configured[4]].map((entry) => ({
				kind: "missing-source",
				alias: entry,
			})),
		);
		for (const id of ["ambiguous", "nonchat", "missing", "chain"]) {
			const model = { provider: "p", id };
			expect(catalog.resolve(model)).toBe(model);
		}
	});

	test("captures original static and refreshed named catalogs without alias rows", async () => {
		const base: Model<"anthropic-messages"> = {
			provider: "p",
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
		let physical: readonly ProviderModelConfig[] = [];
		let refreshed: ProviderModelConfig[] = [{ ...base, id: "next" }];
		const configured = [{ provider: "p", source: "base", id: "short" }] as const;
		const catalog = new AliasCatalog(() => configured);
		catalog.register("p", () =>
			physical.map((model) => ({
				provider: "p",
				id: model.id,
				...(model.type === undefined ? {} : { type: model.type }),
			})),
		);
		const captured: string[][] = [];
		const wrapped = wrapNamedAliases(
			"p",
			{ models: [base], refreshModels: async () => refreshed },
			() => configured,
			undefined,
			(models) => {
				physical = models;
				captured.push(models.map((model) => model.id));
			},
		);
		expect(wrapped.models?.map((model) => model.id)).toEqual(["base", "short"]);
		expect(captured).toEqual([["base"]]);
		expect(catalog.resolve({ provider: "p", id: "short" }).id).toBe("base");
		const controller = new AbortController();
		const context = { allowNetwork: false, signal: controller.signal, publish: async () => true };
		const result = await wrapped.refreshModels?.(context);
		expect(result?.map((model) => model.id)).toEqual(["next"]);
		expect(captured).toEqual([["base"], ["next"]]);
		expect(catalog.aliases()).toEqual([]);
		expect(catalog.issues()).toEqual([{ kind: "missing-source", alias: configured[0] }]);
		refreshed = [base, { ...base, id: "short" }];
		await wrapped.refreshModels?.(context);
		expect(catalog.issues()).toEqual([{ kind: "collision", alias: configured[0] }]);
		controller.abort();
		refreshed = [base];
		await wrapped.refreshModels?.(context);
		expect(captured).toEqual([["base"], ["next"], ["base", "short"]]);
		expect(catalog.issues()).toEqual([{ kind: "collision", alias: configured[0] }]);
	});
});

test("the entrypoint shares accepted aliases and warns once per rejection and reason", async () => {
	const synthetic = FAMILIES.find((family) => family.id === "synthetic");
	const [first, second] = bundledModels();
	if (
		!synthetic?.register ||
		!synthetic.physical ||
		!synthetic.providerRegistrations ||
		!first ||
		!second
	) {
		throw new Error("Synthetic registration and two physical models are required");
	}
	const registrations = synthetic.providerRegistrations;
	let refreshGate: Promise<void> | undefined;
	const registerProviders = spyOn(synthetic, "providerRegistrations").mockImplementation((host) =>
		registrations(host).map((row) => {
			if (!("name" in row) || row.name !== "synthetic" || !row.config.refreshModels) return row;
			const refresh = row.config.refreshModels;
			return {
				...row,
				config: {
					...row.config,
					async refreshModels(context) {
						await refreshGate;
						return refresh.call(row.config, context);
					},
				},
			};
		}),
	);
	let host: FamilyHost | undefined;
	let physicalHost: FamilyHost | undefined;
	let deps: AuthCommandDeps | undefined;
	let config: ProviderConfig | undefined;
	let notifyAlias: (() => void) | undefined;
	let persisted = false;
	const registerFamily = spyOn(synthetic, "register").mockImplementation((_pi, current) => {
		host = current;
	});
	const physical = spyOn(synthetic, "physical").mockImplementation((_model, current) => {
		physicalHost = current;
		return undefined;
	});
	const registerCommands = spyOn(commands, "registerAuthCommands").mockImplementation(
		(_pi, current) => {
			deps = current;
		},
	);
	const warnings: string[] = [];
	const handlers = new Map<string, Array<(payload?: Record<string, unknown>) => unknown>>();
	const runtime = {
		stream: (_model: Model<Api>, _context: Context) => createAssistantMessageEventStream(),
		streamSimple: (_model: Model<Api>, _context: Context) => createAssistantMessageEventStream(),
	};
	const refreshContext = {
		allowNetwork: false,
		signal: new AbortController().signal,
		publish: async () => true,
	};
	const ctx = {
		cwd: process.env["HOME"],
		modelRegistry: {
			runtime,
			refresh: async () => {
				await config?.refreshModels?.(refreshContext);
				return { errors: new Map(), aborted: false };
			},
			getAll: () => [],
			getAvailable: () => [],
		},
		mode: "rpc",
		hasUI: true,
		isProjectTrusted: () => false,
		ui: {
			notify: (message: string) => {
				warnings.push(message);
				if (message.includes("rejected model aliases")) notifyAlias?.();
			},
		},
	};
	const unexpected = (): never => {
		throw new Error("Unexpected Pi API call");
	};
	function registerProvider(provider: Provider): void;
	function registerProvider(name: string, options: ProviderConfig): void;
	function registerProvider(provider: Provider | string, options?: ProviderConfig): void {
		if (provider === "synthetic") config = options;
	}
	const pi: ExtensionAPI = {
		on: (event: string, handler: unknown) => {
			if (typeof handler !== "function") return unexpected();
			const list = handlers.get(event) ?? [];
			list.push((payload) => handler({ type: event, ...payload }, ctx));
			handlers.set(event, list);
			return () => {};
		},
		registerFlag: () => {},
		getFlag: () => false,
		registerCommand: () => {},
		registerEntryRenderer: () => {},
		registerProvider,
		getSettings: () => ({ packages: ["pi-quotas"] }),
		getCommands: () => [],
		events: createEventBus(),
		registerTool: unexpected,
		registerShortcut: unexpected,
		registerMessageRenderer: unexpected,
		registerMarkdownTransformer: unexpected,
		registerToolRenderer: unexpected,
		sendMessage: unexpected,
		sendUserMessage: unexpected,
		appendEntry: unexpected,
		setSessionName: unexpected,
		getSessionName: unexpected,
		setLabel: unexpected,
		exec: unexpected,
		getActiveTools: unexpected,
		getAllTools: unexpected,
		setActiveTools: unexpected,
		setModel: unexpected,
		getThinkingLevel: unexpected,
		setThinkingLevel: unexpected,
		unregisterProvider: unexpected,
		registerMcpServer: unexpected,
		unregisterMcpServer: unexpected,
		getMcpServers: unexpected,
		registerVirtualModel: unexpected,
		unregisterVirtualModel: unexpected,
	};
	const run = async (event: string) => {
		for (const handler of handlers.get(event) ?? []) await handler({ reason: "switch" });
	};
	const aliasWarnings = () =>
		warnings.filter((message) => message.includes("rejected model aliases"));
	const gate = Promise.withResolvers<void>();
	try {
		await piAuthPlus(pi);
		await run("session_start");
		if (
			!host?.aliases ||
			!host.resolveModel ||
			!deps?.models?.details?.aliases ||
			!deps.settings ||
			!config
		) {
			throw new Error("Alias runtime was not installed");
		}
		const save = deps.models.details.aliases.save;
		const collision = { provider: "synthetic", id: second.id, source: first.id };
		const valid = { provider: "synthetic", id: "short", source: first.id };
		await save([collision, valid], "runtime");
		expect(host.aliases()).toEqual([valid]);
		const selected = { provider: "synthetic", id: second.id };
		expect(host.resolveModel(selected)).toBe(selected);
		expect(host.resolveModel({ provider: "synthetic", id: "short" }).id).toBe(first.id);
		expect(aliasWarnings()).toHaveLength(1);
		expect(aliasWarnings()[0]).toContain("collides");
		await save([collision, valid], "runtime");
		expect(aliasWarnings()).toHaveLength(1);
		runtime.stream(first, { messages: [] });
		expect(physicalHost?.aliases?.()).toEqual([valid]);
		expect(physicalHost?.resolveModel?.({ provider: "synthetic", id: "short" }).id).toBe(first.id);
		await config.refreshModels?.({
			...refreshContext,
			stored: { models: [second] },
		});
		expect(host.aliases()).toEqual([]);
		expect(aliasWarnings()).toHaveLength(2);
		expect(aliasWarnings()[1]).toContain("missing, ambiguous, or not a chat model");
		await config.refreshModels?.({ ...refreshContext, stored: { models: [] } });
		expect(aliasWarnings()).toHaveLength(3);
		expect(aliasWarnings()[2]).toContain(JSON.stringify(second.id));
		await config.refreshModels?.({ ...refreshContext, stored: { models: [] } });
		expect(aliasWarnings()).toHaveLength(3);
		const missing = { provider: "synthetic", id: "missing", source: "absent" };
		await host.settings().save("runtime", { "models.aliases": [collision, valid, missing] });
		const notified = Promise.withResolvers<void>();
		notifyAlias = notified.resolve;
		deps.settings.onSaved(["models.aliases"], "runtime");
		await notified.promise;
		notifyAlias = undefined;
		expect(aliasWarnings()).toHaveLength(4);
		expect(aliasWarnings()[3]).toContain('"missing"');
		refreshGate = gate.promise;
		const staleRefresh = config.refreshModels?.({
			...refreshContext,
			stored: { models: [first] },
		});
		refreshGate = undefined;
		await host.settings().save("user", { "models.aliases": [collision] });
		persisted = true;
		await run("session_shutdown");
		expect(aliasWarnings()).toHaveLength(4);
		await run("session_start");
		expect(host.aliases()).toEqual([]);
		expect(aliasWarnings()).toHaveLength(5);
		expect(aliasWarnings()[4]).toContain("collides");
		gate.resolve();
		const staleModels = await staleRefresh;
		expect(staleModels?.some((model) => model.id === second.id)).toBe(true);
		expect(host.aliases()).toEqual([]);
		expect(aliasWarnings()).toHaveLength(5);
	} finally {
		gate.resolve();
		await run("session_shutdown");
		registerFamily.mockRestore();
		registerProviders.mockRestore();
		physical.mockRestore();
		registerCommands.mockRestore();
		if (persisted) await unlink(userSettingsPath());
	}
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
