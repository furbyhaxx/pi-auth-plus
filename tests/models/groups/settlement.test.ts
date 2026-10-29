import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ModelGroup } from "../../../src/models/groups/config.ts";
import { createGroupDefinition } from "../../../src/models/groups/route.ts";
import { registerGroupSettlement } from "../../../src/models/groups/settlement.ts";

const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

type Scenario =
	| "tool"
	| "auth"
	| "partial"
	| "followup"
	| "hidden"
	| "draft"
	| "retry"
	| "unavailable"
	| "logical";
async function run(scenario: Scenario, count = 2) {
	const scratch = mkdtempSync(join(tmpdir(), "pi-group-settlement-"));
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	let toolRuns = 0;
	const requests: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const provider = new URL(req.url).pathname.split("/")[1] ?? "";
			requests.push(provider);
			const body = (await req.json()) as {
				contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
			};
			const calls = body.contents.flatMap((entry) =>
				entry.parts.filter((part) => part["functionCall"]),
			);
			const stream = (parts: Record<string, unknown>[]) =>
				new Response(
					frame({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] }),
					{ headers: { "content-type": "text/event-stream" } },
				);
			if (scenario === "tool" && calls.length === 0)
				return stream([{ functionCall: { id: "first", name: "count", args: {} } }]);
			if (scenario === "followup" && requests.length === 1)
				await session?.prompt("follow up", {
					streamingBehavior: "followUp",
					expandPromptTemplates: false,
				});
			if (scenario === "partial")
				return new Response(
					`${frame({ candidates: [{ content: { role: "model", parts: [{ text: "partial" }] } }] })}data: invalid\n\n`,
					{ headers: { "content-type": "text/event-stream" } },
				);
			if (scenario === "auth" || scenario === "retry" || provider === "a") {
				const status =
					scenario === "tool" ? 402 : scenario === "retry" && provider === "a" ? 429 : 401;
				return Response.json(
					{
						error: {
							code: status,
							message:
								status === 402
									? "quota exhausted"
									: status === 429
										? "rate limit"
										: "authentication failed",
						},
					},
					{ status },
				);
			}
			return stream([{ text: "done" }]);
		},
	});
	try {
		const settings = SettingsManager.inMemory({
			retry: {
				enabled: true,
				maxRetries: 1,
				baseDelayMs: 1,
				maxAgentDelayMs: 1,
				provider: { maxRetries: 0 },
			},
		});
		const runtime = await ModelRuntime.create({
			authPath: join(scratch, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(scratch, "models-store.json"),
			refreshOnCreate: false,
		});
		const providers = ["a", "b", "c"].slice(0, count);
		for (const provider of providers) {
			runtime.registerProvider(provider, {
				api: "google-generative-ai",
				baseUrl: `http://127.0.0.1:${server.port}/${provider}`,
				models: [
					{
						id: "test",
						name: "test",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 10000,
						maxTokens: 1000,
					},
				],
			});
			if (scenario !== "unavailable" || provider === "a")
				await runtime.setRuntimeApiKey(provider, "fixture");
		}
		const group: ModelGroup = {
			id: "test",
			strategy: "failover",
			triggers: ["auth", "quota", "rate-limit"],
			members: [
				...providers.map((provider) => ({ provider, id: "test", tier: 1 })),
				...(scenario === "logical" ? [{ provider: "group", id: "nested", tier: 1 }] : []),
			],
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
				...(scenario === "hidden" || scenario === "draft"
					? [
							(pi: ExtensionAPI) =>
								pi.on("agent_before_settle", (event) => {
									if (event.outcome !== "error") return;
									const target =
										scenario === "hidden"
											? event.context.contextEntries.findLast((entry) => entry.messages.length)
											: event.context.contextEntries.find((entry) =>
													entry.messages.some((message) => message.role === "user"),
												);
									if (!target) return;
									return {
										entries: [
											...event.entries,
											{
												type: "context_edit",
												targetId: target.sourceEntry.id,
												replacement:
													scenario === "hidden" ? null : { content: "edited user request" },
											},
										],
									};
								}),
						]
					: []),
				...(scenario === "partial"
					? [
							(pi: ExtensionAPI) =>
								pi.on("message_end", (event) => {
									if (event.message.role === "assistant" && event.message.stopReason === "error")
										return {
											message: { ...event.message, errorMessage: "401 authentication failed" },
										};
									return undefined;
								}),
						]
					: []),
				(pi: ExtensionAPI) => {
					if (scenario === "logical") {
						pi.on("turn_end", (_event, ctx) => {
							const originalFind = ctx.modelRegistry.find.bind(ctx.modelRegistry);
							const originalAvailable = ctx.modelRegistry.getAvailable.bind(ctx.modelRegistry);
							const physical = originalFind("a", "test");
							if (!physical) throw new Error("physical model missing");
							const logical = { ...physical, provider: "group", id: "nested" };
							Reflect.deleteProperty(logical, "api");
							ctx.modelRegistry.find = (provider, id) =>
								provider === "group" && id === "nested" ? logical : originalFind(provider, id);
							ctx.modelRegistry.getAvailable = () => [...originalAvailable(), logical];
						});
					}
					const settlement = registerGroupSettlement(pi, () => [group]);
					pi.registerVirtualModel(
						createGroupDefinition(group, {
							catalog: () => runtime.getModels(),
							quota: () => undefined,
							chooseBalance: (items) => items[0]?.member,
							random: () => 0,
							takeFailed: settlement.takeFailed,
						}),
					);
				},
			],
		});
		await loader.reload();
		({ session } = await createAgentSession({
			cwd: scratch,
			agentDir: scratch,
			modelRuntime: runtime,
			resourceLoader: loader,
			settingsManager: settings,
			sessionManager: SessionManager.inMemory(scratch),
			customTools: [
				{
					name: "count",
					label: "count",
					description: "Count calls",
					parameters: Type.Object({}),
					execute: async () => {
						toolRuns++;
						return { content: [{ type: "text", text: "finished" }], details: {} };
					},
				},
			],
			tools: ["count"],
		}));
		const model = runtime.getModel("group", "test");
		if (!model) throw new Error("group missing");
		await session.setModel(model);
		const errors: string[] = [];
		await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error.error) });
		await session.prompt("Run count", { expandPromptTemplates: false });
		await session.waitForIdle();
		return {
			requests,
			toolRuns,
			errors,
			branch: session.sessionManager.getBranch(),
			messages: session.messages,
		};
	} finally {
		session?.dispose();
		server.stop(true);
		rmSync(scratch, { recursive: true, force: true });
	}
}

