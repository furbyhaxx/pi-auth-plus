import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Model, Type } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { bundledModels } from "../../../src/families/google/catalog.ts";
import { registerCompatibleThoughtSignatures } from "../../../src/families/google/compatible-signatures.ts";
import { antigravityProject } from "../../../src/families/google/project.ts";
import { antigravityProvider } from "../../../src/families/google/provider.ts";
import { registerThoughtSignatureRecovery } from "../../../src/families/google/signature-recovery.ts";
import { wrapNativeAliases } from "../../../src/models/aliases/native.ts";
import { installPhysicalRequestHooks } from "../../../src/models/runtime/physical.ts";

const DUMMY = "skip_thought_signature_validator";
const SIGNATURE = "Z2VudWluZS1zaWduYXR1cmU=";
const MISSING = "Function call is missing a thought_signature in functionCall parts";
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

type Scenario = "missing" | "persistent" | "unrelated" | "wrong-status" | "signed" | "two-steps";

async function runScenario(
	scenario: Scenario,
	options: {
		earlierDraft?: boolean;
		queueFollowUp?: boolean;
		secondPrompt?: boolean;
		provider?: "google" | "opencode";
		physical?: boolean;
		helper?: "before" | "after" | "retry";
		differentConfig?: boolean;
	} = {},
) {
	const scratch = mkdtempSync(join(tmpdir(), "pi-signature-recovery-"));
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	let toolRuns = 0;
	let runHelper: (() => Promise<void>) | undefined;
	let helperActive = false;
	let helperStarted = false;
	const helperRequests: Array<{ role: string; parts: Array<Record<string, unknown>> }[]> = [];
	const requests: Array<{ role: string; parts: Array<Record<string, unknown>> }[]> = [];
	const bodies: unknown[] = [];
	const helperBodies: unknown[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const body = (await req.json()) as { contents: (typeof requests)[number] };
			const contents = body.contents;
			if (helperActive) {
				helperRequests.push(contents);
				helperBodies.push(body);
			} else {
				requests.push(contents);
				bodies.push(body);
			}
			if (!helperActive && options.helper === "after" && requests.length === 2 && runHelper)
				await runHelper();
			if (!helperActive && options.queueFollowUp && requests.length === 2) {
				await session?.prompt("Continue with this follow-up", {
					streamingBehavior: "followUp",
					expandPromptTemplates: false,
				});
			}
			const calls = contents.flatMap((c) =>
				c.role === "model" ? c.parts.filter((p) => p["functionCall"]) : [],
			);
			const stream = (parts: Record<string, unknown>[]) =>
				new Response(
					frame({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] }),
					{
						headers: { "content-type": "text/event-stream" },
					},
				);
			if (calls.length === 0) {
				return stream([
					{
						functionCall: { id: "first", name: "count", args: { value: 1 } },
						...(scenario === "signed" || scenario === "two-steps"
							? { thoughtSignature: SIGNATURE }
							: {}),
					},
				]);
			}
			if (scenario === "two-steps" && calls.length === 1) {
				return stream([{ functionCall: { id: "second", name: "count", args: { value: 2 } } }]);
			}
			const target = calls[calls.length - 1];
			if (
				scenario === "persistent" ||
				scenario === "unrelated" ||
				scenario === "wrong-status" ||
				!target?.["thoughtSignature"]
			) {
				const status = scenario === "wrong-status" ? 403 : 400;
				return Response.json(
					{
						error: {
							code: status,
							status: "INVALID_ARGUMENT",
							message: scenario === "unrelated" ? "Unrelated invalid function arguments" : MISSING,
						},
					},
					{ status },
				);
			}
			return stream([{ text: "done" }]);
		},
	});
	try {
		const settings = SettingsManager.inMemory();
		const runtime = await ModelRuntime.create({
			authPath: join(scratch, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(scratch, "models-store.json"),
			refreshOnCreate: false,
		});
		await runtime.setRuntimeApiKey(options.provider ?? "google", "fixture");
		const model: Model<"google-generative-ai"> = {
			id: "gemini-3-test",
			name: "fixture",
			api: "google-generative-ai",
			provider: options.provider ?? "google",
			baseUrl: `http://127.0.0.1:${server.port}`,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 10000,
			maxTokens: 1000,
		};
		const loader = new DefaultResourceLoader({
			cwd: scratch,
			agentDir: scratch,
			settingsManager: settings,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				...(options.earlierDraft
					? [
							(pi: ExtensionAPI) => {
								pi.on("agent_before_settle", (event) => {
									if (event.outcome === "error")
										return {
											entries: [
												...event.entries,
												{ type: "custom", customType: "other-extension" },
											],
										};
									return undefined;
								});
							},
						]
					: []),
				(pi: ExtensionAPI) => {
					const recovery = registerThoughtSignatureRecovery(pi);
					if (options.physical) {
						const available = installPhysicalRequestHooks({ runtime }, (model, context) => {
							const hooks = recovery.factory(model, context);
							if (!hooks) return undefined;
							const original = hooks.payload;
							return {
								...hooks,
								payload: async (payload, actualModel) => {
									if (!helperActive && context.messages.some((m) => m.role === "toolResult")) {
										runHelper = async () => {
											if (helperStarted) return;
											helperStarted = true;
											helperActive = true;
											try {
												await runtime
													.streamSimple(model, context, {
														apiKey: "fixture",
														...(options.differentConfig ? { temperature: 0.12 } : {}),
													})
													.result();
											} finally {
												helperActive = false;
											}
										};
										if (
											options.helper === "before" ||
											(options.helper === "retry" && requests.length === 2)
										)
											await runHelper();
									}
									return original?.(payload, actualModel);
								},
							};
						});
						recovery.setPhysicalHooksAvailable(available);
						if (!available) throw new Error("physical hooks unavailable");
					}
				},
			],
		});
		await loader.reload();
		({ session } = await createAgentSession({
			cwd: scratch,
			agentDir: scratch,
			model,
			modelRuntime: runtime,
			resourceLoader: loader,
			settingsManager: settings,
			sessionManager: SessionManager.inMemory(scratch),
			customTools: [
				{
					name: "count",
					label: "count",
					description: "Count tool executions",
					parameters: Type.Object({ value: Type.Number() }),
					execute: async () => {
						toolRuns++;
						return { content: [{ type: "text", text: "finished" }], details: {} };
					},
				},
			],
			tools: ["count"],
		}));
		const errors: string[] = [];
		await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error.error) });
		await session.prompt("Run count", { expandPromptTemplates: false });
		await session.waitForIdle();
		if (options.secondPrompt) {
			await session.prompt("Continue later", { expandPromptTemplates: false });
			await session.waitForIdle();
		}
		const final = session.messages.filter((m) => m.role === "assistant").at(-1);
		const branch = session.sessionManager.getBranch();
		const edits = branch.filter((e) => e.type === "context_edit").length;
		const earlierDrafts = branch.filter(
			(e) => e.type === "custom" && e.customType === "other-extension",
		).length;
		return {
			requests,
			helperRequests,
			bodies,
			helperBodies,
			toolRuns,
			final,
			edits,
			earlierDrafts,
			errors,
		};
	} finally {
		session?.dispose();
		server.stop(true);
		rmSync(scratch, { recursive: true, force: true });
	}
}

