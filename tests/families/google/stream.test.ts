import { describe, expect, test } from "bun:test";
import type { Model } from "@earendil-works/pi-ai";
import { AntigravityError } from "../../../src/families/google/errors.ts";
import {
	parseAntigravitySse,
	streamAntigravityResponse,
} from "../../../src/families/google/stream.ts";

const model: Model<"google-generative-ai"> = {
	id: "gpt-oss-120b",
	name: "Test",
	api: "google-generative-ai",
	provider: "antigravity",
	baseUrl: "https://example.invalid",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10000,
	maxTokens: 1000,
};
const frame = (value: unknown) => `data: ${JSON.stringify({ response: value })}\r\n\r\n`;
// Synthetic envelope/parts from the fork's inline stream tests; SSE framing from 04-api.md §6.3.
const fixture = `: keepalive\r\n\r\n${[
	{
		candidates: [
			{
				content: {
					parts: [{ thought: true, text: "Think é", thoughtSignature: "thinking-signature" }],
				},
			},
		],
	},
	{
		candidates: [{ content: { parts: [{ text: "Answer", thoughtSignature: "text-signature" }] } }],
	},
	{
		candidates: [
			{
				content: {
					parts: [
						{ thought: true, text: "", thoughtSignature: "batch-signature" },
						{
							functionCall: { name: "lookup", args: { query: "weather", nested: [true, null, 2] } },
						},
						{
							functionCall: { id: "second", name: "lookup", args: { query: "other" } },
							thoughtSignature: "own-signature",
						},
					],
				},
				finishReason: "STOP",
			},
		],
	},
	{
		usageMetadata: {
			promptTokenCount: 20,
			cachedContentTokenCount: 5,
			candidatesTokenCount: 7,
			thoughtsTokenCount: 3,
			totalTokenCount: 30,
		},
	},
]
	.map(frame)
	.join("")}`;

function response(chunks: readonly Uint8Array[], open = false, onCancel?: () => void): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				if (!open) controller.close();
			},
			cancel() {
				onCancel?.();
			},
		}),
	);
}
async function collect(source: Response, signal?: AbortSignal) {
	const stream = streamAntigravityResponse(model, source, {
		now: () => 123,
		toolCallId: () => "call_fixed",
		...(signal ? { signal } : {}),
	});
	const events = [];
	for await (const event of stream) {
		events.push({
			type: event.type,
			...("contentIndex" in event ? { contentIndex: event.contentIndex } : {}),
			...("delta" in event ? { delta: event.delta } : {}),
			...("content" in event ? { content: event.content } : {}),
			...("toolCall" in event ? { toolCall: event.toolCall } : {}),
			...("reason" in event ? { reason: event.reason } : {}),
		});
	}
	const result = await stream.result();
	delete result.durationMs;
	return { events, result };
}
async function parseAll(source: Response) {
	const values = [];
	for await (const value of parseAntigravitySse(source)) values.push(value);
	return values;
}

