import { expect, test } from "bun:test";
import type { SessionEntry, SessionProjection } from "@earendil-works/pi-coding-agent";
import { createAnthropicFamily } from "../../src/families/anthropic/index.ts";
import type { ModelAlias } from "../../src/models/aliases/index.ts";
import { AliasCatalog } from "../../src/models/aliases/runtime.ts";
import type { EngineContext } from "../../src/tokens/engine/index.ts";
import { createTokenEngine } from "../../src/tokens/engine/index.ts";
import type {
	CounterDeps,
	TokenCounter,
	TokenModel,
	TokenSource,
	ToolSchema,
} from "../../src/tokens/types.ts";

type Message = SessionProjection["messages"][number];
type SystemTool = NonNullable<Extract<Message, { role: "system" }>["toolsAdded"]>[number];
const deps: CounterDeps = {
	auth: async () => undefined,
	fetch: async () => new Response(),
	tokenizers: { peek: () => undefined, load: async () => undefined },
};

function assistant(stopReason: "stop" | "aborted" | "error" = "stop", totalTokens = 100): Message {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "fake",
		model: "m",
		stopReason,
		timestamp: 0,
		usage: {
			input: 60,
			output: 10,
			cacheRead: 20,
			cacheWrite: 10,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
function session(messages: Message[]) {
	const branch: SessionEntry[] = [];
	const projection: SessionProjection = {
		entries: [],
		messages,
		thinkingLevel: "off",
		model: null,
	};
	function rebuild() {
		projection.entries = messages.map((message, i) => {
			const sourceEntry: SessionEntry = {
				type: "message",
				id: `m${i}`,
				parentId: null,
				timestamp: "",
				message,
			};
			return { sourceEntry, messages: [message] };
		});
		branch.splice(0, branch.length, ...projection.entries.map((entry) => entry.sourceEntry));
	}
	rebuild();
	const ctx: EngineContext = {
		model: { provider: "fake", id: "m", contextWindow: 1000 },
		sessionManager: { buildSessionProjection: () => projection, getBranch: () => branch },
		getSystemPrompt: () => "system",
		getContextUsage: () => ({ tokens: 77 }),
	};
	return { ctx, messages, branch, rebuild };
}
function setup(source: TokenSource = "tokenizer", tools: readonly ToolSchema[] = []) {
	const calls: string[] = [];
	const counter: TokenCounter = {
		id: "fake",
		anchorSource: "provider",
		count: async (text, kind) => {
			calls.push(`${kind}:${text}`);
			return { tokens: text.length, source };
		},
	};
	const engine = createTokenEngine({
		families: [{ id: "fake", label: "Fake", providers: [], tokens: () => counter }],
		deps,
		tools: () => tools,
		now: () => 42,
	});
	return { engine, calls, counter };
}

test("valid usage anchors only the tail and aborted or error assistants cannot anchor", async () => {
	for (const reason of ["aborted", "error"] as const) {
		const { engine, calls } = setup();
		const { ctx } = session([
			assistant(),
			{
				role: "toolResult",
				toolCallId: "t",
				toolName: "read",
				content: [{ type: "text", text: '{"a":1}' }],
				isError: false,
				timestamp: 0,
			},
			assistant(reason, 999),
		]);
		const report = await engine.context(ctx);
		expect(report?.tokens).toEqual({ tokens: 107, source: "tokenizer" });
		expect(report?.anchor).toEqual({ tokens: 100, source: "provider" });
		expect(report?.tail).toEqual({ tokens: 7, source: "tokenizer" });
		expect(report?.tailMessages).toBe(2);
		expect(report?.percent).toBe(10.7);
		expect(report?.pi).toBe(77);
		expect(report?.computedAt).toBe(42);
		expect(calls).toEqual(['json:{"a":1}']);
	}
});

test("compaction without subsequent valid usage counts system, tools and all messages", async () => {
	const tool = { name: "read", description: "Read", parameters: {} };
	const json = JSON.stringify(tool);
	const { engine, calls } = setup("tokenizer", [tool]);
	const state = session([assistant(), { role: "user", content: "hello", timestamp: 0 }]);
	state.branch.push({
		type: "compaction",
		id: "compact",
		parentId: "m1",
		timestamp: "",
		summary: "s",
		firstKeptEntryId: "m0",
		tokensBefore: 100,
	});
	const report = await engine.context(state.ctx);
	expect(report?.anchor).toBeUndefined();
	expect(report?.tokens).toEqual({ tokens: 11 + json.length, source: "tokenizer" });
	expect(calls).toEqual(["prose:system", `json:${json}`, "prose:hello"]);
});

test("appending a message reuses exact segments but retries estimate results", async () => {
	for (const source of ["tokenizer", "estimate"] as const) {
		const { engine, calls } = setup(source);
		const state = session([{ role: "user", content: "one", timestamp: 0 }]);
		await engine.context(state.ctx);
		calls.length = 0;
		state.messages.push({ role: "user", content: "two", timestamp: 0 });
		state.rebuild();
		await engine.context(state.ctx);
		expect(calls).toEqual(
			source === "estimate" ? ["prose:system", "prose:one", "prose:two"] : ["prose:two"],
		);
	}
});

test("breakdown extracts every model-visible role, tool arguments and image estimates", async () => {
	const { engine, calls } = setup();
	const base = assistant("error");
	if (base.role !== "assistant") throw new Error("assistant fixture expected");
	const { ctx } = session([
		{ role: "system", content: "projected", sections: { extra: "section" }, timestamp: 0 },
		{
			role: "user",
			content: [{ type: "image", data: "ignored", mimeType: "image/png" }],
			timestamp: 0,
		},
		{
			...base,
			content: [
				{ type: "thinking", thinking: "thought" },
				{ type: "text", text: "answer" },
				{ type: "toolCall", id: "t", name: "read", arguments: { path: "x" } },
			],
		},
		{ role: "custom", customType: "c", content: "custom text", display: false, timestamp: 0 },
		{
			role: "bashExecution",
			command: "pwd",
			output: "/tmp",
			exitCode: 2,
			cancelled: false,
			truncated: true,
			fullOutputPath: "/out",
			timestamp: 0,
		},
		{
			role: "bashExecution",
			command: "secret",
			output: "excluded",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			excludeFromContext: true,
			timestamp: 0,
		},
		{ role: "branchSummary", summary: "branch", fromId: "x", timestamp: 0 },
		{ role: "compactionSummary", summary: "compact", tokensBefore: 1, timestamp: 0 },
	]);
	const parts = await engine.breakdown(ctx);
	expect(parts?.find((part) => part.kind === "system")).toEqual({
		kind: "system",
		count: { tokens: 16, source: "tokenizer" },
		items: 1,
	});
	expect(parts?.find((part) => part.kind === "user")?.count).toEqual({
		tokens: 1200,
		source: "estimate",
	});
	expect(parts?.find((part) => part.kind === "assistant")?.count).toEqual({
		tokens: 29,
		source: "tokenizer",
	});
	expect(parts?.find((part) => part.kind === "other")?.items).toBe(4);
	expect(calls).toContain('json:{"path":"x"}');
	expect(calls).toContain("json:read");
	expect(calls).toContain(
		"prose:Ran `pwd`\n```\n/tmp\n```\n\nCommand exited with code 2\n\n[Output truncated. Full output: /out]",
	);
	expect(calls).toContain(
		"prose:The following is a summary of a branch that this conversation came back from:\n\n<summary>\nbranch</summary>",
	);
	expect(calls).toContain(
		"prose:The conversation history before this point was compacted into the following summary:\n\n<summary>\ncompact\n</summary>",
	);
	expect(calls.some((call) => call.includes("excluded"))).toBe(false);
});

test("context edits invalidate old usage and later valid usage restores the anchor", async () => {
	const { engine } = setup();
	const state = session([assistant("stop", 0)]);
	expect((await engine.context(state.ctx))?.anchor?.tokens).toBe(100);
	state.branch.push({
		type: "context_edit",
		id: "edit",
		parentId: "m0",
		timestamp: "",
		targetId: "m0",
		replacement: null,
	});
	expect((await engine.context(state.ctx))?.anchor).toBeUndefined();
	const later = assistant("stop", 250);
	state.messages.push(later);
	const entry: SessionEntry = {
		type: "message",
		id: "later",
		parentId: "edit",
		timestamp: "",
		message: later,
	};
	state.branch.push(entry);
	state.ctx.sessionManager
		.buildSessionProjection()
		.entries.push({ sourceEntry: entry, messages: [later] });
	expect((await engine.context(state.ctx))?.anchor).toEqual({ tokens: 250, source: "provider" });
});

test("native tool counts are deduplicated and reused", async () => {
	const { counter } = setup();
	let calls = 0;
	const tools = [{ name: "read", description: "Read", parameters: {} }];
	const engine = createTokenEngine({
		families: [
			{
				id: "fake",
				label: "Fake",
				providers: [],
				tokens: () => ({
					...counter,
					countTools: async (received) => {
						expect(received).toEqual(tools);
						calls++;
						await Promise.resolve();
						return { tokens: 31, source: "count-endpoint" };
					},
				}),
			},
		],
		deps,
		tools: () => tools,
	});
	const { ctx } = session([]);
	const reports = await Promise.all([engine.context(ctx), engine.context(ctx)]);
	expect(reports[0]?.tokens.tokens).toBe(37);
	await engine.context(ctx);
	expect(calls).toBe(1);
});

test("counter failures fall back to labelled estimates and abort stops between segments", async () => {
	let calls = 0;
	const controller = new AbortController();
	const engine = createTokenEngine({
		families: [
			{
				id: "fake",
				label: "Fake",
				providers: [],
				tokens: () => ({
					id: "broken",
					anchorSource: "provider",
					count: async () => {
						calls++;
						throw new Error("counter unavailable");
					},
					countTools: async () => {
						throw new Error("tool counter unavailable");
					},
				}),
			},
		],
		deps,
		tools: () => [{ name: "t", description: "", parameters: {} }],
	});
	const { ctx } = session([{ role: "user", content: "hello", timestamp: 0 }]);
	expect((await engine.context(ctx))?.tokens.source).toBe("estimate");
	const firstCalls = calls;
	await engine.context(ctx);
	expect(calls).toBe(firstCalls * 2);
	controller.abort();
	expect(await engine.context(ctx, controller.signal)).toBeUndefined();
	expect(await engine.breakdown(ctx, controller.signal)).toBeUndefined();
	const live = new AbortController();
	const { counter } = setup();
	const abortEngine = createTokenEngine({
		families: [
			{
				id: "fake",
				label: "Fake",
				providers: [],
				tokens: () => ({
					...counter,
					count: async () => {
						live.abort();
						return { tokens: 1, source: "tokenizer" };
					},
				}),
			},
		],
		deps,
		tools: () => [],
	});
	expect(await abortEngine.context(ctx, live.signal)).toBeUndefined();
	expect(await engine.context({ ...ctx, model: undefined })).toBeUndefined();
});

test("family selection is ordered, cached per model and falls back to the default estimate", async () => {
	const { counter } = setup();
	const visits: string[] = [];
	const engine = createTokenEngine({
		families: [
			{
				id: "a",
				label: "A",
				providers: [],
				tokens: (model) => {
					visits.push(model.id);
					return undefined;
				},
			},
			{
				id: "b",
				label: "B",
				providers: [],
				tokens: (model) => (model.id === "yes" ? counter : undefined),
			},
			{
				id: "c",
				label: "C",
				providers: [],
				tokens: () => {
					throw new Error("must not reach third family for yes");
				},
			},
		],
		deps,
		tools: () => [],
	});
	expect(engine.counterFor({ provider: "p", id: "yes" })).toBe(counter);
	expect(engine.counterFor({ provider: "p", id: "yes" })).toBe(counter);
	expect(visits).toEqual(["yes"]);
	const fallback = createTokenEngine({ families: [], deps, tools: () => [] });
	expect(await fallback.counterFor({ provider: "p", id: "none" }).count("hello", "prose")).toEqual({
		tokens: 2,
		source: "estimate",
	});
});

function aliasEngine(configured: () => readonly ModelAlias[]) {
	const catalog = new AliasCatalog(configured);
	catalog.register("claude", () =>
		["physical-a", "physical-b", "existing"].map((id) => ({ provider: "claude", id })),
	);
	const sent: string[] = [];
	const counts = new Map<string, number>();
	const engine = createTokenEngine({
		families: [createAnthropicFamily({}, async () => undefined)],
		deps: {
			...deps,
			auth: async () => ({ token: "test-api-key", extra: {} }),
			fetch: async (_url, init) => {
				const body: unknown = JSON.parse(String(init?.body));
				if (
					typeof body !== "object" ||
					body === null ||
					!("model" in body) ||
					typeof body.model !== "string"
				) {
					throw new Error("expected a native count request with a model");
				}
				const model = body.model;
				sent.push(model);
				const count = (counts.get(model) ?? 0) + 1;
				counts.set(model, count);
				return Response.json({ input_tokens: count === 1 ? 33 : model === "physical-b" ? 53 : 42 });
			},
		},
		tools: () => [],
		resolveModel: (model) => catalog.resolve(model),
	});
	return { catalog, engine, sent };
}

test("native count requests carry the accepted alias source id", async () => {
	const { engine, sent } = aliasEngine(() => [
		{ provider: "claude", source: "physical-a", id: "logical" },
	]);
	const counter = engine.counterFor({ provider: "claude", id: "logical" });
	expect(await counter.count("hello", "prose")).toEqual({
		tokens: 10,
		source: "count-endpoint",
	});
	expect(sent).toEqual(["physical-a", "physical-a"]);
});

test("accepted aliases use native physical counters and follow retargeting without changing reports", async () => {
	let aliases: readonly ModelAlias[] = [
		{ provider: "claude", source: "physical-a", id: "logical" },
	];
	const { engine, sent } = aliasEngine(() => aliases);
	const { ctx } = session([{ role: "user", content: "hello", timestamp: 0 }]);
	const logical = { provider: "claude", id: "logical", contextWindow: 400 };
	const aliasContext = { ...ctx, model: logical };
	const first = engine.counterFor(logical);
	expect(first.id).toBe("count_tokens:claude:physical-a");
	expect(engine.counterFor({ provider: "claude", id: "physical-a" })).toBe(first);
	const reportA = await engine.context(aliasContext);
	expect(reportA).toMatchObject({
		provider: "claude",
		model: "logical",
		contextWindow: 400,
		percent: 5,
		tokens: { tokens: 20, source: "count-endpoint" },
	});
	expect(await engine.breakdown(aliasContext)).toEqual([
		{ kind: "system", count: { tokens: 10, source: "count-endpoint" }, items: 1 },
		{ kind: "tools", count: { tokens: 0, source: "provider" }, items: 0 },
		{ kind: "user", count: { tokens: 10, source: "count-endpoint" }, items: 1 },
	]);
	expect(sent).toEqual(["physical-a", "physical-a", "physical-a"]);

	aliases = [{ provider: "claude", source: "physical-b", id: "logical" }];
	const second = engine.counterFor(logical);
	expect(second.id).toBe("count_tokens:claude:physical-b");
	expect(second).not.toBe(first);
	expect(engine.counterFor({ provider: "claude", id: "physical-b" })).toBe(second);
	const reportB = await engine.context(aliasContext);
	expect(reportB).toMatchObject({
		provider: "claude",
		model: "logical",
		contextWindow: 400,
		percent: 10.5,
		tokens: { tokens: 42, source: "count-endpoint" },
	});
	expect(await engine.breakdown(aliasContext)).toEqual([
		{ kind: "system", count: { tokens: 21, source: "count-endpoint" }, items: 1 },
		{ kind: "tools", count: { tokens: 0, source: "provider" }, items: 0 },
		{ kind: "user", count: { tokens: 21, source: "count-endpoint" }, items: 1 },
	]);
	expect(sent).toEqual([
		"physical-a",
		"physical-a",
		"physical-a",
		"physical-b",
		"physical-b",
		"physical-b",
	]);
});

test("rejected aliases retain their own physical counter and native request identity", async () => {
	const aliases: readonly ModelAlias[] = [
		{ provider: "claude", source: "physical-a", id: "existing" },
		{ provider: "claude", source: "missing", id: "unresolved" },
	];
	const { catalog, engine, sent } = aliasEngine(() => aliases);
	expect(catalog.issues().map((issue) => issue.kind)).toEqual(["collision", "missing-source"]);
	for (const id of ["existing", "unresolved"]) {
		const counter = engine.counterFor({ provider: "claude", id });
		expect(counter.id).toBe(`count_tokens:claude:${id}`);
		expect(await counter.count("hello", "prose")).toEqual({
			tokens: 10,
			source: "count-endpoint",
		});
	}
	expect(sent).toEqual(["existing", "existing", "unresolved", "unresolved"]);
});

test("counter cache distinguishes resolved providers for the same physical model id", () => {
	let physical: TokenModel = { provider: "a", id: "physical" };
	const visits: TokenModel[] = [];
	const engine = createTokenEngine({
		families: [
			{
				id: "fake",
				label: "Fake",
				providers: [],
				tokens: (model) => {
					visits.push(model);
					return {
						id: `${model.provider}:${model.id}`,
						anchorSource: "provider",
						count: async () => ({ tokens: 1, source: "count-endpoint" }),
					};
				},
			},
		],
		deps,
		tools: () => [],
		resolveModel: () => physical,
	});
	const logical = { provider: "logical", id: "alias" };
	const first = engine.counterFor(logical);
	expect(first.id).toBe("a:physical");
	physical = { provider: "b", id: "physical" };
	const second = engine.counterFor(logical);
	expect(second.id).toBe("b:physical");
	expect(second).not.toBe(first);
	physical = { provider: "a", id: "physical" };
	expect(engine.counterFor(logical)).toBe(first);
	expect(visits).toEqual([
		{ provider: "a", id: "physical" },
		{ provider: "b", id: "physical" },
	]);
});

test("memo separates kinds and live counter ids, hashes large text and evicts old entries", async () => {
	let id = "first";
	let calls = 0;
	const counter: TokenCounter = {
		get id() {
			return id;
		},
		anchorSource: "tokenizer",
		count: async (text) => {
			calls++;
			return { tokens: text.length, source: "tokenizer" };
		},
	};
	const engine = createTokenEngine({
		families: [{ id: "f", label: "F", providers: [], tokens: () => counter }],
		deps,
		tools: () => [],
	});
	const large = "x".repeat(2048);
	const state = session([assistant(), { role: "user", content: large, timestamp: 0 }]);
	await Promise.all([engine.context(state.ctx), engine.context(state.ctx)]);
	expect(calls).toBe(1);
	expect((await engine.context(state.ctx))?.anchor?.source).toBe("tokenizer");
	expect(calls).toBe(1);
	id = "second";
	await engine.context(state.ctx);
	expect(calls).toBe(2);
	state.messages.push(
		{
			role: "toolResult",
			toolCallId: "t",
			toolName: "t",
			content: [{ type: "text", text: "[1]" }],
			isError: false,
			timestamp: 0,
		},
		{ role: "user", content: "[1]", timestamp: 0 },
	);
	state.rebuild();
	await engine.context(state.ctx);
	expect(calls).toBe(4);
	for (let i = 0; i < 4096; i++) {
		state.messages.splice(1, state.messages.length - 1, {
			role: "user",
			content: `unique-${i}`,
			timestamp: 0,
		});
		state.rebuild();
		await engine.context(state.ctx);
	}
	const before = calls;
	state.messages.splice(1, 1, { role: "user", content: large, timestamp: 0 });
	state.rebuild();
	await engine.context(state.ctx);
	expect(calls).toBe(before + 1);
});

test("zero usage is skipped while a later all-zero assistant stays in the tail", async () => {
	const base = assistant();
	if (base.role !== "assistant") throw new Error("assistant fixture expected");
	const zero = {
		...base,
		usage: { ...base.usage, totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	const { engine } = setup();
	expect((await engine.context(session([zero]).ctx))?.anchor).toBeUndefined();
	expect((await engine.context(session([base, zero]).ctx))?.anchor?.tokens).toBe(100);
});

test("recorded system messages replace the live prompt and tools instead of adding to them", async () => {
	const live: ToolSchema = { name: "live", description: "", parameters: {} };
	const { engine, calls } = setup("tokenizer", [live]);
	const read = {
		name: "read",
		description: "r",
		parameters: { type: "object" },
	} as unknown as SystemTool;
	const bash = { name: "bash", description: "b", parameters: {} } as unknown as SystemTool;
	const { ctx } = session([
		{
			role: "system",
			content: "",
			sections: { base: "prompt", rules: "old" },
			toolsAdded: [read, bash],
			timestamp: 0,
		},
		{ role: "user", content: "hi", timestamp: 0 },
		{
			role: "system",
			content: "",
			sections: { rules: null },
			toolsRemoved: [bash],
			timestamp: 0,
		},
	]);
	const report = await engine.context(ctx);
	const json = JSON.stringify(read);
	expect(calls).toEqual(["prose:prompt", `json:${json}`, "prose:hi"]);
	expect(report?.tokens.tokens).toBe(6 + json.length + 2);
	const parts = await engine.breakdown(ctx);
	expect(parts?.find((part) => part.kind === "system")?.items).toBe(2);
	expect(parts?.find((part) => part.kind === "tools")?.items).toBe(1);
});

test("system prose is rewritten to what the provider sends before counting; tool JSON is not", async () => {
	const { calls, counter } = setup();
	const rewriting: TokenCounter = { ...counter, systemText: (text) => text.toUpperCase() };
	const rewritten = createTokenEngine({
		families: [{ id: "fake", label: "Fake", providers: [], tokens: () => rewriting }],
		deps,
		tools: () => [{ name: "t", description: "d", parameters: {} }],
	});
	const { ctx } = session([{ role: "user", content: "hi", timestamp: 0 }]);
	await rewritten.context(ctx);
	expect(calls).toEqual([
		"prose:SYSTEM",
		`json:${JSON.stringify({ name: "t", description: "d", parameters: {} })}`,
		"prose:hi",
	]);
});
