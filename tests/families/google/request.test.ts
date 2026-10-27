import { describe, expect, test } from "bun:test";
import { type AssistantMessage, type Model, normalizeContext, Type } from "@earendil-works/pi-ai";
import type { WireLevel } from "../../../src/families/google/levels.ts";
import { buildRequest, RequestSessions } from "../../../src/families/google/request.ts";

const model: Model<"google-generative-ai"> = {
	id: "gemini-4-argon",
	name: "Argon",
	api: "google-generative-ai",
	provider: "antigravity",
	baseUrl: "https://example.invalid",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100000,
	maxTokens: 65536,
};
const level: WireLevel = {
	id: "gemini-4-argon-low",
	modelEnum: "MODEL_PLACEHOLDER_M419",
	thinking: { kind: "level", level: "LOW" },
};
function assistant(
	id: string,
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "toolUse",
): AssistantMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: id,
		content,
		stopReason,
		timestamp: 2,
		usage: {
			input: 1,
			output: 1,
			totalTokens: 2,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
const call = {
	type: "toolCall",
	id: "call1",
	name: "read",
	arguments: { path: "file" },
	thoughtSignature: "c2lnbmVkLWNhbGw=",
} as const;
const thought = {
	type: "thinking",
	thinking: "private",
	thinkingSignature: "c2lnbmVkLXRob3VnaHQ=",
} as const;
function sessions() {
	let id = 0;
	return new RequestSessions({ now: () => 1000, uuid: () => `id-${++id}` });
}
function context(id = model.id) {
	return normalizeContext({
		systemPrompt: "Help",
		tools: [
			{ name: "read", description: "Read", parameters: Type.Object({ path: Type.String() }) },
		],
		messages: [
			{ role: "user", content: "Read file", timestamp: 1 },
			assistant(id, [thought, call]),
			{
				role: "toolResult",
				toolCallId: "call1",
				toolName: "read",
				content: [{ type: "text", text: "file contents" }],
				isError: false,
				timestamp: 3,
			},
		],
	});
}

describe("families/google/request", () => {
	test("Argon round-trip matches the 1.3.5 captured envelope and payload order", () => {
		const { body, requestId } = buildRequest({
			model,
			context: context(),
			options: {},
			level,
			project: "project",
			sessions: sessions(),
		});
		expect(Object.keys(body)).toEqual([
			"project",
			"requestId",
			"request",
			"model",
			"userAgent",
			"requestType",
		]);
		expect(Object.keys(body.request)).toEqual([
			"contents",
			"systemInstruction",
			"tools",
			"labels",
			"generationConfig",
			"sessionId",
		]);
		expect(Object.keys(body.request.labels)).toEqual([
			"cascade_id",
			"last_step_index",
			"model_enum",
			"request_id",
			"root_cascade_id",
			"trajectory_id",
			"used_claude",
			"used_claude_conservative",
			"used_non_gemini_model",
		]);
		expect(body.request.labels.model_enum).toBe("MODEL_PLACEHOLDER_M419");
		expect(body.model).toBe(level.id);
		expect(body.request.generationConfig).toEqual({
			maxOutputTokens: 65536,
			thinkingConfig: { includeThoughts: true, thinkingLevel: "LOW" },
		});
		expect(body.request.contents.map((entry) => entry.role)).toEqual(["user", "model", "user"]);
		expect(body.request.systemInstruction).toEqual({ parts: [{ text: "Help" }] });
		expect(body.request.tools?.[0]?.functionDeclarations[0]?.["parameters"]).toEqual({
			type: "OBJECT",
			properties: { path: { type: "STRING" } },
			required: ["path"],
		});
		expect(body.request.labels.request_id).toBe(requestId);
		expect(body.request.labels.last_step_index).toBe("2");
		expect(requestId).toEndWith("/3");
	});

	test("Claude removes earlier thinking but keeps the signed open tool-loop turn", () => {
		const claude = { ...model, id: "claude-opus-5-5" };
		const input = context(claude.id);
		const old = assistant(
			claude.id,
			[thought, { type: "text", text: "Earlier answer", textSignature: "old-signature" }],
			"stop",
		);
		const transcript = normalizeContext({ messages: [old, ...input.messages] });
		const { body } = buildRequest({
			model: claude,
			context: transcript,
			options: {},
			level,
			project: "p",
			sessions: sessions(),
		});
		expect(body.request.contents[0]?.parts).toEqual([{ text: "Earlier answer" }]);
		expect(body.request.contents[2]?.parts).toContainEqual({
			thought: true,
			text: "private",
			thoughtSignature: "c2lnbmVkLXRob3VnaHQ=",
		});
		expect(body.request.contents[2]?.parts).toContainEqual({
			functionCall: { name: "read", args: { path: "file" }, id: "call1" },
			thoughtSignature: "c2lnbmVkLWNhbGw=",
		});
		expect(body.request.toolConfig).toEqual({ functionCallingConfig: { mode: "VALIDATED" } });
		expect(input.messages[2]).toEqual(assistant(claude.id, [thought, call]));
	});

	test("Claude completed turn loses thinking; cross-model signatures never replay", () => {
		const claude = { ...model, id: "claude-opus-5-5" };
		const input = normalizeContext({
			messages: [
				assistant(
					claude.id,
					[thought, { type: "text", text: "answer", textSignature: "sig" }],
					"stop",
				),
				{ role: "user", content: "Continue", timestamp: 4 },
			],
		});
		const built = buildRequest({
			model: claude,
			context: input,
			options: {},
			level,
			project: "p",
			sessions: sessions(),
		});
		expect(built.body.request.contents[0]?.parts).toEqual([{ text: "answer" }]);
		const switched = buildRequest({
			model: claude,
			context: context(),
			options: {},
			level,
			project: "p",
			sessions: sessions(),
		});
		expect(JSON.stringify(switched.body)).not.toContain("thoughtSignature");
	});

	test("session identity, monotonic request ids and latched model flags survive requests", () => {
		const store = sessions();
		const args = {
			model,
			context: context(),
			options: { sessionId: "session", maxTokens: 42 },
			level,
			project: "p",
			sessions: store,
		};
		const first = buildRequest({ ...args, model: { ...model, id: "claude-opus-5-5" } });
		const second = buildRequest(args);
		expect(second.requestId).not.toBe(first.requestId);
		expect(second.body.request.labels.trajectory_id).toBe(first.body.request.labels.trajectory_id);
		expect(second.body.request.labels.used_claude).toBe("true");
		expect(second.body.request.labels).not.toHaveProperty("last_execution_id");
		expect(second.body.request.labels.last_step_index).toBe("2");
		expect(second.requestId).toEndWith("/3");
		expect(second.body.request.generationConfig.maxOutputTokens).toBe(42);
		const separate = buildRequest({ ...args, options: { sessionId: "another" } });
		expect(separate.body.request.labels.trajectory_id).not.toBe(
			first.body.request.labels.trajectory_id,
		);
	});

	test("timestamp fallback separates sessions and minimal requests omit optional fields", () => {
		const store = sessions();
		const input = normalizeContext({ messages: [{ role: "user", content: "Hi", timestamp: 1 }] });
		const args = { model, context: input, options: {}, level, project: "p", sessions: store };
		const first = buildRequest(args);
		const second = buildRequest(args);
		expect(first.body.request.labels.trajectory_id).toBe(second.body.request.labels.trajectory_id);
		expect(first.body.request.labels.last_step_index).toBe("0");
		expect(first.requestId).toEndWith("/1");
		expect(first.body.request.labels).not.toHaveProperty("last_execution_id");
		expect(Object.keys(first.body.request)).toEqual([
			"contents",
			"labels",
			"generationConfig",
			"sessionId",
		]);
		const other = buildRequest({
			...args,
			context: normalizeContext({ messages: [{ role: "user", content: "Hi", timestamp: 2 }] }),
		});
		expect(other.body.request.labels.trajectory_id).not.toBe(
			first.body.request.labels.trajectory_id,
		);
	});

	test("GPT tools move numeric bounds into descriptions", () => {
		const gpt = { ...model, id: "gpt-oss-120b" };
		const input = normalizeContext({
			messages: [],
			tools: [
				{
					name: "count",
					description: "Count",
					parameters: Type.Object({ count: Type.Integer({ minimum: 1 }) }),
				},
			],
		});
		const { body } = buildRequest({
			model: gpt,
			context: input,
			options: {},
			level,
			project: "p",
			sessions: sessions(),
		});
		expect(body.request.tools?.[0]?.functionDeclarations[0]?.["parameters"]).toEqual({
			type: "OBJECT",
			properties: { count: { type: "INTEGER", description: "minimum: 1" } },
			required: ["count"],
		});
		expect(body.request.labels.used_non_gemini_model).toBe("true");
	});

	test("same Pi model signatures carry across wire-level switches", () => {
		const { body } = buildRequest({
			model,
			context: context(),
			options: {},
			level: { ...level, id: "gemini-4-argon-high" },
			project: "p",
			sessions: sessions(),
		});
		expect(body.request.contents[1]?.parts?.[0]?.thoughtSignature).toBe("c2lnbmVkLXRob3VnaHQ=");
	});
});
