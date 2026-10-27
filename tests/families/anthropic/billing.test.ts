import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { billingBlock } from "../../../src/families/anthropic/billing.ts";

describe("families/anthropic/billing", () => {
	test("reproduces the known version suffix without gated cch", () => {
		const expected = "x-anthropic-billing-header: cc_version=2.1.87.6ff; cc_entrypoint=cli;";
		for (const content of [
			"hello world test message",
			[
				{ type: "image", text: "ignore" },
				{ type: "text", text: "hello world test message" },
				{ type: "text", text: "ignore" },
			],
		]) {
			expect(
				billingBlock(
					[
						{ role: "assistant", content: "ignore" },
						{ role: "user", content },
						{ role: "user", content: "ignore" },
					],
					"2.1.87",
				),
			).toBe(expected);
		}
	});

	test("distinguishes no user from an empty first user message", () => {
		for (const messages of [undefined, {}, [], [null, {}, { role: "assistant" }]]) {
			expect(billingBlock(messages, "2.1.87")).toBeUndefined();
		}
		for (const content of [
			undefined,
			null,
			[],
			[{ type: "image" }],
			[
				{ type: "text", text: "" },
				{ type: "text", text: "ignored" },
			],
		]) {
			expect(billingBlock([{ role: "user", content }], "2.1.87")).toBe(
				billingBlock([{ role: "user", content: "" }], "2.1.87"),
			);
			expect(billingBlock([{ role: "user", content }], "2.1.87")).toEndWith("cc_entrypoint=cli;");
		}
	});

	test("samples UTF-16 positions, including a bisected surrogate, with zero fallbacks", () => {
		const text = "abcd😀xy";
		const suffix = createHash("sha256")
			.update("59cf53e54c78\ud83dy02.1.87")
			.digest("hex")
			.slice(0, 3);
		expect(billingBlock([{ role: "user", content: text }], "2.1.87")).toContain(
			`cc_version=2.1.87.${suffix};`,
		);
	});
});