function toolParts(contents: Awaited<ReturnType<typeof runScenario>>["requests"][number]) {
	return contents.flatMap((c) =>
		c.role === "model" ? c.parts.filter((p) => p["functionCall"]) : [],
	);
}

async function runCompatibleScenario(provider: "openrouter" | "opencode", signed: boolean) {
	const scratch = mkdtempSync(join(tmpdir(), "pi-compatible-signature-"));
	let toolRuns = 0;
	const requests: Array<Array<Record<string, unknown>>> = [];
	const chunk = (delta: unknown, finish_reason: string | null = null) =>
		frame({
			id: "chat-fixture",
			object: "chat.completion.chunk",
			created: 1,
			model: "google/gemini-test",
			choices: [{ index: 0, delta, finish_reason }],
		});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const body = (await req.json()) as { messages: Array<Record<string, unknown>> };
			requests.push(body.messages);
			const calls = body.messages.flatMap((message) =>
				Array.isArray(message["tool_calls"])
					? (message["tool_calls"] as Array<Record<string, unknown>>)
					: [],
			);
			if (calls.length === 0) {
				const signature = signed
					? { extra_content: { google: { thought_signature: SIGNATURE } } }
					: {};
				return new Response(
					chunk({
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: "call_1",
								type: "function",
								function: { name: "count", arguments: '{"value":1}' },
								...signature,
							},
						],
					}) +
						chunk({}, "tool_calls") +
						"data: [DONE]\n\n",
					{ headers: { "content-type": "text/event-stream" } },
				);
			}
			const extra = calls[0]?.["extra_content"] as
				| { google?: { thought_signature?: unknown } }
				| undefined;
			if (!extra?.google?.thought_signature)
				return Response.json({ error: { code: 400, message: MISSING } }, { status: 400 });
			return new Response(
				`${chunk({ role: "assistant", content: "done" })}${chunk({}, "stop")}data: [DONE]\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
	});
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		const settings = SettingsManager.inMemory();
		const runtime = await ModelRuntime.create({
			authPath: join(scratch, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(scratch, "models-store.json"),
			refreshOnCreate: false,
		});
		await runtime.setRuntimeApiKey(provider, "fixture");
		const model: Model<"openai-completions"> = {
			id: "google/gemini-test",
			name: "fixture",
			api: "openai-completions",
			provider,
			baseUrl: `http://127.0.0.1:${server.port}`,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 10000,
			maxTokens: 1000,
		};
		const loader = new DefaultResourceLoader({
			cwd: scratch,
			agentDir: scratch,
			settingsManager: settings,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				registerCompatibleThoughtSignatures,
				(pi) => {
					registerThoughtSignatureRecovery(pi);
				},
			],
		});
		await loader.reload();
		({ session } = await createAgentSession({
			cwd: scratch,
			agentDir: scratch,
			model,
			modelRuntime: runtime,
			resourceLoader: loader,
			settingsManager: settings,
			sessionManager: SessionManager.inMemory(scratch),
			customTools: [
				{
					name: "count",
					label: "count",
					description: "Count tool executions",
					parameters: Type.Object({ value: Type.Number() }),
					execute: async () => {
						toolRuns++;
						return { content: [{ type: "text", text: "finished" }], details: {} };
					},
				},
			],
			tools: ["count"],
		}));
		const errors: string[] = [];
		await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error.error) });
		await session.prompt("Run count", { expandPromptTemplates: false });
		await session.waitForIdle();
		const final = session.messages.filter((message) => message.role === "assistant").at(-1);
		const calls = requests.map((messages) =>
			messages.flatMap((message) =>
				Array.isArray(message["tool_calls"])
					? (message["tool_calls"] as Array<Record<string, unknown>>)
					: [],
			),
		);
		return { calls, toolRuns, final, errors };
	} finally {
		session?.dispose();
		server.stop(true);
		rmSync(scratch, { recursive: true, force: true });
	}
}

