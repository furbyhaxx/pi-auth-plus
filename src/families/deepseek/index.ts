/** Adds balance reporting to Pi's builtin DeepSeek provider. */
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { deepseekQuota } from "./quota.ts";

/** Creates the quota-only DeepSeek family without replacing Pi's provider. */
export function createDeepseekFamily(): FamilyAdapter {
	return {
		id: "deepseek",
		label: "DeepSeek",
		providers: [{ id: "deepseek", label: "DeepSeek", aliases: ["ds"], quota: deepseekQuota }],
	};
}
