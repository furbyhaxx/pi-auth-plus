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
