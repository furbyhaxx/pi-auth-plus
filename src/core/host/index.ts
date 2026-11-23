/** Host APIs that a Pi-compatible runtime may not carry (oh-my-pi's facade lacks several). */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PackageEntry } from "../conflicts/index.ts";
import type { ProviderSink } from "../registry/index.ts";

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

/** Where provider registrations land; oh-my-pi exposes them on its runtime, not the facade. */
export function hostProviderSink(pi: ExtensionAPI): ProviderSink {
	const runtime = (pi as { runtime?: unknown }).runtime;
	const candidate = runtime as ProviderSink | undefined;
	return typeof candidate?.registerProvider === "function" ? candidate : pi;
}
