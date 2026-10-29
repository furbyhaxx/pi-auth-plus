import { describe, expect, test } from "bun:test";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import type { ModelGroup } from "../../../src/models/groups/config.ts";
import * as member from "../../../src/models/groups/member.ts";
import {
	classifyGroupFailure,
	createGroupDefinition,
	type GroupRouteDeps,
	type GroupRouteState,
} from "../../../src/models/groups/route.ts";
import type { ProviderQuotaSnapshot } from "../../../src/quotas/types.ts";

const model = (provider: string, id = "same", overrides: Partial<Model<Api>> = {}): Model<Api> => ({
	provider,
	id,
	name: id,
	api: "openai-completions",
	baseUrl: "",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	reasoning: true,
	contextWindow: 1000,
	maxTokens: 500,
	...overrides,
});
const a = model("a");
const b = model("b");
const c = model("c");
const group: ModelGroup = {
	id: "group1",
	strategy: "sticky",
	triggers: ["rate-limit", "quota", "auth"],
	members: [
		{ provider: "a", id: "same", tier: 1 },
		{ provider: "b", id: "same", tier: 1 },
		{ provider: "c", id: "same", tier: 2 },
	],
};
const error = (
	errorMessage: string,
	content: AssistantMessage["content"] = [],
): AssistantMessage => ({
	role: "assistant",
	content,
	api: a.api,
	provider: a.provider,
	model: a.id,
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "error",
	errorMessage,
	timestamp: 0,
});
function setup(
	options: {
		group?: ModelGroup;
		models?: Model<Api>[];
		available?: Model<Api>[];
		quota?: (provider: string) => ProviderQuotaSnapshot | undefined;
		chooseBalance?: GroupRouteDeps["chooseBalance"];
		random?: number;
		takeFailed?: GroupRouteDeps["takeFailed"];
	} = {},
) {
	const models = options.models ?? [a, b, c];
	const available = options.available ?? models;
	const definition = createGroupDefinition(options.group ?? group, {
		catalog: () => models,
		quota: options.quota ?? (() => undefined),
		chooseBalance: options.chooseBalance ?? ((candidates) => candidates[0]?.member),
		random: () => options.random ?? 0,
		...(options.takeFailed ? { takeFailed: options.takeFailed } : {}),
	});
	const registry = {
		find: (provider: string, id: string) =>
			models.find((m) => m.provider === provider && m.id === id),
		getAvailable: () => available,
	};
	const ctx = { modelRegistry: registry } as ExtensionContext;
	async function route(request: Partial<ModelRouteRequest<GroupRouteState>> = {}) {
		return await definition.route(
			{ model: a, thinkingLevel: "medium", reason: "user", messages: [], ...request },
			ctx,
		);
	}
	return { route, definition };
}
const state = (
	selected: Model<Api>,
	failed: { provider: string; id: string }[] = [],
): GroupRouteState => ({ selected: { provider: selected.provider, id: selected.id }, failed });
const failed = (m: Model<Api>, message: AssistantMessage) => ({ model: m, message });
const snapshot = (
	provider: string,
	opts: Partial<ProviderQuotaSnapshot>,
): ProviderQuotaSnapshot => ({ provider, fetchedAt: 0, source: "endpoint", windows: [], ...opts });

