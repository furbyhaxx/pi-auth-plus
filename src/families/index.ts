/** Every vendor family, as literal imports so Pi-Bolt can compile them in. */
import { tmpdir } from "node:os";
import type { FamilyAdapter } from "../core/registry/index.ts";
import { defaultTokenizerStore } from "../tokens/tokenizer/index.ts";
import { createAnthropicFamily } from "./anthropic/index.ts";
import { createDeepseekFamily } from "./deepseek/index.ts";
import { createGoogleFamily } from "./google/index.ts";
import { createOpenaiFamily } from "./openai/index.ts";
import { createOpencodeFamily } from "./opencode/index.ts";
import { createOpenrouterFamily } from "./openrouter/index.ts";
import { createSyntheticFamily } from "./synthetic/index.ts";
import { createXaiFamily } from "./xai/index.ts";

export const FAMILIES: readonly FamilyAdapter[] = [
	createOpencodeFamily(),
	createSyntheticFamily(process.env, fetch, Date.now, tmpdir, defaultTokenizerStore()),
	createAnthropicFamily(),
	createGoogleFamily(),
	createOpenaiFamily(),
	createXaiFamily(),
	createOpenrouterFamily(),
	createDeepseekFamily(),
];
