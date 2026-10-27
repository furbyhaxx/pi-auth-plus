/** Every vendor family, as literal imports so Pi-Bolt can compile them in. */
import type { FamilyAdapter } from "../core/registry/index.ts";
import { createAnthropicFamily } from "./anthropic/index.ts";
import { createOpencodeFamily } from "./opencode/index.ts";
import { createSyntheticFamily } from "./synthetic/index.ts";

export const FAMILIES: readonly FamilyAdapter[] = [
	createOpencodeFamily(),
	createSyntheticFamily(),
	createAnthropicFamily(),
];
