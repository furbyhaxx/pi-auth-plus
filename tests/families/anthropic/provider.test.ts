import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Tool } from "@earendil-works/pi-ai";
import { normalizeContext, Type } from "@earendil-works/pi-ai";
import { claudeAuth } from "../../../src/families/anthropic/oauth.ts";
import { claudeProvider } from "../../../src/families/anthropic/provider.ts";
import { CLAUDE_CODE_IDENTITY } from "../../../src/families/anthropic/sanitize.ts";

const VERSION = "2.1.400";
const OAUTH = "sk-ant-oat01-test-token";
const API_KEY = "sk-ant-api03-test-key";

const SSE = [
	{
		type: "message_start",
		message: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			content: [],
			model: "claude-sonnet-5-5",
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 1 },
		},
	},
	{
		type: "content_block_start",
		index: 0,
		content_block: { type: "tool_use", id: "toolu_1", name: "mcp_Bash", input: {} },
	},
	{
		type: "content_block_delta",
		index: 0,
		delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
	},
	{ type: "content_block_stop", index: 0 },
	{
		type: "message_delta",
		delta: { stop_reason: "tool_use", stop_sequence: null },
		usage: { output_tokens: 5 },
	},
	{ type: "message_stop" },
]
	.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
	.join("");

interface Captured {
	url: string;
	headers: Headers;
	body: { system?: { text: string }[]; tools?: { name: string }[] };
}

function capture(sink: Captured[]): typeof fetch {
	const fake = async (input: string | URL | Request, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		sink.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
		return new Response(SSE, { headers: { "content-type": "text/event-stream" } });
	};
	return Object.assign(fake, { preconnect: () => {} }) as typeof fetch;
}

const bash: Tool = {
	name: "bash",
	description: "Run a shell command",
	parameters: Type.Object({ command: Type.String() }),
};

function setup() {
	const provider = claudeProvider({
		auth: claudeAuth(),
		version: async () => VERSION,
		rules: () => [],
		env: {},
	});
	const model = provider.getModels().find((entry) => entry.id === "claude-sonnet-5-5");
	if (!model) throw new Error("claude-sonnet-5-5 missing from Pi's anthropic catalog");
	const context = normalizeContext({
		systemPrompt: "You are an expert coding assistant operating inside pi.",
		messages: [{ role: "user", content: "list files", timestamp: 0 }],
		tools: [bash],
	});
	return { provider, model, context };
}

describe("families/anthropic/provider", () => {
	test("an OAuth turn uses header auth, Claude Code shaping, zero cost and Pi's tool names", async () => {
		const { provider, model, context } = setup();
		const sent: Captured[] = [];
		const message: AssistantMessage = await provider
			.stream(model, context, {
				headers: { Authorization: `Bearer ${OAUTH}` },
				fetch: capture(sent),
				maxRetries: 0,
			})
			.result();

		const [request] = sent;
		expect(request?.url).toContain("/v1/messages?beta=true");
		expect(request?.headers.get("authorization")).toBe(`Bearer ${OAUTH}`);
		expect(request?.headers.get("x-api-key")).toBeNull();
		expect(request?.headers.get("user-agent")).toBe(`claude-cli/${VERSION} (external, cli)`);
		expect(request?.body.system?.[0]?.text).toContain(`cc_version=${VERSION}.`);
		expect(request?.body.system?.[1]?.text).toBe(CLAUDE_CODE_IDENTITY);
		expect(request?.body.tools?.[0]?.name).toBe("mcp_Bash");
		expect(request?.headers.get("x-app")).toBe("cli");
		expect(message.stopReason).toBe("toolUse");
		expect(message.content.find((block) => block.type === "toolCall")).toMatchObject({
			name: "bash",
			arguments: { command: "ls" },
		});
		expect(message.usage.cost.total).toBe(0);
	});

	test("an API-key turn goes through Pi's path untouched and keeps its price", async () => {
		const { provider, model, context } = setup();
		const sent: Captured[] = [];
		const message = await provider
			.stream(model, context, { apiKey: API_KEY, fetch: capture(sent), maxRetries: 0 })
			.result();

		const [request] = sent;
		expect(request?.headers.get("x-api-key")).toBe(API_KEY);
		expect(request?.headers.get("authorization")).toBeNull();
		expect(request?.headers.get("x-app")).toBeNull();
		expect(request?.headers.get("user-agent") ?? "").not.toContain("claude-cli/");
		expect(request?.body.tools?.[0]?.name).toBe("bash");
		expect(JSON.stringify(request?.body.system)).not.toContain("Claude Agent SDK");
		expect(message.usage.cost.total).toBeGreaterThan(0);
	});

	test("OAuth credentials list the catalog at zero cost, API keys at list price", () => {
		const { provider } = setup();
		const catalog = provider.getModels();
		const oauth = provider.filterModels?.(catalog, {
			type: "oauth",
			access: OAUTH,
			refresh: "r",
			expires: 0,
		});
		const keyed = provider.filterModels?.(catalog, { type: "api_key", key: API_KEY });
		expect(oauth?.every((entry) => entry.cost.input === 0 && entry.cost.output === 0)).toBe(true);
		expect(keyed?.some((entry) => entry.cost.output > 0)).toBe(true);
	});
});
