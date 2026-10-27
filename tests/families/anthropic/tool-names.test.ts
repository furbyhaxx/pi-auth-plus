import { describe, expect, test } from "bun:test";
import {
	ToolNameCollisionError,
	toolNameRestorer,
	wireToolName,
} from "../../../src/families/anthropic/tool-names.ts";

describe("families/anthropic/tool-names", () => {
	test("wire names round-trip to the exact Pi names, including custom PascalCase tools", () => {
		const names = [
			"bash",
			"read",
			"web_search",
			"ask_user",
			"MyCustomTool",
			"todo",
			"mcp__server__tool",
			"__pi_deferred_placeholder__",
		];
		const restore = toolNameRestorer(names);
		expect(names.map(wireToolName)).toEqual([
			"Bash",
			"Read",
			"WebSearch",
			"AskUser",
			"MyCustomTool",
			"Todo",
			"mcp__server__tool",
			"DeferredToolPlaceholder",
		]);
		expect(names.map((name) => restore(wireToolName(name)))).toEqual(names);
	});

	test("unknown names pass through and the placeholder is always restored", () => {
		const restore = toolNameRestorer([]);
		expect(restore("Read")).toBe("Read");
		expect(restore("DeferredToolPlaceholder")).toBe("__pi_deferred_placeholder__");
		expect(wireToolName("_web--search")).toBe("WebSearch");
		expect(restore("mcp_StructuredOutput")).toBe("mcp_StructuredOutput");
		expect(restore("web_fetch")).toBe("web_fetch");
	});

	test("two tools with one wire name are refused instead of dispatched ambiguously", () => {
		expect(() => toolNameRestorer(["read", "Read"])).toThrow(ToolNameCollisionError);
		expect(() => toolNameRestorer(["web_search", "webSearch"])).toThrow(ToolNameCollisionError);
		expect(() => toolNameRestorer(["read", "read"])).not.toThrow();
	});
});
