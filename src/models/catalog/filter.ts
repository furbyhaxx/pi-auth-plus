import { readFileSync } from "node:fs";
import { type AnyModel, isModelType } from "@earendil-works/pi-ai";
import type { ModelRuntime, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { parseJsonc } from "../overrides/jsonc.ts";

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function userModelHeaders(path: string, provider: string): Map<string, Set<string>> {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Map();
		throw error;
	}
	const config = record(record(parseJsonc(source).value)?.["providers"])?.[provider];
	const headers = new Map<string, Set<string>>();
	const add = (id: string, value: unknown): void => {
		const fields = record(record(value)?.["headers"]);
		if (!fields) return;
		const names = headers.get(id) ?? new Set<string>();
		for (const key of Object.keys(fields)) names.add(key.toLowerCase());
		headers.set(id, names);
	};
	for (const [id, value] of Object.entries(record(record(config)?.["modelOverrides"]) ?? {}))
		add(id, value);
	const definitions = record(config)?.["models"];
	if (Array.isArray(definitions))
		for (const definition of definitions) {
			const id = record(definition)?.["id"];
			if (typeof id === "string") add(id, definition);
		}
	return headers;
}

function literalHeader(value: string): string {
	const escaped = value.replaceAll("$", () => "$$");
	return escaped.startsWith("!") ? `$${escaped}` : escaped;
}

/** Replace a provider catalog while preserving Pi's composed metadata and offline refreshes. */
export function filteredProviderConfig(
	runtime: Pick<ModelRuntime, "getAllModels" | "refresh">,
	provider: string,
	visible: (model: AnyModel) => boolean,
	modelsPath: string,
): ProviderConfig {
	const models = () => {
		const userHeaders = userModelHeaders(modelsPath, provider);
		return runtime
			.getAllModels(provider)
			.filter(visible)
			.map((model) => {
				if (!model.headers) return model;
				const overridden = isModelType(model, "chat") ? userHeaders.get(model.id) : undefined;
				const headers = Object.fromEntries(
					Object.entries(model.headers)
						.filter(([name]) => !overridden?.has(name.toLowerCase()))
						.map(([name, value]) => [name, literalHeader(value)]),
				);
				return { ...model, headers };
			});
	};
	return {
		models: models(),
		async refreshModels({ signal }) {
			const result = await runtime.refresh({ allowNetwork: false, providers: [provider], signal });
			const error = result.errors.get(provider);
			if (error) throw error;
			return models();
		},
	};
}
