import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	MessageEndEventResult,
} from "@earendil-works/pi-coding-agent";
import type { FamilyHost } from "../../../src/core/registry/index.ts";
import { bundledModels } from "../../../src/families/synthetic/catalog.ts";
import { createSyntheticFamily } from "../../../src/families/synthetic/index.ts";
import { countSyntheticRequest } from "../../../src/families/synthetic/request-tokens.ts";
import {
	correctSyntheticRequestUsage,
	correctSyntheticUsage,
} from "../../../src/families/synthetic/usage.ts";
import type { TextTokenizer, TokenizerStore } from "../../../src/tokens/types.ts";
import { testHost } from "../../host.ts";

// Persisted usage from .project/analyses/tokens/usage-audit/captures/synthetic-hf-deepseek-ai-DeepSeek-V4-1-Flash-1017.json
const CAPTURED: readonly { usage: Usage; prompt: number }[] = [
	{
		prompt: 6869,
		usage: {
			input: 6869,
			output: 20,
			cacheRead: 0,
			cacheWrite: 6869,
			totalTokens: 13758,
			cost: { input: 0.0041214, output: 2.4e-5, cacheRead: 0, cacheWrite: 0, total: 0.0041454 },
			cacheWrite1h: 0,
		},
	},
	{
		prompt: 7311,
		usage: {
			input: 468,
			output: 6,
			cacheRead: 6843,
			cacheWrite: 468,
			totalTokens: 7785,
			cost: {
				input: 0.0002808,
				output: 7.2e-6,
				cacheRead: 0.00020528999999999998,
				cacheWrite: 0,
				total: 0.00049329,
			},
			cacheWrite1h: 0,
		},
	},
];

function capturedUsage(index: number): Usage {
	const captured = CAPTURED[index];
	if (!captured) throw new Error("Missing captured Synthetic usage");
	return captured.usage;
}

function assistant(usage: Usage, provider = "synthetic"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider,
		model: "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017",
		usage,
		stopReason: "stop",
		timestamp: 0,
	};
}

describe("synthetic usage correction", () => {
	test.each(CAPTURED)(
		"context equals the real prompt and cost is unchanged ($prompt)",
		({ usage, prompt }) => {
			const fixed = correctSyntheticUsage(assistant(usage))?.usage;
			expect(fixed?.input).toBe(usage.input);
			expect(fixed?.cacheWrite).toBe(0);
			expect((fixed?.totalTokens ?? 0) - usage.output).toBe(prompt);
			expect(fixed?.cost.total).toBeCloseTo(usage.cost.total, 12);
		},
	);
	test("normal Anthropic accounting and other providers are left alone", () => {
		const normal = { ...capturedUsage(1), cacheWrite: 120, totalTokens: 7437 };
		expect(correctSyntheticUsage(assistant(normal))).toBeUndefined();
		expect(correctSyntheticUsage(assistant(capturedUsage(0), "claude"))).toBeUndefined();
	});
});

// Representative Pi wire blocks: the committed captures retain only payload summaries.
const tool = {
	name: "read",
	description: "Read a file",
	input_schema: { type: "object", properties: { path: { type: "string" } } },
};
const payload = {
	model: "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017",
	system: [{ type: "text", text: "System instructions", cache_control: { type: "ephemeral" } }],
	messages: [
		{ role: "user", content: "Read the file" },
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "I should read it", signature: "not-counted" },
				{ type: "text", text: "Reading now" },
				{ type: "tool_use", id: "call_1", name: "read", input: { path: "README.md" } },
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_1",
					content: [{ type: "text", text: "File contents" }],
				},
				{ type: "tool_result", tool_use_id: "call_2", content: "Another result" },
			],
		},
	],
	tools: [tool],
};
const count = (text: string): number => Math.ceil(text.length / 2);
const expectedPrompt = [
	"System instructions",
	"Read the file",
	"I should read it",
	"Reading now",
	"read",
	'{"path":"README.md"}',
	"File contents",
	"Another result",
	JSON.stringify(tool),
].reduce((sum, text) => sum + count(text), 0);

function store(loaded = true): TokenizerStore {
	const tokenizer: TextTokenizer = { id: "test@revision", count };
	return { peek: () => (loaded ? tokenizer : undefined), load: async () => tokenizer };
}

