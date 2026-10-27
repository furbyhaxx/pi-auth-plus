import { describe, expect, test } from "bun:test";
import { billingBlock } from "../../../src/families/anthropic/billing.ts";
import {
	insecureTls,
	mergeRequestHeaders,
	shapeBody,
	shapeHeaders,
	shapeUrl,
} from "../../../src/families/anthropic/request.ts";
import { CLAUDE_CODE_IDENTITY } from "../../../src/families/anthropic/sanitize.ts";
import { userAgent } from "../../../src/families/anthropic/version.ts";

describe("families/anthropic/request", () => {
	test("shapes a Pi request with billing, identity, sanitized context and every tool location", () => {
		const system = [
			"You are an expert coding assistant operating inside a terminal session.",
			"You are operating inside `Pi`, with delegated tools.",
			"Read the harness guide at github.com/earendil-works/pi before starting.",
			"Install updates from github.com/opensec-git/Pi-Bolt.",
			"Here is some useful information about the environment you are running in:\n/home/pi/api",
			"Project instructions: preserve widgets and use local tests.",
			"Private workspace note: remove this paragraph.",
		].join("\n\n");
		const messages = [
			{
				role: "user",
				content: [
					{ type: "text", text: "hello world test message" },
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: [{ type: "tool_reference", tool_name: "web_search" }],
					},
				],
			},
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "t1", name: "bash", input: { name: "untouched" } },
					{ type: "text", text: "bash", name: "untouched" },
				],
			},
		];
		const shaped = JSON.parse(
			shapeBody(
				JSON.stringify({
					system,
					messages,
					tools: [{ name: "bash", input_schema: {} }, { name: "web_search" }],
					tool_choice: { type: "tool", name: "bash" },
				}),
				"2.1.87",
				[{ match: "Private workspace note" }, { match: "widgets", replacement: "gadgets" }],
			),
		);
		expect(shaped.system).toEqual([
			{ type: "text", text: billingBlock(messages, "2.1.87") },
			{ type: "text", text: CLAUDE_CODE_IDENTITY },
			{
				type: "text",
				text: "Environment context you are running in:\n/home/pi/api\n\nProject instructions: preserve gadgets and use local tests.",
			},
		]);
		expect(shaped.tools.map((tool: { name: string }) => tool.name)).toEqual([
			"mcp_Bash",
			"mcp_Web_search",
		]);
		expect(shaped.tool_choice.name).toBe("mcp_Bash");
		expect(shaped.messages[0].content[1].content[0].tool_name).toBe("mcp_Web_search");
		expect(shaped.messages[0].content[1].tool_use_id).toBe("t1");
		expect(shaped.messages[1].content[0].name).toBe("mcp_Bash");
		expect(shaped.messages[1].content[0].input.name).toBe("untouched");
		expect(shaped.messages[1].content[1].name).toBe("untouched");
	});

	test("passes invalid bodies through and tolerates absent or malformed optional fields", () => {
		for (const body of ["{", "null", "[]", "42"]) expect(shapeBody(body, "1.2.3", [])).toBe(body);
		expect(JSON.parse(shapeBody("{}", "1.2.3", [])).system).toEqual([
			{ type: "text", text: CLAUDE_CODE_IDENTITY },
		]);
		const body = {
			tools: [null, {}, { name: "" }],
			messages: [null, { content: "text" }],
			tool_choice: { type: "auto", name: "bash" },
		};
		expect(JSON.parse(shapeBody(JSON.stringify(body), "1.2.3", []))).toMatchObject(body);
	});

	test("merges header representations with init precedence and shapes OAuth without mutation", () => {
		const input = new Request("https://api.anthropic.com/v1/messages", {
			headers: { "x-api-key": "dummy-key", "x-retain": "yes", "x-override": "old" },
		});
		for (const headers of [
			new Headers({ "x-override": "new" }),
			{ "x-override": "new" },
			[["x-override", "new"]] satisfies [string, string][],
		]) {
			const merged = mergeRequestHeaders(input, { headers });
			expect(merged.get("x-override")).toBe("new");
			expect(merged.get("x-retain")).toBe("yes");
			merged.set("anthropic-beta", " custom,oauth-2025-04-20,custom, ,other ");
			const shaped = shapeHeaders(merged, "dummy-token", "2.1.87");
			expect(shaped.get("anthropic-beta")).toBe(
				"oauth-2025-04-20,interleaved-thinking-2025-05-14,custom,other",
			);
			expect(shaped.has("x-api-key")).toBe(false);
			expect(shaped.get("authorization")).toBe("Bearer dummy-token");
			expect(shaped.get("user-agent")).toBe(userAgent("2.1.87"));
			expect(shaped.get("x-app")).toBe("cli");
			expect(merged.get("x-api-key")).toBe("dummy-key");
		}
		expect(input.headers.get("x-override")).toBe("old");
		expect([...mergeRequestHeaders("https://example.com")]).toEqual([]);
		expect([...mergeRequestHeaders(new URL("https://example.com"))]).toEqual([]);
	});

	test("rewrites only origin and messages beta, retaining explicit beta and unchanged inputs", () => {
		const env = { ANTHROPIC_BASE_URL: " http://localhost:8000/ignored?ignore=yes " };
		expect(String(shapeUrl("https://api.anthropic.com/v1/messages?x=1#keep", env))).toBe(
			"http://localhost:8000/v1/messages?x=1&beta=true#keep",
		);
		const url = new URL("https://api.anthropic.com/v1/messages?beta=false");
		expect(shapeUrl(url, {})).toBe(url);
		for (const path of ["/v1/models", "/v1/messages/"]) {
			const input = `https://api.anthropic.com${path}`;
			expect(shapeUrl(input, {})).toBe(input);
			expect(String(shapeUrl(input, env))).toBe(`http://localhost:8000${path}`);
		}
		for (const base of ["", "invalid", "ftp://example.com", "https://user:pass@example.com"]) {
			expect(
				String(shapeUrl("https://api.anthropic.com/v1/messages", { ANTHROPIC_BASE_URL: base })),
			).toBe("https://api.anthropic.com/v1/messages?beta=true");
		}
		expect(shapeUrl("relative", env)).toBe("relative");
	});

	test("preserves Request method, body, headers and abort propagation", async () => {
		const controller = new AbortController();
		const input = new Request("https://api.anthropic.com/v1/messages", {
			method: "POST",
			body: "payload",
			headers: { "x-retain": "yes" },
			signal: controller.signal,
		});
		const result = shapeUrl(input, {});
		expect(result).toBeInstanceOf(Request);
		if (!(result instanceof Request)) throw new Error("Expected a Request");
		expect(result.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
		expect(result.method).toBe("POST");
		expect(result.headers.get("x-retain")).toBe("yes");
		expect(await result.text()).toBe("payload");
		controller.abort();
		expect(result.signal.aborted).toBe(true);
	});

	test("requires both the exact TLS switch and a nonempty custom endpoint", () => {
		for (const flag of ["1", "true", " true "]) {
			expect(insecureTls({ ANTHROPIC_INSECURE: flag })).toBe(false);
			expect(insecureTls({ ANTHROPIC_INSECURE: flag, ANTHROPIC_BASE_URL: " " })).toBe(false);
			expect(
				insecureTls({ ANTHROPIC_INSECURE: flag, ANTHROPIC_BASE_URL: "https://localhost" }),
			).toBe(true);
		}
		for (const flag of [undefined, "0", "false", "TRUE", "yes"]) {
			expect(
				insecureTls({ ANTHROPIC_INSECURE: flag, ANTHROPIC_BASE_URL: "https://localhost" }),
			).toBe(false);
		}
	});
});
