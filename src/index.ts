/** Pi entrypoint: awaits family registration and wires commands, flags and events. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Registry } from "./core/registry/index.ts";
import { FAMILIES } from "./families/index.ts";

export default async function piAuthPlus(pi: ExtensionAPI): Promise<void> {
	const registry = new Registry(FAMILIES);
	for (const family of registry.families) await family.register?.(pi);
}
