/** Contributes quotas for Pi's builtin OpenAI provider without registering a provider. */
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { openaiQuota } from "./quota.ts";

/** Creates the quota-only OpenAI family without network I/O. */
export function createOpenaiFamily(): FamilyAdapter {
	return {
		id: "openai",
		label: "OpenAI",
		providers: [
			{
				id: "openai",
				label: "OpenAI",
				aliases: ["codex", "cox", "oai", "openai-codex"],
				quota: openaiQuota,
			},
		],
	};
}
