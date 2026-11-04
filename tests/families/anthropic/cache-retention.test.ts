import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyClaudeCacheRetention } from "../../../src/families/anthropic/cache-retention.ts";
import { createAnthropicFamily } from "../../../src/families/anthropic/index.ts";
import { testHost } from "../../host.ts";

const claude = { provider: "claude", id: "sample", api: "anthropic-messages" };
const anthropic = { ...claude, provider: "anthropic" };
const providers = ["claude", "anthropic"];
const ephemeral = { type: "ephemeral" };

function payload(control: Record<string, unknown> = ephemeral) {
	return {
		model: "sample",
		system: [
			{ type: "text", text: "identity", cache_control: control },
			{ type: "text", text: "rules" },
		],
		tools: [{ name: "read", cache_control: control }],
		messages: [
			{ role: "user", content: "plain string content" },
			{ role: "assistant", content: [{ type: "text", text: "ok" }] },
			{ role: "user", content: [{ type: "text", text: "latest", cache_control: control }] },
		],
	};
}

describe("Claude cache retention", () => {
	test("long moves every breakpoint to the 1-hour tier without mutating the input", () => {
		const input = payload();
		const long = { type: "ephemeral", ttl: "1h" };
		expect(applyClaudeCacheRetention(input, claude, "long", providers)).toEqual(payload(long));
		expect(applyClaudeCacheRetention(input, anthropic, "long", providers)).toEqual(payload(long));
		expect(input).toEqual(payload());
	});

	test("short removes a 1-hour lifetime and keeps other cache_control fields", () => {
		const scoped = { type: "ephemeral", ttl: "1h", scope: "global" };
		expect(applyClaudeCacheRetention(payload(scoped), claude, "short", providers)).toEqual(
			payload({ type: "ephemeral", scope: "global" }),
		);
	});

	test("leaves default, unscoped, incompatible, helper and already-matching requests untouched", () => {
		const input = payload();
		expect(applyClaudeCacheRetention(input, claude, "default", providers)).toBeUndefined();
		expect(applyClaudeCacheRetention(input, claude, "long", ["anthropic"])).toBeUndefined();
		expect(applyClaudeCacheRetention(input, undefined, "long", providers)).toBeUndefined();
		expect(
			applyClaudeCacheRetention(input, { ...claude, api: "openai-completions" }, "long", providers),
		).toBeUndefined();
		expect(
			applyClaudeCacheRetention(
				input,
				{ ...claude, compat: { supportsLongCacheRetention: false } },
				"long",
				providers,
			),
		).toBeUndefined();
		expect(
			applyClaudeCacheRetention({ ...input, model: "helper" }, claude, "long", providers),
		).toBeUndefined();
		expect(applyClaudeCacheRetention(input, claude, "short", providers)).toBeUndefined();
		expect(
			applyClaudeCacheRetention(
				payload({ type: "ephemeral", ttl: "1h" }),
				claude,
				"long",
				providers,
			),
		).toBeUndefined();
	});

	test("family hook reads the current setting on every request", async () => {
		const host = await testHost({ "claude.cacheRetention": "long" });
		const handlers = new Map<string, (event: { payload: unknown }, context: unknown) => unknown>();
		const pi = {
			on: (name: string, fn: (event: { payload: unknown }, context: unknown) => unknown) => {
				handlers.set(name, fn);
			},
		} as unknown as ExtensionAPI;
		await createAnthropicFamily({}).register?.(pi, host);
		const request = handlers.get("before_provider_request");
		expect(request?.({ payload: payload() }, { model: claude })).toEqual(
			payload({ type: "ephemeral", ttl: "1h" }),
		);
		await host.settings().save("runtime", { "claude.cacheRetention": "default" });
		expect(request?.({ payload: payload() }, { model: claude })).toBeUndefined();
	});
});