async function runAntigravityScenario(alias = false) {
	const scratch = mkdtempSync(join(tmpdir(), "pi-agy-signature-"));
	let toolRuns = 0;
	const requests: Array<{ role: string; parts: Array<Record<string, unknown>> }[]> = [];
	const fetchFixture = async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		if (String(input).endsWith(":loadCodeAssist"))
			return Response.json({ cloudaicompanionProject: "test-project" });
		const body = JSON.parse(String(init?.body)) as {
			request: { contents: (typeof requests)[number] };
		};
		requests.push(body.request.contents);
		const calls = toolParts(body.request.contents);
		const stream = (parts: Record<string, unknown>[]) =>
			new Response(
				frame({
					response: { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] },
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		if (calls.length === 0)
			return stream([{ functionCall: { id: "first", name: "count", args: { value: 1 } } }]);
		if (!calls[0]?.["thoughtSignature"])
			return Response.json(
				{ error: { code: 400, status: "INVALID_ARGUMENT", message: MISSING } },
				{ status: 400 },
			);
		return stream([{ text: "done" }]);
	};
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		const settings = SettingsManager.inMemory();
		const runtime = await ModelRuntime.create({
			authPath: join(scratch, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(scratch, "models-store.json"),
			refreshOnCreate: false,
		});
		const provider = antigravityProvider({
			auth: {
				apiKey: {
					name: "fixture",
					resolve: async () => ({
						auth: { headers: { Authorization: "Bearer fixture" } },
						source: "fixture",
					}),
				},
			},
			project: antigravityProject({ fetch: fetchFixture, headers: () => ({}) }),
			fetch: fetchFixture,
		});
		const registered = alias
			? wrapNativeAliases(provider, () => [
					{ provider: "antigravity", source: "gemini-4-argon", id: "gemini-alias" },
				])
			: provider;
		runtime.registerNativeProvider(registered);
		const model = alias
			? registered.getModels().find((entry) => entry.id === "gemini-alias")
			: bundledModels().find((entry) => entry.id === "gemini-4-argon");
		if (!model) throw new Error("fixture model missing");
		const loader = new DefaultResourceLoader({
			cwd: scratch,
			agentDir: scratch,
			settingsManager: settings,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				(pi) => {
					registerThoughtSignatureRecovery(pi);
				},
			],
		});
		await loader.reload();
		({ session } = await createAgentSession({
			cwd: scratch,
			agentDir: scratch,
			model,
			modelRuntime: runtime,
			resourceLoader: loader,
			settingsManager: settings,
			sessionManager: SessionManager.inMemory(scratch),
			customTools: [
				{
					name: "count",
					label: "count",
					description: "Count tool executions",
					parameters: Type.Object({ value: Type.Number() }),
					execute: async () => {
						toolRuns++;
						return { content: [{ type: "text", text: "finished" }], details: {} };
					},
				},
			],
			tools: ["count"],
		}));
		const errors: string[] = [];
		await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error.error) });
		await session.prompt("Run count", { expandPromptTemplates: false });
		await session.waitForIdle();
		return {
			requests,
			toolRuns,
			errors,
			final: session.messages.filter((message) => message.role === "assistant").at(-1),
		};
	} finally {
		session?.dispose();
		rmSync(scratch, { recursive: true, force: true });
	}
}

