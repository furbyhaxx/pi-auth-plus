import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { filteredProviderConfig } from "../../../src/models/catalog/filter.ts";

const paths: string[] = [];
afterEach(() => {
	for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("model catalog filtering", () => {
	test("preserves personalized and custom models while filtering and refreshing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "model-filter-"));
		paths.push(dir);
		const modelsPath = join(dir, "models.json");
		writeFileSync(
			modelsPath,
			`{
				// Pi accepts comments and trailing commas.
				"providers": { "openrouter": { "models": [
					{ "id": "custom/kept", "contextWindow": 123456, "maxTokens": 1234 },
				], }, },
			}`,
		);
		const modelsStore = new InMemoryModelsStore();
		const create = () =>
			ModelRuntime.create({
				modelsPath,
				modelsStore,
				credentials: new InMemoryCredentialStore(),
				allowModelNetwork: false,
			});
		const seed = await create();
		const baseline = seed.getModels("openrouter").find((model) => model.id !== "custom/kept");
		if (!baseline) throw new Error("Expected a bundled OpenRouter model");
		const personal = {
			...baseline,
			id: "vendor/personal",
			headers: { "X-Model-Header": "preserved" },
		};
		const hidden = { ...baseline, id: "vendor/hidden" };
		const classifier = seed.getModelsOfType("classifier", "openai")[0];
		if (!classifier) throw new Error("Expected a bundled classifier model");
		const sameIdClassifier = { ...classifier, provider: "openrouter", id: personal.id };
		await modelsStore.write("openrouter", { models: [personal, hidden, sameIdClassifier] });
		const mirror = await create();
		const runtime = await create();
		const visible = (model: { id: string }) => !model.id.includes("hidden");
		runtime.registerProvider(
			"openrouter",
			filteredProviderConfig(mirror, "openrouter", visible, modelsPath),
		);
		await runtime.refresh({ allowNetwork: false, providers: ["openrouter"] });
		expect(
			runtime
				.getModels("openrouter")
				.map((model) => model.id)
				.sort(),
		).toEqual(["custom/kept", "vendor/personal"]);
		expect(runtime.getModel("openrouter", "custom/kept")?.contextWindow).toBe(123456);
		expect(runtime.getModelOfType("classifier", "openrouter", personal.id)).toBeDefined();
		const selected = runtime.getModel("openrouter", personal.id);
		if (!selected) throw new Error("Expected the retained personalized model");
		const auth = await new ModelRegistry(runtime).getApiKeyAndHeaders(selected);
		expect(auth.ok && auth.headers?.["X-Model-Header"]).toBe("preserved");

		await modelsStore.write("openrouter", {
			models: [
				personal,
				hidden,
				sameIdClassifier,
				{ ...personal, id: "vendor/new" },
				{ ...hidden, id: "vendor/new-hidden" },
			],
		});
		await runtime.refresh({ allowNetwork: false, providers: ["openrouter"] });
		expect(
			runtime
				.getModels("openrouter")
				.map((model) => model.id)
				.sort(),
		).toEqual(["custom/kept", "vendor/new", "vendor/personal"]);
	});

	test("preserves literal catalog headers and user model-header precedence", async () => {
		const dir = mkdtempSync(join(tmpdir(), "model-filter-headers-"));
		paths.push(dir);
		const modelsPath = join(dir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: {
					openrouter: {
						modelOverrides: {
							"vendor/header-test": {
								headers: { "X-Precedence": "user-value" },
							},
						},
					},
				},
			}),
		);
		const modelsStore = new InMemoryModelsStore();
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("openrouter", async () => ({ type: "api_key", key: "test" }));
		const create = () =>
			ModelRuntime.create({ modelsPath, modelsStore, credentials, allowModelNetwork: false });
		const seed = await create();
		const source = seed.getModels("openrouter")[0];
		if (!source) throw new Error("Expected an OpenRouter fixture model");
		await modelsStore.write("openrouter", {
			models: [
				{
					...source,
					id: "vendor/header-test",
					headers: {
						"X-Precedence": "base-value",
						"X-Literal": "!printf wrong",
						"X-Dollar": "$MISSING_LITERAL",
					},
				},
			],
		});
		const mirror = await create();
		const runtime = await create();
		const original = mirror.getModel("openrouter", "vendor/header-test");
		if (!original) throw new Error("Expected the fixture model");
		const baseline = await new ModelRegistry(mirror).getApiKeyAndHeaders(original);
		runtime.registerProvider(
			"openrouter",
			filteredProviderConfig(mirror, "openrouter", () => true, modelsPath),
		);
		await runtime.refresh({ allowNetwork: false, providers: ["openrouter"] });
		const filtered = runtime.getModel("openrouter", original.id);
		if (!filtered) throw new Error("Expected the filtered fixture model");
		const actual = await new ModelRegistry(runtime).getApiKeyAndHeaders(filtered);
		expect(actual).toEqual(baseline);
	});
});
