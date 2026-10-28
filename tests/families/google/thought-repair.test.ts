import { describe, expect, test } from "bun:test";
import { repairThoughtSignaturePayload } from "../../../src/families/google/thought-repair.ts";

const dummy = "skip_thought_signature_validator";

describe("repairThoughtSignaturePayload", () => {
	test("repairs only the first call in every native step of the current turn", () => {
		const payload = {
			contents: [
				{ role: "user", parts: [{ text: "previous" }] },
				{ role: "model", parts: [{ functionCall: { name: "old" } }] },
				{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "image" } }] },
				{
					role: "model",
					parts: [
						{ text: "thinking" },
						{ functionCall: { name: "a" } },
						{ functionCall: { name: "b" }, thoughtSignature: "parallel" },
					],
				},
				{ role: "user", parts: [{ functionResponse: { name: "a" } }] },
				{
					role: "model",
					parts: [
						{ functionCall: { name: "c" }, thought_signature: "signed" },
						{ functionCall: { name: "d" } },
					],
				},
				{ role: "user", parts: [{ function_response: { name: "c" } }] },
				{
					role: "model",
					parts: [{ functionCall: { name: "e" } }, { functionCall: { name: "f" } }],
				},
			],
		};
		const before = structuredClone(payload);
		const expected = structuredClone(payload);
		Object.assign(expected.contents[3]?.parts[1] ?? {}, { thoughtSignature: dummy });
		Object.assign(expected.contents[7]?.parts[0] ?? {}, { thoughtSignature: dummy });
		expect(repairThoughtSignaturePayload(payload)).toEqual({ payload: expected, repaired: 2 });
		expect(payload).toEqual(before);
	});

	test("repairs nested envelopes and JSON payload strings", () => {
		const payload = {
			model: "example",
			request: {
				contents: [
					{ role: "user", parts: [{ text: "hello" }] },
					{ role: "model", parts: [{ functionCall: { name: "a" } }] },
				],
				config: { temperature: 1 },
			},
		};
		const expected = {
			...payload,
			request: {
				...payload.request,
				contents: [
					payload.request.contents[0],
					{ role: "model", parts: [{ functionCall: { name: "a" }, thoughtSignature: dummy }] },
				],
			},
		};
		expect(repairThoughtSignaturePayload(payload)).toEqual({ payload: expected, repaired: 1 });
		expect(repairThoughtSignaturePayload(JSON.stringify(payload))).toEqual({
			payload: JSON.stringify(expected),
			repaired: 1,
		});
	});

	test("preserves chat signatures and reasoning details while repairing multiple steps", () => {
		const encrypted = [
			{ type: "reasoning.encrypted", format: "google-gemini-v1", data: "genuine" },
		];
		const other = [{ type: "reasoning.text", text: "verbatim" }];
		const payload = {
			messages: [
				{ role: "user", content: "previous" },
				{ role: "assistant", tool_calls: [{ id: "old" }] },
				{ role: "user", content: [{ type: "image_url", image_url: { url: "image" } }] },
				{
					role: "assistant",
					reasoning_details: other,
					tool_calls: [
						{ id: "a", extra_content: { other: 1, google: { other: 2 } } },
						{ id: "b", extra_content: { google: { thought_signature: "parallel" } } },
					],
				},
				{ role: "tool", content: "result" },
				{ role: "assistant", reasoning_details: encrypted, tool_calls: [{ id: "c" }] },
				{
					role: "assistant",
					tool_calls: [
						{ id: "d", extra_content: { google: { thought_signature: "signed" } } },
						{ id: "e" },
					],
				},
				{ role: "model", tool_calls: [{ id: "f" }, { id: "g" }] },
			],
		};
		const before = structuredClone(payload);
		const result = repairThoughtSignaturePayload(payload);
		expect(result).toEqual({
			repaired: 2,
			payload: {
				messages: [
					...payload.messages.slice(0, 3),
					{
						role: "assistant",
						reasoning_details: other,
						tool_calls: [
							{
								id: "a",
								extra_content: { other: 1, google: { other: 2, thought_signature: dummy } },
							},
							payload.messages[3]?.tool_calls?.[1],
						],
					},
					...payload.messages.slice(4, 7),
					{
						role: "model",
						tool_calls: [
							{ id: "f", extra_content: { google: { thought_signature: dummy } } },
							{ id: "g" },
						],
					},
				],
			},
		});
		expect(payload).toEqual(before);
	});

	test("does not mistake chat tool results for a new turn", () => {
		const payload = {
			messages: [
				{ role: "user", content: "hello" },
				{ role: "assistant", tool_calls: [{ id: "a" }] },
				{ role: "user", content: [{ type: "tool_result", content: "result" }] },
				{ role: "assistant", tool_calls: [{ id: "b" }] },
			],
		};
		expect(repairThoughtSignaturePayload(payload)).toEqual({
			repaired: 2,
			payload: {
				messages: [
					payload.messages[0],
					{
						role: "assistant",
						tool_calls: [{ id: "a", extra_content: { google: { thought_signature: dummy } } }],
					},
					payload.messages[2],
					{
						role: "assistant",
						tool_calls: [{ id: "b", extra_content: { google: { thought_signature: dummy } } }],
					},
				],
			},
		});
	});

	test("returns undefined for unsupported or unchanged inputs", () => {
		for (const payload of [
			null,
			"{",
			{},
			{ contents: [] },
			{
				contents: [
					{ role: "user", parts: [{ functionResponse: {} }] },
					{ role: "model", parts: [{ functionCall: {} }] },
				],
			},
			{
				contents: [
					{ role: "user", parts: [{ text: "hi" }] },
					{
						role: "model",
						parts: [{ functionCall: {}, thoughtSignature: "signed" }, { functionCall: {} }],
					},
				],
			},
			{
				contents: [
					{ role: "user", parts: [{ text: "hi" }] },
					{ role: "model", parts: [{ functionCall: null }, { functionCall: {} }] },
				],
			},
			{
				contents: [
					{ role: "user", parts: [{ functionCall: {} }] },
					{ role: "model", parts: [{ functionCall: {} }] },
				],
			},
			{ messages: [{ role: "assistant", tool_calls: [{ id: "x" }] }] },
			{
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", tool_calls: [] },
				],
			},
		])
			expect(repairThoughtSignaturePayload(payload)).toBeUndefined();
	});
});
