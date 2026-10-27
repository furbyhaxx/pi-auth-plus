import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { correctSyntheticUsage } from "../../../src/families/synthetic/usage.ts";

// Persisted usage from .project/analyses/tokens/usage-audit/captures/synthetic-hf-deepseek-ai-DeepSeek-V4-1-Flash-1017.json
const CAPTURED: readonly { usage: Usage; prompt: number }[] = [
	{
		prompt: 6869,
		usage: {
			input: 6869,
			output: 20,
			cacheRead: 0,
			cacheWrite: 6869,
			totalTokens: 13758,
			cost: { input: 0.0041214, output: 2.4e-5, cacheRead: 0, cacheWrite: 0, total: 0.0041454 },
			cacheWrite1h: 0,
		},
	},
	{
		prompt: 7311,
		usage: {
			input: 468,
			output: 6,
			cacheRead: 6843,
			cacheWrite: 468,
			totalTokens: 7785,
			cost: {
				input: 0.0002808,
				output: 7.2e-6,
				cacheRead: 0.00020528999999999998,
				cacheWrite: 0,
				total: 0.00049329,
			},
			cacheWrite1h: 0,
		},
	},
];

function assistant(usage: Usage, provider = "synthetic"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider,
		model: "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017",
		usage,
		stopReason: "stop",
		timestamp: 0,
	};
}

describe("synthetic usage correction", () => {
	test.each(CAPTURED)(
		"context equals the real prompt and cost is unchanged ($prompt)",
		({ usage, prompt }) => {
			const fixed = correctSyntheticUsage(assistant(usage))?.usage;
			expect(fixed?.input).toBe(usage.input);
			expect(fixed?.cacheWrite).toBe(0);
			expect((fixed?.totalTokens ?? 0) - usage.output).toBe(prompt);
			expect(fixed?.cost.total).toBeCloseTo(usage.cost.total, 12);
		},
	);
	test("normal Anthropic accounting and other providers are left alone", () => {
		const normal = { ...CAPTURED[1]!.usage, cacheWrite: 120, totalTokens: 7437 };
		expect(correctSyntheticUsage(assistant(normal))).toBeUndefined();
		expect(correctSyntheticUsage(assistant(CAPTURED[0]!.usage, "claude"))).toBeUndefined();
	});
});
