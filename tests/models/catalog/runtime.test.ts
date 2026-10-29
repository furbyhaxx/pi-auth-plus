import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	ModelRuntime,
	type ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import { type AppSettings, SETTINGS } from "../../../src/core/config/catalog.ts";
import { SettingsStore } from "../../../src/core/config/index.ts";
import { CatalogVisibility } from "../../../src/models/catalog/runtime.ts";

function visibilityFor(pi: ExtensionAPI, settings: () => AppSettings): CatalogVisibility {
	return new CatalogVisibility(pi, settings, new Set(["owned"]));
}

test("starting a session with unchanged rules does not abort a catalog refresh", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-rules-runtime-"));
	try {
		const settings = new SettingsStore(SETTINGS, { user: join(dir, "auth-plus.json") });
		await settings.load();
		let refreshes = 0;
		const pi = { registerProvider: () => {} } as unknown as ExtensionAPI;
		const ctx = {
			modelRegistry: {
				getRegisteredProviderConfig: () => undefined,
				getRegisteredNativeProvider: () => undefined,
				refresh: async () => {
					refreshes++;
					return { errors: new Map(), aborted: false };
				},
			},
			ui: { notify: () => {} },
		} as unknown as ExtensionContext;
		const visibility = new CatalogVisibility(pi, () => settings, new Set(["owned"]));
		await visibility.apply();
		await visibility.apply(ctx);
		expect(refreshes).toBe(0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("stops re-registering a catalog when another extension changes its provider", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-rules-foreign-"));
	const previous = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = dir;
	try {
		const settings = new SettingsStore(SETTINGS, { user: join(dir, "auth-plus.json") });
		await settings.load();
		await settings.save("runtime", { "models.rules": ["openai/*"] });
		const registrations = new Map<string, ProviderConfig>();
		const warnings: string[] = [];
		let count = 0;
		const pi = {
			registerProvider: (id: string, config: ProviderConfig) => {
				registrations.set(id, config);
				count++;
			},
		} as unknown as ExtensionAPI;
		const ctx = {
			modelRegistry: {
				getRegisteredProviderConfig: (id: string) => registrations.get(id),
				getRegisteredNativeProvider: () => undefined,
				refresh: async () => ({ errors: new Map(), aborted: false }),
			},
			ui: { notify: (message: string) => warnings.push(message) },
		} as unknown as ExtensionContext;
		const visibility = new CatalogVisibility(pi, () => settings, new Set());
		await visibility.apply();
		const original = registrations.get("openai");
		expect(original).toBeDefined();
		registrations.set("openai", { ...original, baseUrl: "https://proxy.invalid" });
		await visibility.apply(ctx);
		expect(warnings.join("\n")).toContain("another extension changed");
		expect(visibility.handles("openai")).toBe(false);
		const previousCount = count;
		await settings.save("runtime", { "models.rules": ["openai/*", "!openai/example"] });
		await visibility.apply(ctx);
		expect(count).toBe(previousCount);
	} finally {
		if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const outcome of ["resolve", "reject"] as const) {
	test(`an aborted registry refresh cannot publish ${outcome} results or mark rules applied`, async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-rules-aborted-"));
		const release = Promise.withResolvers<void>();
		try {
			const settings = new SettingsStore(SETTINGS, { user: join(dir, "auth-plus.json") });
			await settings.load();
			const owner = new AbortController();
			const entered = Promise.withResolvers<void>();
			const warnings: string[] = [];
			let refreshes = 0;
			let refreshSignal: AbortSignal | undefined;
			const pi = { registerProvider: () => {} } as unknown as ExtensionAPI;
			const ctx = {
				modelRegistry: {
					getRegisteredProviderConfig: () => undefined,
					getRegisteredNativeProvider: () => undefined,
					refresh: async (options: { signal?: AbortSignal }) => {
						refreshes++;
						if (refreshes === 1) {
							refreshSignal = options.signal;
							entered.resolve();
							await release.promise;
							if (outcome === "reject") throw new Error("old registry failure");
							return {
								errors: new Map([["owned", new Error("old registry failure")]]),
								aborted: false,
							};
						}
						return { errors: new Map(), aborted: false };
					},
				},
				ui: { notify: (message: string) => warnings.push(message) },
			} as unknown as ExtensionContext;
			const visibility = visibilityFor(pi, () => settings);
			await visibility.apply();
			await settings.save("runtime", { "models.rules": ["!owned/*"] });
			const pending = visibility.apply(ctx, [], owner.signal, settings);
			await entered.promise;
			owner.abort();
			const refreshWasAborted = refreshSignal?.aborted;
			release.resolve();
			await pending;
			expect(refreshWasAborted).toBe(true);
			expect(warnings).toEqual([]);
			await visibility.apply(ctx, [], new AbortController().signal, settings);
			expect(refreshes).toBe(2);
			expect(warnings).toEqual([]);
		} finally {
			release.resolve();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test(`a superseded mirror refresh cannot publish ${outcome} results or overwrite newer rules`, async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-rules-superseded-"));
		const previous = process.env["PI_CODING_AGENT_DIR"];
		process.env["PI_CODING_AGENT_DIR"] = dir;
		const release = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		const create = ModelRuntime.create.bind(ModelRuntime);
		let oldSignal: AbortSignal | undefined;
		let mirrorRefreshes = 0;
		const createSpy = spyOn(ModelRuntime, "create").mockImplementation(async (options) => {
			const mirror = await create(options);
			spyOn(mirror, "refresh").mockImplementation(async (refreshOptions) => {
				mirrorRefreshes++;
				if (mirrorRefreshes === 1) {
					oldSignal = refreshOptions?.signal;
					entered.resolve();
					await release.promise;
					if (outcome === "reject") throw new Error("old mirror failure");
					return { errors: new Map([["openai", new Error("old mirror failure")]]), aborted: false };
				}
				return { errors: new Map(), aborted: false };
			});
			return mirror;
		});
		try {
			const oldStore = new SettingsStore(SETTINGS, { user: join(dir, "old.json") });
			const newStore = new SettingsStore(SETTINGS, { user: join(dir, "new.json") });
			await oldStore.load();
			await newStore.load();
			let currentStore = oldStore;
			const registrations = new Map<string, ProviderConfig>();
			const warnings: string[] = [];
			let registryRefreshes = 0;
			const pi = {
				registerProvider: (id: string, config: ProviderConfig) => registrations.set(id, config),
			} as unknown as ExtensionAPI;
			const ctx = {
				modelRegistry: {
					getRegisteredProviderConfig: (id: string) => registrations.get(id),
					getRegisteredNativeProvider: () => undefined,
					refresh: async () => {
						registryRefreshes++;
						return { errors: new Map(), aborted: false };
					},
				},
				ui: { notify: (message: string) => warnings.push(message) },
			} as unknown as ExtensionContext;
			const visibility = visibilityFor(pi, () => currentStore);
			await visibility.apply();
			await oldStore.save("runtime", { "models.rules": ["openai/*"] });
			await newStore.save("runtime", { "models.rules": ["!openai/*"] });
			const owner = new AbortController();
			const pending = visibility.apply(ctx, [], owner.signal, oldStore);
			await entered.promise;
			currentStore = newStore;
			await visibility.apply(ctx, [], owner.signal, newStore);
			const refreshWasAborted = oldSignal?.aborted;
			const completedRefreshes = registryRefreshes;
			release.resolve();
			await pending;
			expect(refreshWasAborted).toBe(true);
			expect(warnings).toEqual([]);
			expect(registrations.size).toBe(0);
			await visibility.apply(ctx, [], owner.signal, newStore);
			expect(registryRefreshes).toBe(completedRefreshes);
		} finally {
			release.resolve();
			createSpy.mockRestore();
			if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
			else process.env["PI_CODING_AGENT_DIR"] = previous;
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("an already aborted owner cannot change catalog state", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-rules-preaborted-"));
	try {
		const settings = new SettingsStore(SETTINGS, { user: join(dir, "auth-plus.json") });
		await settings.load();
		let refreshes = 0;
		const warnings: string[] = [];
		const pi = { registerProvider: () => {} } as unknown as ExtensionAPI;
		const ctx = {
			modelRegistry: {
				getRegisteredProviderConfig: () => undefined,
				getRegisteredNativeProvider: () => undefined,
				refresh: async () => {
					refreshes++;
					return { errors: new Map(), aborted: false };
				},
			},
			ui: { notify: (message: string) => warnings.push(message) },
		} as unknown as ExtensionContext;
		const visibility = visibilityFor(pi, () => settings);
		await visibility.apply();
		await settings.save("runtime", { "models.rules": ["!owned/*"] });
		const owner = new AbortController();
		owner.abort();
		await visibility.apply(ctx, ["owned"], owner.signal, settings);
		expect(refreshes).toBe(0);
		expect(warnings).toEqual([]);
		await visibility.apply(ctx, [], new AbortController().signal, settings);
		expect(refreshes).toBe(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a superseding apply retries unfinished provider refreshes in the same session", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-rules-pending-"));
	const release = Promise.withResolvers<void>();
	try {
		const settings = new SettingsStore(SETTINGS, { user: join(dir, "auth-plus.json") });
		await settings.load();
		const entered = Promise.withResolvers<void>();
		const warnings: string[] = [];
		const calls: { providers: readonly string[]; signal: AbortSignal | undefined }[] = [];
		const pi = { registerProvider: () => {} } as unknown as ExtensionAPI;
		const ctx = {
			modelRegistry: {
				getRegisteredProviderConfig: () => undefined,
				getRegisteredNativeProvider: () => undefined,
				refresh: async (options: { providers: readonly string[]; signal?: AbortSignal }) => {
					calls.push({ providers: options.providers, signal: options.signal });
					if (calls.length === 1) {
						entered.resolve();
						await release.promise;
						return { errors: new Map([["owned", new Error("old failure")]]), aborted: false };
					}
					return { errors: new Map(), aborted: false };
				},
			},
			ui: { notify: (message: string) => warnings.push(message) },
		} as unknown as ExtensionContext;
		const visibility = visibilityFor(pi, () => settings);
		await visibility.apply();
		const owner = new AbortController();
		const pending = visibility.apply(ctx, ["owned"], owner.signal, settings);
		await entered.promise;
		const latest = await visibility.apply(ctx, [], owner.signal, settings);
		release.resolve();
		await pending;
		expect(calls.map((call) => call.providers)).toEqual([["owned"], ["owned"]]);
		expect(calls[0]?.signal?.aborted).toBe(true);
		expect(warnings).toEqual([]);
		if (!latest) throw new Error("Expected the current application lifetime");
		expect(latest.aborted).toBe(false);
		await visibility.apply(ctx, [], owner.signal, settings);
		expect(latest.aborted).toBe(true);
		expect(calls.length).toBe(2);
	} finally {
		release.resolve();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a superseded conflict check cannot revoke a current registration", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-rules-conflict-race-"));
	const previous = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = dir;
	const release = Promise.withResolvers<void>();
	const entered = Promise.withResolvers<void>();
	let mirrorSpy: ReturnType<typeof spyOn<typeof ModelRuntime.prototype, "refresh">> | undefined;
	try {
		const settings = new SettingsStore(SETTINGS, { user: join(dir, "auth-plus.json") });
		await settings.load();
		await settings.save("runtime", { "models.rules": ["openai/*"] });
		const registrations = new Map<string, ProviderConfig>();
		const warnings: string[] = [];
		const pi = {
			registerProvider: (id: string, config: ProviderConfig) => registrations.set(id, config),
		} as unknown as ExtensionAPI;
		const visibility = visibilityFor(pi, () => settings);
		await visibility.apply();
		const registration = registrations.get("openai");
		if (!registration) throw new Error("Expected a factory-time OpenAI registration");
		let refreshes = 0;
		mirrorSpy = spyOn(ModelRuntime.prototype, "refresh").mockImplementation(async () => {
			refreshes++;
			if (refreshes === 1) {
				entered.resolve();
				await release.promise;
			}
			return { errors: new Map(), aborted: false };
		});
		const registry = {
			getRegisteredProviderConfig: (id: string) => registrations.get(id),
			getRegisteredNativeProvider: () => undefined,
			refresh: async () => ({ errors: new Map(), aborted: false }),
		};
		const ctx = {
			modelRegistry: registry,
			ui: { notify: (message: string) => warnings.push(message) },
		} as unknown as ExtensionContext;
		const staleCtx = {
			...ctx,
			modelRegistry: {
				...registry,
				getRegisteredProviderConfig: () => ({
					...registration,
					baseUrl: "https://foreign.invalid",
				}),
			},
		} as unknown as ExtensionContext;
		const owner = new AbortController();
		const pending = visibility.apply(staleCtx, ["owned"], owner.signal, settings);
		await entered.promise;
		await visibility.apply(ctx, [], owner.signal, settings);
		release.resolve();
		await pending;
		expect(visibility.handles("openai")).toBe(true);
		expect(warnings).toEqual([]);
	} finally {
		release.resolve();
		mirrorSpy?.mockRestore();
		if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a superseded runtime creation cannot install a stale mirror or rules", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-rules-create-"));
	const previous = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = dir;
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const create = ModelRuntime.create.bind(ModelRuntime);
	const createSpy = spyOn(ModelRuntime, "create").mockImplementation(async (options) => {
		entered.resolve();
		await release.promise;
		return create(options);
	});
	try {
		const oldStore = new SettingsStore(SETTINGS, { user: join(dir, "old.json") });
		const newStore = new SettingsStore(SETTINGS, { user: join(dir, "new.json") });
		await oldStore.load();
		await newStore.load();
		let currentStore = oldStore;
		let refreshes = 0;
		const pi = { registerProvider: () => {} } as unknown as ExtensionAPI;
		const ctx = {
			modelRegistry: {
				getRegisteredProviderConfig: () => undefined,
				getRegisteredNativeProvider: () => undefined,
				refresh: async () => {
					refreshes++;
					return { errors: new Map(), aborted: false };
				},
			},
			ui: { notify: () => {} },
		} as unknown as ExtensionContext;
		const visibility = visibilityFor(pi, () => currentStore);
		await visibility.apply();
		await oldStore.save("runtime", { "models.rules": ["openai/*"] });
		await newStore.save("runtime", { "models.rules": ["!openai/*"] });
		const owner = new AbortController();
		const pending = visibility.apply(ctx, [], owner.signal, oldStore);
		await entered.promise;
		currentStore = newStore;
		await visibility.apply(ctx, [], owner.signal, newStore);
		const completedRefreshes = refreshes;
		release.resolve();
		await pending;
		expect(visibility.catalog().length).toBe(0);
		await visibility.apply(ctx, [], owner.signal, newStore);
		expect(refreshes).toBe(completedRefreshes);
	} finally {
		release.resolve();
		createSpy.mockRestore();
		if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("uses captured rules during apply and newer rules for later provider refreshes", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-rules-captured-"));
	const previous = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = dir;
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const create = ModelRuntime.create.bind(ModelRuntime);
	const createSpy = spyOn(ModelRuntime, "create").mockImplementation(async (options) => {
		entered.resolve();
		await release.promise;
		return create(options);
	});
	try {
		const oldStore = new SettingsStore(SETTINGS, { user: join(dir, "old.json") });
		const newStore = new SettingsStore(SETTINGS, { user: join(dir, "new.json") });
		await oldStore.load();
		await newStore.load();
		let currentStore = oldStore;
		const registrations = new Map<string, ProviderConfig>();
		const pi = {
			registerProvider: (id: string, config: ProviderConfig) => registrations.set(id, config),
		} as unknown as ExtensionAPI;
		const ctx = {
			modelRegistry: {
				getRegisteredProviderConfig: (id: string) => registrations.get(id),
				getRegisteredNativeProvider: () => undefined,
				refresh: async () => ({ errors: new Map(), aborted: false }),
			},
			ui: { notify: () => {} },
		} as unknown as ExtensionContext;
		const visibility = visibilityFor(pi, () => currentStore);
		await visibility.apply();
		await oldStore.save("runtime", { "models.rules": ["openai/*"] });
		const owner = new AbortController();
		const pending = visibility.apply(ctx, [], owner.signal, oldStore);
		await entered.promise;
		currentStore = newStore;
		release.resolve();
		await pending;
		const config = registrations.get("openai");
		expect(config?.models).toEqual([]);
		if (!config?.refreshModels) throw new Error("Expected a filtered OpenAI provider");
		owner.abort();
		await visibility.apply(ctx, [], new AbortController().signal, newStore);
		const models = await config.refreshModels({
			allowNetwork: false,
			publish: async () => true,
			signal: new AbortController().signal,
		});
		expect(models.length).toBeGreaterThan(0);
	} finally {
		release.resolve();
		createSpy.mockRestore();
		if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});
