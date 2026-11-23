import { describe, expect, test } from "bun:test";
import {
	decodeLevel,
	encodeLevel,
	thinkingConfig,
	type WireLevel,
} from "../../../src/families/google/levels.ts";

const LEVELS: WireLevel[] = [
	{
		id: "gemini-4-argon-low",
		modelEnum: "MODEL_PLACEHOLDER_M419",
		thinking: { kind: "level", level: "LOW" },
	},
	{
		id: "claude-opus-5-5-high",
		modelEnum: "MODEL_PLACEHOLDER_M402",
		thinking: { kind: "adaptive", level: "HIGH" },
	},
	{
		id: "gemini-3.8-flash-high",
		modelEnum: "MODEL_PLACEHOLDER_M318",
		thinking: { kind: "budget", budget: -1 },
	},
	{
		id: "gemini-4-hydrogen-xhigh",
		modelEnum: "MODEL_PLACEHOLDER_M500",
		thinking: { kind: "level", level: "XHIGH" },
	},
];

describe("families/google/levels", () => {
	test("every level survives a models-store round trip", () => {
		for (const level of LEVELS) {
			const stored = JSON.parse(JSON.stringify(encodeLevel(level))) as string;
			expect(decodeLevel(stored)).toEqual(level);
		}
	});

	test("refuses values it did not encode", () => {
		for (const value of [
			"gemini-4-argon-low",
			"LOW",
			"a|b|level:LOWER",
			"a|b|budget:1.5",
			"a|b|budget:-2",
			"a|b|budget:",
			"|b|level:LOW",
			"a|b|c|level:LOW",
		]) {
			expect(decodeLevel(value)).toBeUndefined();
		}
	});

	test("matches the CLI thinking configs", () => {
		expect(thinkingConfig({ kind: "level", level: "LOW" })).toEqual({
			includeThoughts: true,
			thinkingLevel: "LOW",
		});
		expect(thinkingConfig({ kind: "adaptive", level: "MEDIUM" })).toEqual({
			includeThoughts: true,
			thinkingBudget: 0,
			thinkingLevel: "MEDIUM",
		});
		expect(thinkingConfig({ kind: "budget", budget: 4000 })).toEqual({
			includeThoughts: true,
			thinkingBudget: 4000,
		});
		// XHIGH has no value in the recovered wire enum; the envelope model carries the level.
		expect(thinkingConfig({ kind: "level", level: "XHIGH" })).toEqual({
			includeThoughts: true,
			thinkingLevel: "HIGH",
		});
	});
});
