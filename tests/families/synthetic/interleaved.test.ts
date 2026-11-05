import { describe, expect, test } from "bun:test";
import type {
	Api,
	AssistantMessage,
	Model,
	ThinkingContent,
	ToolCall,
} from "@earendil-works/pi-ai";
import { foldInterleavedBlocks } from "../../../src/families/synthetic/interleaved.ts";
import { syntheticPhysicalHooks } from "../../../src/families/synthetic/physical.ts";

const MODEL = "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017";

function assistant(content: AssistantMessage["content"], provider = "synthetic"): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider,
		model: MODEL,
		stopReason: "toolUse",
		timestamp: 0,
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

const thinking = (text: string, extra: Partial<ThinkingContent> = {}): ThinkingContent => ({
	type: "thinking",
	thinking: text,
	...extra,
});

const call: ToolCall = {
	type: "toolCall",
	id: "call-1",
	name: "bash",
	arguments: { command: "true" },
};

describe("folding Synthetic's interleaved reasoning and answer fragments", () => {
	test("folds every thinking and text fragment into one block each", () => {
		const folded = foldInterleavedBlocks(
			assistant([
				thinking("Let me look at both git "),
				{ type: "text", text: "Gate" },
				thinking("states."),
				{ type: "text", text: " is green: 1259 tests." },
				call,
			]),
		);
		expect(folded?.content).toEqual([
			thinking("Let me look at both git states."),
			{ type: "text", text: "Gate is green: 1259 tests." },
			call,
		]);
	});

	test("keeps an interleaved tool call where it stands", () => {
		const folded = foldInterleavedBlocks(
			assistant([
				thinking("a"),
				{ type: "text", text: "b" },
				call,
				thinking("c"),
				{ type: "text", text: "d" },
			]),
		);
		expect(folded?.content.map((block) => block.type)).toEqual(["thinking", "text", "toolCall"]);
		expect(folded?.content[0]).toEqual(thinking("ac"));
		expect(folded?.content[1]).toEqual({ type: "text", text: "bd" });
	});

	test("leaves a single thinking block and a single text block untouched", () => {
		expect(foldInterleavedBlocks(assistant([thinking("a"), { type: "text", text: "b" }]))).toBe(
			undefined,
		);
		expect(foldInterleavedBlocks(assistant([{ type: "text", text: "b" }, call]))).toBeUndefined();
	});

	test("never merges signed or redacted reasoning", () => {
		for (const block of [
			thinking("a", { thinkingSignature: "signed" }),
			thinking("a", { redacted: true, thinkingSignature: "opaque" }),
		])
			expect(
				foldInterleavedBlocks(assistant([block, { type: "text", text: "b" }, thinking("c")])),
			).toBeUndefined();
	});

	test("folds repeated answer fragments even without reasoning", () => {
		const folded = foldInterleavedBlocks(
			assistant([
				{ type: "text", text: "1. Search" },
				{ type: "text", text: " log files." },
			]),
		);
		expect(folded?.content).toEqual([{ type: "text", text: "1. Search log files." }]);
	});

	test("ignores other providers", () => {
		expect(
			foldInterleavedBlocks(
				assistant([thinking("a"), { type: "text", text: "b" }, thinking("c")], "other"),
			),
		).toBeUndefined();
	});

	test("the physical message hook returns the folded message", async () => {
		const model: Model<Api> = {
			id: MODEL,
			name: MODEL,
			provider: "synthetic",
			api: "anthropic-messages",
			baseUrl: "https://example.test",
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			reasoning: true,
			contextWindow: 1000,
			maxTokens: 100,
		};
		const hooks = syntheticPhysicalHooks(model, []);
		if (!hooks?.payload || !hooks.message) throw new Error("missing physical hooks");
		await hooks.payload({ model: MODEL }, model);
		const folded = hooks.message(
			assistant([
				thinking("Let me check"),
				{ type: "text", text: " the gate." },
				thinking(" Then commit."),
			]),
		);
		expect(folded?.content).toEqual([
			thinking("Let me check Then commit."),
			{ type: "text", text: " the gate." },
		]);
	});
});