describe("group member health", () => {
	const paid = model("paid", "same", {
		cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
	});
	const plan = { id: "plan", shortLabel: "plan", label: "Plan" };

	test("distinguishes missing, virtual, unavailable, and needs-auth members", () => {
		const auth = snapshot("a", { needsAuth: true, error: "login required" });
		for (const unavailable of [
			member.groupMemberHealth(undefined, true),
			member.groupMemberHealth(model("group"), true),
			member.groupMemberHealth(model("foreign", "v", { api: "pi-virtual" }), true),
			member.groupMemberHealth(a, false, auth),
		])
			expect(unavailable).toEqual({ state: "unavailable", routable: false });
		expect(member.groupMemberHealth(a, true, auth)).toEqual({
			state: "needs-auth",
			routable: false,
		});
	});

	test("reports unknown quota without excluding an otherwise available member", () => {
		const cases = [
			undefined,
			snapshot("paid", {}),
			snapshot("paid", { error: "quota request failed", windows: [{ ...plan, usedFraction: 0 }] }),
			snapshot("paid", { windows: [plan] }),
			snapshot("paid", { windows: [{ ...plan, scope: "search", usedFraction: 1 }] }),
			snapshot("paid", { windows: [{ ...plan, group: "other", usedFraction: 1 }] }),
			snapshot("paid", { credits: { currency: "$" } }),
			snapshot("paid", { credits: { currency: "$", remaining: 0 } }),
		];
		for (const quota of cases)
			expect(member.groupMemberHealth(paid, true, quota)).toEqual({
				state: "unknown",
				routable: true,
			});
	});

	test("does not demote unknown quota below a known healthy lower-priority member", async () => {
		const ranked: ModelGroup = {
			...group,
			members: [
				{ provider: "a", id: "same", tier: 1 },
				{ provider: "b", id: "same", tier: 2 },
			],
		};
		const known = snapshot("b", { windows: [{ ...plan, usedFraction: 0.2 }] });
		const { route } = setup({
			group: ranked,
			quota: (provider) => (provider === "b" ? known : undefined),
		});
		expect((await route()).model).toEqual(a);
	});

	test("reports a usable nonexhausted plan or positive paid credit balance as healthy", () => {
		for (const quota of [
			snapshot("paid", { windows: [{ ...plan, usedFraction: 0 }] }),
			snapshot("paid", { windows: [{ ...plan, usedFraction: 0.9 }] }),
			snapshot("paid", { credits: { currency: "$", remaining: 5 } }),
		])
			expect(member.groupMemberHealth(paid, true, quota)).toEqual({
				state: "healthy",
				routable: true,
			});
	});

	test("keeps exhaustion and quota-error routing decisions separate", async () => {
		const exhausted = snapshot("a", { windows: [{ ...plan, usedFraction: 1 }] });
		expect(member.groupMemberHealth(a, true, exhausted)).toEqual({
			state: "exhausted",
			routable: false,
		});
		const incomplete = { ...exhausted, error: "quota request failed" };
		expect(member.groupMemberHealth(a, true, incomplete)).toEqual({
			state: "unknown",
			routable: false,
		});
		expect(
			(await setup({ quota: (provider) => (provider === "a" ? incomplete : undefined) }).route())
				.model,
		).toEqual(b);
	});

	test("ignores an empty credit balance for a free model without inventing quota health", () => {
		const credits = snapshot("paid", {
			credits: { remaining: 0, total: 10, currency: "$" },
			windows: [{ id: "credits", shortLabel: "cred", label: "Credits", usedFraction: 1 }],
		});
		expect(member.groupMemberHealth(a, true, credits)).toEqual({
			state: "unknown",
			routable: true,
		});
		expect(
			member.groupMemberHealth(a, true, {
				...credits,
				windows: [...credits.windows, { ...plan, usedFraction: 0.2 }],
			}),
		).toEqual({ state: "healthy", routable: true });
		expect(
			member.groupMemberHealth(a, true, {
				...credits,
				windows: [...credits.windows, { ...plan, usedFraction: 1 }],
			}),
		).toEqual({ state: "exhausted", routable: false });
		expect(member.groupMemberHealth(paid, true, credits)).toEqual({
			state: "exhausted",
			routable: false,
		});
		const tiered = model("paid", "tiered", {
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				tiers: [{ inputTokensAbove: 100, input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }],
			},
		});
		expect(member.groupMemberHealth(tiered, true, credits)).toEqual({
			state: "exhausted",
			routable: false,
		});
	});
});

