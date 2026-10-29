import { describe, expect, spyOn, test } from "bun:test";
import type { Context, Model } from "@earendil-works/pi-ai";
import type { SessionProjection } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { claudeTokenCounter } from "../../../src/families/anthropic/count.ts";
import { createAnthropicFamily } from "../../../src/families/anthropic/index.ts";
import { CLAUDE_CODE_IDENTITY } from "../../../src/families/anthropic/sanitize.ts";
import { createTokenEngine, type EngineContext } from "../../../src/tokens/engine/index.ts";
import type { CounterDeps, TokenDiagnostic } from "../../../src/tokens/types.ts";

const model = { provider: "claude", id: "claude-test" };
const options = { version: async () => "2.1.311", env: {} };
const needsAuth = {
	code: "needs-auth",
	provider: "claude",
	message:
		"Claude token counting at https://api.anthropic.com/v1/messages/count_tokens needs authentication; run /login claude.",
} satisfies TokenDiagnostic;
const fullModel: Model<"anthropic-messages"> = {
	id: "claude-test",
	name: "Test",
	api: "anthropic-messages",
	provider: "claude",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
};
const hello: Context = {
	messages: [{ role: "user", content: [{ type: "text", text: "Hello." }], timestamp: 0 }],
};
const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const tokenizers = { peek: () => undefined, load: async () => undefined };
function deps(fetch: CounterDeps["fetch"], token = "sk-ant-oat-test"): CounterDeps {
	return { fetch, auth: async () => ({ token, extra: {} }), tokenizers };
}

