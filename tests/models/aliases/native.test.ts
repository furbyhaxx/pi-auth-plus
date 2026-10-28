import { describe, expect, test } from "bun:test";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	normalizeContext,
	type Provider,
} from "@earendil-works/pi-ai";
import type { AliasIssue, ModelAlias } from "../../../src/models/aliases/index.ts";
import { wrapNativeAliases } from "../../../src/models/aliases/native.ts";

const base: Model<"anthropic-messages"> = {
	provider: "test",
	id: "base",
	name: "Base",
	api: "anthropic-messages",
	baseUrl: "https://example.invalid",
	input: ["text"],
	reasoning: false,
	contextWindow: 5000,
	maxTokens: 500,
	cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
};
const alias: ModelAlias = {
	provider: "test",
	source: "base",
	id: "short",
	name: "Short",
	contextWindow: 1000,
	maxTokens: 100,
};

function fixture() {
	let catalog = [base, { ...base, id: "hidden" }, { ...base, id: "occupied" }];
	let payload: unknown;
	let envelope = false;
	const provider: Provider<"anthropic-messages"> = {
		id: "test",
		name: "Test",
		auth: {},
		getModels: () => catalog,
		getAllModels: () => [
			...catalog,
			{ ...base, id: "image", type: "image", api: "openai-images", output: ["image"] },
		],
		filterModels: (models) =>
			models
				.filter((model) => model.id !== "hidden")
				.map((model) => ({ ...model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
		async refreshModels(ctx) {
			await ctx.publish({
				update: () => {
					catalog = [{ ...base, id: "new" }];
				},
			});
		},
		stream(model, _context, options) {
			return run(model, options?.onPayload);
		},
		streamSimple(model, _context, options) {
			return run(model, options?.onPayload);
		},
	};
	function run(
		model: Model<"anthropic-messages">,
		callback: ((payload: unknown, model: Model<"anthropic-messages">) => unknown) | undefined,
	) {
		const stream = createAssistantMessageEventStream();
		void (async () => {
			const original = { model: envelope ? "wire-level" : model.id };
			const transformed = await callback?.(original, model);
			payload = transformed === undefined ? original : transformed;
			const message: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			};
			stream.push({ type: "done", reason: "stop", message });
		})();
		return stream;
	}
	return {
		provider,
		payload: () => payload,
		setEnvelope: (value: boolean) => {
			envelope = value;
		},
	};
}

describe("native aliases", () => {
	test("preserves policy, transforms, identity, and prevents collisions", async () => {
		const f = fixture();
		const issues: (readonly AliasIssue[])[] = [];
		const collision = { ...alias, id: "occupied" };
		const hidden = { ...alias, source: "hidden", id: "hidden-alias" };
		const wrapped = wrapNativeAliases(
			f.provider,
			() => [alias, collision, hidden],
			(found) => {
				issues.push(found);
			},
		);
		expect(wrapped.auth).toBe(f.provider.auth);
		const models = wrapped.getModels();
		const selected = models.find((model) => model.id === "short");
		if (!selected) throw new Error("alias missing");
		expect([base.contextWindow, selected.contextWindow, selected.maxTokens]).toEqual([
			5000, 1000, 100,
		]);
		expect(issues.flat()).toContainEqual({ kind: "collision", alias: collision });
		const available = wrapped.filterModels?.(models, undefined) ?? [];
		expect(available.map((model) => model.id)).not.toContain("hidden-alias");
		expect(available.find((model) => model.id === "short")?.cost.input).toBe(0);
		const all = wrapped.getAllModels?.() ?? [];
		expect((wrapped.filterAllModels?.(all, undefined) ?? []).map((model) => model.id)).toContain(
			"image",
		);
		const original = { model: "short", kept: true };
		const result = await wrapped
			.streamSimple(selected, normalizeContext({ messages: [] }), { onPayload: () => original })
			.result();
		expect(result.model).toBe("short");
		expect(f.payload()).toEqual({ model: "base", kept: true });
		expect(original.model).toBe("short");
		const occupied = models.find((model) => model.id === "occupied");
		if (!occupied) throw new Error("physical model missing");
		await wrapped.stream(occupied, normalizeContext({ messages: [] })).result();
		expect(f.payload()).toEqual({ model: "occupied" });
		await wrapped
			.stream(selected, normalizeContext({ messages: [] }), { onPayload: () => undefined })
			.result();
		expect(f.payload()).toEqual({ model: "base" });
		await wrapped
			.streamSimple(selected, normalizeContext({ messages: [] }), { onPayload: () => null })
			.result();
		expect(f.payload()).toBeNull();
		f.setEnvelope(true);
		await wrapped.streamSimple(selected, normalizeContext({ messages: [] })).result();
		expect(f.payload()).toEqual({ model: "wire-level" });
	});

	test("applies the all-model policy before creating aliases", () => {
		const f = fixture();
		const provider: Provider<"anthropic-messages"> = {
			...f.provider,
			filterAllModels: (models) =>
				models
					.filter((model) => model.id !== "hidden")
					.map((model) => ({
						...model,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					})),
		};
		const wrapped = wrapNativeAliases(provider, () => [
			alias,
			{ ...alias, id: "hidden-alias", source: "hidden" },
		]);
		const available = wrapped.filterAllModels?.(wrapped.getAllModels?.() ?? [], undefined) ?? [];
		expect(available.map((model) => model.id)).not.toContain("hidden-alias");
		expect(available.find((model) => model.id === "short")?.cost.input).toBe(0);
		expect(available.map((model) => model.id)).toContain("image");
	});

	test("reads current settings and follows the original refresh", async () => {
		const f = fixture();
		let aliases: readonly ModelAlias[] = [alias];
		const reported: AliasIssue[] = [];
		const wrapped = wrapNativeAliases(
			f.provider,
			() => aliases,
			(issues) => {
				reported.push(...issues);
			},
		);
		expect(wrapped.getModels().map((model) => model.id)).toContain("short");
		await wrapped.refreshModels?.({
			allowNetwork: false,
			signal: new AbortController().signal,
			publish: async (publication) => {
				publication.update?.();
				return true;
			},
		});
		expect(wrapped.getModels().map((model) => model.id)).not.toContain("short");
		expect(reported).toContainEqual({ kind: "missing-source", alias });
		aliases = [{ ...alias, source: "new" }];
		expect(wrapped.getModels().map((model) => model.id)).toContain("short");
	});
});
