/** Contributes ChatGPT quotas without registering a model provider. */
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { codexQuotaAuth } from "./auth.ts";
import type { CodexOptions } from "./codex-auth/index.ts";
import { CODEX_PROVIDER_ID } from "./identity.ts";
import { openaiQuota } from "./quota.ts";

/** Creates the quota-only OpenAI family without network I/O; `codexAuth` relocates the Codex file. */
export function createOpenaiFamily(
	options: { readonly codexAuth?: Omit<CodexOptions, "signal"> } = {},
): FamilyAdapter {
	return {
		id: "openai",
		label: "OpenAI",
		providers: [
			{
				id: CODEX_PROVIDER_ID,
				label: "OpenAI Codex",
				aliases: ["openai", "openai-codex", "chatgpt", "cx", "cox", "oai"],
				quota: { ...openaiQuota, auth: codexQuotaAuth(options.codexAuth) },
			},
		],
	};
}
