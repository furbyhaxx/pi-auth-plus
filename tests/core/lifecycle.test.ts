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
import { channelName } from "../../src/core/bus/index.ts";
import piAuthPlus from "../../src/index.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";

test("session replacement fences physical responses, resets and shutdown work", async () => {
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
	const ctx = {
		cwd: process.env["HOME"],
		modelRegistry: {
			runtime,
			refresh: async () => ({ errors: new Map(), aborted: false }),
			getAll: () => [],
			getAvailable: () => [],
		},
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
		getActiveTools: unexpected,
		getAllTools: unexpected,
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
		shutdownWaiting = waiting.resolve;
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