describe("group routes", () => {
	test("matches complete identities, honors lowest tier and falls back", async () => {
		const { route } = setup({ available: [b, c] });
		expect((await route()).model).toEqual(b);
		expect(
			(
				await route({
					reason: "retry",
					state: state(b),
					failed: failed(b, error("429 rate limit")),
				})
			).model,
		).toEqual(c);
	});
	test("routes around logical members to a physical alias with unknown quota", async () => {
		const logicalGroup = model("group", "g");
		const foreignVirtual = model("foreign", "virtual", { api: "pi-virtual" });
		const alias = model("vendor", "org/alias");
		const g: ModelGroup = {
			...group,
			members: [
				{ provider: "group", id: "g", tier: 1 },
				{ provider: "foreign", id: "virtual", tier: 1 },
				{ provider: "vendor", id: "org/alias", tier: 2 },
			],
		};
		const { route } = setup({ group: g, models: [logicalGroup, foreignVirtual, alias] });
		expect((await route()).model).toEqual(alias);
		expect((await route({ reason: "continuation", state: state(logicalGroup) })).model).toEqual(
			alias,
		);
		const unavailable = setup({
			group: g,
			models: [logicalGroup, foreignVirtual, alias],
			available: [],
		});
		expect((await unavailable.route()).model).toEqual(alias);
	});
	test.each([model("group", "g"), model("foreign", "virtual", { api: "pi-virtual" })])(
		"reports no physical candidates for $provider/$id",
		async (invalid) => {
			const g: ModelGroup = {
				...group,
				members: [{ provider: invalid.provider, id: invalid.id, tier: 1 }],
			};
			const { route, definition } = setup({ group: g, models: [invalid] });
			await expect(route()).rejects.toThrow("no physical models");
			expect(definition.contextWindow).toBeUndefined();
			expect(definition.maxTokens).toBeUndefined();
			expect(definition.thinkingLevels).toContain("max");
		},
	);
	test("excludes logical members from the group's advertised capabilities", () => {
		const logicalGroup = model("group", "g", { contextWindow: 50, maxTokens: 25 });
		const foreignVirtual = model("foreign", "virtual", {
			api: "pi-virtual",
			contextWindow: 40,
			maxTokens: 20,
			thinkingLevelMap: { xhigh: "xhigh" },
		});
		const alias = model("vendor", "org/alias", {
			contextWindow: 1000,
			maxTokens: 500,
			reasoning: false,
		});
		const g: ModelGroup = {
			...group,
			members: [
				{ provider: "group", id: "g", tier: 1 },
				{ provider: "foreign", id: "virtual", tier: 1 },
				{ provider: "vendor", id: "org/alias", tier: 2 },
			],
		};
		const { definition } = setup({ group: g, models: [logicalGroup, foreignVirtual, alias] });
		expect(definition.contextWindow).toBe(1000);
		expect(definition.maxTokens).toBe(500);
		expect(definition.thinkingLevels).toEqual(["off"]);
	});
	test("strategies choose within the eligible tier", async () => {
		for (const [strategy, expected] of [
			["sticky", b],
			["failover", a],
			["balance", b],
			["random", b],
		] as const) {
			let called = false;
			const { route } = setup({
				group: { ...group, strategy },
				random: 0.9,
				chooseBalance: (candidates, previous, messages) => {
					called = true;
					expect(candidates.map((item) => item.model)).toEqual([a, b]);
					expect(previous).toEqual({ provider: "b", id: "same" });
					expect(messages).toEqual([]);
					return candidates[1]?.member;
				},
			});
			expect((await route({ state: state(b) })).model).toEqual(expected);
			expect(called).toBe(strategy === "balance");
		}
	});
	test("keeps the selected physical route on tool continuation even if unhealthy", async () => {
		const { route } = setup({ available: [a, c] });
		expect(
			(await route({ reason: "continuation", state: state(b), previous: { model: b } })).model,
		).toEqual(b);
	});
	test("exposes conservative positive limits, union thinking levels, and remaps then clamps", async () => {
		const ma = model("a", "same", {
			contextWindow: 1000,
			maxTokens: 200,
			thinkingLevelMap: { high: null },
		});
		const mb = model("b", "same", {
			contextWindow: 0,
			maxTokens: 100,
			thinkingLevelMap: { xhigh: "xhigh" },
		});
		const g = {
			...group,
			contextWindow: 2000,
			members: [
				{ provider: "a", id: "same", tier: 1, thinking: { low: "high" as const } },
				{ provider: "b", id: "same", tier: 1 },
			],
		};
		const { definition, route } = setup({ group: g, models: [ma, mb] });
		expect(definition.contextWindow).toBe(1000);
		expect(definition.maxTokens).toBe(100);
		expect(definition.thinkingLevels).toContain("xhigh");
		expect((await route({ thinkingLevel: "low" })).thinkingLevel).toBe("medium");
		expect(
			setup({ group: { ...g, contextWindow: 500 }, models: [ma, mb] }).definition.contextWindow,
		).toBe(500);
	});
	test("offers every thinking level before a catalog is known", () => {
		// Factory-time registration has no catalog, and Pi clamps the level to the routed model.
		const { definition } = setup({ models: [] });
		expect(definition.thinkingLevels).toEqual([
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});
	test("only configured safe failure types switch and preserve exclusions", async () => {
		const { route } = setup();
		const first = await route({
			reason: "retry",
			state: state(a),
			failed: failed(a, error("429 rate limit")),
		});
		expect(first.model).toEqual(b);
		if (!first.state) throw new Error("Expected route state");
		const second = await route({
			reason: "retry",
			state: first.state,
			failed: failed(b, error("429 rate limit")),
		});
		expect(second.model).toEqual(c);
		if (!second.state) throw new Error("Expected route state");
		expect((await route({ reason: "user", state: second.state })).model).toEqual(a);
		expect(
			(
				await route({
					reason: "retry",
					state: state(a),
					failed: failed(a, error("400 bad request")),
				})
			).model,
		).toEqual(a);
		const restricted = setup({ group: { ...group, triggers: ["rate-limit"] } });
		expect(
			(
				await restricted.route({
					reason: "retry",
					state: state(a),
					failed: failed(a, error("401 unauthorized")),
				})
			).model,
		).toEqual(a);
		expect(
			(
				await route({
					reason: "retry",
					state: state(a),
					failed: failed(a, error("401 unauthorized")),
				})
			).model,
		).toEqual(b);
	});
	test("partial output, thinking, and tool calls from the failed request prevent switches", async () => {
		const { route } = setup();
		for (const content of [
			[{ type: "text", text: "partial" }],
			[{ type: "thinking", thinking: "partial" }],
			[{ type: "toolCall", id: "1", name: "run", arguments: {} }],
		] satisfies AssistantMessage["content"][]) {
			const message = error("429 rate limit", content);
			expect(classifyGroupFailure(group, message)).toBeUndefined();
			expect(
				(await route({ reason: "retry", state: state(a), failed: failed(a, message) })).model,
			).toEqual(a);
		}
		expect(
			(
				await route({
					reason: "retry",
					state: state(a),
					messages: [
						{
							...error("old", [{ type: "toolCall", id: "1", name: "run", arguments: {} }]),
							stopReason: "toolUse",
						},
						{
							role: "toolResult",
							toolCallId: "1",
							toolName: "run",
							content: [{ type: "text", text: "done" }],
							isError: false,
							timestamp: 0,
						},
					],
					failed: failed(a, error("429")),
				})
			).model,
		).toEqual(b);
	});
	test("settlement failover keeps earlier exclusions when Pi labels a retry as a user turn", async () => {
		const failures = [a, b];
		const coordinated = setup({ takeFailed: () => failures.shift() });
		const first = await coordinated.route({ reason: "user", state: state(a) });
		expect(first.model).toEqual(b);
		if (!first.state) throw new Error("Expected route state");
		const second = await coordinated.route({ reason: "user", state: first.state });
		expect(second.model).toEqual(c);
		expect(second.state?.failed).toEqual([
			{ provider: "a", id: "same" },
			{ provider: "b", id: "same" },
		]);
	});
	test("keeps a zero-cost model eligible when its provider's credit balance is empty", async () => {
		const creditWindow = snapshot("a", {
			credits: { remaining: 0, total: 10, currency: "$" },
			windows: [{ id: "credits", shortLabel: "cred", label: "Credits", usedFraction: 1 }],
		});
		const result = await setup({
			available: [a, c],
			quota: (provider) => (provider === "a" ? creditWindow : undefined),
		}).route();
		expect(result.model).toEqual(a);
		const paid = model("a", "same", {
			cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
		});
		expect(
			(
				await setup({
					models: [paid, c],
					quota: (provider) => (provider === "a" ? creditWindow : undefined),
				}).route()
			).model,
		).toEqual(c);
	});

	test("best effort when auth or plan quota exhausts all, and ignore scoped quota", async () => {
		const quota = (provider: string) => snapshot(provider, { needsAuth: true });
		expect((await setup({ available: [], quota }).route()).model).toEqual(a);
		const exhausted = (provider: string) =>
			snapshot(provider, {
				windows: [{ id: "all", shortLabel: "all", label: "all", usedFraction: 1 }],
			});
		expect((await setup({ quota: exhausted }).route()).model).toEqual(a);
		expect(
			(
				await setup({
					quota: (provider) => (provider === "a" ? exhausted(provider) : undefined),
				}).route()
			).model,
		).toEqual(b);
		expect(
			(
				await setup({
					quota: (provider) => (provider === "a" ? quota(provider) : undefined),
				}).route()
			).model,
		).toEqual(b);
		const scoped = (provider: string) =>
			snapshot(provider, {
				windows: [
					{ id: "search", shortLabel: "search", label: "search", scope: "search", usedFraction: 1 },
				],
			});
		expect(
			(
				await setup({
					quota: (provider) => (provider === "a" ? scoped(provider) : exhausted(provider)),
				}).route()
			).model,
		).toEqual(a);
	});
	test("classification respects triggers and no-output errors", () => {
		expect(classifyGroupFailure(group, error("429 rate limit"))).toBe("rate-limit");
		expect(classifyGroupFailure(group, error("402 quota exceeded"))).toBe("quota");
		expect(classifyGroupFailure(group, error("401 unauthorized"))).toBe("auth");
		expect(classifyGroupFailure({ ...group, triggers: [] }, error("429"))).toBeUndefined();
		expect(classifyGroupFailure(group, error("400 quota"))).toBeUndefined();
	});
	test("keeps failed route with no alternative and accepts coordinator exclusions", async () => {
		const one = setup({ models: [a] });
		expect(
			(await one.route({ reason: "retry", state: state(a), failed: failed(a, error("429")) }))
				.model,
		).toEqual(a);
		const coordinated = setup({ takeFailed: () => ({ provider: "a", id: "same" }) });
		expect((await coordinated.route({ reason: "continuation", state: state(a) })).model).toEqual(b);
		expect((await coordinated.route({ reason: "user", state: state(a) })).model).toEqual(b);
		expect(
			(
				await coordinated.route({
					reason: "retry",
					state: state(a),
					failed: failed(a, error("429", [{ type: "text", text: "partial" }])),
				})
			).model,
		).toEqual(a);
		expect(
			(
				await coordinated.route({
					reason: "continuation",
					state: state(a),
					messages: [error("prior", [{ type: "text", text: "started" }])],
				})
			).model,
		).toEqual(b);
		await expect(setup({ models: [] }).route()).rejects.toThrow("no physical models");
	});
});
