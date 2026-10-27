import { describe, expect, test } from "bun:test";
import {
	type AssistantMessage,
	type Model,
	normalizeContext,
	type Tool,
	Type,
} from "@earendil-works/pi-ai";
import * as upstream from "@earendil-works/pi-ai/api/google-shared";
import * as local from "../../../src/families/google/convert.ts";
import * as parts from "../../../src/families/google/parts.ts";

const signature = "c2lnbmF0dXJl";
const image = { type: "image", mimeType: "image/png", data: "aW1hZ2U=" } as const;
const tools: Tool[] = [
	{
		name: "read",
		description: "Read a file",
		parameters: Type.Object({ path: Type.String(), limit: Type.Optional(Type.Integer()) }),
	},
	{ name: "render", description: "Render", parameters: Type.Object({}) },
];
function model(id: string, vision = true): Model<"google-generative-ai"> {
	return {
		id,
		name: id,
		api: "google-generative-ai",
		provider: "antigravity",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: vision ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 65536,
	};
}
function assistant(
	target: Model<"google-generative-ai">,
	content: AssistantMessage["content"],
): AssistantMessage {
	return {
		role: "assistant",
		api: target.api,
		provider: target.provider,
		model: target.id,
		content,
		stopReason: "toolUse",
		timestamp: 2,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
function transcript(target: Model<"google-generative-ai">) {
	return normalizeContext({
		systemPrompt: "Help",
		tools,
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: "Read\uD800 this\uDC00" }, image],
				timestamp: 1,
			},
			assistant(target, [
				{ type: "thinking", thinking: "Inspect", thinkingSignature: signature },
				{ type: "text", text: "", textSignature: signature },
				{
					type: "toolCall",
					id: "read1",
					name: "read",
					arguments: { path: "file" },
					thoughtSignature: signature,
				},
				{
					type: "toolCall",
					id: "render1",
					name: "render",
					arguments: {},
					thoughtSignature: signature,
				},
			]),
			{
				role: "toolResult",
				toolCallId: "read1",
				toolName: "read",
				content: [{ type: "text", text: "Failed" }],
				isError: true,
				timestamp: 3,
			},
			{
				role: "toolResult",
				toolCallId: "render1",
				toolName: "render",
				content: [image],
				isError: false,
				timestamp: 4,
			},
			assistant({ ...target, provider: "other", id: "other-model" }, [
				{ type: "thinking", thinking: "Foreign reasoning", thinkingSignature: signature },
				{ type: "text", text: "Visible", textSignature: signature },
				{
					type: "toolCall",
					id: "orphan|call",
					name: "read",
					arguments: {},
					thoughtSignature: signature,
				},
			]),
			{ role: "user", content: "Continue", timestamp: 5 },
		],
	});
}

describe("families/google/convert upstream parity", () => {
	for (const id of ["gemini-4-argon", "claude-opus-5-5", "gpt-oss-120b", "gemini-2.5-pro"]) {
		for (const vision of [true, false]) {
			test(`${id}, image input ${vision}`, () => {
				const target = model(id, vision);
				const context = transcript(target);
				expect<unknown>(local.convertMessages(target, context)).toEqual(
					upstream.convertMessages(target, context),
				);
			});
		}
	}
	test("empty blocks, invalid signatures, interrupted assistants and trailing orphan calls", () => {
		const target = model("gemini-4-argon");
		const context = normalizeContext({
			messages: [
				{ role: "user", content: [], timestamp: 1 },
				assistant(target, [
					{ type: "text", text: " ", textSignature: "invalid" },
					{ type: "thinking", thinking: "", thinkingSignature: "bad=" },
					{ type: "thinking", thinking: "" },
					{ type: "thinking", thinking: "Readable" },
					{ type: "text", text: "Visible", textSignature: "!!!!" },
				]),
				{ ...assistant(target, [{ type: "text", text: "Partial" }]), stopReason: "error" },
				{ ...assistant(target, [{ type: "text", text: "Aborted" }]), stopReason: "aborted" },
				assistant(target, [{ type: "toolCall", id: "pending", name: "read", arguments: {} }]),
			],
		});
		expect<unknown>(local.convertMessages(target, context)).toEqual(
			upstream.convertMessages(target, context),
		);
	});

	test("tool declarations without strict sampling", () => {
		expect<unknown>(local.convertTools(tools, false, false)).toEqual(
			upstream.convertTools(tools, false, false),
		);
		expect<unknown>(local.convertTools([], false, false)).toEqual(
			upstream.convertTools([], false, false),
		);
	});

	test("stream helpers", () => {
		for (const part of [
			{},
			{ thought: true },
			{ thought: false, thoughtSignature: signature },
			{ thoughtSignature: signature },
		]) {
			expect(parts.isThinkingPart(part)).toBe(upstream.isThinkingPart(part));
		}
		for (const existing of [undefined, "", signature]) {
			for (const incoming of [undefined, "", "new-signature"]) {
				expect(parts.retainThoughtSignature(existing, incoming)).toBe(
					upstream.retainThoughtSignature(existing, incoming),
				);
			}
		}
		for (const reason of [
			"STOP",
			"MAX_TOKENS",
			"BLOCKLIST",
			"PROHIBITED_CONTENT",
			"SPII",
			"SAFETY",
			"IMAGE_SAFETY",
			"IMAGE_PROHIBITED_CONTENT",
			"IMAGE_RECITATION",
			"IMAGE_OTHER",
			"RECITATION",
			"FINISH_REASON_UNSPECIFIED",
			"OTHER",
			"LANGUAGE",
			"MALFORMED_FUNCTION_CALL",
			"UNEXPECTED_TOOL_CALL",
			"TOO_MANY_TOOL_CALLS",
			"NO_IMAGE",
			"unknown",
			"",
		]) {
			expect(parts.mapStopReasonString(reason)).toBe(upstream.mapStopReasonString(reason));
		}
		for (const id of [
			"claude-opus-5-5",
			"gemini-4-argon",
			"gemini-2.5-pro",
			"gemini-live-3-flash",
			"GEMINI-3-pro",
			"gpt-oss-120b",
			"other",
		]) {
			expect(parts.requiresToolCallId(id)).toBe(upstream.requiresToolCallId(id));
		}
	});
});