async function registered(tokenizers?: TokenizerStore, host?: FamilyHost) {
	type Handler = (event: ExtensionEvent, ctx: ExtensionContext) => unknown;
	const handlers = new Map<string, Handler>();
	const pi = {
		registerFlag: () => {},
		getFlag: () => false,
		on: (name: string, handler: Handler) => handlers.set(name, handler),
	} as unknown as ExtensionAPI;
	const family = createSyntheticFamily({}, undefined, undefined, undefined, tokenizers);
	await family.register?.(pi, host ?? (await testHost()));
	const model = { provider: "synthetic", id: payload.model };
	function emit(event: ExtensionEvent, selected = model) {
		return handlers.get(event.type)?.(event, { model: selected } as ExtensionContext);
	}
	function end(message: AssistantMessage) {
		return emit({ type: "message_end", message }) as MessageEndEventResult | undefined;
	}
	return { emit, end, family };
}

describe("Synthetic tokenizer usage", () => {
	test.each(CAPTURED)("counts all request blocks and preserves billing ($prompt)", ({ usage }) => {
		const original = assistant(usage);
		const fixed = correctSyntheticRequestUsage(original, payload, store());
		expect(fixed).toBeDefined();
		const result = fixed?.usage;
		expect((result?.input ?? 0) + (result?.cacheRead ?? 0) + (result?.cacheWrite ?? 0)).toBe(
			expectedPrompt,
		);
		expect(result?.totalTokens).toBe(expectedPrompt + usage.output);
		expect(result?.output).toBe(usage.output);
		expect(result?.cost).toEqual(usage.cost);
		const deduped = correctSyntheticUsage(original) ?? original;
		const prompt = deduped.usage.input + deduped.usage.cacheRead + deduped.usage.cacheWrite;
		expect(result?.input).toBe(Math.round((deduped.usage.input * expectedPrompt) / prompt));
		expect(result?.cacheWrite).toBe(
			Math.round((deduped.usage.cacheWrite * expectedPrompt) / prompt),
		);
		expect(original.usage).toEqual(usage);
	});

	test("unloaded, absent, failed, mismatched and alias tokenizers keep only dedupe", () => {
		const message = assistant(capturedUsage(0));
		const deduped = correctSyntheticUsage(message);
		const broken: TokenizerStore = {
			peek: () => ({
				id: "broken",
				count: () => {
					throw new Error("failed");
				},
			}),
			load: async () => undefined,
		};
		for (const tokenizers of [undefined, store(false), broken]) {
			expect(correctSyntheticRequestUsage(message, payload, tokenizers)).toEqual(deduped);
		}
		expect(
			correctSyntheticRequestUsage(message, { ...payload, model: "foreign" }, store()),
		).toEqual(deduped);
		const alias = { ...message, model: "syn:small:text" };
		expect(
			correctSyntheticRequestUsage(alias, { ...payload, model: alias.model }, store()),
		).toEqual(correctSyntheticUsage(alias));
	});

	test("other providers, errors and zero prompt usage are untouched", () => {
		const message = assistant(capturedUsage(0));
		for (const ignored of [
			{ ...message, provider: "claude" },
			{ ...message, stopReason: "error" as const },
			{
				...message,
				usage: { ...message.usage, input: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
			},
		]) {
			expect(correctSyntheticRequestUsage(ignored, payload, store())).toBeUndefined();
		}
	});

	test("unsupported or malformed content falls back instead of counting binary data", () => {
		const message = assistant(capturedUsage(0));
		for (const body of [
			null,
			{ ...payload, messages: null },
			{ ...payload, messages: [{ content: [{ type: "image", source: { data: "base64" } }] }] },
			{ ...payload, messages: [{ content: [{ type: "text", text: 7 }] }] },
			{ ...payload, tools: [{ name: "read" }] },
		]) {
			expect(correctSyntheticRequestUsage(message, body, store())).toEqual(
				correctSyntheticUsage(message),
			);
		}
	});

	test("counts blocks separately for tokenizer memoization", () => {
		const calls: string[] = [];
		expect(
			countSyntheticRequest(payload, {
				id: "test",
				count: (text) => {
					calls.push(text);
					return count(text);
				},
			}),
		).toBe(expectedPrompt);
		expect(calls).toHaveLength(9);
		expect(calls).toContain("System instructions");
		expect(calls).toContain(JSON.stringify(tool));
	});

	test("preloads on lifecycle events without awaiting, captures and persists matching usage", async () => {
		const loads: string[] = [];
		const tokenizers = store();
		const family = await registered({
			peek: tokenizers.peek,
			load: (repo) => {
				loads.push(repo);
				return new Promise(() => {});
			},
		});
		expect(loads).toEqual([]);
		expect(family.emit({ type: "session_start", reason: "startup" })).toBeUndefined();
		const model = bundledModels().find((candidate) => candidate.id === payload.model);
		if (!model) throw new Error("Missing bundled Synthetic model");
		family.emit({
			type: "model_select",
			model,
			previousModel: undefined,
			source: "set",
		});
		expect(loads).toEqual([payload.model.slice(3), payload.model.slice(3)]);
		family.emit({ type: "before_provider_request", payload });
		const message = assistant(capturedUsage(0));
		expect(family.end(message)?.message).toMatchObject({
			usage: { input: expectedPrompt, totalTokens: expectedPrompt + message.usage.output },
		});
		expect(family.end(message)?.message).toEqual(correctSyntheticUsage(message));
	});

	test("configured aliases preload and count their source while retaining request identity", async () => {
		const alias = "my-synthetic-model";
		const repo = payload.model.slice(3);
		const loads: string[] = [];
		const tokenizers: TokenizerStore = {
			peek: (id) => (id === repo ? { id: `${id}@test`, count } : undefined),
			load: async (id) => {
				loads.push(id);
				return undefined;
			},
		};
		const host = await testHost({
			"models.aliases": [{ provider: "synthetic", id: alias, source: payload.model }],
		});
		const { emit, end, family } = await registered(tokenizers, host);
		const model = { provider: "synthetic", id: alias };
		emit({ type: "session_start", reason: "startup" }, model);
		const source = bundledModels().find((candidate) => candidate.id === payload.model);
		if (!source) throw new Error("Missing bundled Synthetic model");
		emit({
			type: "model_select",
			model: { ...source, id: alias },
			previousModel: undefined,
			source: "set",
		});
		expect(loads).toEqual([repo, repo]);
		const deps = { auth: async () => undefined, fetch: async () => new Response(), tokenizers };
		expect(createSyntheticFamily().tokens?.(model, deps)?.id).toBe("estimate:synthetic:4/3");
		const counter = family.tokens?.(model, deps);
		expect(counter?.id).toBe(`${repo}@test`);
		expect(counter?.anchorSource).toBe("tokenizer");
		const message = { ...assistant(capturedUsage(0)), model: alias };
		emit({ type: "before_provider_request", payload: { ...payload, model: alias } }, model);
		expect(end(message)?.message).toMatchObject({
			model: alias,
			usage: { input: expectedPrompt, totalTokens: expectedPrompt + message.usage.output },
		});
		expect(end(message)?.message).toEqual(correctSyntheticUsage(message));
		emit({ type: "before_provider_request", payload: { ...payload, model: payload.model } }, model);
		expect(end(message)?.message).toEqual(correctSyntheticUsage(message));
		emit({ type: "before_provider_request", payload: { ...payload, model: alias } }, model);
		expect(end({ ...message, model: payload.model })?.message).toEqual(
			correctSyntheticUsage({ ...message, model: payload.model }),
		);
		await host.settings().save("runtime", {
			"models.aliases": [{ provider: "other", id: alias, source: payload.model }],
		});
		expect(family.tokens?.(model, deps)?.id).toBe("estimate:synthetic:4/3");
		await host.settings().save("runtime", {
			"models.aliases": [{ provider: "synthetic", id: alias, source: "hf:other/model" }],
		});
		await family.tokens?.(model, deps)?.count("text", "prose");
		expect(loads).toContain("other/model");
	});

	test("does not capture foreign requests or reuse requests after session changes", async () => {
		const family = await registered(store());
		const message = assistant(capturedUsage(0));
		family.emit(
			{ type: "before_provider_request", payload },
			{ provider: "claude", id: payload.model },
		);
		expect(family.end(message)?.message).toEqual(correctSyntheticUsage(message));
		family.emit({ type: "before_provider_request", payload: { ...payload, model: "foreign" } });
		expect(family.end(message)?.message).toEqual(correctSyntheticUsage(message));
		family.emit({ type: "before_provider_request", payload });
		family.emit({ type: "session_start", reason: "new" });
		expect(family.end(message)?.message).toEqual(correctSyntheticUsage(message));
	});
});
