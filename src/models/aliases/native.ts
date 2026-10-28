/** Native-provider alias catalogs and request shaping. */
import {
	type Api,
	isModelType,
	type Model,
	type Provider,
	type StreamOptions,
} from "@earendil-works/pi-ai";
import { type AliasIssue, expandAliases, type ModelAlias, rewriteAliasPayload } from "./index.ts";

/** Wrap a provider while reading alias settings and its dynamic catalog on each operation. */
export function wrapNativeAliases<TApi extends Api>(
	provider: Provider<TApi>,
	aliases: () => readonly ModelAlias[],
	report?: (issues: readonly AliasIssue[]) => void,
): Provider<TApi> {
	function resolved() {
		const catalog = provider.getModels();
		const all = provider.getAllModels?.() ?? catalog;
		const nonChat = all.filter((model) => !isModelType(model, "chat"));
		const candidates: ModelAlias[] = [];
		const collisions: AliasIssue[] = [];
		for (const alias of aliases()) {
			if (alias.provider !== provider.id) continue;
			if (nonChat.some((model) => model.provider === alias.provider && model.id === alias.id)) {
				collisions.push({ kind: "collision", alias });
			} else {
				candidates.push(alias);
			}
		}
		const expanded = expandAliases(catalog, candidates);
		const issues = [...collisions, ...expanded.issues];
		report?.(issues);
		const rejected = new Set(expanded.issues.map((issue) => issue.alias));
		return { catalog, aliases: candidates.filter((alias) => !rejected.has(alias)) };
	}

	function optionsFor<T extends StreamOptions>(
		model: Model<TApi>,
		options: T | undefined,
	): T | undefined {
		const selected = resolved().aliases.filter(
			(alias) => alias.id === model.id && alias.provider === model.provider,
		);
		if (selected.length === 0) return options;
		const onPayload: NonNullable<StreamOptions["onPayload"]> = async (payload, payloadModel) => {
			const transformed = await options?.onPayload?.(payload, payloadModel);
			return rewriteAliasPayload(
				transformed === undefined ? payload : transformed,
				model,
				selected,
			);
		};
		return Object.assign({}, options, { onPayload });
	}

	return {
		...provider,
		...(provider.refreshModels ? { refreshModels: provider.refreshModels.bind(provider) } : {}),
		getModels() {
			const current = resolved();
			return expandAliases(current.catalog, current.aliases).models;
		},
		getAllModels() {
			const current = resolved();
			const all = provider.getAllModels?.() ?? current.catalog;
			const added = expandAliases(current.catalog, current.aliases).models.slice(
				current.catalog.length,
			);
			return [...all, ...added];
		},
		filterModels(models, credential) {
			const current = resolved();
			const ids = new Set(current.aliases.map((alias) => alias.id));
			const originals = models.filter((model) => !ids.has(model.id));
			const available = provider.filterModels?.(originals, credential) ?? originals;
			return expandAliases(available, current.aliases).models;
		},
		filterAllModels(models, credential) {
			const current = resolved();
			const ids = new Set(current.aliases.map((alias) => alias.id));
			const originals = models.filter((model) => !isModelType(model, "chat") || !ids.has(model.id));
			if (provider.filterAllModels) {
				const available = provider.filterAllModels(originals, credential);
				const chats = available.filter((model): model is Model<TApi> => isModelType(model, "chat"));
				return [...available, ...expandAliases(chats, current.aliases).models.slice(chats.length)];
			}
			const chats = originals.filter((model): model is Model<TApi> => isModelType(model, "chat"));
			const available = provider.filterModels?.(chats, credential) ?? chats;
			const availableById = new Map(available.map((model) => [model.id, model]));
			const filtered: (typeof originals)[number][] = [];
			for (const model of originals) {
				if (!isModelType(model, "chat")) {
					filtered.push(model);
				} else {
					const transformed = availableById.get(model.id);
					if (transformed) filtered.push(transformed);
				}
			}
			return [
				...filtered,
				...expandAliases(available, current.aliases).models.slice(available.length),
			];
		},
		stream(model, context, options) {
			return provider.stream(model, context, optionsFor(model, options));
		},
		streamSimple(model, context, options) {
			return provider.streamSimple(model, context, optionsFor(model, options));
		},
	};
}
