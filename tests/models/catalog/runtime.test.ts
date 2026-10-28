import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import { SETTINGS } from "../../../src/core/config/catalog.ts";
import { SettingsStore } from "../../../src/core/config/index.ts";
import { CatalogVisibility } from "../../../src/models/catalog/runtime.ts";
import { compileModelRules, evaluateModelRules } from "../../../src/models/rules/match.ts";
import { effectiveModelRules } from "../../../src/models/rules/settings.ts";

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
		const visibility = new CatalogVisibility(
			pi,
			() => settings,
			new Set(["owned"]),
			(model) =>
				!evaluateModelRules(
					compileModelRules(effectiveModelRules(settings)),
					model.provider,
					model.id,
				).hidden,
		);
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
		const visibility = new CatalogVisibility(
			pi,
			() => settings,
			new Set(),
			(model) =>
				!evaluateModelRules(
					compileModelRules(effectiveModelRules(settings)),
					model.provider,
					model.id,
				).hidden,
		);
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
