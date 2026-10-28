import type { AnyModel } from "@earendil-works/pi-ai";
import type { ModelRuntime, ProviderConfig } from "@earendil-works/pi-coding-agent";

/** Replace a provider catalog while preserving Pi's composed metadata and offline refreshes. */
export function filteredProviderConfig(
	runtime: Pick<ModelRuntime, "getAllModels" | "refresh">,
	provider: string,
	visible: (model: AnyModel) => boolean,
): ProviderConfig {
	const models = () => runtime.getAllModels(provider).filter(visible);
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
