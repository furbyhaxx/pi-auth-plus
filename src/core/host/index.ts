/** Host APIs that a Pi-compatible runtime may not carry (oh-my-pi's facade lacks several). */
import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { PackageEntry } from "../conflicts/index.ts";
import type { ProviderSink } from "../registry/index.ts";
import { type HostProviderConfig, hostProviderConfig } from "./legacy-provider.ts";

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

interface HostRuntimeSink {
	registerProvider(name: string, config: HostProviderConfig): void;
}

function hostRuntime(pi: ExtensionAPI): HostRuntimeSink | undefined {
	if (!("runtime" in pi)) return undefined;
	const runtime: unknown = pi.runtime;
	if (typeof runtime !== "object" || runtime === null || !("registerProvider" in runtime))
		return undefined;
	const register = runtime.registerProvider;
	if (typeof register !== "function") return undefined;
	return { registerProvider: (name, config) => register.call(runtime, name, config) };
}

/**
 * Where provider registrations land. oh-my-pi exposes them on its runtime, not the facade, and
 * takes only named configs in its own shape, so registrations there pass through the projection.
 */
export function hostProviderSink(pi: ExtensionAPI): ProviderSink {
	const runtime = hostRuntime(pi);
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

/** True when registrations go to oh-my-pi's runtime and native providers need projecting. */
export function hostTakesConfigsOnly(pi: ExtensionAPI): boolean {
	return hostRuntime(pi) !== undefined;
}
