import { describe, expect, test } from "bun:test";
import { sumCounts } from "../../src/tokens/types.ts";

describe("token count contracts", () => {
	test("sums and deduplicates authentication diagnostics in first-seen order", () => {
		const claudeDiagnostic = {
			code: "needs-auth",
			provider: "claude",
			message: "Sign in with /login claude to get a native token count.",
		} as const;
		const syntheticDiagnostic = {
			code: "needs-auth",
			provider: "synthetic",
			message: "Sign in with /login synthetic to get a native token count.",
		} as const;
		const otherClaudeDiagnostic = {
			...claudeDiagnostic,
			message: "Sign in with /login claude to count this request.",
		} as const;

		expect(
			sumCounts([
				{
					tokens: 12,
					source: "count-endpoint",
					diagnostics: [claudeDiagnostic, syntheticDiagnostic],
				},
				{ tokens: 5, source: "tokenizer", diagnostics: [claudeDiagnostic, otherClaudeDiagnostic] },
			]),
		).toEqual({
			tokens: 17,
			source: "tokenizer",
			diagnostics: [claudeDiagnostic, syntheticDiagnostic, otherClaudeDiagnostic],
		});
	});

	test("keeps the no-diagnostic result shape unchanged", () => {
		expect(
			sumCounts([
				{ tokens: 7, source: "provider" },
				{ tokens: 2, source: "count-endpoint" },
			]),
		).toEqual({ tokens: 9, source: "count-endpoint" });
	});
});
