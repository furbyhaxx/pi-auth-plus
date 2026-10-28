import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createOpenaiFamily } from "../../../src/families/openai/index.ts";
import { applyOpenaiVerbosity } from "../../../src/families/openai/verbosity.ts";
import { testHost } from "../../host.ts";

const openai = { provider: "openai", id: "sample", api: "openai-responses" };
const codex = { provider: "openai-codex", id: "sample", api: "openai-codex-responses" };
const providers = ["openai", "openai-codex"];

describe("OpenAI response verbosity", () => {
	test("merges verbosity into a Responses payload without mutating other text settings", () => {
		const format = { type: "json_schema", name: "reply" };
		const payload = { model: "sample", input: [], text: { format, custom: true }, store: false };
		expect(applyOpenaiVerbosity(payload, openai, "high", providers)).toEqual({
			...payload,
			text: { format, custom: true, verbosity: "high" },
		});
		expect(payload.text).toEqual({ format, custom: true });
		expect(applyOpenaiVerbosity({ model: "sample", input: [] }, codex, "low", providers)).toEqual({
			model: "sample",
			input: [],
			text: { verbosity: "low" },
		});
	});

	test("leaves unconfigured, incompatible, unscoped and helper requests untouched", () => {
		const payload = { model: "sample", input: [] };
		expect(applyOpenaiVerbosity(payload, openai, "default", providers)).toBeUndefined();
		expect(applyOpenaiVerbosity(payload, openai, "high", [])).toBeUndefined();
		expect(applyOpenaiVerbosity(payload, undefined, "high", providers)).toBeUndefined();
		expect(
			applyOpenaiVerbosity(payload, { ...openai, api: "openai-completions" }, "high", providers),
		).toBeUndefined();
		expect(
			applyOpenaiVerbosity({ ...payload, model: "helper" }, openai, "high", providers),
		).toBeUndefined();
		expect(
			applyOpenaiVerbosity({ model: "sample", messages: [] }, openai, "high", providers),
		).toBeUndefined();
		expect(
			applyOpenaiVerbosity({ ...payload, text: "invalid" }, openai, "high", providers),
		).toBeUndefined();
	});

	test("per-model verbosity overrides the global setting and preserves other text fields", () => {
		const model = { ...openai, samplingParams: { text: { verbosity: "high" } } };
		const payload = { model: "sample", input: [], text: { format: { type: "json_object" } } };
		expect(applyOpenaiVerbosity(payload, model, "low", providers)).toEqual({
			...payload,
			text: { format: { type: "json_object" }, verbosity: "high" },
		});
	});

	test("family hook uses the current scoped setting on every request", async () => {
		const host = await testHost({ "openai.verbosity": "high" });
		let handler:
			| ((event: { payload: unknown }, context: { model: typeof openai }) => unknown)
			| undefined;
		const pi = {
			on: (_name: string, fn: typeof handler) => {
				handler = fn;
			},
		} as unknown as ExtensionAPI;
		await createOpenaiFamily().register?.(pi, host);
		const payload = { model: "sample", input: [] };
		expect(handler?.({ payload }, { model: openai })).toEqual({
			...payload,
			text: { verbosity: "high" },
		});
		await host.settings().save("runtime", { "openai.verbosity": "low" });
		expect(handler?.({ payload }, { model: openai })).toEqual({
			...payload,
			text: { verbosity: "low" },
		});
	});
});
