import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCompatibleThoughtSignatures } from "../../../src/families/google/compatible-signatures.ts";

const signature = "opaque-genuine-signature==";
const selected = {
	id: "google/gemini-example",
	provider: "compatible",
	api: "openai-completions",
} as Model<"openai-completions">;

function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		api: selected.api,
		provider: selected.provider,
		model: selected.id,
		responseId: "completion-1",
		content,
		stopReason: "toolUse",
		timestamp: 1,
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

function harness() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	registerCompatibleThoughtSignatures({
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI);
	let messages: AssistantMessage[] = [];
	const context = {
		model: selected,
		sessionManager: { buildSessionProjection: () => ({ messages }) },
	};
	return {
		context,
		setMessages: (value: AssistantMessage[]) => {
			messages = value;
		},
		emit: (name: string, event: unknown) => handlers.get(name)?.(event, context),
	};
}

function chunk(call: unknown, provider = selected.provider, model = selected.id) {
	return {
		type: "provider_stream_event",
		api: selected.api,
		provider,
		model,
		data: { id: "completion-1", choices: [{ delta: { tool_calls: [call] } }] },
	};
}

function request() {
	return {
		model: selected.id,
		messages: [
			{
				role: "assistant",
				reasoning_details: [{ type: "reasoning.encrypted", data: "unchanged" }],
				tool_calls: [
					{ id: "call-a", type: "function", function: { name: "read", arguments: "{}" } },
					{
						id: "call-b",
						type: "function",
						function: { name: "read", arguments: "{}" },
						extra_content: { google: { thought_signature: "existing" } },
					},
				],
			},
		],
	};
}

describe("compatible thought signatures", () => {
	test("persists a split streamed signature and replays it only on its original call", () => {
		const h = harness();
		h.emit("provider_stream_event", chunk({ index: 0, id: "call-a" }));
		h.emit(
			"provider_stream_event",
			chunk({ index: 0, extra_content: { google: { thought_signature: signature } } }),
		);
		h.emit(
			"provider_stream_event",
			chunk({ index: 1, id: "call-b", extra_content: { google: { thought_signature: "new" } } }),
		);
		const message = assistant([
			{ type: "toolCall", id: "call-a", name: "read", arguments: {} },
			{ type: "toolCall", id: "call-b", name: "read", arguments: {}, thoughtSignature: "original" },
		]);
		const result = h.emit("message_end", { type: "message_end", message }) as {
			message: AssistantMessage;
		};
		expect(result.message.content).toEqual([
			{ type: "toolCall", id: "call-a", name: "read", arguments: {}, thoughtSignature: signature },
			{ type: "toolCall", id: "call-b", name: "read", arguments: {}, thoughtSignature: "original" },
		]);
		h.setMessages([result.message]);
		const payload = request();
		const output = h.emit("before_provider_request", { type: "before_provider_request", payload });
		expect(output).toEqual({
			...payload,
			messages: [
				{
					...payload.messages[0],
					tool_calls: [
						{
							...payload.messages[0]?.tool_calls[0],
							extra_content: { google: { thought_signature: signature } },
						},
						payload.messages[0]?.tool_calls[1],
					],
				},
			],
		});
		expect(payload.messages[0]?.tool_calls[0]).not.toHaveProperty("extra_content");
	});

	test("clears pending captures on session shutdown and after binding", () => {
		const h = harness();
		const event = chunk({
			index: 0,
			id: "call-a",
			extra_content: { google: { thought_signature: signature } },
		});
		const message = assistant([{ type: "toolCall", id: "call-a", name: "read", arguments: {} }]);
		h.emit("provider_stream_event", event);
		h.emit("session_shutdown", {});
		expect(h.emit("message_end", { message })).toBeUndefined();
		h.emit("provider_stream_event", event);
		expect(h.emit("message_end", { message })).toBeDefined();
		expect(h.emit("message_end", { message })).toBeUndefined();
	});

	test("does not replay structured legacy metadata or duplicate payload IDs", () => {
		const h = harness();
		const message = assistant([
			{
				type: "toolCall",
				id: "call-a",
				name: "read",
				arguments: {},
				thoughtSignature: '{"type":"reasoning.encrypted"}',
			},
		]);
		h.setMessages([message]);
		const payload = request();
		expect(h.emit("before_provider_request", { payload })).toBeUndefined();
		h.setMessages([
			assistant([
				{
					type: "toolCall",
					id: "call-a",
					name: "read",
					arguments: {},
					thoughtSignature: signature,
				},
			]),
		]);
		const duplicate = { ...payload, messages: [payload.messages[0], payload.messages[0]] };
		expect(h.emit("before_provider_request", { payload: duplicate })).toBeUndefined();
	});

	test("ignores wrong model, provider, response, duplicate IDs and ambiguous fragments", () => {
		const h = harness();
		h.emit(
			"provider_stream_event",
			chunk(
				{ index: 0, id: "call-a", extra_content: { google: { thought_signature: signature } } },
				"other",
			),
		);
		h.emit(
			"provider_stream_event",
			chunk(
				{ index: 0, id: "call-a", extra_content: { google: { thought_signature: signature } } },
				selected.provider,
				"other/gemini-example",
			),
		);
		const message = assistant([{ type: "toolCall", id: "call-a", name: "read", arguments: {} }]);
		expect(h.emit("message_end", { message })).toBeUndefined();
		h.emit(
			"provider_stream_event",
			chunk({
				index: 0,
				id: "call-a",
				extra_content: { google: { thought_signature: signature } },
			}),
		);
		expect(h.emit("message_end", { message: { ...message, responseId: "other" } })).toBeUndefined();
		h.emit("provider_stream_event", chunk({ index: 0, id: "another" }));
		expect(h.emit("message_end", { message })).toBeUndefined();
		h.setMessages([
			assistant([
				{
					type: "toolCall",
					id: "call-a",
					name: "read",
					arguments: {},
					thoughtSignature: signature,
				},
			]),
		]);
		const payload = request();
		h.context.model = { ...selected, provider: "other" };
		expect(h.emit("before_provider_request", { payload })).toBeUndefined();
		h.context.model = { ...selected, id: "virtual-group" };
		expect(h.emit("before_provider_request", { payload })).toBeUndefined();
		h.context.model = selected;
		expect(
			h.emit("before_provider_request", { payload: { ...payload, model: "another" } }),
		).toBeUndefined();
		h.setMessages([
			assistant([
				{
					type: "toolCall",
					id: "call-a",
					name: "read",
					arguments: {},
					thoughtSignature: signature,
				},
				{
					type: "toolCall",
					id: "call-a",
					name: "read",
					arguments: {},
					thoughtSignature: signature,
				},
			]),
		]);
		expect(h.emit("before_provider_request", { payload })).toBeUndefined();
	});
});