describe("group settlement", () => {
	test("continues from the existing tool result after quota exhaustion", async () => {
		const result = await run("tool");
		expect(result.errors).toEqual([]);
		expect(result.requests).toEqual(["a", "a", "b"]);
		expect(result.toolRuns).toBe(1);
		expect(result.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
		expect(result.branch.filter((entry) => entry.type === "context_edit")).toHaveLength(1);
	});
	test("each auth failure is tried at most once and the final error remains", async () => {
		for (const count of [2, 3]) {
			const result = await run("auth", count);
			expect(result.errors).toEqual([]);
			expect(result.requests).toEqual(["a", "b", "c"].slice(0, count));
			expect(result.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
		}
	});
	test("includes automatic retry failures when deciding whether an alternative remains", async () => {
		const result = await run("retry", 3);
		expect(result.errors).toEqual([]);
		expect(result.requests).toEqual(["a", "b", "c"]);
		expect(result.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
	});
	test("leaves the error visible when no alternative has credentials", async () => {
		const result = await run("unavailable");
		expect(result.requests).toEqual(["a"]);
		expect(result.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
		expect(result.branch.filter((entry) => entry.type === "context_edit")).toHaveLength(0);
	});
	test("does not retry when the only alternative is a group without API metadata", async () => {
		const result = await run("logical", 1);
		expect(result.errors).toEqual([]);
		expect(result.requests).toEqual(["a"]);
		expect(result.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "error" });
		expect(result.branch.filter((entry) => entry.type === "context_edit")).toHaveLength(0);
	});
	test("does not retry partial output", async () => {
		const result = await run("partial");
		expect(result.requests).toEqual(["a"]);
		expect(result.messages.at(-1)).toMatchObject({
			role: "assistant",
			stopReason: "error",
			content: [{ type: "text", text: "partial" }],
		});
		expect(result.branch.filter((entry) => entry.type === "context_edit")).toHaveLength(0);
	});
	test("does not discard a queued follow-up", async () => {
		const result = await run("followup");
		expect(
			result.messages.some(
				(message) =>
					message.role === "user" && JSON.stringify(message.content).includes("follow up"),
			),
		).toBe(true);
	});
	test("preserves earlier boundary drafts and respects a hidden failure", async () => {
		const draft = await run("draft");
		expect(draft.requests).toEqual(["a", "b"]);
		expect(draft.branch.filter((entry) => entry.type === "context_edit")).toHaveLength(2);
		expect(
			draft.messages.some(
				(message) =>
					message.role === "user" &&
					JSON.stringify(message.content).includes("edited user request"),
			),
		).toBe(true);
		const hidden = await run("hidden");
		expect(hidden.requests).toEqual(["a"]);
		expect(hidden.branch.filter((entry) => entry.type === "context_edit")).toHaveLength(1);
	});
});
