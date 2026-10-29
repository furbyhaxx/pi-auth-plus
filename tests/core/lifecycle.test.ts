import { expect, spyOn, test } from "bun:test";
import {
	type Api,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
	createEventBus,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { channelName, request } from "../../src/core/bus/index.ts";
import { FAMILIES } from "../../src/families/index.ts";
import piAuthPlus from "../../src/index.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";
import { defaultTokenizerStore } from "../../src/tokens/tokenizer/index.ts";
import type { CounterDeps } from "../../src/tokens/types.ts";

function lifecycleFixture(activeModel?: { readonly provider: string; readonly id: string }) {
	const requests: (ModelsSimpleStreamOptions | undefined)[] = [];
	const runtime = {
		stream(_model: Model<Api>, _context: Context, options?: ModelsSimpleStreamOptions) {
			requests.push(options);
			return createAssistantMessageEventStream();
		},
		streamSimple(_model: Model<Api>, _context: Context, options?: ModelsSimpleStreamOptions) {
			requests.push(options);
			return createAssistantMessageEventStream();
		},
	};
	const model: Model<Api> = {
		id: "model",
		name: "Model",
		provider: "test-provider",
		api: "test-api",
		baseUrl: "https://example.test",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: false,
		contextWindow: 1000,
		maxTokens: 100,
	};
	const handlers = new Map<string, Array<(payload?: Record<string, unknown>) => unknown>>();
	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	const notices: string[] = [];
	const bus = createEventBus();
	const prompted = Promise.withResolvers<void>();
	const approval = Promise.withResolvers<string | undefined>();
	const authLookups: string[] = [];
	const ctx = {
		cwd: process.env["HOME"],
		model: activeModel ? { ...model, ...activeModel } : undefined,
		modelRegistry: {
			runtime,
			refresh: async () => ({ errors: new Map(), aborted: false }),
			getAll: () => [],
			getAvailable: () => [],
			getProviderAuth: async (provider: string) => {
				authLookups.push(provider);
				return { auth: { apiKey: "test-key" } };
			},
		},
		sessionManager: {
			getSessionId: () => "session",
			getLeafId: () => null,
			getBranch: () => [],
			buildSessionProjection: () => ({ messages: [] }),
		},
		getSystemPrompt: () => "A test prompt for token counting.",
		getContextUsage: () => undefined,
		mode: "rpc",
		hasUI: true,
		isProjectTrusted: () => false,
		ui: {
			notify: (message: string) => notices.push(message),
			select: async () => {
				prompted.resolve();
				return approval.promise;
			},
		},
	};
	const unexpected = (): never => {
		throw new Error("Unexpected Pi API call");
	};
	const pi: ExtensionAPI = {
		on: (event: string, handler: unknown) => {
			if (typeof handler !== "function") return unexpected();
			const list = handlers.get(event) ?? [];
			list.push((payload) => handler({ type: event, ...payload }, ctx));
			handlers.set(event, list);
			return () => {};
		},
		registerFlag: () => {},
		getFlag: () => false,
		registerCommand: (name, options) => {
			commands.set(name, options);
		},
		registerEntryRenderer: () => {},
		registerProvider: () => {},
		getSettings: () => ({}),
		getCommands: () => [],
		events: bus,
		registerTool: unexpected,
		registerShortcut: unexpected,
		registerMessageRenderer: unexpected,
		registerMarkdownTransformer: unexpected,
		registerToolRenderer: unexpected,
		sendMessage: unexpected,
		sendUserMessage: unexpected,
		appendEntry: unexpected,
		setSessionName: unexpected,
		getSessionName: unexpected,
		setLabel: unexpected,
		exec: unexpected,
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: unexpected,
		setModel: unexpected,
		getThinkingLevel: unexpected,
		setThinkingLevel: unexpected,
		unregisterProvider: unexpected,
		registerMcpServer: unexpected,
		unregisterMcpServer: unexpected,
		getMcpServers: unexpected,
		registerVirtualModel: unexpected,
		unregisterVirtualModel: unexpected,
	};
	let shutdownWaiting: (() => void) | undefined;
	const run = async (event: string) => {
		for (const handler of handlers.get(event) ?? []) {
			const result = handler({ reason: "switch" });
			if (event === "session_shutdown" && result instanceof Promise) shutdownWaiting?.();
			await result;
		}
	};
	return {
		requests,
		runtime,
		model,
		commands,
		notices,
		bus,
		prompted,
		approval,
		ctx,
		pi,
		run,
		authLookups,
		setShutdownWaiting: (notify: () => void) => {
			shutdownWaiting = notify;
		},
	};
}

test("session replacement fences physical responses, resets and shutdown work", async () => {
	const {
		requests,
		runtime,
		model,
		commands,
		notices,
		bus,
		prompted,
		approval,
		ctx,
		pi,
		run,
		setShutdownWaiting,
	} = lifecycleFixture();
	const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
	const ingest = spyOn(QuotaEngine.prototype, "ingestHeaders").mockResolvedValue(undefined);
	const list = spyOn(QuotaEngine.prototype, "listResets").mockResolvedValue({
		provider: "codex",
		fetchedAt: 0,
		available: 1,
		credits: [{ id: "credit", type: "reset", status: "available" }],
	});
	const consume = spyOn(QuotaEngine.prototype, "consumeReset").mockResolvedValue({
		provider: "codex",
		creditId: "credit",
		windowsReset: 1,
		code: "reset",
	});
	try {
		await piAuthPlus(pi);
		const auth = commands.get("auth")?.handler;
		if (!auth) throw new Error("Missing auth command");
		const invoke = () => auth("", ctx as unknown as ExtensionCommandContext);
		await invoke();
		expect(notices).toEqual([]);
		await run("session_start");
		notices.length = 0;
		await invoke();
		expect(notices).toHaveLength(1);
		runtime.stream(model, { messages: [] });
		await run("session_shutdown");
		await invoke();
		expect(notices).toHaveLength(1);
		await run("session_start");
		notices.length = 0;
		await invoke();
		expect(notices).toHaveLength(1);
		runtime.streamSimple(model, { messages: [] });
		const old = requests[0]?.onResponse;
		const current = requests[1]?.onResponse;
		if (!old || !current) throw new Error("Missing physical response hooks");
		await old({ status: 200, headers: { owner: "old" } }, model);
		await current({ status: 200, headers: { owner: "current" } }, model);
		expect(ingest.mock.calls).toEqual([[{ owner: "current" }, "test-provider", { strict: true }]]);
		await run("session_start");
		runtime.stream(model, { messages: [] });
		const replacement = requests[2]?.onResponse;
		if (!replacement) throw new Error("Missing replacement response hook");
		await current({ status: 200, headers: { owner: "previous" } }, model);
		await replacement({ status: 200, headers: { owner: "replacement" } }, model);
		expect(ingest.mock.calls).toEqual([
			[{ owner: "current" }, "test-provider", { strict: true }],
			[{ owner: "replacement" }, "test-provider", { strict: true }],
		]);
		bus.emit(channelName("quotas", "reset"), {
			nonce: "reset-request",
			payload: { provider: "codex", confirm: true },
		});
		await prompted.promise;
		const restarting = run("session_start");
		approval.resolve("Spend 1 credit now (cannot be undone)");
		await restarting;
		expect(consume).not.toHaveBeenCalled();

		const pending = Promise.withResolvers<string | undefined>();
		ingest.mockImplementationOnce(() => pending.promise);
		runtime.stream(model, { messages: [] });
		const beforeShutdown = requests[3]?.onResponse;
		if (!beforeShutdown) throw new Error("Missing pre-shutdown response hook");
		await beforeShutdown({ status: 200, headers: { owner: "pending" } }, model);
		const waiting = Promise.withResolvers<void>();
		setShutdownWaiting(waiting.resolve);
		const shutdown = run("session_shutdown");
		await waiting.promise;
		await run("session_start");
		pending.resolve(undefined);
		await shutdown;
		runtime.stream(model, { messages: [] });
		const afterShutdown = requests[4]?.onResponse;
		if (!afterShutdown) throw new Error("Missing post-shutdown response hook");
		await afterShutdown({ status: 200, headers: { owner: "new-session" } }, model);
		expect(ingest.mock.calls.at(-1)).toEqual([
			{ owner: "new-session" },
			"test-provider",
			{ strict: true },
		]);
	} finally {
		await run("session_shutdown");
		start.mockRestore();
		ingest.mockRestore();
		list.mockRestore();
		consume.mockRestore();
	}
});

for (const mode of ["environment", "flag", "online"] as const) {
	test(`${mode} startup applies quota and native-count network policy`, async () => {
		const originalArgv = [...process.argv];
		const originalOffline = process.env["PI_OFFLINE"];
		process.env["PI_OFFLINE"] = mode === "environment" ? "YeS" : "0";
		if (mode === "flag") process.argv.push("--offline");
		const offline = mode !== "online";
		const { pi, run, bus, authLookups } = lifecycleFixture({
			provider: "claude",
			id: `test-${mode}`,
		});
		const family = FAMILIES.find((entry) => entry.id === "anthropic");
		if (!family?.tokens) throw new Error("Missing native counter family");
		const originalTokens = family.tokens;
		const counterDeps: CounterDeps[] = [];
		const counter = spyOn(family, "tokens").mockImplementation((model, deps) => {
			counterDeps.push(deps);
			return originalTokens(model, deps);
		});
		const fakeFetch = Object.assign(async () => Response.json({ input_tokens: 3 }), {
			preconnect: globalThis.fetch.preconnect,
		});
		const transport = spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
		const originalStart = QuotaEngine.prototype.start;
		let engine: QuotaEngine | undefined;
		const start = spyOn(QuotaEngine.prototype, "start").mockImplementation(function (
			this: QuotaEngine,
		) {
			engine = this;
			return originalStart.call(this);
		});
		const refresh = spyOn(QuotaEngine.prototype, "refresh").mockResolvedValue(undefined);
		try {
			await piAuthPlus(pi);
			await run("session_start");
			expect(start).toHaveBeenCalledTimes(1);
			if (!engine) throw new Error("Quota engine did not start");
			await engine.tick();
			const scheduledRefreshes = refresh.mock.calls.length;

			const report = await request(bus, "tokens", "query", { refresh: true }, (value) => value);
			expect(report).toMatchObject({
				ok: true,
				report: { tokens: { source: offline ? "estimate" : "count-endpoint" } },
			});
			const deps = counterDeps.at(-1);
			if (!deps) throw new Error("Missing counter dependencies");
			if (offline) {
				expect(authLookups).toEqual([]);
				expect(await deps.auth("claude")).toBeUndefined();
				await expect(deps.fetch("https://example.test/count")).rejects.toThrow("offline");
				expect(transport).not.toHaveBeenCalled();
				expect(scheduledRefreshes).toBe(0);
			} else {
				expect(authLookups.length).toBeGreaterThan(0);
				expect(await deps.auth("claude")).toMatchObject({ token: "test-key" });
				expect((await deps.fetch("https://example.test/count")).ok).toBe(true);
				expect(transport).toHaveBeenCalled();
				expect(scheduledRefreshes).toBeGreaterThan(0);
			}

			refresh.mockClear();
			await run("agent_end");
			if (offline) expect(refresh).not.toHaveBeenCalled();
			else expect(refresh).toHaveBeenCalledWith("claude", { minAgeMs: 2000 });

			refresh.mockClear();
			const response = await request(
				bus,
				"quotas",
				"refresh",
				{ providers: ["claude"], force: true },
				(value) => value,
			);
			expect(response).toMatchObject({ ok: true });
			expect(refresh).toHaveBeenCalledWith("claude", { force: true, minAgeMs: 0 });
		} finally {
			await run("session_shutdown");
			counter.mockRestore();
			transport.mockRestore();
			start.mockRestore();
			refresh.mockRestore();
			process.argv.splice(0, process.argv.length, ...originalArgv);
			if (originalOffline === undefined) delete process.env["PI_OFFLINE"];
			else process.env["PI_OFFLINE"] = originalOffline;
		}
	});
}

test("offline token reports use a locally loaded tokenizer", async () => {
	const originalOffline = process.env["PI_OFFLINE"];
	process.env["PI_OFFLINE"] = "1";
	const { pi, run, bus } = lifecycleFixture({ provider: "synthetic", id: "hf:example/local" });
	const store = defaultTokenizerStore();
	const tokenizer = { id: "example/local@cached", count: () => 7 };
	const peek = spyOn(store, "peek").mockImplementation((repo) =>
		repo === "example/local" ? tokenizer : undefined,
	);
	const load = spyOn(store, "load").mockResolvedValue(tokenizer);
	const refresh = spyOn(QuotaEngine.prototype, "refresh").mockResolvedValue(undefined);
	try {
		await piAuthPlus(pi);
		await run("session_start");
		const report = await request(bus, "tokens", "query", { refresh: true }, (value) => value);
		expect(report).toMatchObject({
			ok: true,
			report: { tokens: { source: "tokenizer", tokens: 7 } },
		});
		expect(load).toHaveBeenCalledWith("example/local");
	} finally {
		await run("session_shutdown");
		peek.mockRestore();
		load.mockRestore();
		refresh.mockRestore();
		if (originalOffline === undefined) delete process.env["PI_OFFLINE"];
		else process.env["PI_OFFLINE"] = originalOffline;
	}
});
