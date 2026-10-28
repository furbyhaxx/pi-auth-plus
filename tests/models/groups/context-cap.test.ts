import { describe, expect, test } from "bun:test";
import { installGroupContextCap } from "../../../src/models/groups/context-cap.ts";

function fixture(physicalWindow: unknown) {
	const physical = {
		provider: "physical",
		id: "model",
		api: "test-api",
		contextWindow: physicalWindow,
		maxTokens: 700,
	};
	const state = { selected: true };
	const route = { model: physical, thinkingLevel: "high", state };
	const calls: { receiver: unknown; args: unknown[] }[] = [];
	const runtime = {
		async resolveModel(...args: unknown[]) {
			calls.push({ receiver: this, args });
			return route;
		},
	};
	return { physical, route, calls, runtime };
}

const group = (contextWindow: unknown) => ({
	provider: "group",
	id: "example",
	api: "pi-virtual",
	contextWindow,
});

describe("group context cap", () => {
	test("caps a resolved physical model without changing its identity or output limit", async () => {
		const { runtime, physical, route, calls } = fixture(2000);
		const selected = group(500);
		const messages = [{ role: "user" }];
		const options = { reason: "user" };
		expect(installGroupContextCap({ runtime })).toBe(true);
		const result = await runtime.resolveModel(selected, messages, options);
		expect(calls).toEqual([{ receiver: runtime, args: [selected, messages, options] }]);
		expect(result).toEqual({ ...route, model: { ...physical, contextWindow: 500 } });
		expect(result.model).not.toBe(physical);
		expect(result.model.maxTokens).toBe(700);
		expect(result.state).toBe(route.state);
		expect(physical.contextWindow).toBe(2000);
		expect((await runtime.resolveModel(group(3000), messages, options)).model.contextWindow).toBe(
			2000,
		);
	});

	test("passes other models and invalid limits through unchanged", async () => {
		const { runtime, route } = fixture(2000);
		expect(installGroupContextCap({ runtime })).toBe(true);
		for (const selected of [
			{ ...group(500), provider: "other" },
			{ ...group(500), api: "test-api" },
			...[0, -1, Number.NaN, Number.POSITIVE_INFINITY, "500", undefined].map(group),
		]) {
			expect(await runtime.resolveModel(selected)).toBe(route);
		}
		for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "2000", undefined]) {
			const invalid = fixture(limit);
			expect(installGroupContextCap({ runtime: invalid.runtime })).toBe(true);
			expect(await invalid.runtime.resolveModel(group(500))).toBe(invalid.route);
		}
	});

	test("installs once and preserves rejected routes", async () => {
		const { runtime, calls } = fixture(2000);
		expect(installGroupContextCap({ runtime })).toBe(true);
		const wrapped = runtime.resolveModel;
		expect(installGroupContextCap({ runtime })).toBe(true);
		expect(runtime.resolveModel).toBe(wrapped);
		await runtime.resolveModel(group(500));
		expect(calls).toHaveLength(1);
		const failure = new Error("routing failed");
		const failing = {
			resolveModel: async (..._args: unknown[]) => {
				throw failure;
			},
		};
		expect(installGroupContextCap({ runtime: failing })).toBe(true);
		await expect(failing.resolveModel(group(500))).rejects.toBe(failure);
	});

	test("rejects unsupported runtimes without throwing or modifying them", () => {
		const frozen = Object.freeze({ resolveModel: async () => ({}) });
		const original = frozen.resolveModel;
		const throwing = {
			get runtime(): never {
				throw new Error("unavailable");
			},
		};
		for (const registry of [null, {}, { runtime: {} }, { runtime: frozen }, throwing]) {
			expect(installGroupContextCap(registry)).toBe(false);
		}
		expect(frozen.resolveModel).toBe(original);
	});
});
