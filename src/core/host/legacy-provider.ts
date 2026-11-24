/**
 * Projection of a native `Provider` onto the host's config registration. oh-my-pi's provider
 * drain accepts only a name plus config, and it reserves built-in API names, so the stream
 * is exposed under a namespaced API id that its models then reference.
 */
import type {
	Credential,
	OAuthLoginCallbacks,
	Provider,
	ProviderAuth,
	RefreshModelsContext,
	SimpleStreamOptions,
	ThinkingLevelMap,
} from "@earendil-works/pi-ai";
import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

/** oh-my-pi's catalog seam: it ignores `refreshModels` and caches this result for 24 h. */
export type HostProviderConfig = Omit<ProviderConfig, "refreshModels"> & {
	fetchDynamicModels?: (apiKey: string | undefined) => Promise<readonly ProviderModelConfig[]>;
};

const DYNAMIC_MODELS_TIMEOUT_MS = 30_000;

/** API id registered for a family's own streaming implementation on this host. */
export function hostApiId(api: string): string {
	return `pi-auth-plus-${api}`;
}

function interaction(callbacks: OAuthLoginCallbacks) {
	return {
		signal: callbacks.signal ?? new AbortController().signal,
		notify(event: {
			type: string;
			message?: string;
			url?: string;
			instructions?: string;
			userCode?: string;
			verificationUri?: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
		}): void {
			switch (event.type) {
				case "auth_url":
					if (event.url)
						callbacks.onAuth({
							url: event.url,
							...(event.instructions ? { instructions: event.instructions } : {}),
						});
					return;
				case "device_code":
					if (event.userCode && event.verificationUri)
						callbacks.onDeviceCode({
							userCode: event.userCode,
							verificationUri: event.verificationUri,
							...(event.intervalSeconds ? { intervalSeconds: event.intervalSeconds } : {}),
							...(event.expiresInSeconds ? { expiresInSeconds: event.expiresInSeconds } : {}),
						});
					return;
				default:
					if (event.message) callbacks.onProgress?.(event.message);
			}
		},
		async prompt(prompt: {
			type: "text" | "secret" | "select" | "manual_code";
			message: string;
			placeholder?: string;
			options?: readonly { id: string; label: string; description?: string }[];
		}): Promise<string> {
			if (prompt.type === "select") {
				const chosen = await callbacks.onSelect({
					message: prompt.message,
					options: [...(prompt.options ?? [])],
				});
				if (chosen === undefined) throw new Error("Login cancelled");
				return chosen;
			}
			if (prompt.type === "manual_code" && callbacks.onManualCodeInput)
				return callbacks.onManualCodeInput();
			return callbacks.onPrompt({
				message: prompt.message,
				...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
			});
		},
	};
}

function legacyOAuth(
	oauth: NonNullable<ProviderAuth["oauth"]>,
): NonNullable<ProviderConfig["oauth"]> {
	return {
		name: oauth.name,
		...(oauth.isSubscription ? { isSubscription: true } : {}),
		login: async (callbacks) => oauth.login(interaction(callbacks)),
		refreshToken: async (credentials, signal) => ({
			...(await oauth.refresh({ ...credentials, type: "oauth" }, signal)),
			type: "oauth" as const,
		}),
		getApiKey: (credentials) => credentials.access as string,
	};
}

function staticHeaders(headers: Provider["headers"]): Record<string, string> | undefined {
	if (!headers) return undefined;
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) if (value !== null) out[name] = value;
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Undefined when the provider has neither auth path, which a config cannot express. */
export function legacyProviderConfig(provider: Provider): ProviderConfig | undefined {
	const models = provider.getModels();
	if (!provider.auth.oauth && !provider.auth.apiKey) return undefined;
	const api = hostApiId(models[0]?.api ?? "messages");
	const headers = staticHeaders(provider.headers);
	const config: ProviderConfig = {
		name: provider.name,
		...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
		...(headers ? { headers } : {}),
		api,
		models: models.map((model) => ({ ...model, api })),
		streamSimple: (model, context, options) => provider.streamSimple(model, context, options),
		...(provider.auth.oauth ? { oauth: legacyOAuth(provider.auth.oauth) } : {}),
		async refreshModels(context) {
			await provider.refreshModels?.(context);
			return provider.getModels().map((model) => ({ ...model, api }));
		},
	};
	if (!config.baseUrl && models[0]?.baseUrl) config.baseUrl = models[0].baseUrl;
	return config;
}

function refreshContext(apiKey: string | undefined, oauth: boolean): RefreshModelsContext {
	const credential: Credential | undefined = !apiKey
		? undefined
		: oauth
			? { type: "oauth", access: apiKey, refresh: "", expires: Number.MAX_SAFE_INTEGER }
			: { type: "api_key", key: apiKey };
	return {
		...(credential ? { credential } : {}),
		allowNetwork: true,
		// oh-my-pi owns freshness: it calls only when its own 24 h cache is stale.
		force: true,
		signal: AbortSignal.timeout(DYNAMIC_MODELS_TIMEOUT_MS),
		async publish(publication) {
			publication.update?.();
			return true;
		},
	};
}

