import { describe, expect, test } from "bun:test";
import { claudeTokenCounter } from "../../../src/families/anthropic/count.ts";
import { createAnthropicFamily } from "../../../src/families/anthropic/index.ts";
import { CLAUDE_CODE_IDENTITY } from "../../../src/families/anthropic/sanitize.ts";
import type { CounterDeps } from "../../../src/tokens/types.ts";

const model = { provider: "claude", id: "claude-test" };
const options = { version: async () => "2.1.311", env: {} };
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
			source: "count-endpoint",
		});
		expect(await counter.count("more text", "prose")).toEqual({
			tokens: 10,
			source: "count-endpoint",
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
		).toEqual({ tokens: 117, source: "count-endpoint" });
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
			expect((await counter.count("abc", "json")).source).toBe("estimate");
		});
	}

	test("no credential never fetches", async () => {
		const counter = claudeTokenCounter(
			model,
			{
				auth: async () => undefined,
				fetch: async () => {
					throw new Error("unexpected fetch");
				},
				tokenizers,
			},
			options,
		);
		expect(await counter.count("abc", "prose")).toEqual({ tokens: 2, source: "estimate" });
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
