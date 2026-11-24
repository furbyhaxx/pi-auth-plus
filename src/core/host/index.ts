/** Host APIs that a Pi-compatible runtime may not carry (oh-my-pi's facade lacks several). */
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { PackageEntry } from "../conflicts/index.ts";
import type { ProviderSink } from "../registry/index.ts";
import { hostProviderConfig } from "./legacy-provider.ts";
import { ompRuntime } from "./omp.ts";

/** The configured package lists conflict detection reads. */
export interface HostSettings {
	readonly packages?: readonly PackageEntry[];
	readonly extensions?: readonly string[];
}

/** Pi's settings, or empty lists on a host without the accessor. */
export function hostSettings(pi: ExtensionAPI): HostSettings {
	if (typeof pi.getSettings !== "function") return {};
	const settings = pi.getSettings();
	return {
		...(settings.packages ? { packages: settings.packages } : {}),
		...(settings.extensions ? { extensions: settings.extensions } : {}),
	};
}

/** Virtual models back the model groups; without them groups stay inactive. */
export function supportsVirtualModels(pi: ExtensionAPI): boolean {
	return (
		typeof pi.registerVirtualModel === "function" && typeof pi.unregisterVirtualModel === "function"
	);
}

/** Custom session entries render as plain transcript entries without this hook. */
export function supportsEntryRenderer(pi: ExtensionAPI): boolean {
	return typeof pi.registerEntryRenderer === "function";
}

/**
 * Where provider registrations land. oh-my-pi exposes them on its runtime, not the facade, and
 * takes only named configs in its own shape, so registrations there pass through the projection.
 */
export function hostProviderSink(pi: ExtensionAPI): ProviderSink {
	const runtime = ompRuntime(pi);
	if (!runtime) return pi;
	return {
		registerProvider(providerOrName: Provider | string, config?: ProviderConfig): void {
			if (typeof providerOrName !== "string" || !config)
				throw new Error(
					"oh-my-pi registers providers by name and config; project native providers with legacyProviderConfig first",
				);
			runtime.registerProvider(providerOrName, hostProviderConfig(config));
		},
	};
}