const HOST_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const DEFAULT_EFFORTS: ReadonlySet<string> = new Set(["minimal", "low", "medium", "high"]);

type HostEffort = (typeof HOST_EFFORTS)[number];

/** oh-my-pi's per-model effort list; it reads no `thinkingLevelMap`. */
interface HostThinking {
	readonly mode: "effort";
	readonly efforts: readonly HostEffort[];
	readonly effortMap?: Partial<Record<HostEffort, string>>;
}

type HostModelConfig = ProviderModelConfig & { thinking?: HostThinking };

function levelMap(model: ProviderModelConfig): ThinkingLevelMap | undefined {
	return "thinkingLevelMap" in model ? model.thinkingLevelMap : undefined;
}

/**
 * Pi's levels: a string maps, `null` is unsupported, a missing key keeps Pi's default set.
 * oh-my-pi rebuilds models from known fields only and caches them across runs, so a provider
 * with its own stream gets its level values back through `effortMap`, which it hands to that
 * stream unread.
 */
function hostThinking(model: ProviderModelConfig, ownStream: boolean): HostThinking | undefined {
	const map = levelMap(model);
	if (!map || !("reasoning" in model) || !model.reasoning) return undefined;
	const efforts = HOST_EFFORTS.filter((level) => {
		const value = map[level];
		return typeof value === "string" || (value === undefined && DEFAULT_EFFORTS.has(level));
	});
	if (efforts.length === 0) return undefined;
	const effortMap: Partial<Record<HostEffort, string>> = {};
	for (const level of efforts) {
		const value = map[level];
		if (typeof value === "string") effortMap[level] = value;
	}
	return ownStream && Object.keys(effortMap).length > 0
		? { mode: "effort", efforts, effortMap }
		: { mode: "effort", efforts };
}

/** The level map `hostThinking` carried, from a model oh-my-pi rebuilt. */
function restoredLevelMap(model: object): ThinkingLevelMap | undefined {
	if (!("thinking" in model)) return undefined;
	const thinking: unknown = model.thinking;
	if (typeof thinking !== "object" || thinking === null || !("effortMap" in thinking))
		return undefined;
	const effortMap: unknown = thinking.effortMap;
	if (typeof effortMap !== "object" || effortMap === null) return undefined;
	const map: ThinkingLevelMap = { off: null };
	for (const level of HOST_EFFORTS) {
		const value: unknown = Reflect.get(effortMap, level);
		map[level] = typeof value === "string" ? value : null;
	}
	return map;
}

/** Pi hands an OAuth access token to a stream as its bearer header; oh-my-pi as `apiKey`. */
function withBearer(options: SimpleStreamOptions | undefined): SimpleStreamOptions | undefined {
	if (!options?.apiKey) return options;
	const { apiKey, ...rest } = options;
	const headers = rest.headers ?? {};
	if (Object.keys(headers).some((name) => name.toLowerCase() === "authorization")) return options;
	return { ...rest, headers: { ...headers, Authorization: `Bearer ${apiKey}` } };
}

/**
 * A Pi provider config in oh-my-pi's shape: `fetchDynamicModels` in place of `refreshModels`,
 * effort lists in place of `thinkingLevelMap`, and no environment-reference key.
 *
 * Pi ranks a `/login` key above a config `$NAME` reference. oh-my-pi ranks any registered
 * `apiKey` above stored logins and sends an unset variable's name as the key, so the reference
 * is dropped and its own credential cascade (logins, then the provider's known variable)
 * serves the request. It requires a key for static models, so they move to the dynamic path.
 */
export function hostProviderConfig(config: ProviderConfig): HostProviderConfig {
	const { refreshModels, streamSimple, ...rest } = config;
	const ownStream = streamSimple !== undefined;
	const project = (models: readonly ProviderModelConfig[]): HostModelConfig[] =>
		models.map((model) => {
			const thinking = hostThinking(model, ownStream);
			return thinking ? { ...model, thinking } : model;
		});
	const projected: HostProviderConfig = { ...rest };
	const envKey = config.apiKey?.startsWith("$") === true;
	if (envKey) delete projected.apiKey;
	if (config.models) {
		if (envKey) delete projected.models;
		else projected.models = project(config.models);
	}
	if (streamSimple)
		projected.streamSimple = (model, context, options) => {
			const thinkingLevelMap = model.thinkingLevelMap ?? restoredLevelMap(model);
			return streamSimple(
				thinkingLevelMap ? { ...model, thinkingLevelMap } : model,
				context,
				config.oauth ? withBearer(options) : options,
			);
		};
	if (refreshModels)
		projected.fetchDynamicModels = async (apiKey) =>
			project(await refreshModels.call(config, refreshContext(apiKey, config.oauth !== undefined)));
	else if (envKey) {
		const models = project(config.models ?? []);
		projected.fetchDynamicModels = async () => models;
	}
	return projected;
}
