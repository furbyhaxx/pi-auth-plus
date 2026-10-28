import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { CLI_USER_AGENT, envBlock } from "../../src/families/opencode/identity.ts";
import { opencodePhysicalHooks } from "../../src/families/opencode/physical.ts";

function model(provider: string, id = "shared"): Model<Api> {
	return {
		id,
		name: id,
		provider,
		api: "openai-completions",
		baseUrl: "https://example.test",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: false,
		contextWindow: 1000,
		maxTokens: 100,
	};
}

describe("OpenCode physical request hooks", () => {
	for (const provider of ["opencode", "opencode-go"]) {
		test(`${provider} stamps headers with or without Pi attribution without mutating them`, async () => {
			const hooks = opencodePhysicalHooks(model(provider), "/work", "ses_test");
			if (!hooks?.headers) throw new Error("missing headers hook");
			for (const stamped of [false, true]) {
				const headers = Object.freeze({
					Authorization: "Bearer key",
					"user-agent": "custom",
					"X-OpenCode-Project": "custom",
					"x-opencode-project": "duplicate",
					...(stamped ? { "X-OpenCode-Client": "pi", "x-opencode-session": "pi" } : {}),
				});
				const result = await hooks.headers(headers);
				expect(result).toEqual({
					Authorization: "Bearer key",
					"User-Agent": CLI_USER_AGENT,
					"x-opencode-client": "cli",
					"x-opencode-project": "global",
					"x-opencode-session": "ses_test",
					"x-opencode-session-id": "ses_test",
					"x-session-affinity": "ses_test",
					"X-Session-Id": "ses_test",
				});
				expect(headers["user-agent"]).toBe("custom");
				expect(headers["X-OpenCode-Project"]).toBe("custom");
				expect(headers["x-opencode-project"]).toBe("duplicate");
			}
		});

		test(`${provider} appends env to string and array prompts without mutating payloads`, async () => {
			const actual = model(provider);
			const hooks = opencodePhysicalHooks(actual, "/work", "ses_test");
			if (!hooks?.payload) throw new Error("missing payload hook");
			const block = envBlock("/work", process.platform);
			for (const content of ["instructions", [{ type: "text", text: "instructions" }]]) {
				const payload = {
					model: "shared",
					messages: [
						{ role: "system", content },
						{ role: "user", content: "hi" },
					],
					tools: [{ type: "function", function: { name: "tool" } }],
					temperature: 0.3,
				};
				const original = structuredClone(payload);
				const shaped = await hooks.payload(payload, actual);
				expect(payload).toEqual(original);
				expect(shaped).toEqual({
					...original,
					messages: [
						{
							role: "system",
							content:
								typeof content === "string"
									? `instructions\n\n${block}`
									: [...content, { type: "text", text: block }],
						},
						original.messages[1],
					],
				});
			}
		});
	}

	test("foreign colliding providers and virtual models have no hooks", () => {
		const headers = { "x-opencode-client": "pi", "x-opencode-session": "ses_other" };
		expect(opencodePhysicalHooks(model("foreign"), "/work", "ses_test")).toBeUndefined();
		expect(
			opencodePhysicalHooks({ ...model("opencode"), api: "pi-virtual" }, "/work", "ses_test"),
		).toBeUndefined();
		expect(headers).toEqual({ "x-opencode-client": "pi", "x-opencode-session": "ses_other" });
	});

	test("leaves mismatched ids, foreign actual models and existing env untouched", async () => {
		const actual = model("opencode");
		const hooks = opencodePhysicalHooks(actual, "/work", "ses_test");
		if (!hooks?.payload) throw new Error("missing payload hook");
		const plain = { model: "shared", messages: [{ role: "developer", content: "instructions" }] };
		const wrongId = { ...plain, model: "other" };
		const existing = {
			model: "shared",
			messages: [{ role: "system", content: "<env>existing</env>" }],
		};
		const existingArray = {
			model: "shared",
			messages: [{ role: "system", content: [{ type: "text", text: "<env>existing</env>" }] }],
		};
		for (const [payload, physical] of [
			[wrongId, actual],
			[plain, model("foreign")],
			[plain, model("opencode", "other")],
			[existing, actual],
			[existingArray, actual],
		] as const) {
			const original = structuredClone(payload);
			const result = await hooks.payload(payload, physical);
			expect(result === undefined ? payload : result).toEqual(original);
			expect(payload).toEqual(original);
		}
	});
});
