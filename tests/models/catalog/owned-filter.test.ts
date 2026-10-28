import { describe, expect, test } from "bun:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, type ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
	filterNativeProvider,
	filterOwnedConfig,
} from "../../../src/models/catalog/owned-filter.ts";

const visible = (model: { id: string }) => !model.id.includes("hidden");

describe("owned provider visibility", () => {
	test("composes a native provider's policy and reflects changed rules after refresh", async () => {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("openai", async () => ({ type: "api_key", key: "test" }));
		const runtime = await ModelRuntime.create({
			credentials,
			modelsPath: null,
			allowModelNetwork: false,
		});
		const base = runtime.getProvider("openai");
		if (!base) throw new Error("Expected OpenAI fixture provider");
		const models = base.getModels();
		const first = models[0];
		const second = models[1];
		const third = models[2];
		if (!first || !second || !third) throw new Error("Expected three model fixtures");
		let hidden = second.id;
		const { filterAllModels: originalFilterAll, ...withoutFilterAll } = base;
		void originalFilterAll;
		const native = {
			...withoutFilterAll,
			filterModels: (input: typeof models) => input.filter((item) => item.id !== third.id),
		};
		runtime.registerNativeProvider(filterNativeProvider(native, (model) => model.id !== hidden));
		await runtime.refresh({ allowNetwork: false, providers: ["openai"] });
		let available = await runtime.getAvailable("openai");
		expect(available.some((model) => model.id === first.id)).toBe(true);
		expect(available.some((model) => model.id === second.id)).toBe(false);
		expect(available.some((model) => model.id === third.id)).toBe(false);
		expect(runtime.getModel("openai", second.id)).toBeUndefined();
		expect(runtime.getProvider("openai")?.auth).toBe(base.auth);

		hidden = first.id;
		await runtime.refresh({ allowNetwork: false, providers: ["openai"] });
		available = await runtime.getAvailable("openai");
		expect(available.some((model) => model.id === first.id)).toBe(false);
		expect(available.some((model) => model.id === second.id)).toBe(true);
		expect(available.some((model) => model.id === third.id)).toBe(false);
		const all = await runtime.getAllAvailable("openai");
		expect(all.some((model) => model.id === first.id)).toBe(false);
		expect(all.some((model) => model.id === second.id)).toBe(true);
		expect(all.some((model) => model.id === third.id)).toBe(false);
	});

	test("filters an owned named provider's initial and refreshed catalog without changing publication", async () => {
		let hidden = true;
		let calls = 0;
		let preview: readonly string[] = [];
		const fields = {
			reasoning: false,
			input: ["text"] as ("text" | "image")[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000,
			maxTokens: 100,
		};
		const entries: ProviderModelConfig[] = [
			{ id: "kept", name: "Kept", ...fields },
			{ id: "hidden", name: "Hidden", ...fields },
		];
		const refreshModels = async () => {
			calls++;
			return entries;
		};
		const config = filterOwnedConfig(
			{ models: entries, refreshModels },
			(model) => !hidden || visible(model),
			(models) => {
				preview = models.map((model) => model.id);
			},
		);
		expect(preview).toEqual(["kept", "hidden"]);
		expect(config.models?.map((model) => model.id)).toEqual(["kept"]);
		expect((await config.refreshModels?.({} as never))?.map((model) => model.id)).toEqual(["kept"]);
		hidden = false;
		expect((await config.refreshModels?.({} as never))?.map((model) => model.id)).toEqual([
			"kept",
			"hidden",
		]);
		expect(calls).toBe(2);
	});
});
