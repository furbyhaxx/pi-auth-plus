/** Alias expansion for extension-registered provider catalogs. */
import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { AliasIssue, ModelAlias } from "./index.ts";

/** Preserve provider configuration while adding aliases of unambiguous physical chat models. */
export function wrapNamedAliases(
	providerId: string,
	config: ProviderConfig,
	aliases: () => readonly ModelAlias[],
	report?: (issues: readonly AliasIssue[]) => void,
): ProviderConfig {
	function expand(physical: ProviderModelConfig[]): ProviderModelConfig[] {
		const models = [...physical];
		const issues: AliasIssue[] = [];
		const counts = new Map<string, number>();
		for (const model of physical) counts.set(model.id, (counts.get(model.id) ?? 0) + 1);
		const ids = new Set(counts.keys());
		for (const alias of aliases()) {
			if (alias.provider !== providerId) continue;
			if (ids.has(alias.id)) {
				issues.push({ kind: "collision", alias });
				continue;
			}
			const source =
				counts.get(alias.source) === 1
					? physical.find((model) => model.id === alias.source)
					: undefined;
			if (!source || (source.type !== undefined && source.type !== "chat")) {
				issues.push({ kind: "missing-source", alias });
				continue;
			}
			models.push({
				...source,
				id: alias.id,
				...(alias.name !== undefined ? { name: alias.name } : {}),
				...(alias.contextWindow !== undefined ? { contextWindow: alias.contextWindow } : {}),
				...(alias.maxTokens !== undefined ? { maxTokens: alias.maxTokens } : {}),
			});
			ids.add(alias.id);
		}
		report?.(issues);
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
