import { describe, expect, test } from "bun:test";
import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { syntheticPhysicalHooks } from "../../../src/families/synthetic/physical.ts";
import type { ModelAlias } from "../../../src/models/aliases/index.ts";
import { installPhysicalRequestHooks } from "../../../src/models/runtime/physical.ts";
import type { TokenizerStore } from "../../../src/tokens/types.ts";

const source = "hf:example/model";
const alias = "short-name";
const aliases: readonly ModelAlias[] = [
	{ provider: "other", id: alias, source: "hf:wrong/repo" },
	{ provider: "synthetic", id: alias, source },
];
const model = (id: string, provider = "synthetic"): Model<Api> => ({
	id,
	name: id,
	provider,
	api: "anthropic-messages",
	baseUrl: "https://example.test",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: false,
	contextWindow: 1000,
	maxTokens: 100,
});
const message = (id: string): AssistantMessage => ({
	role: "assistant",
	content: [],
	api: "anthropic-messages",
	provider: "synthetic",
	model: id,
	stopReason: "stop",
	timestamp: 0,
	usage: {
		input: 10,
		output: 2,
		cacheRead: 0,
		cacheWrite: 10,
		totalTokens: 22,
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
	},
});
const payload = (id: string, content: string) => ({
	model: id,
	messages: [{ role: "user", content }],
});

function fixture() {
	const requests: {
		model: Model<Api>;
		options: ModelsSimpleStreamOptions | undefined;
		stream: ReturnType<typeof createAssistantMessageEventStream>;
	}[] = [];
	const runtime = {
		stream(selected: Model<Api>, _context: Context, options?: ModelsSimpleStreamOptions) {
			const stream = createAssistantMessageEventStream();
			requests.push({ model: selected, options, stream });
			return stream;
		},
		streamSimple(selected: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions) {
			return this.stream(selected, context, options);
		},
	};
	return { requests, runtime };
}

describe("Synthetic physical request hooks", () => {
	test("isolates overlapping requests and counts caller-transformed logical alias payloads", async () => {
		const loads: string[] = [];
		const tokenizers: TokenizerStore = {
			peek: (repo) =>
				repo === "example/model" ? { id: repo, count: (text) => text.length } : undefined,
			load: (repo) => {
				loads.push(repo);
				return new Promise(() => {});
			},
		};
		const { requests, runtime } = fixture();
		expect(
			installPhysicalRequestHooks({ runtime }, (selected) =>
				syntheticPhysicalHooks(selected, aliases, tokenizers),
			),
		).toBe(true);
		const context: Context = { messages: [] };
		const first = runtime.stream(model(alias), context, {
			onPayload: () => payload(alias, "first"),
		});
		const second = runtime.stream(model(alias), context, {
			onPayload: () => payload(alias, "second-long"),
		});
		expect(loads).toEqual(["example/model", "example/model"]);
		const [a, b] = requests;
		if (!a?.options?.onPayload || !b?.options?.onPayload) throw new Error("missing requests");
		expect(await a.options.onPayload(payload(alias, "discarded"), a.model)).toEqual(
			payload(source, "first"),
		);
		expect(await b.options.onPayload(payload(alias, "discarded"), b.model)).toEqual(
			payload(source, "second-long"),
		);
		b.stream.push({ type: "done", reason: "stop", message: message(alias) });
		a.stream.push({ type: "done", reason: "stop", message: message(alias) });
		const [aResult, bResult] = await Promise.all([first.result(), second.result()]);
		expect([aResult.model, bResult.model]).toEqual([alias, alias]);
		expect([aResult.usage.input, bResult.usage.input]).toEqual([5, 11]);
		expect([aResult.usage.totalTokens, bResult.usage.totalTokens]).toEqual([7, 13]);
	});

	test("handles physical identities, mismatches, errors and caller replacements", async () => {
		const loads: string[] = [];
		const tokenizers: TokenizerStore = {
			peek: () => ({ id: "test", count: (text) => text.length }),
			load: async (repo) => {
				loads.push(repo);
				return undefined;
			},
		};
		expect(syntheticPhysicalHooks(model(alias, "other"), aliases, tokenizers)).toBeUndefined();
		const physical = syntheticPhysicalHooks(model(source), aliases, tokenizers);
		if (!physical?.payload || !physical.message) throw new Error("missing physical hooks");
		const body = payload(source, "physical");
		expect(await physical.payload(body, model(source))).toBe(body);
		const corrected = physical.message(message(source));
		expect(corrected?.model).toBe(source);
		expect(corrected?.usage.input).toBe(8);
		const selected = syntheticPhysicalHooks(model(alias), aliases, tokenizers);
		if (!selected?.payload || !selected.message) throw new Error("missing alias hooks");
		const replacement = payload("different", "foreign");
		expect(await selected.payload(replacement, model(alias))).toBe(replacement);
		expect(selected.message(message(alias))).toBeUndefined();
		await selected.payload(payload(alias, "matching"), model(alias));
		for (const ignored of [
			{ ...message(alias), provider: "other" },
			{ ...message(alias), model: source },
			{ ...message(alias), stopReason: "error" as const },
		])
			expect(selected.message(ignored)).toBeUndefined();
		const invalid = syntheticPhysicalHooks(model("not-hf"), aliases, tokenizers);
		expect(invalid).toBeDefined();
		expect(loads).toEqual(["example/model", "example/model"]);
	});
});
