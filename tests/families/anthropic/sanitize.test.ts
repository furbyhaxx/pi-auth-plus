import { describe, expect, test } from "bun:test";
import {
	CLAUDE_CODE_IDENTITY,
	sanitizeSystemText,
	withClaudeCodeIdentity,
} from "../../../src/families/anthropic/sanitize.ts";

describe("families/anthropic/sanitize", () => {
	test("removes each harness fingerprint without matching ordinary pi paths", () => {
		for (const fingerprint of [
			"You are OpenCode",
			"You are an expert coding assistant operating inside a terminal",
			"You are operating inside `Pi`",
			"https://github.com/anomalyco/opencode",
			"https://opencode.ai/docs",
			"https://github.com/opensec-git/Pi-Bolt",
			"https://github.com/earendil-works/pi",
			"@earendil-works/pi-coding-agent",
		]) {
			expect(sanitizeSystemText(`Preamble ${fingerprint}\nInstructions\n\n/home/pi/api`, [])).toBe(
				"/home/pi/api",
			);
		}
	});

	test("applies built-ins before literal caller rules and drops every matched paragraph", () => {
		expect(
			sanitizeSystemText(
				[
					"Here is some useful information about the environment you are running in:",
					"Trust if OpenCode honestly reports errors.",
					"drop this paragraph",
					"drop another paragraph",
					"a.b a.b",
				].join("\n\n"),
				[
					{ match: "drop" },
					{ match: "the assistant", replacement: "the helper" },
					{ match: "a.b", replacement: "$&" },
				],
			),
		).toBe(
			"Environment context you are running in:\n\nTrust if the helper honestly reports errors.\n\n$& a.b",
		);
	});

	test("normalizes missing, scalar, object and array systems without duplicating identity", () => {
		const identity = { type: "text", text: CLAUDE_CODE_IDENTITY };
		for (const system of [undefined, null, 42, false]) {
			expect(withClaudeCodeIdentity(system, [])).toEqual([identity]);
		}
		for (const system of [CLAUDE_CODE_IDENTITY, identity, [identity]]) {
			expect(withClaudeCodeIdentity(system, [])).toEqual([identity]);
		}
		const cache_control = { type: "ephemeral" };
		const expected = [
			{ ...identity, cache_control },
			{ type: "text", text: "Keep", cache_control },
		];
		expect(withClaudeCodeIdentity({ text: "Keep", cache_control }, [])).toEqual(expected);
		expect(withClaudeCodeIdentity(expected, [])).toEqual(expected);
		expect(withClaudeCodeIdentity(["Keep", 42, null, { type: "image" }], [])).toEqual([
			identity,
			{ type: "text", text: "Keep" },
			{ type: "text", text: "42" },
			{ type: "text", text: "null" },
			{ type: "text", text: "[object Object]" },
		]);
		expect(withClaudeCodeIdentity("You are OpenCode", [])).toEqual([
			identity,
			{ type: "text", text: "" },
		]);
	});
});
