import { describe, expect, test } from "bun:test";
import { type AssistantMessage, normalizeContext } from "@earendil-works/pi-ai";
import { bundledModels } from "../../../src/families/google/catalog.ts";
import { antigravityAuth } from "../../../src/families/google/oauth.ts";
import { antigravityProject } from "../../../src/families/google/project.ts";
import { antigravityProvider, pickLevel } from "../../../src/families/google/provider.ts";

const TOKEN = "test-access-token";
const frame = (value: unknown) => `data: ${JSON.stringify({ response: value })}\r\n\r\n`;

function family(id: string) {
	const model = bundledModels().find((entry) => entry.id === id);
	if (!model) throw new Error(`${id} missing from the snapshot`);
	return model;
}

interface Sent {
	url: string;
	headers: Headers;
	body: unknown;
}

function setup(stream: () => Response) {
	const sent: Sent[] = [];
	const fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		sent.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
		if (url.endsWith(":loadCodeAssist"))
			return Response.json({ cloudaicompanionProject: "test-project" });
		return stream();
	};
	const project = antigravityProject({ fetch, headers: () => ({}) });
	const provider = antigravityProvider({ auth: antigravityAuth({ fetch }), project, fetch });
	const context = normalizeContext({
		systemPrompt: "You are a coding assistant.",
		messages: [{ role: "user", content: "hi", timestamp: 1 }],
	});
	return { sent, provider, context };
}

describe("families/google/provider", () => {
	test("picks the requested level, clamps upward, then falls back to the highest", () => {
		const argon = family("gemini-4-argon");
		expect(pickLevel(argon, "medium")?.id).toBe("gemini-4-argon-medium");
		expect(pickLevel(argon, "minimal")?.id).toBe("gemini-4-argon-low");
		expect(pickLevel(argon, "xhigh")?.id).toBe("gemini-4-argon-high");
		expect(pickLevel(argon, undefined)?.id).toBe("gemini-4-argon-low");
		const gpt = family("gpt-oss-120b");
		expect(pickLevel(gpt, "low")?.id).toBe("gpt-oss-120b-medium");
		expect(pickLevel(gpt, "high")?.id).toBe("gpt-oss-120b-medium");
	});

	test("an OAuth turn discovers the project and sends the level's envelope with CLI headers", async () => {
		const { sent, provider, context } = setup(
			() =>
				new Response(
					frame({
						candidates: [
							{ content: { role: "model", parts: [{ text: "hello" }] }, finishReason: "STOP" },
						],
						usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 },
					}),
				),
		);
		const model = family("claude-opus-5-5");
		const message: AssistantMessage = await provider
			.streamSimple(model, context, {
				headers: { Authorization: `Bearer ${TOKEN}` },
				reasoning: "high",
				sessionId: "test-session",
			})
			.result();

		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([{ type: "text", text: "hello" }]);
		expect(message.usage.cost.total).toBe(0);
		const [load, turn] = sent;
		expect(load?.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
		expect(turn?.url).toBe(
			"https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
		);
		expect(turn?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
		expect(turn?.headers.get("user-agent")).toStartWith("antigravity/cli/1.4.8 (aidev_client;");
		expect(turn?.body).toMatchObject({
			project: "test-project",
			model: "claude-opus-5-5-high",
			requestType: "agent",
			request: {
				labels: { model_enum: "MODEL_PLACEHOLDER_M402" },
				generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } },
			},
		});
	});

	test("HTTP and login failures become error turns with a recovery", async () => {
		const { provider, context } = setup(() =>
			Response.json(
				{
					error: {
						code: 429,
						status: "RESOURCE_EXHAUSTED",
						message: "quota",
						details: [{ reason: "RATE_LIMIT_EXCEEDED" }, { retryDelay: "7s" }],
					},
				},
				{ status: 429 },
			),
		);
		const model = family("gemini-4-argon");
		const limited = await provider
			.streamSimple(model, context, { headers: { Authorization: `Bearer ${TOKEN}` } })
			.result();
		expect(limited.stopReason).toBe("error");
		expect(limited.errorMessage).toContain("RATE_LIMIT_EXCEEDED");
		expect(limited.errorMessage).not.toContain(TOKEN);
		expect(limited.errorMessage).not.toContain("test-project");

		const anonymous = await provider.streamSimple(model, context, {}).result();
		expect(anonymous.stopReason).toBe("error");
		expect(anonymous.errorMessage).toContain("/login antigravity");
	});
});
