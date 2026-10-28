/** Visibility policies for providers owned by pi-auth-plus. */
import { isModelType, type Provider } from "@earendil-works/pi-ai";
import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export type ModelVisibility = (model: { readonly id: string }) => boolean;

/** Compose visibility with a native provider's existing credential-specific policies. */
export function filterNativeProvider(provider: Provider, visible: ModelVisibility): Provider {
	return {
		...provider,
		getModels: () => provider.getModels().filter(visible),
		getAllModels: () => (provider.getAllModels?.() ?? provider.getModels()).filter(visible),
		filterModels: (models, credential) =>
			(provider.filterModels?.(models, credential) ?? models).filter(visible),
		filterAllModels: (models, credential) => {
			if (provider.filterAllModels)
				return provider.filterAllModels(models, credential).filter(visible);
			if (!provider.filterModels) return models.filter(visible);
			const chat = models.filter((model) => isModelType(model, "chat"));
			const allowed = new Set(provider.filterModels(chat, credential).map((model) => model.id));
			return models.filter(
				(model) => visible(model) && (!isModelType(model, "chat") || allowed.has(model.id)),
			);
		},
	};
}

/** Retain an owned named provider's auth and refresh behavior while filtering its catalog. */
export function filterOwnedConfig(
	config: ProviderConfig,
	visible: ModelVisibility,
	onCatalog?: (models: readonly ProviderModelConfig[]) => void,
): ProviderConfig {
	const refresh = config.refreshModels;
	if (config.models) onCatalog?.(config.models);
	return {
		...config,
		...(config.models ? { models: config.models.filter(visible) } : {}),
		...(refresh
			? {
					refreshModels: async (context) => {
						const models = await refresh(context);
						onCatalog?.(models);
						return models.filter(visible);
					},
				}
			: {}),
	};
}
