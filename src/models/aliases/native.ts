/** Native-provider alias catalogs and request shaping. */
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	isModelType,
	lazyStream,
	type Model,
	normalizeContext,
	type Provider,
	type StreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	type AliasCatalogEntry,
	type AliasIssue,
	expandAliases,
	type ModelAlias,
	resolveAliases,
	rewriteAliasPayload,
} from "./index.ts";

function modelKey(model: AliasCatalogEntry): string {
	return JSON.stringify([model.provider, model.id, model.type ?? "chat"]);
}

function matchesAlias(model: AliasCatalogEntry, alias: ModelAlias): boolean {
	return (
		(model.type === undefined || model.type === "chat") &&
		model.provider === alias.provider &&
		model.id === alias.id
	);
}

/** Wrap a provider while reading alias settings and its dynamic catalog on each operation. */
export function wrapNativeAliases<TApi extends Api>(
	provider: Provider<TApi>,
	aliases: () => readonly ModelAlias[],
	report?: (issues: readonly AliasIssue[]) => void,
): Provider<TApi> {
	function resolved() {
		const catalog = provider.getModels();
		const all = provider.getAllModels?.() ?? catalog;
		const resolution = resolveAliases(
			all,
			aliases().filter((alias) => alias.provider === provider.id),
		);
		report?.(resolution.issues);
		return { catalog, all, aliases: resolution.aliases };
	}

	function policyInputs<T extends AliasCatalogEntry>(
		current: ReturnType<typeof resolved>,
		models: readonly T[],
	) {
		const requested = current.aliases.filter((alias) =>
			models.some((model) => matchesAlias(model, alias)),
		);
		const originals = models.filter(
			(model) => !current.aliases.some((alias) => matchesAlias(model, alias)),
		);
		const incoming = new Set(originals.map(modelKey));
		// Borrow hidden sources for policy evaluation without returning them.
		const sources = current.catalog.filter(
			(model) =>
				!incoming.has(modelKey(model)) &&
				requested.some((alias) => alias.provider === model.provider && alias.source === model.id),
		);
		return { requested, originals, sources, incoming };
	}

	function optionsFor<T extends StreamOptions>(
		model: Model<TApi>,
		alias: ModelAlias,
		options: T | undefined,
	): T {
		const onPayload: NonNullable<StreamOptions["onPayload"]> = async (payload, payloadModel) => {
			const transformed = await options?.onPayload?.(payload, { ...payloadModel, id: model.id });
			return rewriteAliasPayload(transformed === undefined ? payload : transformed, model, [alias]);
		};
		const onResponse: StreamOptions["onResponse"] = options?.onResponse
			? (response, responseModel) =>
					options.onResponse?.(response, { ...responseModel, id: model.id })
			: undefined;
		const onProviderStreamEvent: StreamOptions["onProviderStreamEvent"] =
			options?.onProviderStreamEvent
				? (data, eventModel) =>
						options.onProviderStreamEvent?.(data, { ...eventModel, id: model.id })
				: undefined;
		return Object.assign({}, options, {
			onPayload,
			...(onResponse ? { onResponse } : {}),
			...(onProviderStreamEvent ? { onProviderStreamEvent } : {}),
		});
	}

	function contextFor(
		context: TranscriptContext,
		model: Model<TApi>,
		alias: ModelAlias,
	): TranscriptContext {
		return normalizeContext({
			messages: context.messages.map((message) => {
				if (message.role !== "assistant" || message.provider !== model.provider) return message;
				if (message.model === alias.id) return { ...message, model: alias.source };
				// Physical-model turns must remain distinct from turns created under this alias.
				if (message.model === alias.source) return { ...message, model: alias.id };
				return message;
			}),
		});
	}

	function mapStream(
		source: AssistantMessageEventStream,
		model: Model<TApi>,
		alias: ModelAlias,
	): AssistantMessageEventStream {
		const mapped = new WeakMap<AssistantMessage, AssistantMessage>();
		function messageFor(message: AssistantMessage): AssistantMessage {
			if (message.provider !== model.provider || message.model !== alias.source) return message;
			const prior = mapped.get(message);
			if (prior) return Object.assign(prior, message, { model: model.id });
			const result = { ...message, model: model.id };
			mapped.set(message, result);
			return result;
		}
		function eventFor(event: AssistantMessageEvent): AssistantMessageEvent {
			if (event.type === "done") return { ...event, message: messageFor(event.message) };
			if (event.type === "error") return { ...event, error: messageFor(event.error) };
			return { ...event, partial: messageFor(event.partial) };
		}
		return lazyStream(model, async () => ({
			async *[Symbol.asyncIterator]() {
				for await (const event of source) yield eventFor(event);
			},
			async result() {
				return messageFor(await source.result());
			},
		}));
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
			const added = expandAliases(current.catalog, current.aliases).models.slice(
				current.catalog.length,
			);
			return [...current.all, ...added];
		},
		filterModels(models, credential) {
			const current = resolved();
			const { requested, originals, sources, incoming } = policyInputs(current, models);
			const physical = [...originals, ...sources];
			const available = provider.filterModels?.(physical, credential) ?? physical;
			return [
				...available.filter((model) => incoming.has(modelKey(model))),
				...expandAliases(available, requested).models.slice(available.length),
			];
		},
		filterAllModels(models, credential) {
			const current = resolved();
			const { requested, originals, sources, incoming } = policyInputs(current, models);
			const physical = [...originals, ...sources];
			if (provider.filterAllModels) {
				const available = provider.filterAllModels(physical, credential);
				const chats = available.filter((model): model is Model<TApi> => isModelType(model, "chat"));
				return [
					...available.filter((model) => incoming.has(modelKey(model))),
					...expandAliases(chats, requested).models.slice(chats.length),
				];
			}
			const chats = physical.filter((model): model is Model<TApi> => isModelType(model, "chat"));
			const available = provider.filterModels?.(chats, credential) ?? chats;
			const availableById = new Map(available.map((model) => [modelKey(model), model]));
			const filtered: (typeof originals)[number][] = [];
			for (const model of originals) {
				if (!isModelType(model, "chat")) {
					filtered.push(model);
				} else {
					const transformed = availableById.get(modelKey(model));
					if (transformed) filtered.push(transformed);
				}
			}
			return [...filtered, ...expandAliases(available, requested).models.slice(available.length)];
		},
		stream(model, context, options) {
			const alias = resolved().aliases.find(
				(entry) => entry.id === model.id && entry.provider === model.provider,
			);
			if (!alias) return provider.stream(model, context, options);
			return mapStream(
				provider.stream(
					{ ...model, id: alias.source },
					contextFor(context, model, alias),
					optionsFor(model, alias, options),
				),
				model,
				alias,
			);
		},
		streamSimple(model, context, options) {
			const alias = resolved().aliases.find(
				(entry) => entry.id === model.id && entry.provider === model.provider,
			);
			if (!alias) return provider.streamSimple(model, context, options);
			return mapStream(
				provider.streamSimple(
					{ ...model, id: alias.source },
					contextFor(context, model, alias),
					optionsFor(model, alias, options),
				),
				model,
				alias,
			);
		},
	};
}
