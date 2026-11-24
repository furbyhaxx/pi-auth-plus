import { describe, expect, test } from "bun:test";
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	hostProviderSink,
	hostSettings,
	supportsEntryRenderer,
	supportsVirtualModels,
} from "../../src/core/host/index.ts";
import { providerAuthView, registeredProviders } from "../../src/core/host/registry.ts";

function fakeApi(extra: Record<string, unknown> = {}): ExtensionAPI {
	return extra as unknown as ExtensionAPI;
}

describe("core/host capabilities", () => {
	test("settings read degrades to empty lists without the accessor", () => {
		expect(hostSettings(fakeApi())).toEqual({});
		expect(
			hostSettings(
				fakeApi({
					getSettings: () => ({ packages: ["pi-quotas"], extensions: ["/x/y.ts"], theme: "dark" }),
				}),
			),
		).toEqual({ packages: ["pi-quotas"], extensions: ["/x/y.ts"] });
	});

	test("virtual models and entry renderers are optional", () => {
		expect(supportsVirtualModels(fakeApi())).toBe(false);
		expect(supportsEntryRenderer(fakeApi())).toBe(false);
		expect(
			supportsVirtualModels(
				fakeApi({ registerVirtualModel: () => {}, unregisterVirtualModel: () => {} }),
			),
		).toBe(true);
		expect(supportsEntryRenderer(fakeApi({ registerEntryRenderer: () => {} }))).toBe(true);
	});

	test("the runtime is the provider sink when it exposes one", () => {
		const runtime = {
			registered: [] as string[],
			registerProvider(this: { registered: string[] }, name: string) {
				this.registered.push(name);
			},
		};
		const sink = hostProviderSink(fakeApi({ runtime }));
		sink.registerProvider("claude", { name: "Claude" });
		expect(runtime.registered).toEqual(["claude"]);
	});

	test("a plain host registers providers on the API itself", () => {
		const registered: string[] = [];
		const sink = hostProviderSink(
			fakeApi({ registerProvider: (name: string) => registered.push(name) }),
		);
		sink.registerProvider("synthetic", { name: "Synthetic" });
		expect(registered).toEqual(["synthetic"]);
	});

	test("oh-my-pi never receives an environment-reference key that would shadow its logins", async () => {
		const configs: Record<string, unknown>[] = [];
		const runtime = {
			registerProvider(_name: string, config: Record<string, unknown>) {
				configs.push(config);
			},
		};
		const model = {
			id: "hf:test",
			name: "Test",
			reasoning: false,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000,
			maxTokens: 100,
		};
		hostProviderSink(fakeApi({ runtime })).registerProvider("synthetic", {
			name: "Synthetic",
			baseUrl: "https://example.test",
			api: "anthropic-messages",
			apiKey: "$SYNTHETIC_API_KEY",
			models: [model],
		});
		const [config] = configs;
		expect(config?.["apiKey"]).toBeUndefined();
		expect(config?.["models"]).toBeUndefined();
		const fetchModels = config?.["fetchDynamicModels"];
		expect(typeof fetchModels).toBe("function");
		if (typeof fetchModels !== "function") return;
		expect(await fetchModels(undefined)).toEqual([model]);
	});

	test("oh-my-pi refreshes catalogs through fetchDynamicModels with the resolved credential", async () => {
		const configs: Record<string, unknown>[] = [];
		const runtime = {
			registerProvider(_name: string, config: Record<string, unknown>) {
				configs.push(config);
			},
		};
		const seen: unknown[] = [];
		let updated = false;
		hostProviderSink(fakeApi({ runtime })).registerProvider("antigravity", {
			name: "Antigravity",
			baseUrl: "https://example.test",
			oauth: {
				name: "Antigravity",
				login: async () => ({ access: "a", refresh: "r", expires: 1 }),
				refreshToken: async (credentials) => credentials,
				getApiKey: (credentials) => credentials.access,
			},
			async refreshModels(context) {
				seen.push(context.credential, context.allowNetwork);
				await context.publish({ update: () => (updated = true) });
				return [];
			},
		});
		const [config] = configs;
		expect(config?.["refreshModels"]).toBeUndefined();
		const fetchModels = config?.["fetchDynamicModels"];
		if (typeof fetchModels !== "function") throw new Error("fetchDynamicModels missing");
		await fetchModels("token");
		expect(seen).toEqual([
			{ type: "oauth", access: "token", refresh: "", expires: Number.MAX_SAFE_INTEGER },
			true,
		]);
		expect(updated).toBe(true);
	});

	test("an oh-my-pi stream gets back the level map and bearer that Pi would hand it", () => {
		const configs: Record<string, unknown>[] = [];
		const runtime = {
			registerProvider(_name: string, config: Record<string, unknown>) {
				configs.push(config);
			},
		};
		const seen: { levels: unknown; options: unknown }[] = [];
		const model = {
			id: "gemini-4-hydrogen",
			name: "Hydrogen",
			api: "pi-auth-plus-google-generative-ai",
			reasoning: true,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000,
			maxTokens: 100,
			thinkingLevelMap: {
				off: null,
				minimal: null,
				low: "h-low|M|level:LOW",
				medium: null,
				high: null,
				xhigh: "h-xhigh|M|level:XHIGH",
			},
		};
		hostProviderSink(fakeApi({ runtime })).registerProvider("antigravity", {
			name: "Antigravity",
			baseUrl: "https://example.test",
			api: "pi-auth-plus-google-generative-ai",
			oauth: {
				name: "Antigravity",
				login: async () => ({ access: "a", refresh: "r", expires: 1 }),
				refreshToken: async (credentials) => credentials,
				getApiKey: (credentials) => credentials.access,
			},
			models: [model],
			streamSimple: (streamed, _context, options) => {
				seen.push({ levels: streamed.thinkingLevelMap, options });
				throw new Error("stop");
			},
		});
		const [config] = configs;
		const models = config?.["models"];
		if (!Array.isArray(models)) throw new Error("models missing");
		const [projected] = models;
		expect(projected.thinking).toEqual({
			mode: "effort",
			efforts: ["low", "xhigh"],
			effortMap: { low: "h-low|M|level:LOW", xhigh: "h-xhigh|M|level:XHIGH" },
		});
		const stream = config?.["streamSimple"];
		if (typeof stream !== "function") throw new Error("streamSimple missing");
		// The model as oh-my-pi rebuilds it from its cache: known fields only.
		const { thinkingLevelMap: _dropped, ...rebuilt } = projected;
		expect(() => stream(rebuilt, { messages: [] }, { apiKey: "token" })).toThrow("stop");
		expect(seen).toEqual([
			{
				levels: { ...model.thinkingLevelMap, max: null },
				options: { headers: { Authorization: "Bearer token" } },
			},
		]);
	});

	test("an oh-my-pi stream receives the host prompt and tools as Pi's system message", () => {
		const configs: Record<string, unknown>[] = [];
		const runtime = {
			registerProvider: (_name: string, config: Record<string, unknown>) => configs.push(config),
		};
		const seen: unknown[] = [];
		hostProviderSink(fakeApi({ runtime })).registerProvider("antigravity", {
			name: "Antigravity",
			baseUrl: "https://example.test",
			api: "pi-auth-plus-google-generative-ai",
			apiKey: "k",
			models: [],
			streamSimple: (_model, context) => {
				seen.push(context.messages);
				throw new Error("stop");
			},
		});
		const stream = configs[0]?.["streamSimple"];
		if (typeof stream !== "function") throw new Error("streamSimple missing");
		const tool = { name: "bash", description: "Run a command", parameters: { type: "object" } };
		const user = { role: "user", content: "hi", timestamp: 5 };
		const omp = { systemPrompt: ["You are omp.", "Rules."], tools: [tool], messages: [user] };
		expect(() => stream({ id: "m" }, omp, {})).toThrow("stop");
		expect(seen).toEqual([
			[
				{ role: "system", content: "You are omp.\n\nRules.", toolsAdded: [tool], timestamp: 0 },
				user,
			],
		]);
	});
});

describe("core/host registry views", () => {
	test("provider auth prefers the full result and falls back to a key lookup", async () => {
		const full = {
			getProviderAuth: async () => ({ auth: { apiKey: "k", headers: { a: "b" } } }),
			getApiKeyForProvider: async () => "ignored",
		};
		expect(await providerAuthView(full, "claude")).toEqual({
			auth: { apiKey: "k", headers: { a: "b" } },
		});
		expect(await providerAuthView({ getApiKeyForProvider: async () => "key" }, "claude")).toEqual({
			auth: { apiKey: "key" },
		});
		expect(await providerAuthView({ getApiKeyForProvider: async () => undefined }, "claude")).toBe(
			undefined,
		);
		expect(await providerAuthView(undefined, "claude")).toBe(undefined);
	});

	test("provider ownership is unknown without both accessors", () => {
		const config = { name: "Claude" };
		const native = { id: "claude" } as Provider;
		expect(registeredProviders({ getAll: () => [] } as never)).toBe(undefined);
		const ownership = registeredProviders({
			getRegisteredProviderConfig: () => config,
			getRegisteredNativeProvider: () => native,
		} as never);
		expect(ownership?.config("claude")).toEqual(config);
		expect(ownership?.native("claude")).toBe(native);
	});
});
