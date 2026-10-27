import { describe, expect, test } from "bun:test";
import {
	ToolNameCollisionError,
	toolNameRestorer,
	wireToolName,
} from "../../../src/families/anthropic/tool-names.ts";

describe("families/anthropic/tool-names", () => {
	test("wire names round-trip to the exact Pi names, including custom PascalCase tools", () => {
		const names = ["bash", "Agent", "web_search"];
		const restore = toolNameRestorer(names);
		expect(names.map(wireToolName)).toEqual(["mcp_Bash", "mcp_Agent", "mcp_Web_search"]);
		expect(names.map((name) => restore(wireToolName(name)))).toEqual(names);
	});

	test("unknown names fall back to the CLI's convention and unprefixed names pass through", () => {
		const restore = toolNameRestorer([]);
		expect(restore("mcp_Read")).toBe("read");
		expect(restore("mcp_StructuredOutput")).toBe("StructuredOutput");
		expect(restore("web_fetch")).toBe("web_fetch");
	});

	test("two tools with one wire name are refused instead of dispatched ambiguously", () => {
		expect(() => toolNameRestorer(["read", "Read"])).toThrow(ToolNameCollisionError);
		expect(() => toolNameRestorer(["read", "read"])).not.toThrow();
	});
});
