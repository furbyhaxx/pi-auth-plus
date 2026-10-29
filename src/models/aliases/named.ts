/** Alias expansion for extension-registered provider catalogs. */
import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { type AliasIssue, type ModelAlias, resolveAliases } from "./index.ts";

/** Preserve provider configuration while adding aliases of unambiguous physical chat models. */
export function wrapNamedAliases(
	providerId: string,
	config: ProviderConfig,
	aliases: () => readonly ModelAlias[],
	report?: (issues: readonly AliasIssue[]) => void,
): ProviderConfig {
	function expand(physical: ProviderModelConfig[]): ProviderModelConfig[] {
		const models = [...physical];
		const resolution = resolveAliases(
			physical.map((model) => ({
				provider: providerId,
				id: model.id,
				...(model.type !== undefined ? { type: model.type } : {}),
			})),
			aliases().filter((alias) => alias.provider === providerId),
		);
		for (const alias of resolution.aliases) {
			const source = physical.find((model) => model.id === alias.source);
			if (!source || (source.type !== undefined && source.type !== "chat")) continue;
			models.push({
				...source,
				id: alias.id,
				...(alias.name !== undefined ? { name: alias.name } : {}),
				...(alias.contextWindow !== undefined ? { contextWindow: alias.contextWindow } : {}),
				...(alias.maxTokens !== undefined ? { maxTokens: alias.maxTokens } : {}),
			});
		}
		report?.(resolution.issues);
		return models;
	}

	const refreshModels = config.refreshModels;
	return {
		...config,
		...(config.models ? { models: expand(config.models) } : {}),
		...(refreshModels
			? {
					async refreshModels(context) {
						return expand(await refreshModels.call(config, context));
					},
				}
			: {}),
	};
}
