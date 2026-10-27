/** Adds quota reporting for Pi's builtin OpenRouter provider without replacing it. */
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { openrouterQuota } from "./quota.ts";

/** Creates the quota-only family without network or provider registration. */
export function createOpenrouterFamily(): FamilyAdapter {
	return {
		id: "openrouter",
		label: "OpenRouter",
		providers: [{ id: "openrouter", label: "OpenRouter", aliases: ["or"], quota: openrouterQuota }],
	};
}
