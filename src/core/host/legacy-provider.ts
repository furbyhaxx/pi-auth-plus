/**
 * Projection of a native `Provider` onto the host's config registration. oh-my-pi's provider
 * drain accepts only a name plus config, and it reserves built-in API names, so the stream
 * is exposed under a namespaced API id that its models then reference.
 */
import type { OAuthLoginCallbacks, Provider, ProviderAuth } from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";

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
