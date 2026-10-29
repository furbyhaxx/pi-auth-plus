import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function lifecycleFixture(activeModel?: {
	readonly provider: string;
	readonly id: string;
	readonly api?: string;
}) {
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
	const noticeTones: (string | undefined)[] = [];
	const catalog: Model<Api>[] = [];
	const virtuals = new Map<
		string,
		{ readonly provider: string; readonly id: string; readonly contextWindow?: number }
	>();
	const removed: string[] = [];
	const switches: Model<Api>[] = [];
	const availableVirtuals: string[][] = [];
	let onRefresh: (() => void) | undefined;
	const bus = createEventBus();
	const prompted = Promise.withResolvers<void>();
	const approval = Promise.withResolvers<string | undefined>();
	const authLookups: string[] = [];
	const ctx = {
		cwd: process.env["HOME"],
		model: activeModel ? { ...model, ...activeModel } : undefined,
		modelRegistry: {
			runtime,
			refresh: async () => {
				onRefresh?.();
				return { errors: new Map(), aborted: false };
			},
			getRegisteredProviderConfig: () => undefined,
			getRegisteredNativeProvider: () => undefined,
			getAll: () => catalog,
			getAvailable: () => {
				availableVirtuals.push([...virtuals.keys()]);
				return [
					...catalog,
					...[...virtuals.values()].map((virtual) => ({
						...model,
						...virtual,
						api: "pi-virtual",
					})),
				];
			},
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
			notify: (message: string, tone?: string) => {
				notices.push(message);
				noticeTones.push(tone);
			},
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
		setModel: async (next) => {
			switches.push(next);
			ctx.model = next;
			return true;
		},
		getThinkingLevel: unexpected,
		setThinkingLevel: unexpected,
		unregisterProvider: unexpected,
		registerMcpServer: unexpected,
		unregisterMcpServer: unexpected,
		getMcpServers: unexpected,
		registerVirtualModel: (definition) => {
			virtuals.set(definition.id, definition);
		},
		unregisterVirtualModel: (provider, id) => {
			virtuals.delete(id);
			removed.push(`${provider}/${id}`);
		},
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
		noticeTones,
		catalog,
		virtuals,
		removed,
		switches,
		availableVirtuals,
		setRefresh: (handler: (() => void) | undefined) => {
			onRefresh = handler;
		},
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

function settingsFixture(settings: Record<string, unknown>): () => void {
	const previous = process.env["PI_CODING_AGENT_DIR"];
	const dir = mkdtempSync(join(tmpdir(), "physical-effects-"));
	writeFileSync(join(dir, "auth-plus.json"), JSON.stringify(settings));
	process.env["PI_CODING_AGENT_DIR"] = dir;
	return () => {
		if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previous;
		rmSync(dir, { recursive: true, force: true });
	};
}

function groupSettings(
	rules: readonly string[],
	hiddenDefault = "warn",
	rulesScope?: "user" | "trusted-project",
) {
	return settingsFixture({
		models: {
			groups: ["alpha", "beta"].map((id) => ({
				id,
				members: [{ provider: "test-provider", id: "model" }],
			})),
			rules,
			hiddenDefault,
			...(rulesScope ? { rulesScope } : {}),
		},
	});
}

async function saveRules(fixture: ReturnType<typeof lifecycleFixture>, rules: readonly string[]) {
	const refreshed = Promise.withResolvers<void>();
	fixture.setRefresh(refreshed.resolve);
	let opened = false;
	Object.assign(fixture.ctx.ui, {
		custom: async () => {
			if (opened) return undefined;
			opened = true;
			return { editSetting: "models.rules" };
		},
		editor: async () => JSON.stringify(rules),
		select: async () => "This session only",
	});
	const command = fixture.commands.get("auth")?.handler;
	if (!command) throw new Error("Missing auth command");
	await command("settings", { ...fixture.ctx, mode: "tui" } as unknown as ExtensionCommandContext);
	await refreshed.promise;
	await new Promise<void>((resolve) => setImmediate(resolve));
	fixture.setRefresh(undefined);
}

test("factory applies ordered visibility rules before group registration", async () => {
	const cleanup = groupSettings(["group/*", "!group/beta"]);
	const fixture = lifecycleFixture();
	fixture.catalog.push(fixture.model);
	const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
	try {
		await piAuthPlus(fixture.pi);
		expect([...fixture.virtuals.keys()]).toEqual(["beta"]);
		await fixture.run("session_start");
		expect([...fixture.virtuals.keys()]).toEqual(["beta"]);
		expect(fixture.virtuals.get("beta")?.contextWindow).toBe(fixture.model.contextWindow);
	} finally {
		await fixture.run("session_shutdown");
		start.mockRestore();
		cleanup();
	}
});

test("startup respects user-only rules for a selected group in a trusted project", async () => {
	const cleanup = groupSettings(["group/alpha"], "warn", "user");
	const project = mkdtempSync(join(tmpdir(), "group-project-"));
	mkdirSync(join(project, ".pi"));
	writeFileSync(
		join(project, ".pi", "auth-plus.json"),
		JSON.stringify({ models: { rules: ["group/beta"] } }),
	);
	const fixture = lifecycleFixture({ provider: "group", id: "alpha" });
	fixture.ctx.cwd = project;
	fixture.ctx.isProjectTrusted = () => true;
	const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
	try {
		await piAuthPlus(fixture.pi);
		expect([...fixture.virtuals.keys()]).toEqual(["beta"]);
		await fixture.run("session_start");
		expect([...fixture.virtuals.keys()]).toEqual(["beta"]);
		expect(fixture.notices).toContain(
			"group/alpha is hidden by model rules; the current selection was kept.",
		);
		expect(fixture.switches).toEqual([]);
	} finally {
		await fixture.run("session_shutdown");
		start.mockRestore();
		cleanup();
		rmSync(project, { recursive: true, force: true });
	}
});

for (const policy of ["warn", "fallback", "fallback-physical", "fallback-no-candidate"] as const) {
	test(`rule changes refresh selected groups under ${policy} policy`, async () => {
		const noCandidate = policy === "fallback-no-candidate";
		const noOtherGroup = noCandidate || policy === "fallback-physical";
		const cleanup = groupSettings(
			noOtherGroup ? ["group/beta"] : [],
			policy === "warn" ? "warn" : "fallback",
		);
		const fixture = lifecycleFixture({ provider: "group", id: "alpha" });
		if (!noCandidate) fixture.catalog.push(fixture.model);
		const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
		try {
			await piAuthPlus(fixture.pi);
			await fixture.run("session_start");
			expect([...fixture.virtuals.keys()]).toEqual(noOtherGroup ? ["alpha"] : ["alpha", "beta"]);
			fixture.notices.length = 0;
			fixture.noticeTones.length = 0;
			await saveRules(fixture, noOtherGroup ? ["group/*"] : ["group/*", "!group/beta"]);
			expect([...fixture.virtuals.keys()]).toEqual(noOtherGroup ? [] : ["beta"]);
			expect(fixture.removed).toEqual(["group/alpha"]);
			if (policy === "fallback" || policy === "fallback-physical") {
				const target = policy === "fallback" ? "group/beta" : "test-provider/model";
				expect(fixture.availableVirtuals.at(-1)).toEqual(noOtherGroup ? [] : ["beta"]);
				expect(fixture.switches.map(({ provider, id }) => `${provider}/${id}`)).toEqual([target]);
				expect(fixture.notices).toEqual([
					`group/alpha is hidden by model rules; switched to ${target}.`,
				]);
				expect(fixture.noticeTones).toEqual(["info"]);
			} else {
				expect(fixture.switches).toEqual([]);
				expect(fixture.notices).toEqual([
					"group/alpha is hidden by model rules; the current selection was kept.",
				]);
				expect(fixture.noticeTones).toEqual(["warning"]);
				if (noCandidate) expect(fixture.availableVirtuals.at(-1)).toEqual([]);
			}
			await saveRules(fixture, ["group/*", "!group/alpha", "!group/beta"]);
			expect([...fixture.virtuals.keys()].sort()).toEqual(["alpha", "beta"]);
			expect(fixture.notices).toHaveLength(1);
			expect(fixture.virtuals.get("alpha")?.contextWindow).toBe(
				noCandidate ? undefined : fixture.model.contextWindow,
			);
		} finally {
			await fixture.run("session_shutdown");
			start.mockRestore();
			cleanup();
		}
	});
}

async function respond(fixture: ReturnType<typeof lifecycleFixture>, provider: string) {
	const model = { ...fixture.model, provider };
	fixture.runtime.stream(model, { messages: [] });
	const response = fixture.requests.at(-1)?.onResponse;
	if (!response) throw new Error("Missing physical response hook");
	await response({ status: 200, headers: {} }, model);
	return response;
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
		const { pi, run, bus, authLookups, model, runtime, requests } = lifecycleFixture({
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
			expect(refresh).not.toHaveBeenCalled();
			const physicalModel = { ...model, provider: "claude", id: `test-${mode}` };
			runtime.stream(physicalModel, { messages: [] });
			const responseHook = requests.at(-1)?.onResponse;
			if (!responseHook) throw new Error("Missing physical response hook");
			await responseHook({ status: 200, headers: {} }, physicalModel);
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

test("group requests apply OpenAI verbosity to the physical payload", async () => {
	const cleanup = settingsFixture({ openai: { verbosity: "high" } });
	const fixture = lifecycleFixture({ provider: "group", id: "team", api: "pi-virtual" });
	const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
	try {
		await piAuthPlus(fixture.pi);
		await fixture.run("session_start");
		const model = { ...fixture.model, provider: "openai", api: "openai-responses" };
		const payload = { model: model.id, input: [], text: { format: { type: "json_object" } } };
		fixture.runtime.stream(model, { messages: [] });
		const transform = fixture.requests.at(-1)?.onPayload;
		if (!transform) throw new Error("Missing physical payload hook");
		expect(await transform(payload, model)).toEqual({
			...payload,
			text: { ...payload.text, verbosity: "high" },
		});
		const override = { ...model, samplingParams: { text: { verbosity: "low" } } };
		fixture.runtime.stream(override, { messages: [] });
		const overridden = fixture.requests.at(-1)?.onPayload;
		if (!overridden) throw new Error("Missing physical override hook");
		expect(await overridden(payload, override)).toEqual({
			...payload,
			text: { ...payload.text, verbosity: "low" },
		});
		writeFileSync(
			join(process.env["PI_CODING_AGENT_DIR"] ?? "", "auth-plus.json"),
			JSON.stringify({ openai: { verbosity: "medium" } }),
		);
		await fixture.run("session_start");
		fixture.runtime.stream(model, { messages: [] });
		const updated = fixture.requests.at(-1)?.onPayload;
		if (!updated) throw new Error("Missing updated physical payload hook");
		expect(await updated(payload, model)).toEqual({
			...payload,
			text: { ...payload.text, verbosity: "medium" },
		});
	} finally {
		await fixture.run("session_shutdown");
		start.mockRestore();
		cleanup();
	}
});

test("group responses refresh each physical quota once and fence old sessions", async () => {
	const previousOffline = process.env["PI_OFFLINE"];
	process.env["PI_OFFLINE"] = "0";
	const fixture = lifecycleFixture({ provider: "group", id: "team", api: "pi-virtual" });
	const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
	const ingest = spyOn(QuotaEngine.prototype, "ingestHeaders").mockResolvedValue(undefined);
	const refresh = spyOn(QuotaEngine.prototype, "refresh").mockResolvedValue(undefined);
	try {
		await piAuthPlus(fixture.pi);
		await fixture.run("session_start");
		await fixture.run("agent_end");
		expect(refresh).not.toHaveBeenCalled();
		for (const provider of [
			"synthetic",
			"claude",
			"openai",
			"openai-codex",
			"synthetic",
			"antigravity",
			"unknown",
		])
			await respond(fixture, provider);
		await fixture.run("agent_end");
		expect(refresh.mock.calls).toEqual([
			["synthetic", { minAgeMs: 2000 }],
			["claude", { minAgeMs: 2000 }],
			["codex", { minAgeMs: 2000 }],
			["antigravity", { minAgeMs: 2000 }],
		]);
		refresh.mockClear();
		await fixture.run("agent_end");
		expect(refresh).not.toHaveBeenCalled();
		fixture.runtime.stream({ ...fixture.model, provider: "synthetic" }, { messages: [] });
		const response = fixture.requests.at(-1)?.onResponse;
		if (!response) throw new Error("Missing physical response hook");
		await response({ status: 200, headers: {} }, { ...fixture.model, provider: "claude" });
		expect(ingest.mock.calls.at(-1)).toEqual([{}, "claude", { strict: true }]);
		await fixture.run("agent_end");
		expect(refresh.mock.calls).toEqual([["claude", { minAgeMs: 2000 }]]);
		refresh.mockClear();

		const old = await respond(fixture, "synthetic");
		await fixture.run("session_start");
		await old({ status: 200, headers: {} }, { ...fixture.model, provider: "synthetic" });
		await fixture.run("agent_end");
		expect(refresh).not.toHaveBeenCalled();
		await respond(fixture, "claude");
		await fixture.run("agent_end");
		expect(refresh.mock.calls).toEqual([["claude", { minAgeMs: 2000 }]]);

		refresh.mockClear();
		await respond(fixture, "synthetic");
		await fixture.run("session_shutdown");
		await fixture.run("session_start");
		await fixture.run("agent_end");
		expect(refresh).not.toHaveBeenCalled();
	} finally {
		await fixture.run("session_shutdown");
		start.mockRestore();
		ingest.mockRestore();
		refresh.mockRestore();
		if (previousOffline === undefined) delete process.env["PI_OFFLINE"];
		else process.env["PI_OFFLINE"] = previousOffline;
	}
});

for (const scenario of [
	{
		name: "disabled sources",
		settings: { quotas: { providers: ["cc", "oai"] } },
		offline: false,
		conflict: false,
		expected: ["claude", "codex"],
	},
	{
		name: "request refresh disabled",
		settings: { quotas: { refreshOnRequest: false } },
		offline: false,
		conflict: false,
		expected: [],
	},
	{ name: "offline", settings: {}, offline: true, conflict: false, expected: [] },
	{ name: "quota conflict", settings: {}, offline: false, conflict: true, expected: [] },
] as const) {
	test(`${scenario.name} restricts group response refresh`, async () => {
		const previousOffline = process.env["PI_OFFLINE"];
		process.env["PI_OFFLINE"] = scenario.offline ? "1" : "0";
		const cleanup = settingsFixture(scenario.settings);
		const fixture = lifecycleFixture({ provider: "group", id: "team", api: "pi-virtual" });
		const conflict = scenario.conflict
			? spyOn(fixture.pi, "getSettings").mockReturnValue({ packages: ["pi-quotas"] })
			: undefined;
		const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
		const ingest = spyOn(QuotaEngine.prototype, "ingestHeaders").mockResolvedValue(undefined);
		const refresh = spyOn(QuotaEngine.prototype, "refresh").mockResolvedValue(undefined);
		try {
			await piAuthPlus(fixture.pi);
			await fixture.run("session_start");
			for (const provider of ["synthetic", "claude", "openai", "openai-codex"])
				await respond(fixture, provider);
			await fixture.run("agent_end");
			expect(refresh.mock.calls).toEqual(scenario.expected.map((id) => [id, { minAgeMs: 2000 }]));
		} finally {
			await fixture.run("session_shutdown");
			conflict?.mockRestore();
			start.mockRestore();
			ingest.mockRestore();
			refresh.mockRestore();
			cleanup();
			if (previousOffline === undefined) delete process.env["PI_OFFLINE"];
			else process.env["PI_OFFLINE"] = previousOffline;
		}
	});
}

for (const scenario of [
	{ name: "enabled", providers: ["cc"], expected: ["claude"] },
	{ name: "disabled", providers: ["synthetic"], expected: [] },
] as const) {
	test(`${scenario.name} session provider fallback without physical hooks`, async () => {
		const previousOffline = process.env["PI_OFFLINE"];
		process.env["PI_OFFLINE"] = "0";
		const cleanup = settingsFixture({ quotas: { providers: scenario.providers } });
		const fixture = lifecycleFixture({ provider: "claude", id: "model" });
		Object.freeze(fixture.runtime);
		const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
		const refresh = spyOn(QuotaEngine.prototype, "refresh").mockResolvedValue(undefined);
		try {
			await piAuthPlus(fixture.pi);
			await fixture.run("session_start");
			await fixture.run("agent_end");
			expect(refresh.mock.calls).toEqual(scenario.expected.map((id) => [id, { minAgeMs: 2000 }]));
			refresh.mockClear();
			await fixture.run("session_shutdown");
			await fixture.run("agent_end");
			expect(refresh).not.toHaveBeenCalled();
		} finally {
			await fixture.run("session_shutdown");
			start.mockRestore();
			refresh.mockRestore();
			cleanup();
			if (previousOffline === undefined) delete process.env["PI_OFFLINE"];
			else process.env["PI_OFFLINE"] = previousOffline;
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
