/** Model-registry accessors that a Pi-compatible runtime may omit (oh-my-pi omits several). */
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionContext, ProviderConfig } from "@earendil-works/pi-coding-agent";

type Registry = ExtensionContext["modelRegistry"];

/** The auth lookups the quota and search paths need, with either host spelling present. */
export interface ProviderAuthRegistry {
	getProviderAuth?(id: string): Promise<ProviderAuthView | undefined>;
	getApiKeyForProvider?(id: string): Promise<string | undefined>;
}

/** Non-secret request auth in the shape the quota and search paths read. */
export interface ProviderAuthView {
	readonly auth?: {
		readonly apiKey?: string;
		readonly headers?: Readonly<Record<string, string | null>>;
	};
}

/** Pi's refreshed provider auth, else the host's API key lookup. */
export async function providerAuthView(
	registry: ProviderAuthRegistry | undefined,
	provider: string,
): Promise<ProviderAuthView | undefined> {
	if (!registry) return undefined;
	if (typeof registry.getProviderAuth === "function")
		return registry.getProviderAuth.call(registry, provider);
	if (typeof registry.getApiKeyForProvider === "function") {
		const apiKey = await registry.getApiKeyForProvider.call(registry, provider);
		return apiKey ? { auth: { apiKey } } : undefined;
	}
	return undefined;
}

/** The host's view of who registered a provider, when it exposes one. */
export interface RegisteredProviders {
	config(provider: string): ProviderConfig | undefined;
	native(provider: string): Provider | undefined;
}

export function registeredProviders(registry: Registry): RegisteredProviders | undefined {
	const native = registry as {
		getRegisteredProviderConfig?: (id: string) => ProviderConfig | undefined;
		getRegisteredNativeProvider?: (id: string) => Provider | undefined;
	};
	if (
		typeof native.getRegisteredProviderConfig !== "function" ||
		typeof native.getRegisteredNativeProvider !== "function"
	)
		return undefined;
	return {
		config: (provider) => native.getRegisteredProviderConfig?.call(registry, provider),
		native: (provider) => native.getRegisteredNativeProvider?.call(registry, provider),
	};
}