describe("thought signature recovery", () => {
	test("correlates main requests independently of same-model helpers", async () => {
		for (const helper of ["before", "after"] as const) {
			for (const differentConfig of [false, true]) {
				const result = await runScenario("missing", { physical: true, helper, differentConfig });
				expect(result.errors).toEqual([]);
				expect(result.toolRuns).toBe(1);
				expect(result.requests).toHaveLength(3);
				expect(result.helperRequests).toHaveLength(1);
				if (differentConfig) expect(result.helperBodies[0]).not.toEqual(result.bodies[1]);
				else expect(result.helperBodies[0]).toEqual(result.bodies[1]);
				expect(toolParts(result.helperRequests[0] ?? [])[0]?.["thoughtSignature"]).toBeUndefined();
				expect(toolParts(result.requests[2] ?? [])[0]?.["thoughtSignature"]).toBe(DUMMY);
				expect(result.final?.stopReason).toBe("stop");
			}
		}
	});

	test("does not repair a helper with a different configuration during recovery", async () => {
		const result = await runScenario("missing", {
			physical: true,
			helper: "retry",
			differentConfig: true,
		});
		expect(result.errors).toEqual([]);
		expect(result.toolRuns).toBe(1);
		expect(result.requests).toHaveLength(3);
		expect(result.helperRequests).toHaveLength(1);
		expect(result.helperBodies[0]).not.toEqual(result.bodies[1]);
		expect(result.helperRequests[0]).toEqual(result.requests[1]);
		expect(toolParts(result.helperRequests[0] ?? [])[0]?.["thoughtSignature"]).toBeUndefined();
		expect(toolParts(result.requests[2] ?? [])[0]?.["thoughtSignature"]).toBe(DUMMY);
		expect(result.final?.stopReason).toBe("stop");
	});

	test("recovers through physical request hooks without rerunning tools", async () => {
		const result = await runScenario("missing", { physical: true, queueFollowUp: true });
		expect(result.errors).toEqual([]);
		expect(result.toolRuns).toBe(1);
		expect(result.requests).toHaveLength(3);
		expect(toolParts(result.requests[2] ?? [])[0]?.["thoughtSignature"]).toBe(DUMMY);
		expect(result.final?.stopReason).toBe("stop");
	});
	test("recovers Gemini through OpenCode's Google-native request format", async () => {
		const result = await runScenario("missing", { provider: "opencode" });
		expect(result.errors).toEqual([]);
		expect(result.toolRuns).toBe(1);
		expect(result.requests).toHaveLength(3);
		expect(toolParts(result.requests[2] ?? [])[0]?.["thoughtSignature"]).toBe(DUMMY);
		expect(result.final?.stopReason).toBe("stop");
	});

	test("recovers the actual Antigravity provider's nested request, including aliases", async () => {
		for (const alias of [false, true]) {
			const result = await runAntigravityScenario(alias);
			expect(result.errors).toEqual([]);
			expect(result.toolRuns).toBe(1);
			expect(result.requests).toHaveLength(3);
			expect(toolParts(result.requests[2] ?? [])[0]?.["thoughtSignature"]).toBe(DUMMY);
			expect(result.final?.stopReason).toBe("stop");
		}
	});
	test("recovers or preserves Gemini signatures through compatible gateway streams", async () => {
		for (const provider of ["openrouter", "opencode"] as const) {
			for (const signed of [false, true]) {
				const result = await runCompatibleScenario(provider, signed);
				expect(result.errors).toEqual([]);
				expect(result.toolRuns).toBe(1);
				expect(result.final?.stopReason).toBe("stop");
				expect(result.calls).toHaveLength(signed ? 2 : 3);
				const call = result.calls.at(-1)?.[0];
				const extra = call?.["extra_content"] as
					| { google?: { thought_signature?: string } }
					| undefined;
				expect(extra?.google?.thought_signature).toBe(signed ? SIGNATURE : DUMMY);
			}
		}
	});
	test("keeps subsequent user turns usable after a recovered tool call", async () => {
		const result = await runScenario("missing", { secondPrompt: true });
		expect(result.errors).toEqual([]);
		expect(result.toolRuns).toBe(1);
		expect(result.final?.stopReason).toBe("stop");
		expect(toolParts(result.requests.at(-1) ?? [])[0]?.["thoughtSignature"]).toBe(DUMMY);
	});

	test("repairs an already queued follow-up without repeating the tool", async () => {
		const result = await runScenario("missing", { queueFollowUp: true });
		expect(result.errors).toEqual([]);
		expect(result.toolRuns).toBe(1);
		expect(result.requests).toHaveLength(3);
		expect(toolParts(result.requests[2] ?? [])[0]?.["thoughtSignature"]).toBe(DUMMY);
		expect(result.final?.stopReason).toBe("stop");
	});

	test("preserves another extension's boundary entry", async () => {
		const result = await runScenario("missing", { earlierDraft: true });
		expect(result.errors).toEqual([]);
		expect(result.earlierDrafts).toBe(1);
		expect(result.edits).toBe(1);
		expect(result.toolRuns).toBe(1);
		expect(result.final?.stopReason).toBe("stop");
	});

	test("retries once from retained tool results without executing the tool again", async () => {
		const result = await runScenario("missing");
		expect(result.errors).toEqual([]);
		expect(result.toolRuns).toBe(1);
		expect(result.requests).toHaveLength(3);
		expect(toolParts(result.requests[1] ?? [])[0]?.["thoughtSignature"]).toBeUndefined();
		expect(toolParts(result.requests[2] ?? [])[0]?.["thoughtSignature"]).toBe(DUMMY);
		expect(result.edits).toBe(1);
		expect(result.final?.stopReason).toBe("stop");
	});

	test("preserves earlier signed steps and repairs a later missing step", async () => {
		const result = await runScenario("two-steps");
		expect(result.errors).toEqual([]);
		expect(result.toolRuns).toBe(2);
		expect(result.requests).toHaveLength(4);
		const parts = toolParts(result.requests[3] ?? []);
		expect(parts[0]?.["thoughtSignature"]).toBe(SIGNATURE);
		expect(parts[1]?.["thoughtSignature"]).toBe(DUMMY);
		expect(result.final?.stopReason).toBe("stop");
	});

	test("does not retry unrelated errors or matching errors with a different status", async () => {
		for (const scenario of ["unrelated", "wrong-status"] as const) {
			const result = await runScenario(scenario);
			expect(result.errors).toEqual([]);
			expect(result.requests).toHaveLength(2);
			expect(result.toolRuns).toBe(1);
			expect(result.edits).toBe(0);
			expect(result.final?.stopReason).toBe("error");
		}
	});

	test("stops after one failed repair and does not touch valid signatures", async () => {
		const persistent = await runScenario("persistent");
		expect(persistent.errors).toEqual([]);
		expect(persistent.requests).toHaveLength(3);
		expect(persistent.toolRuns).toBe(1);
		expect(persistent.edits).toBe(1);
		expect(persistent.final?.stopReason).toBe("error");
		const signed = await runScenario("signed");
		expect(signed.errors).toEqual([]);
		expect(signed.requests).toHaveLength(2);
		expect(toolParts(signed.requests[1] ?? [])[0]?.["thoughtSignature"]).toBe(SIGNATURE);
		expect(signed.edits).toBe(0);
		expect(signed.final?.stopReason).toBe("stop");
	});
});
