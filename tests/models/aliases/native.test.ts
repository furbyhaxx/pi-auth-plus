import { describe, expect, test } from "bun:test";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	normalizeContext,
	type Provider,
	type SimpleStreamOptions,
	Type,
} from "@earendil-works/pi-ai";
import { antigravityProvider, pickLevel } from "../../../src/families/google/provider.ts";
import { buildRequest, RequestSessions } from "../../../src/families/google/request.ts";
import type { AliasIssue, ModelAlias } from "../../../src/models/aliases/index.ts";
import { wrapNativeAliases } from "../../../src/models/aliases/native.ts";

const base: Model<"anthropic-messages"> = {
	provider: "test",
	id: "base",
	name: "Base",
	api: "anthropic-messages",
	baseUrl: "https://example.invalid",
	input: ["text"],
	reasoning: false,
	contextWindow: 5000,
	maxTokens: 500,
	cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
};
const alias: ModelAlias = {
	provider: "test",
	source: "base",
	id: "short",
	name: "Short",
	contextWindow: 1000,
	maxTokens: 100,
};

function fixture() {
	let catalog = [base, { ...base, id: "hidden" }, { ...base, id: "occupied" }];
	let payload: unknown;
	let envelope = false;
	const provider: Provider<"anthropic-messages"> = {
		id: "test",
		name: "Test",
		auth: {},
		getModels: () => catalog,
		getAllModels: () => [
			...catalog,
			{ ...base, id: "image", type: "image", api: "openai-images", output: ["image"] },
		],
		filterModels: (models) =>
			models
				.filter((model) => model.id !== "hidden")
				.map((model) => ({ ...model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
		async refreshModels(ctx) {
			await ctx.publish({
				update: () => {
					catalog = [{ ...base, id: "new" }];
				},
			});
		},
		stream(model, _context, options) {
			return run(model, options?.onPayload);
		},
		streamSimple(model, _context, options) {
			return run(model, options?.onPayload);
		},
	};
	function run(
		model: Model<"anthropic-messages">,
		callback: ((payload: unknown, model: Model<"anthropic-messages">) => unknown) | undefined,
	) {
		const stream = createAssistantMessageEventStream();
		void (async () => {
			const original = { model: envelope ? "wire-level" : model.id };
			const transformed = await callback?.(original, model);
			payload = transformed === undefined ? original : transformed;
			const message: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			};
			stream.push({ type: "done", reason: "stop", message });
		})();
		return stream;
	}
	return {
		provider,
		payload: () => payload,
		setEnvelope: (value: boolean) => {
			envelope = value;
		},
	};
}

describe("native aliases", () => {
	test("uses physical identity for real Antigravity request shaping and signatures", async () => {
		const physical: Model<"google-generative-ai"> = {
			api: "google-generative-ai",
			provider: "antigravity",
			id: "claude-test",
			name: "Test",
			baseUrl: "https://example.invalid",
			input: ["text"],
			reasoning: true,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 5000,
			maxTokens: 500,
		};
		const gpt = { ...physical, id: "gpt-oss-test" };
		const signature = "c2lnbmVkLXRob3VnaHQ=";
		let body: ReturnType<typeof buildRequest>["body"] | undefined;
		const provider: Provider<"google-generative-ai"> = {
			id: physical.provider,
			name: "test",
			auth: {},
			getModels: () => [physical, gpt],
			stream(model, context, options) {
				return run(model, context, options?.onPayload);
			},
			streamSimple(model, context, options) {
				return run(model, context, options?.onPayload);
			},
		};
		function run(
			model: Model<"google-generative-ai">,
			context: Parameters<typeof buildRequest>[0]["context"],
			onPayload: ((body: unknown, model: Model<"google-generative-ai">) => unknown) | undefined,
		) {
			body = buildRequest({
				model,
				context,
				options: {},
				level: {
					id: "claude-test-high",
					modelEnum: "CLAUDE",
					thinking: { kind: "level", level: "HIGH" },
				},
				project: "test",
				sessions: new RequestSessions({ now: () => 10, uuid: () => "fixed" }),
			}).body;
			const stream = createAssistantMessageEventStream();
			void (async () => {
				await onPayload?.(body, model);
				const message: AssistantMessage = {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				};
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: "stop", message });
			})();
			return stream;
		}
		const previous: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "reason", thinkingSignature: signature },
				{ type: "toolCall", id: "c1", name: "read", arguments: {}, thoughtSignature: signature },
			],
			api: physical.api,
			provider: physical.provider,
			model: "short",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 2,
		};
		const context = normalizeContext({
			tools: [{ name: "read", description: "read", parameters: Type.Object({}) }],
			messages: [
				{ role: "user", content: "read", timestamp: 1 },
				previous,
				{
					role: "toolResult",
					toolCallId: "c1",
					toolName: "read",
					content: [{ type: "text", text: "done" }],
					isError: false,
					timestamp: 3,
				},
			],
		});
		const wrapped = wrapNativeAliases(provider, () => [
			{ provider: physical.provider, source: physical.id, id: "short", maxTokens: 77 },
			{ provider: physical.provider, source: gpt.id, id: "gpt-short" },
		]);
		const selected = wrapped.getModels().find((model) => model.id === "short");
		if (!selected) throw new Error("alias missing");
		let observed = "";
		const stream = wrapped.streamSimple(selected, context, {
			onPayload: (_, model) => {
				observed = model.id;
			},
		});
		const ids: string[] = [];
		for await (const event of stream)
			ids.push(
				event.type === "done"
					? event.message.model
					: event.type === "error"
						? event.error.model
						: event.partial.model,
			);
		expect((await stream.result()).model).toBe("short");
		expect(ids).toEqual(["short", "short"]);
		expect(observed).toBe("short");
		const actual = body;
		const expected = buildRequest({
			model: { ...selected, id: physical.id },
			context: normalizeContext({
				messages: context.messages.map((message) =>
					message.role === "assistant" ? { ...message, model: physical.id } : message,
				),
			}),
			options: {},
			level: {
				id: "claude-test-high",
				modelEnum: "CLAUDE",
				thinking: { kind: "level", level: "HIGH" },
			},
			project: "test",
			sessions: new RequestSessions({ now: () => 10, uuid: () => "fixed" }),
		}).body;
		expect(actual).toEqual(expected);
		expect(actual?.model).toBe("claude-test-high");
		expect(JSON.stringify(actual?.request.contents)).toContain(signature);
		expect(previous.model).toBe("short");

		const foreign = normalizeContext({
			messages: context.messages.map((message) =>
				message === previous ? { ...previous, model: physical.id } : message,
			),
		});
		await wrapped.streamSimple(selected, foreign).result();
		expect(JSON.stringify(body?.request.contents)).not.toContain(signature);
		const gptAlias = wrapped.getModels().find((model) => model.id === "gpt-short");
		if (!gptAlias) throw new Error("GPT alias missing");
		const gptContext = normalizeContext({
			tools: [
				{
					name: "numeric",
					description: "numeric",
					parameters: Type.Object({ count: Type.Number({ minimum: 2 }) }),
				},
			],
			messages: [{ role: "user", content: "go", timestamp: 1 }],
		});
		await wrapped.streamSimple(gptAlias, gptContext).result();
		const gptBody = buildRequest({
			model: { ...gptAlias, id: gpt.id },
			context: gptContext,
			options: {},
			level: {
				id: "claude-test-high",
				modelEnum: "CLAUDE",
				thinking: { kind: "level", level: "HIGH" },
			},
			project: "test",
			sessions: new RequestSessions({ now: () => 10, uuid: () => "fixed" }),
		}).body;
		expect(body).toEqual(gptBody);
		expect(JSON.stringify(body?.request.tools)).toContain("minimum: 2");
	});
	test("round-trips a streamed signature and maps setup errors through Antigravity", async () => {
		const signature = "c2lnbmVkLXRob3VnaHQ=";
		const bodies: unknown[] = [];
		const provider = antigravityProvider({
			auth: {},
			project: { resolve: async () => "test-project" },
			fetch: async (_input, init) => {
				bodies.push(JSON.parse(String(init?.body)));
				const response = {
					candidates: [
						{
							content: {
								parts: [
									{ thought: true, text: "reason", thoughtSignature: signature },
									{
										functionCall: { id: "c1", name: "read", args: {} },
										thoughtSignature: signature,
									},
								],
							},
							finishReason: "STOP",
						},
					],
				};
				return new Response(`data: ${JSON.stringify({ response })}\n\n`);
			},
		});
		const physical = provider.getModels().find((model) => model.id.startsWith("claude-"));
		if (!physical) throw new Error("no Claude model in catalog");
		const wrapped = wrapNativeAliases(provider, () => [
			{ provider: physical.provider, source: physical.id, id: "short" },
		]);
		const selected = wrapped.getModels().find((model) => model.id === "short");
		if (!selected) throw new Error("alias missing");
		const context = normalizeContext({
			tools: [{ name: "read", description: "read", parameters: Type.Object({}) }],
			messages: [{ role: "user", content: "read", timestamp: 1 }],
		});
		const ids: string[] = [];
		const hooks: string[] = [];
		const options: SimpleStreamOptions = {
			headers: { Authorization: "Bearer test-token" },
			onPayload: (_payload, model) => {
				hooks.push(`payload:${model.id}`);
			},
			onResponse: (_response, model) => {
				hooks.push(`response:${model.id}`);
			},
		};
		const stream = wrapped.streamSimple(selected, context, options);
		for await (const event of stream)
			ids.push(
				event.type === "done"
					? event.message.model
					: event.type === "error"
						? event.error.model
						: event.partial.model,
			);
		const first = await stream.result();
		expect(first.model).toBe("short");
		expect(ids.length).toBeGreaterThan(1);
		expect(ids.every((id) => id === "short")).toBe(true);
		expect(hooks).toEqual(["payload:short", "response:short"]);
		expect(first.content).toContainEqual({
			type: "thinking",
			thinking: "reason",
			thinkingSignature: signature,
		});
		const call = first.content.find((block) => block.type === "toolCall");
		if (call?.type !== "toolCall") throw new Error("tool call missing");
		const next = normalizeContext({
			messages: [
				...context.messages,
				first,
				{
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: [{ type: "text", text: "done" }],
					isError: false,
					timestamp: 2,
				},
			],
		});
		await wrapped.streamSimple(selected, next, options).result();
		expect(JSON.stringify(bodies[1])).toContain(signature);
		expect(bodies[1]).toMatchObject({ model: pickLevel(physical, undefined)?.id });
		const failed = wrapped.streamSimple(selected, context);
		const errors = [];
		for await (const event of failed) errors.push(event);
		expect(errors[0]?.type).toBe("error");
		expect((await failed.result()).model).toBe("short");
	});

	test("preserves policy, transforms, identity, and prevents collisions", async () => {
		const f = fixture();
		const issues: (readonly AliasIssue[])[] = [];
		const collision = { ...alias, id: "occupied" };
		const hidden = { ...alias, source: "hidden", id: "hidden-alias" };
		const wrapped = wrapNativeAliases(
			f.provider,
			() => [alias, collision, hidden],
			(found) => {
				issues.push(found);
			},
		);
		expect(wrapped.auth).toBe(f.provider.auth);
		const models = wrapped.getModels();
		const selected = models.find((model) => model.id === "short");
		if (!selected) throw new Error("alias missing");
		expect([base.contextWindow, selected.contextWindow, selected.maxTokens]).toEqual([
			5000, 1000, 100,
		]);
		expect(issues.flat()).toContainEqual({ kind: "collision", alias: collision });
		const available = wrapped.filterModels?.(models, undefined) ?? [];
		expect(available.map((model) => model.id)).not.toContain("hidden-alias");
		expect(available.find((model) => model.id === "short")?.cost.input).toBe(0);
		const all = wrapped.getAllModels?.() ?? [];
		expect((wrapped.filterAllModels?.(all, undefined) ?? []).map((model) => model.id)).toContain(
			"image",
		);
		const original = { model: "short", kept: true };
		const result = await wrapped
			.streamSimple(selected, normalizeContext({ messages: [] }), { onPayload: () => original })
			.result();
		expect(result.model).toBe("short");
		expect(f.payload()).toEqual({ model: "base", kept: true });
		expect(original.model).toBe("short");
		const occupied = models.find((model) => model.id === "occupied");
		if (!occupied) throw new Error("physical model missing");
		await wrapped.stream(occupied, normalizeContext({ messages: [] })).result();
		expect(f.payload()).toEqual({ model: "occupied" });
		await wrapped
			.stream(selected, normalizeContext({ messages: [] }), { onPayload: () => undefined })
			.result();
		expect(f.payload()).toEqual({ model: "base" });
		await wrapped
			.streamSimple(selected, normalizeContext({ messages: [] }), { onPayload: () => null })
			.result();
		expect(f.payload()).toBeNull();
		f.setEnvelope(true);
		await wrapped.streamSimple(selected, normalizeContext({ messages: [] })).result();
		expect(f.payload()).toEqual({ model: "wire-level" });
	});

	test("preserves callbacks, result-only streams, and synchronous failures", async () => {
		const f = fixture();
		const provider: Provider<"anthropic-messages"> = {
			...f.provider,
			stream() {
				throw new Error("synchronous failure");
			},
			streamSimple(model, _context, options) {
				void options?.onResponse?.({ status: 200, headers: {} }, model);
				void options?.onProviderStreamEvent?.({ chunk: true }, model);
				const stream = createAssistantMessageEventStream();
				stream.end({
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: 0,
				});
				return stream;
			},
		};
		const wrapped = wrapNativeAliases(provider, () => [alias]);
		const selected = wrapped.getModels().find((model) => model.id === alias.id);
		if (!selected) throw new Error("alias missing");
		const callbacks: string[] = [];
		const result = await wrapped
			.streamSimple(selected, normalizeContext({ messages: [] }), {
				onResponse: (_, model) => {
					callbacks.push(`response:${model.id}`);
				},
				onProviderStreamEvent: (_, model) => {
					callbacks.push(`event:${model.id}`);
				},
			})
			.result();
		expect(result.model).toBe("short");
		expect(callbacks).toEqual(["response:short", "event:short"]);
		expect(() => wrapped.stream(selected, normalizeContext({ messages: [] }))).toThrow(
			"synchronous failure",
		);
	});

	test("applies the all-model policy before creating aliases", () => {
		const f = fixture();
		const provider: Provider<"anthropic-messages"> = {
			...f.provider,
			filterAllModels: (models) =>
				models
					.filter((model) => model.id !== "hidden")
					.map((model) => ({
						...model,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					})),
		};
		const wrapped = wrapNativeAliases(provider, () => [
			alias,
			{ ...alias, id: "hidden-alias", source: "hidden" },
		]);
		const available = wrapped.filterAllModels?.(wrapped.getAllModels?.() ?? [], undefined) ?? [];
		expect(available.map((model) => model.id)).not.toContain("hidden-alias");
		expect(available.find((model) => model.id === "short")?.cost.input).toBe(0);
		expect(available.map((model) => model.id)).toContain("image");
	});

	test("reads current settings and follows the original refresh", async () => {
		const f = fixture();
		let aliases: readonly ModelAlias[] = [alias];
		const reported: AliasIssue[] = [];
		const wrapped = wrapNativeAliases(
			f.provider,
			() => aliases,
			(issues) => {
				reported.push(...issues);
			},
		);
		expect(wrapped.getModels().map((model) => model.id)).toContain("short");
		await wrapped.refreshModels?.({
			allowNetwork: false,
			signal: new AbortController().signal,
			publish: async (publication) => {
				publication.update?.();
				return true;
			},
		});
		expect(wrapped.getModels().map((model) => model.id)).not.toContain("short");
		expect(reported).toContainEqual({ kind: "missing-source", alias });
		aliases = [{ ...alias, source: "new" }];
		expect(wrapped.getModels().map((model) => model.id)).toContain("short");
	});
});
