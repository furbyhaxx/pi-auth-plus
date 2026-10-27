/** Resolves quota settings through the registry, never through family-specific names. */
import type { AppSettings } from "../core/config/catalog.ts";
import type { ProviderEntry, Registry } from "../core/registry/index.ts";

/** Enabled quota providers in registration order; unknown or quota-less names are ignored. */
export function enabledQuotaProviders(registry: Registry, settings: AppSettings): ProviderEntry[] {
	const names = settings.get("quotas.providers");
	const ids = new Set(
		names.flatMap((name) => {
			const resolved = registry.resolve(name);
			return resolved ? [resolved.provider.id] : [];
		}),
	);
	return registry
		.providers()
		.flatMap(({ provider }) =>
			provider.quota && (names.length === 0 || ids.has(provider.id)) ? [provider] : [],
		);
}