describe("families/google/stream", () => {
	test("maps signatures, tool arguments, event order and trailing usage across every byte boundary", async () => {
		const bytes = new TextEncoder().encode(fixture);
		const baseline = await collect(response([bytes]));
		expect(baseline.result.stopReason).toBe("toolUse");
		expect(baseline.result.content).toEqual([
			{ type: "thinking", thinking: "Think é", thinkingSignature: "thinking-signature" },
			{ type: "text", text: "Answer", textSignature: "text-signature" },
			{
				type: "toolCall",
				id: "call_fixed",
				name: "lookup",
				arguments: { query: "weather", nested: [true, null, 2] },
				thoughtSignature: "batch-signature",
			},
			{
				type: "toolCall",
				id: "second",
				name: "lookup",
				arguments: { query: "other" },
				thoughtSignature: "own-signature",
			},
		]);
		expect(baseline.result.usage).toEqual({
			input: 15,
			output: 10,
			reasoning: 3,
			cacheRead: 5,
			cacheWrite: 0,
			totalTokens: 30,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		});
		expect(baseline.events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		for (let split = 0; split <= bytes.length; split++) {
			expect(await collect(response([bytes.slice(0, split), bytes.slice(split)]))).toEqual(
				baseline,
			);
		}
		expect(await collect(response(Array.from(bytes, (byte) => new Uint8Array([byte]))))).toEqual(
			baseline,
		);
	});

	test("merges text deltas, retains standalone signatures and maps token limits", async () => {
		const body = frame({
			candidates: [
				{
					content: { parts: [{ text: "A" }, { text: "B" }, { thoughtSignature: "sig" }] },
					finishReason: "MAX_TOKENS",
				},
			],
		});
		const { result } = await collect(new Response(body));
		expect(result.stopReason).toBe("length");
		expect(result.content).toEqual([{ type: "text", text: "AB", textSignature: "sig" }]);
	});

	test("does not move a standalone text signature onto the following tool call", async () => {
		const body = frame({
			candidates: [
				{
					content: {
						parts: [
							{ text: "Answer" },
							{ thoughtSignature: "text-only" },
							{ functionCall: { name: "lookup" } },
						],
					},
					finishReason: "STOP",
				},
			],
			usageMetadata: { totalTokenCount: 0 },
		});
		const { result } = await collect(new Response(body));
		expect(result.content).toEqual([
			{ type: "text", text: "Answer", textSignature: "text-only" },
			{ type: "toolCall", id: "call_fixed", name: "lookup", arguments: {} },
		]);
	});

	test("normalizes and deduplicates tool ids and applies batch signatures only once", async () => {
		const body = frame({
			candidates: [
				{
					content: {
						parts: [
							{ thought: true, text: "", thoughtSignature: "batch" },
							{ functionCall: { id: "same/id", name: "one" } },
							{ functionCall: { id: "same_id", name: "two" } },
							{ functionCall: { id: "same_id", name: "three" } },
						],
					},
					finishReason: "STOP",
				},
			],
			usageMetadata: { totalTokenCount: 0 },
		});
		const { result } = await collect(new Response(body));
		expect(result.content).toEqual([
			{ type: "toolCall", id: "same_id", name: "one", arguments: {}, thoughtSignature: "batch" },
			{ type: "toolCall", id: "call_fixed", name: "two", arguments: {} },
			{ type: "toolCall", id: "call_123_1", name: "three", arguments: {} },
		]);
	});

	test("in-band RPC failures throw the same typed error and become Pi error events", async () => {
		const body =
			frame({ candidates: [{ content: { parts: [{ text: "Partial" }] } }] }) +
			frame({
				error: {
					code: 429,
					message: "Quota exhausted",
					details: [{ reason: "RATE_LIMIT_EXCEEDED" }, { retryDelay: "2s" }],
				},
			});
		const generator = parseAntigravitySse(new Response(body));
		await generator.next();
		const error = await generator.next().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(AntigravityError);
		if (!(error instanceof AntigravityError)) throw new Error("Expected typed RPC error");
		expect(error.reason).toBe("RATE_LIMIT_EXCEEDED");
		expect(error.retryAfterMs).toBe(2000);
		const { result } = await collect(new Response(body));
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe(error.message);
	});

	test.each([
		["", "TRUNCATED_STREAM"],
		[frame({ candidates: [{ content: { parts: [{ text: "Partial" }] } }] }), "TRUNCATED_STREAM"],
		[frame({ candidates: [{ finishReason: "STOP" }] }), "EMPTY_RESPONSE"],
		[
			frame({ promptFeedback: { blockReason: "SAFETY", blockReasonMessage: "Blocked" } }),
			"PROMPT_BLOCKED",
		],
		[
			frame({ candidates: [{ content: { parts: [{ text: "No" }] }, finishReason: "SAFETY" }] }),
			"FINISH_REASON",
		],
	])("rejects incomplete or blocked stream %s", async (body, reason) => {
		const { result, events } = await collect(new Response(body));
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain(reason);
		expect(events.at(-1)?.type).toBe("error");
	});

	test("accepts plain multiline SSE and an unterminated final frame", async () => {
		expect(
			await parseAll(
				new Response(
					'data: {"candidates":\ndata: []}\n\ndata: [DONE]\n\n: ping\n\ndata: {"usageMetadata":{}}',
				),
			),
		).toEqual([{ candidates: [] }, { usageMetadata: {} }]);
	});

	test("malformed JSON is a typed parse error", async () => {
		await expect(parseAll(new Response("data: broken\n\n"))).rejects.toBeInstanceOf(
			AntigravityError,
		);
	});

	test("abort cancels a pending read and produces an aborted event", async () => {
		const controller = new AbortController();
		let canceled = false;
		const pending = collect(
			response([], true, () => {
				canceled = true;
			}),
			controller.signal,
		);
		controller.abort();
		const { result } = await pending;
		expect(result.stopReason).toBe("aborted");
		expect(canceled).toBe(true);
	});

	test("gpt-oss waits at most one second after a terminal candidate for usage", async () => {
		let canceled = false;
		const body = frame({
			candidates: [{ content: { parts: [{ text: "Done" }] }, finishReason: "STOP" }],
		});
		const { result } = await collect(
			response([new TextEncoder().encode(body)], true, () => {
				canceled = true;
			}),
		);
		expect(result.stopReason).toBe("stop");
		expect(canceled).toBe(true);
	});
});