describe("families/anthropic/count", () => {
	test("keeps identity and version, omits billing and metadata, and subtracts one shared baseline", async () => {
		const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
		const counter = claudeTokenCounter(
			model,
			deps(async (url, init) => {
				const body = JSON.parse(String(init?.body));
				sent.push({ url: String(url), headers: new Headers(init?.headers), body });
				return Response.json({ input_tokens: sent.length === 1 ? 33 : 42 });
			}),
			options,
		);
		expect(await counter.count("hello world", "prose")).toEqual({
			tokens: 10,
			source: "estimate",
		});
		expect(await counter.count("more text", "prose")).toEqual({
			tokens: 10,
			source: "estimate",
		});
		expect(sent).toHaveLength(3);
		for (const call of sent) {
			expect(call.url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
			expect(call.headers.get("anthropic-version")).toBe("2023-06-01");
			expect(call.headers.get("authorization")).toBe("Bearer sk-ant-oat-test");
			expect(call.headers.get("user-agent")).toContain("claude-cli/2.1.311");
			expect(call.headers.get("x-api-key")).toBeNull();
			expect(call.body["system"]).toEqual([{ type: "text", text: CLAUDE_CODE_IDENTITY }]);
			expect(call.body).not.toHaveProperty("metadata");
			expect(JSON.stringify(call.body)).not.toContain("x-anthropic-billing-header");
		}
		expect(sent[0]?.body["messages"]).toEqual([
			{ role: "user", content: [{ type: "text", text: "x" }] },
		]);
	});

	test("429 falls back and suppresses further requests during backoff", async () => {
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			deps(async () => {
				calls++;
				return new Response("limited", { status: 429 });
			}),
			options,
		);
		expect(await counter.count("hello world", "prose")).toEqual({ tokens: 5, source: "estimate" });
		expect(await counter.count("hello again", "prose")).toEqual({ tokens: 5, source: "estimate" });
		expect(calls).toBe(1);
	});

	test("API keys use x-api-key and tools use wire names and no-tools subtraction", async () => {
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			deps(async (url, init) => {
				calls++;
				expect(String(url)).toBe("https://proxy.example/v1/messages/count_tokens");
				const headers = new Headers(init?.headers);
				expect(headers.get("x-api-key")).toBe("test-api-key");
				expect(headers.get("authorization")).toBeNull();
				if (calls > 1)
					expect(JSON.parse(String(init?.body)).tools).toEqual([
						{ name: "Read", description: "Read a file", input_schema: { type: "object" } },
					]);
				return Response.json({ input_tokens: calls === 1 ? 33 : 150 });
			}, "test-api-key"),
			{ ...options, env: { ANTHROPIC_BASE_URL: "https://proxy.example" } },
		);
		expect(
			await counter.countTools?.([
				{ name: "read", description: "Read a file", parameters: { type: "object" } },
			]),
		).toEqual({ tokens: 117, source: "estimate" });
	});

	for (const failure of [401, 403, 500, "json", "shape", "network"] as const) {
		test(`falls back without rejecting on ${failure}`, async () => {
			const counter = claudeTokenCounter(
				model,
				deps(async () => {
					if (typeof failure === "number") return new Response("failed", { status: failure });
					if (failure === "json") return new Response("not JSON");
					if (failure === "shape") return Response.json({ input_tokens: -1 });
					throw new Error("network failure");
				}),
				options,
			);
			expect(await counter.count("abc", "json")).toEqual({ tokens: 2, source: "estimate" });
		});
	}

	test("missing credentials explain segment and tool estimates and recover immediately", async () => {
		let signedIn = false;
		let calls = 0;
		const tools = [{ name: "read", description: "Read", parameters: { type: "object" } }];
		const counter = claudeTokenCounter(
			model,
			{
				auth: async () => (signedIn ? { token: "test-api-key", extra: {} } : undefined),
				fetch: async () => {
					calls++;
					return Response.json({ input_tokens: calls === 1 ? 36 : calls === 2 ? 33 : 42 });
				},
				tokenizers,
			},
			options,
		);
		const estimatedTools = Math.ceil(JSON.stringify(tools).length / 2.7);
		expect(await counter.countContext?.({ model: fullModel, context: hello })).toBeUndefined();
		expect(await counter.count("hello world", "prose")).toEqual({
			tokens: 5,
			source: "estimate",
			diagnostics: [needsAuth],
		});
		expect(await counter.countTools?.(tools)).toEqual({
			tokens: estimatedTools,
			source: "estimate",
			diagnostics: [needsAuth],
		});
		expect(calls).toBe(0);

		signedIn = true;
		expect(await counter.countContext?.({ model: fullModel, context: hello })).toEqual({
			tokens: 36,
			source: "count-endpoint",
		});
		expect(await counter.count("hello world", "prose")).toEqual({ tokens: 10, source: "estimate" });
		expect(await counter.countTools?.(tools)).toEqual({ tokens: 9, source: "estimate" });
		expect(calls).toBe(4);

		signedIn = false;
		expect(await counter.count("hello world", "prose")).toEqual({
			tokens: 5,
			source: "estimate",
			diagnostics: [needsAuth],
		});
		expect(await counter.countTools?.(tools)).toEqual({
			tokens: estimatedTools,
			source: "estimate",
			diagnostics: [needsAuth],
		});
		expect(calls).toBe(4);
		signedIn = true;
		expect(await counter.count("hello world", "prose")).toEqual({ tokens: 10, source: "estimate" });
		expect(await counter.countTools?.(tools)).toEqual({ tokens: 9, source: "estimate" });
		expect(calls).toBe(6);
	});

	test("engine preserves one missing-auth reason across fallback segments and recovers", async () => {
		let signedIn = false;
		let calls = 0;
		const tools = [{ name: "read", description: "Read", parameters: { type: "object" } }];
		const engine = createTokenEngine({
			families: [createAnthropicFamily({}, async () => undefined)],
			deps: {
				auth: async () => (signedIn ? { token: "test-api-key", extra: {} } : undefined),
				fetch: async () => {
					calls++;
					return Response.json({ input_tokens: 36 });
				},
				tokenizers,
			},
			tools: () => tools,
		});
		const projection: SessionProjection = {
			entries: [],
			messages: [{ role: "user", content: "hello", timestamp: 0 }],
			thinkingLevel: "off",
			model: null,
		};
		const ctx: EngineContext = {
			model: fullModel,
			modelRegistry: { find: () => fullModel },
			sessionManager: { buildSessionProjection: () => projection, getBranch: () => [] },
			getSystemPrompt: () => "system",
			getContextUsage: () => undefined,
		};
		expect((await engine.context(ctx))?.tokens).toEqual({
			tokens: 3 + 2 + Math.ceil(JSON.stringify(tools).length / 2.7),
			source: "estimate",
			diagnostics: [needsAuth],
		});
		const parts = await engine.breakdown(ctx);
		expect(parts?.map((part) => [part.kind, part.count.diagnostics])).toEqual([
			["system", [needsAuth]],
			["tools", [needsAuth]],
			["user", [needsAuth]],
		]);
		expect(calls).toBe(0);
		signedIn = true;
		expect((await engine.context(ctx))?.tokens).toEqual({
			tokens: 36,
			source: "count-endpoint",
		});
		expect(calls).toBe(1);
		expect((await engine.breakdown(ctx))?.map((part) => [part.kind, part.count])).toEqual([
			["system", { tokens: 1, source: "estimate" }],
			["tools", { tokens: 0, source: "estimate" }],
			["user", { tokens: 1, source: "estimate" }],
		]);
		expect(calls).toBe(5);
	});

	test("engine resolves authentication before reusing shaped native request totals", async () => {
		let mode: "oauth" | "api" | "missing" = "oauth";
		const systems: number[] = [];
		const services: CounterDeps = {
			auth: async () =>
				mode === "missing"
					? undefined
					: { token: "test-credential", extra: { type: mode === "oauth" ? "oauth" : "api_key" } },
			fetch: async (_url, init) => {
				const body: unknown = JSON.parse(String(init?.body));
				if (typeof body !== "object" || body === null || !("messages" in body))
					throw new Error("expected native request");
				const system = "system" in body && Array.isArray(body.system) ? body.system.length : 0;
				systems.push(system);
				return Response.json({ input_tokens: system });
			},
			tokenizers,
		};
		const counter = claudeTokenCounter(model, services, options);
		const engine = createTokenEngine({
			families: [{ id: "anthropic", label: "Anthropic", providers: [], tokens: () => counter }],
			deps: services,
			tools: () => [],
		});
		const projection: SessionProjection = {
			entries: [],
			messages: [{ role: "user", content: "Hello.", timestamp: 0 }],
			thinkingLevel: "off",
			model: null,
		};
		const ctx: EngineContext = {
			model: fullModel,
			modelRegistry: { find: () => fullModel },
			sessionManager: { buildSessionProjection: () => projection, getBranch: () => [] },
			getSystemPrompt: () => "",
			getContextUsage: () => undefined,
		};
		expect((await engine.context(ctx))?.tokens).toEqual({ tokens: 1, source: "count-endpoint" });
		expect((await engine.context(ctx))?.tokens).toEqual({ tokens: 1, source: "count-endpoint" });
		expect(systems).toEqual([1]);
		mode = "api";
		expect((await engine.context(ctx))?.tokens).toEqual({ tokens: 0, source: "count-endpoint" });
		expect((await engine.context(ctx))?.tokens).toEqual({ tokens: 0, source: "count-endpoint" });
		expect(systems).toEqual([1, 0]);
		mode = "missing";
		expect((await engine.context(ctx))?.tokens).toEqual({
			tokens: 3,
			source: "estimate",
			diagnostics: [needsAuth],
		});
		expect(systems).toEqual([1, 0]);
		mode = "api";
		expect((await engine.context(ctx))?.tokens).toEqual({ tokens: 0, source: "count-endpoint" });
		expect(systems).toEqual([1, 0]);
	});

	test("cancelled baseline waiters do not receive or poison missing-auth guidance", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let signedIn = false;
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			{
				auth: async () => {
					if (signedIn) return { token: "test-api-key", extra: {} };
					started.resolve();
					await release.promise;
					return undefined;
				},
				fetch: async () => {
					calls++;
					return Response.json({ input_tokens: 33 });
				},
				tokenizers,
			},
			options,
		);
		const abort = new AbortController();
		const first = counter.count("x", "prose", abort.signal);
		await started.promise;
		const second = counter.count("x", "prose");
		abort.abort();
		try {
			expect(await first).toEqual({ tokens: 1, source: "estimate" });
			release.resolve();
			expect(await second).toEqual({ tokens: 1, source: "estimate", diagnostics: [needsAuth] });
			expect(calls).toBe(0);
			signedIn = true;
			expect(await counter.count("x", "prose")).toEqual({ tokens: 1, source: "estimate" });
			expect(calls).toBe(2);
		} finally {
			release.resolve();
			await second;
		}
	});

	test("a cancelled auth lookup after a cached baseline does not invent guidance", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let authCalls = 0;
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			{
				auth: async () => {
					authCalls++;
					if (authCalls === 3) {
						started.resolve();
						await release.promise;
						return undefined;
					}
					return { token: "test-api-key", extra: {} };
				},
				fetch: async () => {
					calls++;
					return Response.json({ input_tokens: 33 });
				},
				tokenizers,
			},
			options,
		);
		expect(await counter.count("x", "prose")).toEqual({ tokens: 1, source: "estimate" });
		const abort = new AbortController();
		const cancelled = counter.count("x", "prose", abort.signal);
		await started.promise;
		abort.abort();
		try {
			expect(await cancelled).toEqual({ tokens: 1, source: "estimate" });
			release.resolve();
			expect(await counter.count("x", "prose")).toEqual({ tokens: 1, source: "estimate" });
			expect(calls).toBe(3);
		} finally {
			release.resolve();
			await cancelled;
		}
	});

	test("late missing authentication cannot contaminate a concurrent successful count", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let authCalls = 0;
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			{
				auth: async () => {
					authCalls++;
					if (authCalls === 1) {
						started.resolve();
						await release.promise;
						return undefined;
					}
					return { token: "test-api-key", extra: {} };
				},
				fetch: async () => {
					calls++;
					return Response.json({ input_tokens: 36 });
				},
				tokenizers,
			},
			options,
		);
		const missing = counter.count("x", "prose");
		await started.promise;
		try {
			expect(await counter.countContext?.({ model: fullModel, context: hello })).toEqual({
				tokens: 36,
				source: "count-endpoint",
			});
			release.resolve();
			expect(await missing).toEqual({ tokens: 1, source: "estimate", diagnostics: [needsAuth] });
			expect(await counter.count("x", "prose")).toEqual({ tokens: 1, source: "estimate" });
			expect(calls).toBe(3);
		} finally {
			release.resolve();
			await missing;
		}
	});

	test("queues calls beyond two in flight and shares the baseline", async () => {
		let active = 0;
		let peak = 0;
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			deps(async () => {
				calls++;
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active--;
				return Response.json({ input_tokens: 33 });
			}),
			options,
		);
		await Promise.all(Array.from({ length: 8 }, () => counter.count("x", "prose")));
		expect(peak).toBe(2);
		expect(calls).toBe(9);
	});

	test("counts complete SDK-shaped requests with the captured 36 and 41 token responses", async () => {
		const generation = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async () => {
					throw new Error("generation network is forbidden");
				},
				{
					preconnect: () => {
						throw new Error("generation network is forbidden");
					},
				},
			),
		);
		try {
			const reference = [
				{
					request: `{"model":"claude-haiku-5-5","system":[{"type":"text","text":"You are Claude Code, Anthropic's official CLI for Claude."}],"messages":[{"role":"user","content":[{"type":"text","text":"Hello."}]}]}`,
					response: '{"input_tokens":36}',
				},
				{
					request: `{"model":"claude-haiku-5-5","system":[{"type":"text","text":"You are Claude Code, Anthropic's official CLI for Claude."},{"type":"text","text":"Be concise."}],"messages":[{"role":"user","content":[{"type":"text","text":"Hello."}]}]}`,
					response: '{"input_tokens":41}',
				},
			];
			const capturedModel = { ...fullModel, id: "claude-haiku-5-5" };
			const sent: Record<string, unknown>[] = [];
			const counter = claudeTokenCounter(
				{ ...model, id: capturedModel.id },
				deps(async (url, init) => {
					expect(String(url)).toBe("https://api.anthropic.com/v1/messages/count_tokens");
					expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-ant-oat-test");
					sent.push(JSON.parse(String(init?.body)));
					const fixture = reference[sent.length - 1];
					if (!fixture) throw new Error("unexpected count request");
					return new Response(fixture.response, {
						headers: { "content-type": "application/json" },
					});
				}),
				options,
			);
			expect(await counter.countContext?.({ model: capturedModel, context: hello })).toEqual({
				tokens: 36,
				source: "count-endpoint",
			});
			expect(
				await counter.countContext?.({
					model: capturedModel,
					context: { ...hello, systemPrompt: "Be concise." },
				}),
			).toEqual({ tokens: 41, source: "count-endpoint" });
			expect(sent).toHaveLength(2);
			for (const [index, body] of sent.entries()) {
				const fixture = reference[index];
				if (!fixture) throw new Error("unexpected count request");
				const withoutCacheControl = JSON.parse(
					JSON.stringify(body, (key, value) => (key === "cache_control" ? undefined : value)),
				);
				expect(withoutCacheControl).toEqual(JSON.parse(fixture.request));
				expect(body["model"]).toBe(capturedModel.id);
				expect(body["messages"]).toEqual([
					{
						role: "user",
						content: [{ type: "text", text: "Hello.", cache_control: { type: "ephemeral" } }],
					},
				]);
				expect(body).not.toHaveProperty("max_tokens");
				expect(body).not.toHaveProperty("stream");
				expect(body).not.toHaveProperty("metadata");
				expect(JSON.stringify(body)).not.toContain("x-anthropic-billing-header");
			}
			expect(sent[0]?.["system"]).toEqual([{ type: "text", text: CLAUDE_CODE_IDENTITY }]);
			expect(sent[1]?.["system"]).toEqual([
				{ type: "text", text: CLAUDE_CODE_IDENTITY, cache_control: { type: "ephemeral" } },
				{ type: "text", text: "Be concise.", cache_control: { type: "ephemeral" } },
			]);
			expect(generation).not.toHaveBeenCalled();
		} finally {
			generation.mockRestore();
		}
	});

	test("full-request memo tracks effective rewrites, endpoints and protocol headers", async () => {
		let rules = [{ match: "secret", replacement: "first" }];
		const env: Record<string, string> = { ANTHROPIC_BASE_URL: "https://first.example" };
		const sent: { url: string; body: string; headers: Headers }[] = [];
		const counter = claudeTokenCounter(
			model,
			deps(async (url, init) => {
				sent.push({
					url: String(url),
					body: String(init?.body),
					headers: new Headers(init?.headers),
				});
				return Response.json({ input_tokens: sent.length });
			}),
			{ ...options, env, rules: () => rules },
		);
		const context: Context = { ...hello, systemPrompt: "secret" };
		let requestModel = {
			...fullModel,
			baseUrl: "https://upstream.example/first",
			headers: { "anthropic-version": "2023-06-01", "anthropic-beta": "example-beta" },
		};
		const count = () => counter.countContext?.({ model: requestModel, context });
		expect(await count()).toEqual({ tokens: 1, source: "count-endpoint" });
		expect(await count()).toEqual({ tokens: 1, source: "count-endpoint" });
		rules = [{ match: "secret", replacement: "second" }];
		expect(await count()).toEqual({ tokens: 2, source: "count-endpoint" });
		env["ANTHROPIC_BASE_URL"] = "https://second.example";
		expect(await count()).toEqual({ tokens: 3, source: "count-endpoint" });
		requestModel = { ...requestModel, baseUrl: "https://upstream.example/second" };
		expect(await count()).toEqual({ tokens: 4, source: "count-endpoint" });
		requestModel = {
			...requestModel,
			headers: { "anthropic-version": "2023-06-01", "anthropic-beta": "another-beta" },
		};
		expect(await count()).toEqual({ tokens: 5, source: "count-endpoint" });
		requestModel = {
			...requestModel,
			headers: { "anthropic-version": "2024-01-01", "anthropic-beta": "another-beta" },
		};
		expect(await count()).toEqual({ tokens: 6, source: "count-endpoint" });
		requestModel = { ...requestModel, name: "Other display name" };
		expect(await count()).toEqual({ tokens: 6, source: "count-endpoint" });
		expect(sent).toHaveLength(6);
		expect(sent[0]?.body).toContain('"text":"first"');
		expect(sent[1]?.body).toContain('"text":"second"');
		expect(sent.map(({ url }) => url)).toEqual([
			"https://first.example/first/v1/messages/count_tokens",
			"https://first.example/first/v1/messages/count_tokens",
			"https://second.example/first/v1/messages/count_tokens",
			"https://second.example/second/v1/messages/count_tokens",
			"https://second.example/second/v1/messages/count_tokens",
			"https://second.example/second/v1/messages/count_tokens",
		]);
		expect(sent[4]?.headers.get("anthropic-beta")).toContain("another-beta");
		expect(sent[5]?.headers.get("anthropic-version")).toBe("2024-01-01");
	});

	test("engine retains distinct full-request counts for different models", async () => {
		const otherModel = { ...fullModel, id: "other" };
		const models = [fullModel, otherModel];
		const sent: string[] = [];
		const services = deps(async (_url, init) => {
			const body: unknown = JSON.parse(String(init?.body));
			if (typeof body !== "object" || body === null || !("model" in body))
				throw new Error("expected native request model");
			sent.push(String(body.model));
			return Response.json({ input_tokens: body.model === otherModel.id ? 2 : 1 });
		}, "test-api-key");
		const engine = createTokenEngine({
			families: [createAnthropicFamily({}, async () => undefined)],
			deps: services,
			tools: () => [],
		});
		const projection: SessionProjection = {
			entries: [],
			messages: [{ role: "user", content: "Hello.", timestamp: 0 }],
			thinkingLevel: "off",
			model: null,
		};
		const ctx: EngineContext = {
			model: fullModel,
			modelRegistry: {
				find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
			},
			sessionManager: { buildSessionProjection: () => projection, getBranch: () => [] },
			getSystemPrompt: () => "",
			getContextUsage: () => undefined,
		};
		expect((await engine.context(ctx))?.tokens.tokens).toBe(1);
		expect((await engine.context({ ...ctx, model: otherModel }))?.tokens.tokens).toBe(2);
		expect((await engine.context(ctx))?.tokens.tokens).toBe(1);
		expect(sent).toEqual([fullModel.id, otherModel.id]);
	});

	test("full-request memo excludes credentials and refuses unknown header identities", async () => {
		let token = "test-credential-one";
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			{
				auth: async () => ({ token, extra: { type: "api_key" } }),
				fetch: async () => Response.json({ input_tokens: ++calls }),
				tokenizers,
			},
			options,
		);
		let requestModel: Model<"anthropic-messages"> = {
			...fullModel,
			headers: { "x-api-key": "test-override-one" },
		};
		const count = (context = hello) => counter.countContext?.({ model: requestModel, context });
		expect(await count()).toEqual({ tokens: 1, source: "count-endpoint" });
		token = "test-credential-two";
		requestModel = { ...requestModel, headers: { "x-api-key": "test-override-two" } };
		expect(await count()).toEqual({ tokens: 1, source: "count-endpoint" });
		requestModel = {
			...requestModel,
			headers: { "x-api-key": "test-override-two", "x-custom-secret": "custom" },
		};
		expect(await count()).toEqual({ tokens: 2, source: "count-endpoint" });
		expect(await count()).toEqual({ tokens: 3, source: "count-endpoint" });
		requestModel = { ...requestModel, headers: { "x-api-key": "test-override-two" } };
		const sensitive: Context = { messages: [{ role: "user", content: token, timestamp: 0 }] };
		expect(await count(sensitive)).toEqual({ tokens: 4, source: "count-endpoint" });
		expect(await count(sensitive)).toEqual({ tokens: 5, source: "count-endpoint" });
		requestModel = { ...requestModel, headers: { "anthropic-beta": token } };
		expect(await count()).toEqual({ tokens: 6, source: "count-endpoint" });
		expect(await count()).toEqual({ tokens: 7, source: "count-endpoint" });
		requestModel = { ...requestModel, baseUrl: `https://proxy.example/${token}`, headers: {} };
		expect(await count()).toEqual({ tokens: 8, source: "count-endpoint" });
		expect(await count()).toEqual({ tokens: 9, source: "count-endpoint" });
		requestModel = {
			...requestModel,
			baseUrl: fullModel.baseUrl,
			headers: { authorization: "Bearer test-other-credential" },
		};
		const echoed: Context = {
			messages: [{ role: "user", content: "test-other-credential", timestamp: 0 }],
		};
		expect(await count(echoed)).toEqual({ tokens: 10, source: "count-endpoint" });
		expect(await count(echoed)).toEqual({ tokens: 11, source: "count-endpoint" });
	});

	test("full-request memo evicts the least recently used successful request", async () => {
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			deps(async () => Response.json({ input_tokens: ++calls })),
			options,
		);
		const count = (index: number) =>
			counter.countContext?.({
				model: fullModel,
				context: { messages: [{ role: "user", content: `message-${index}`, timestamp: 0 }] },
			});
		for (let i = 0; i < 256; i++) await count(i);
		expect(await count(0)).toEqual({ tokens: 1, source: "count-endpoint" });
		await count(256);
		expect(await count(1)).toEqual({ tokens: 258, source: "count-endpoint" });
		expect(calls).toBe(258);
	});

	test("preserves SDK tool calls, results and ordered native system and tool changes", async () => {
		const read = {
			name: "read_file",
			description: "Read",
			parameters: Type.Object({ path: Type.String() }),
			constrainedSampling: { type: "json_schema", strict: "require" } as const,
		};
		const write = { name: "write_file", description: "Write", parameters: Type.Object({}) };
		const context: Context = {
			messages: [
				{
					role: "system",
					content: "Start",
					sections: { focus: "original-section" },
					toolsAdded: [read],
					timestamp: 0,
				},
				{ role: "user", content: "Use a tool", timestamp: 1 },
				{
					role: "assistant",
					content: [
						{ type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "x" } },
					],
					api: "anthropic-messages",
					provider: "claude",
					model: "claude-test",
					usage,
					stopReason: "toolUse",
					timestamp: 2,
				},
				{
					role: "toolResult",
					toolCallId: "call_1",
					toolName: "read_file",
					content: [{ type: "text", text: "contents" }],
					isError: false,
					timestamp: 3,
				},
				{
					role: "system",
					content: "Updated",
					sections: { focus: null, phase: "replacement-section" },
					toolsRemoved: [{ name: "read_file" }],
					toolsAdded: [write],
					timestamp: 4,
				},
				{ role: "user", content: "Continue", timestamp: 5 },
			],
		};
		let body: Record<string, unknown> = {};
		const counter = claudeTokenCounter(
			model,
			deps(async (_url, init) => {
				body = JSON.parse(String(init?.body));
				return Response.json({ input_tokens: 220 });
			}),
			options,
		);
		expect(
			await counter.countContext?.({
				model: {
					...fullModel,
					compat: {
						supportsMidConvoSystemMessages: true,
						supportsMidConvoToolChanges: true,
						supportsStrictTools: true,
					},
				},
				context,
			}),
		).toEqual({ tokens: 220, source: "count-endpoint" });
		const encoded = JSON.stringify(body);
		expect(encoded).toContain('"name":"ReadFile"');
		expect(encoded).toContain('"name":"WriteFile"');
		expect(encoded).toContain('"strict":true');
		expect(encoded).toContain('"type":"tool_use","id":"call_1","name":"ReadFile"');
		expect(encoded).toContain('"type":"tool_result","tool_use_id":"call_1"');
		expect(encoded).toContain('"type":"tool_removal"');
		expect(encoded).toContain('"type":"tool_addition"');
		expect(encoded.indexOf('"role":"assistant"')).toBeLessThan(
			encoded.indexOf('"type":"tool_result"'),
		);
		expect(encoded.indexOf('"type":"tool_result"')).toBeLessThan(
			encoded.indexOf('"type":"tool_removal"'),
		);
		expect(encoded).toContain("original-section");
		expect(encoded).toContain("replacement-section");
		expect(await counter.countContext?.({ model: fullModel, context })).toEqual({
			tokens: 220,
			source: "count-endpoint",
		});
		expect(JSON.stringify(body["system"])).not.toContain("original-section");
		expect(JSON.stringify(body["system"])).toContain("replacement-section");
		expect(JSON.stringify(body["tools"])).toContain('"name":"WriteFile"');
		expect(JSON.stringify(body["messages"])).not.toContain('"type":"tool_addition"');
	});

	test("API-key full counts keep the SDK's unshaped identity and tool names", async () => {
		let body: Record<string, unknown> = {};
		const counter = claudeTokenCounter(
			model,
			deps(async (url, init) => {
				body = JSON.parse(String(init?.body));
				expect(String(url)).toBe("https://proxy.example/anthropic/v1/messages/count_tokens");
				expect(new Headers(init?.headers).get("x-api-key")).toBe("test-api-key");
				expect(new Headers(init?.headers).get("anthropic-beta")).toBe("example-beta");
				return Response.json({ input_tokens: 50 });
			}, "test-api-key"),
			{ ...options, env: { ANTHROPIC_BASE_URL: "https://override.example" } },
		);
		expect(
			await counter.countContext?.({
				model: {
					...fullModel,
					baseUrl: "https://proxy.example/anthropic",
					headers: { "anthropic-beta": "example-beta" },
				},
				context: {
					...hello,
					tools: [{ name: "read_file", description: "Read", parameters: Type.Object({}) }],
				},
			}),
		).toEqual({ tokens: 50, source: "count-endpoint" });
		expect(body).not.toHaveProperty("system");
		expect(JSON.stringify(body)).toContain('"name":"read_file"');
	});

	test("keeps supported SDK thinking and output configuration in the count recipe", async () => {
		let body: Record<string, unknown> = {};
		let betas = "";
		const counter = claudeTokenCounter(
			model,
			deps(async (_url, init) => {
				body = JSON.parse(String(init?.body));
				betas = new Headers(init?.headers).get("anthropic-beta") ?? "";
				return Response.json({ input_tokens: 45 });
			}),
			options,
		);
		expect(
			await counter.countContext?.({
				model: {
					...fullModel,
					reasoning: true,
					thinkingLevelMap: { off: null },
					compat: { supportsMidConvoEffort: true, supportsMidConvoSystemMessages: true },
				},
				context: hello,
			}),
		).toEqual({ tokens: 45, source: "count-endpoint" });
		expect(body["thinking"]).toEqual({
			type: "adaptive",
			display: "summarized",
			block_binding: { prefix_mismatch_behavior: "drop_block" },
		});
		expect(body["output_config"]).toEqual({ effort: "high" });
		expect(betas).toContain("mid-conversation-output-config-2026-07-01");
	});

	test("unsupported signatures, application roles and mismatched models fall back without requests", async () => {
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			deps(async () => {
				calls++;
				return Response.json({ input_tokens: 1 });
			}),
			options,
		);
		const signed: Context = {
			messages: [
				{
					role: "assistant",
					content: [{ type: "thinking", thinking: "secret", thinkingSignature: "opaque" }],
					api: "anthropic-messages",
					provider: "claude",
					model: "claude-test",
					usage,
					stopReason: "stop",
					timestamp: 0,
				},
			],
		};
		const unsupported: Context = JSON.parse(
			'{"messages":[{"role":"custom","content":"do not drop"}]}',
		);
		expect(await counter.countContext?.({ model: fullModel, context: signed })).toBeUndefined();
		expect(
			await counter.countContext?.({ model: fullModel, context: unsupported }),
		).toBeUndefined();
		expect(
			await counter.countContext?.({ model: { ...fullModel, id: "other" }, context: hello }),
		).toBeUndefined();
		expect(
			await counter.countContext?.({
				model: { ...fullModel, input: ["text"] },
				context: {
					messages: [
						{
							role: "user",
							content: [{ type: "image", data: "Zg==", mimeType: "image/png" }],
							timestamp: 0,
						},
					],
				},
			}),
		).toBeUndefined();
		expect(calls).toBe(0);
		expect(await counter.count("x", "prose")).toEqual({ tokens: 1, source: "estimate" });
		expect(calls).toBe(2);
	});

	test("full-count failures back off and missing credentials make no requests", async () => {
		let calls = 0;
		let now = Date.now();
		const clock = spyOn(Date, "now").mockImplementation(() => now);
		try {
			const counter = claudeTokenCounter(
				model,
				deps(async () => {
					calls++;
					return calls === 1
						? new Response("limited", { status: 429 })
						: Response.json({ input_tokens: 36 });
				}),
				options,
			);
			expect(await counter.countContext?.({ model: fullModel, context: hello })).toBeUndefined();
			expect(await counter.countContext?.({ model: fullModel, context: hello })).toBeUndefined();
			expect(calls).toBe(1);
			now += 60_001;
			expect(await counter.countContext?.({ model: fullModel, context: hello })).toEqual({
				tokens: 36,
				source: "count-endpoint",
			});
			expect(calls).toBe(2);
		} finally {
			clock.mockRestore();
		}
		let signedIn = false;
		let recoveryCalls = 0;
		const recovering = claudeTokenCounter(
			model,
			{
				...deps(async () => {
					recoveryCalls++;
					return Response.json({ input_tokens: 36 });
				}),
				auth: async () => (signedIn ? { token: "sk-ant-oat-test", extra: {} } : undefined),
			},
			options,
		);
		expect(await recovering.countContext?.({ model: fullModel, context: hello })).toBeUndefined();
		expect(recoveryCalls).toBe(0);
		signedIn = true;
		expect(await recovering.countContext?.({ model: fullModel, context: hello })).toEqual({
			tokens: 36,
			source: "count-endpoint",
		});
		expect(recoveryCalls).toBe(1);
	});

	test("does not invent messages for an empty or whitespace-only SDK request", async () => {
		let body: Record<string, unknown> = {};
		const counter = claudeTokenCounter(
			model,
			deps(async (_url, init) => {
				body = JSON.parse(String(init?.body));
				return new Response("empty messages rejected", { status: 400 });
			}),
			options,
		);
		const context: Context = {
			systemPrompt: "Only system",
			tools: [{ name: "read_file", description: "Read", parameters: Type.Object({}) }],
			messages: [{ role: "user", content: "  ", timestamp: 0 }],
		};
		expect(await counter.countContext?.({ model: fullModel, context })).toBeUndefined();
		expect(body["messages"]).toEqual([]);
		expect(JSON.stringify(body["system"])).toContain("Only system");
		expect(JSON.stringify(body["tools"])).toContain('"name":"ReadFile"');
	});

	test("snapshots rules and input before awaiting authentication", async () => {
		const auth = Promise.withResolvers<void>();
		let rules = [{ match: "secret", replacement: "first" }];
		const sent: string[] = [];
		const counter = claudeTokenCounter(
			model,
			{
				...deps(async (_url, init) => {
					sent.push(String(init?.body));
					return Response.json({ input_tokens: 41 });
				}),
				auth: async () => {
					await auth.promise;
					return { token: "sk-ant-oat-test", extra: {} };
				},
			},
			{ ...options, rules: () => rules },
		);
		const context: Context = { ...hello, systemPrompt: "secret" };
		const first = counter.countContext?.({ model: fullModel, context });
		rules = [{ match: "secret", replacement: "second" }];
		context.systemPrompt = "changed";
		auth.resolve();
		expect(await first).toEqual({ tokens: 41, source: "count-endpoint" });
		expect(sent[0]).toContain('"text":"first"');
		expect(sent[0]).not.toContain("changed");
		context.systemPrompt = "secret";
		expect(await counter.countContext?.({ model: fullModel, context })).toEqual({
			tokens: 41,
			source: "count-endpoint",
		});
		expect(sent[1]).toContain('"text":"second"');
	});

	test("cancellation does not poison another full count or cache a late result", async () => {
		const started = Promise.withResolvers<void>();
		const late = Promise.withResolvers<Response>();
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			deps(async () => {
				calls++;
				if (calls === 1) {
					started.resolve();
					return late.promise;
				}
				return Response.json({ input_tokens: 36 });
			}),
			options,
		);
		const abort = new AbortController();
		const first = counter.countContext?.({ model: fullModel, context: hello }, abort.signal);
		await started.promise;
		try {
			const second = counter.countContext?.({ model: fullModel, context: hello });
			abort.abort();
			expect(
				await Promise.race([
					first,
					new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
				]),
			).toBeUndefined();
			expect(await second).toEqual({ tokens: 36, source: "count-endpoint" });
			late.resolve(Response.json({ input_tokens: 999 }));
			expect(await counter.countContext?.({ model: fullModel, context: hello })).toEqual({
				tokens: 36,
				source: "count-endpoint",
			});
			expect(calls).toBe(2);
		} finally {
			late.resolve(Response.json({ input_tokens: 999 }));
			await first;
		}
	});

	test("a cancelled segment caller does not cancel the shared baseline", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			deps(async () => {
				calls++;
				if (calls === 1) {
					started.resolve();
					await release.promise;
				}
				return Response.json({ input_tokens: 33 });
			}),
			options,
		);
		const abort = new AbortController();
		const first = counter.count("x", "prose", abort.signal);
		await started.promise;
		const second = counter.count("x", "prose");
		abort.abort();
		try {
			expect((await first).source).toBe("estimate");
			release.resolve();
			expect(await second).toEqual({ tokens: 1, source: "estimate" });
			expect(calls).toBe(2);
		} finally {
			release.resolve();
			await second;
		}
	});

	test("queued cancellation settles independently of active requests", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let calls = 0;
		const counter = claudeTokenCounter(
			model,
			deps(async () => {
				calls++;
				if (calls === 2) started.resolve();
				await release.promise;
				return Response.json({ input_tokens: 36 });
			}),
			options,
		);
		expect(typeof counter.countContext).toBe("function");
		const first = counter.countContext?.({ model: fullModel, context: hello });
		const second = counter.countContext?.({ model: fullModel, context: hello });
		await started.promise;
		const abort = new AbortController();
		const third = counter.countContext?.({ model: fullModel, context: hello }, abort.signal);
		abort.abort();
		try {
			expect(
				await Promise.race([
					third,
					new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
				]),
			).toBeUndefined();
			expect(calls).toBe(2);
		} finally {
			release.resolve();
			await Promise.all([first, second, third]);
		}
	});

	test("family caches only claude model counters without fetching", () => {
		const family = createAnthropicFamily({}, async () => undefined);
		const services = deps(async () => {
			throw new Error("unexpected fetch");
		});
		expect(family.tokens?.(model, services)).toBe(family.tokens?.(model, services));
		expect(family.tokens?.({ ...model, provider: "antigravity" }, services)).toBeUndefined();
	});
	test("rewrites system text the way the provider sends it, including user rules", () => {
		const counter = claudeTokenCounter(model, deps(fetch), {
			...options,
			rules: () => [{ match: "secret", replacement: "public" }],
		});
		const prompt = "Keep this secret.\n\nRead the docs at earendil-works/pi first.\n\nTail.";
		expect(counter.systemText?.(prompt)).toBe("Keep this public.\n\nTail.");
	});
});
