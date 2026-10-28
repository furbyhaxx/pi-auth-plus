import { describe, expect, test } from "bun:test";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { installPhysicalRequestHooks } from "../../../src/models/runtime/physical.ts";

const context: Context = { messages: [] };
const model = (provider: string, api: Api = "test-api"): Model<Api> => ({
	id: "same",
	name: "Same",
	provider,
	api,
	baseUrl: "https://example.test",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: false,
	contextWindow: 1000,
	maxTokens: 100,
});
const message = (provider: string, stopReason: "stop" | "aborted" = "stop"): AssistantMessage => ({
	role: "assistant",
	content: [],
	api: "test-api",
	provider,
	model: "same",
	stopReason,
	timestamp: 0,
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
});

function runtimeFixture() {
	const requests: {
		model: Model<Api>;
		context: Context;
		options: ModelsSimpleStreamOptions | undefined;
		stream: ReturnType<typeof createAssistantMessageEventStream>;
		method: string;
		receiver: unknown;
	}[] = [];
	const runtime = {
		stream(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions) {
			const stream = createAssistantMessageEventStream();
			requests.push({ model, context, options, stream, method: "stream", receiver: this });
			return stream;
		},
		streamSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions) {
			const stream = createAssistantMessageEventStream();
			requests.push({ model, context, options, stream, method: "streamSimple", receiver: this });
			return stream;
		},
	};
	return { runtime, requests };
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>) {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

describe("physical request hooks", () => {
	test("isolates overlapping same-id requests, composes callbacks and preserves events", async () => {
		const { runtime, requests } = runtimeFixture();
		const calls: string[] = [];
		const signal = new AbortController().signal;
		expect(
			installPhysicalRequestHooks({ runtime }, (selected, receivedContext) => {
				expect(receivedContext).toBe(context);
				const provider = selected.provider;
				return {
					headers: (headers) => ({ ...headers, hook: provider }),
					payload: (payload, actual) => {
						calls.push(`payload:${provider}:${actual.baseUrl}:${String(payload)}`);
						return `${payload}:${provider}`;
					},
					message: (value) => {
						calls.push(`message:${provider}`);
						return { ...value, responseId: provider };
					},
				};
			}),
		).toBe(true);
		const options: ModelsSimpleStreamOptions = {
			signal,
			maxTokens: 21,
			samplingParams: { top_p: 0.4 },
			transformHeaders: async (headers) => ({ ...headers, caller: "yes" }),
			onPayload: async (value) => `${value}:caller`,
		};
		const a = runtime.stream(model("a"), context, options);
		const b = runtime.streamSimple(model("b"), context, options);
		const [ra, rb] = requests;
		if (
			!ra ||
			!rb ||
			!ra.options?.onPayload ||
			!rb.options?.onPayload ||
			!ra.options.transformHeaders
		)
			throw new Error("missing request");
		expect(ra.receiver).toBe(runtime);
		expect(rb.receiver).toBe(runtime);
		expect([ra.method, rb.method]).toEqual(["stream", "streamSimple"]);
		expect(ra.options.signal).toBe(signal);
		expect(ra.options.samplingParams).toBe(options.samplingParams);
		expect(ra.options.maxTokens).toBe(21);
		expect(await ra.options.transformHeaders({ original: "yes" })).toEqual({
			original: "yes",
			caller: "yes",
			hook: "a",
		});
		expect(await rb.options.onPayload("body", { ...rb.model, baseUrl: "resolved" })).toBe(
			"body:caller:b",
		);
		expect(await ra.options.onPayload("body", ra.model)).toBe("body:caller:a");
		const partial = message("a");
		const start: AssistantMessageEvent = { type: "start", partial };
		ra.stream.push(start);
		const ma = message("a");
		const mb = message("b");
		rb.stream.push({ type: "done", reason: "stop", message: mb });
		ra.stream.push({ type: "done", reason: "stop", message: ma });
		const [ea, eb] = await Promise.all([collect(a), collect(b)]);
		expect(ea[0]).toBe(start);
		expect(ea[0]?.type === "start" && ea[0].partial).toBe(partial);
		const aResult = await a.result();
		const bResult = await b.result();
		expect(ea[1]?.type === "done" && ea[1].message).toBe(aResult);
		expect(eb[0]?.type === "done" && eb[0].message).toBe(bResult);
		expect([aResult.responseId, bResult.responseId]).toEqual(["a", "b"]);
		expect(calls.filter((entry) => entry.startsWith("message:")).sort()).toEqual([
			"message:a",
			"message:b",
		]);
		expect(calls.slice(0, 2)).toEqual([
			"payload:b:resolved:body:caller",
			"payload:a:https://example.test:body:caller",
		]);
	});

	test("passes virtual and unmatched calls through and updates factory on reload", async () => {
		const { runtime, requests } = runtimeFixture();
		let called = 0;
		const first = () => {
			called++;
			return undefined;
		};
		expect(installPhysicalRequestHooks({ runtime }, first)).toBe(true);
		const wrapped = runtime.streamSimple;
		const options = { maxTokens: 10 };
		const virtual = runtime.streamSimple(model("v", "pi-virtual"), context, options);
		expect(requests[0]?.stream).toBe(virtual);
		expect(requests[0]?.options).toBe(options);
		expect(called).toBe(0);
		const passthrough = runtime.stream(model("a"), context, options);
		expect(requests[1]?.stream).toBe(passthrough);
		expect(requests[1]?.options).toBe(options);
		expect(installPhysicalRequestHooks({ runtime }, () => ({ payload: () => null }))).toBe(true);
		expect(runtime.streamSimple).toBe(wrapped);
		runtime.streamSimple(model("a"), context);
		await expect(requests[2]?.options?.onPayload?.("x", model("a"))).resolves.toBeNull();
		expect(called).toBe(1);
	});

	test("preserves abort events, identity, result rejection and no-message stream", async () => {
		const { runtime, requests } = runtimeFixture();
		installPhysicalRequestHooks({ runtime }, () => ({ message: () => undefined }));
		const controller = new AbortController();
		const stream = runtime.stream(model("a"), context, { signal: controller.signal });
		const request = requests[0];
		if (!request) throw new Error("missing request");
		controller.abort();
		expect(request.options?.signal?.aborted).toBe(true);
		const partial = message("a", "aborted");
		const start: AssistantMessageEvent = { type: "start", partial };
		request.stream.push(start);
		request.stream.push({ type: "error", reason: "aborted", error: partial });
		const events = await collect(stream);
		expect(events[0]).toBe(start);
		expect(events[1]?.type === "error" && events[1].error).toBe(await stream.result());
		expect((await stream.result()).stopReason).toBe("aborted");
		const failure = new Error("rejected");
		const rejected = runtime.streamSimple(model("b"), context);
		const second = requests[1];
		if (!second) throw new Error("missing request");
		second.stream.result = () => Promise.reject(failure);
		await expect(rejected.result()).rejects.toBe(failure);
		second.stream.push({ type: "error", reason: "error", error: message("b") });
		await collect(rejected);
		installPhysicalRequestHooks({ runtime }, () => ({ headers: (headers) => headers }));
		const unchanged = runtime.stream(model("c"), context);
		expect(requests[2]?.stream).toBe(unchanged);
	});

	test("preserves stream iteration failures after forwarding earlier events", async () => {
		const { runtime, requests } = runtimeFixture();
		const failure = new Error("iteration failed");
		const start: AssistantMessageEvent = { type: "start", partial: message("a") };
		installPhysicalRequestHooks({ runtime }, () => ({ message: () => undefined }));
		const stream = runtime.stream(model("a"), context);
		const request = requests[0];
		if (!request) throw new Error("missing request");
		request.stream[Symbol.asyncIterator] = async function* () {
			yield start;
			throw failure;
		};
		const iterator = stream[Symbol.asyncIterator]();
		expect((await iterator.next()).value).toBe(start);
		await expect(iterator.next()).rejects.toBe(failure);
	});

	test("intercepts physical recursion only and preserves callback errors and undefined payloads", async () => {
		const { runtime, requests } = runtimeFixture();
		const base = runtime.streamSimple;
		runtime.streamSimple = function (selected, current, options) {
			return selected.api === "pi-virtual"
				? this.streamSimple(model("physical"), current, options)
				: base.call(this, selected, current, options);
		};
		const factories: string[] = [];
		installPhysicalRequestHooks({ runtime }, (selected) => {
			factories.push(selected.provider);
			return { payload: () => undefined };
		});
		runtime.streamSimple(model("virtual", "pi-virtual"), context, {
			onPayload: () => undefined,
		});
		expect(factories).toEqual(["physical"]);
		const request = requests[0];
		if (!request?.options?.onPayload) throw new Error("missing callback");
		expect(await request.options.onPayload("original", request.model)).toBe("original");
		const failure = new Error("callback failure");
		runtime.stream(model("other"), context, {
			onPayload: () => {
				throw failure;
			},
		});
		const other = requests[1];
		if (!other?.options?.onPayload) throw new Error("missing callback");
		await expect(other.options.onPayload("original", other.model)).rejects.toBe(failure);
	});

	test("rejects unsupported or frozen runtimes without changes", () => {
		const { runtime } = runtimeFixture();
		const original = runtime.stream;
		Object.freeze(runtime);
		for (const registry of [null, {}, { runtime: {} }, { runtime }, { runtime: { stream() {} } }]) {
			expect(installPhysicalRequestHooks(registry, () => undefined)).toBe(false);
		}
		expect(runtime.stream).toBe(original);
		expect(Object.getOwnPropertySymbols(runtime)).toEqual([]);
	});
});
