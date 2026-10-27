/** Quota-only metadata for Pi's builtin xAI provider. */
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { estimateCounter } from "../../tokens/estimate/index.ts";
import type { TokenCounter } from "../../tokens/types.ts";
import { xaiQuota } from "./quota.ts";

/** Contributes billing quotas without registering or replacing the builtin provider. */
export function createXaiFamily(): FamilyAdapter {
	const counters = new Map<string, TokenCounter>();
	return {
		id: "xai",
		label: "xAI",
		providers: [{ id: "xai", label: "xAI", aliases: ["grok"], quota: xaiQuota }],
		tokens: (model) => {
			if (model.provider !== "xai") return undefined;
			const cached = counters.get(model.id);
			if (cached) return cached;
			// Chars per token measured in .project/analyses/tokens/usage-audit/report.md.
			const counter = estimateCounter("xai", {
				prose: 4.17,
				json: 3.31,
			});
			counters.set(model.id, counter);
			return counter;
		},
	};
}
