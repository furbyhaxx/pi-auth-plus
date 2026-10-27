/** Quota-only metadata for Pi's builtin xAI provider. */
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { xaiQuota } from "./quota.ts";

/** Contributes billing quotas without registering or replacing the builtin provider. */
export function createXaiFamily(): FamilyAdapter {
	return {
		id: "xai",
		label: "xAI",
		providers: [{ id: "xai", label: "xAI", aliases: ["grok"], quota: xaiQuota }],
	};
}
