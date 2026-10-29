/** Counts projected context with Pi-compatible usage anchors and source-labelled segments. */
import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { estimateCounter } from "../estimate/index.ts";
import type {
	CounterDeps,
	TokenContextInput,
	TokenCount,
	TokenCounter,
	TokenModel,
	ToolSchema,
} from "../types.ts";
import { sumCounts } from "../types.ts";
import {
	currentSystem,
	messageSegments,
	nativeContext,
	type Segment,
	usageAnchor,
} from "./messages.ts";

/** The live session inputs required by the counter, without Pi runtime imports. */
export interface EngineContext {
	readonly model:
		| { readonly provider: string; readonly id: string; readonly contextWindow?: number }
		| undefined;
	readonly sessionManager: Pick<
		ExtensionContext["sessionManager"],
		"buildSessionProjection" | "getBranch"
	>;
	readonly modelRegistry?: Pick<ExtensionContext["modelRegistry"], "find">;
	readonly thinkingLevel?: ExtensionContext["thinkingLevel"];
	getSystemPrompt(): string;
	getContextUsage(): { readonly tokens: number | null } | undefined;
}

/** The supplied context's count, its usage anchor and Pi's comparison estimate. */
export interface ContextReport {
	readonly provider: string;
	readonly model: string;
	readonly contextWindow: number | undefined;
	readonly tokens: TokenCount;
	readonly percent: number | undefined;
	readonly anchor: TokenCount | undefined;
	readonly tail: TokenCount;
	readonly tailMessages: number;
	readonly pi: number | null | undefined;
	readonly computedAt: number;
}

/** Logical contributions to the full request, independent of usage anchors. */
export type BreakdownKind = "system" | "tools" | "user" | "assistant" | "toolResult" | "other";
/** Counts and message/tool cardinality for one contribution. */
export interface BreakdownPart {
	readonly kind: BreakdownKind;
	readonly count: TokenCount;
	readonly items: number;
}
/** Injected family counters, active tools and clock. */
export interface TokenEngineOptions {
	readonly families: readonly FamilyAdapter[];
	readonly deps: CounterDeps;
	readonly tools: () => readonly ToolSchema[];
	/** Resolves the live physical identity used to select and cache a counter. */
	readonly resolveModel?: (model: TokenModel) => TokenModel;
	readonly now?: () => number;
}
/** Model counter selection and asynchronous session reports; aborted reports resolve undefined. */
export interface TokenEngine {
	/** Selects and retains the first matching family's counter for this model. */
	counterFor(model: TokenModel): TokenCounter;
	/** Uses persisted usage when valid, counting only subsequent messages. */
	context(ctx: EngineContext, signal?: AbortSignal): Promise<ContextReport | undefined>;
	/** Recounts the full request by contribution, independently of usage anchors. */
	breakdown(
		ctx: EngineContext,
		signal?: AbortSignal,
	): Promise<readonly BreakdownPart[] | undefined>;
}

type SessionMessages = ReturnType<
	EngineContext["sessionManager"]["buildSessionProjection"]
>["messages"];

const MEMO_LIMIT = 4096;
function contentKey(text: string): string {
	return Buffer.byteLength(text) >= 1024
		? `sha256:${createHash("sha256").update(text).digest("hex")}`
		: `text:${text}`;
}
function toolJson(tool: ToolSchema): string {
	return JSON.stringify({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	});
}
function breakdownKind(role: string): BreakdownKind {
	switch (role) {
		case "system":
		case "user":
		case "assistant":
		case "toolResult":
			return role;
		default:
			return "other";
	}
}

/** Creates a lazy engine with bounded segment memoization and in-flight deduplication. */
export function createTokenEngine(options: TokenEngineOptions): TokenEngine {
	const counters = new Map<string, TokenCounter>();
	const memo = new Map<string, TokenCount>();
	const pending = new Map<string, Promise<TokenCount>>();
	const fallback = estimateCounter("default");
	const now = options.now ?? Date.now;

	function physicalModel(model: TokenModel): TokenModel {
		return options.resolveModel ? options.resolveModel(model) : model;
	}

	function counterForPhysical(physical: TokenModel): TokenCounter {
		const key = JSON.stringify([physical.provider, physical.id]);
		const cached = counters.get(key);
		if (cached) return cached;
		let selected = fallback;
		for (const family of options.families) {
			const candidate = family.tokens?.(physical, options.deps);
			if (candidate) {
				selected = candidate;
				break;
			}
		}
		counters.set(key, selected);
		return selected;
	}

	function counterFor(model: TokenModel): TokenCounter {
		return counterForPhysical(physicalModel(model));
	}

	async function countContext(
		counter: TokenCounter,
		physical: TokenModel,
		ctx: EngineContext,
		messages: SessionMessages,
		signal?: AbortSignal,
	): Promise<TokenCount | undefined> {
		const native = counter.countContext;
		if (!native || !ctx.modelRegistry || signal?.aborted) return undefined;
		const model = ctx.modelRegistry.find(physical.provider, physical.id);
		if (!model || model.provider !== physical.provider || model.id !== physical.id)
			return undefined;
		const context = nativeContext(messages, () => ctx.getSystemPrompt(), options.tools);
		if (!context) return undefined;
		const thinkingLevel = ctx.thinkingLevel;
		const input: TokenContextInput = {
			model,
			context,
			...(thinkingLevel === undefined ? {} : { thinkingLevel }),
		};
		try {
			const count = await native.call(counter, input, signal);
			return signal?.aborted ? undefined : count;
		} catch {
			return undefined;
		}
	}

	async function memoized(key: string, compute: () => Promise<TokenCount>): Promise<TokenCount> {
		const cached = memo.get(key);
		if (cached) {
			memo.delete(key);
			memo.set(key, cached);
			return cached;
		}
		const running = pending.get(key);
		if (running) return running;
		const promise = compute();
		pending.set(key, promise);
		try {
			const count = await promise;
			if (count.source !== "estimate") {
				memo.set(key, count);
				if (memo.size > MEMO_LIMIT) {
					const oldest = memo.keys().next().value;
					if (oldest !== undefined) memo.delete(oldest);
				}
			}
			return count;
		} finally {
			pending.delete(key);
		}
	}

	async function countText(
		counter: TokenCounter,
		text: string,
		kind: "prose" | "json",
		signal?: AbortSignal,
	): Promise<TokenCount> {
		return memoized(JSON.stringify([counter.id, kind, contentKey(text)]), async () => {
			try {
				return await counter.count(text, kind, signal);
			} catch {
				return fallback.count(text, kind, signal);
			}
		});
	}

	async function countSegments(
		counter: TokenCounter,
		segments: readonly Segment[],
		signal?: AbortSignal,
	): Promise<TokenCount | undefined> {
		const counts: TokenCount[] = [];
		for (const segment of segments) {
			if (signal?.aborted) return undefined;
			counts.push(
				"image" in segment
					? segment.image
					: await countText(counter, segment.text, segment.kind, signal),
			);
		}
		return signal?.aborted ? undefined : sumCounts(counts);
	}

	async function countTools(
		counter: TokenCounter,
		tools: readonly ToolSchema[],
		signal?: AbortSignal,
	): Promise<TokenCount | undefined> {
		if (signal?.aborted) return undefined;
		if (tools.length === 0) return sumCounts([]);
		const native = counter.countTools;
		if (!native)
			return countSegments(
				counter,
				tools.map((tool) => ({ text: toolJson(tool), kind: "json" })),
				signal,
			);
		const json = `[${tools.map(toolJson).join(",")}]`;
		const result = await memoized(
			JSON.stringify([counter.id, "tools", contentKey(json)]),
			async () => {
				try {
					return await native.call(counter, tools, signal);
				} catch {
					return fallback.count(json, "json", signal);
				}
			},
		);
		return signal?.aborted ? undefined : result;
	}

	function asSent(counter: TokenCounter, segments: readonly Segment[]): readonly Segment[] {
		const rewrite = counter.systemText?.bind(counter);
		if (!rewrite) return segments;
		return segments.map((segment) =>
			"text" in segment && segment.kind === "prose"
				? { text: rewrite(segment.text), kind: segment.kind }
				: segment,
		);
	}

	// Pi 1.4 records prompt sections and tool loadouts as transcript system messages; the live
	// prompt and tool list only stand in before the first one is recorded.
	function systemInputs(
		counter: TokenCounter,
		ctx: EngineContext,
		messages: SessionMessages,
	): {
		readonly segments: readonly Segment[];
		readonly tools: readonly ToolSchema[];
		readonly items: number;
	} {
		const recorded = currentSystem(messages);
		if (recorded)
			return {
				segments: asSent(counter, recorded.segments),
				tools: recorded.tools,
				items: recorded.messages,
			};
		return {
			segments: asSent(counter, [{ text: ctx.getSystemPrompt(), kind: "prose" }]),
			tools: options.tools(),
			items: 1,
		};
	}

	async function breakdown(
		ctx: EngineContext,
		signal?: AbortSignal,
	): Promise<readonly BreakdownPart[] | undefined> {
		if (!ctx.model || signal?.aborted) return undefined;
		const counter = counterFor(ctx.model);
		const messages = ctx.sessionManager.buildSessionProjection().messages;
		const inputs = systemInputs(counter, ctx, messages);
		const system = await countSegments(counter, inputs.segments, signal);
		if (!system) return undefined;
		const toolCount = await countTools(counter, inputs.tools, signal);
		if (!toolCount) return undefined;
		const parts = new Map<BreakdownKind, BreakdownPart>([
			["system", { kind: "system", count: system, items: inputs.items }],
			["tools", { kind: "tools", count: toolCount, items: inputs.tools.length }],
		]);
		for (const message of messages) {
			if (message.role === "system") continue;
			if (message.role === "bashExecution" && message.excludeFromContext) continue;
			const segments = messageSegments(message);
			const count = await countSegments(counter, segments, signal);
			if (!count) return undefined;
			const kind = breakdownKind(message.role);
			const previous = parts.get(kind);
			parts.set(kind, {
				kind,
				count: sumCounts(previous ? [previous.count, count] : [count]),
				items: (previous?.items ?? 0) + 1,
			});
		}
		return signal?.aborted ? undefined : [...parts.values()];
	}

	async function context(
		ctx: EngineContext,
		signal?: AbortSignal,
	): Promise<ContextReport | undefined> {
		const model = ctx.model;
		if (!model || signal?.aborted) return undefined;
		const physical = physicalModel(model);
		const counter = counterForPhysical(physical);
		const projection = ctx.sessionManager.buildSessionProjection();
		const anchorInfo = usageAnchor(projection, ctx.sessionManager.getBranch());
		const messages = projection.messages.slice(anchorInfo ? anchorInfo.index + 1 : 0);
		const counts: TokenCount[] = [];
		const full = anchorInfo
			? undefined
			: await countContext(counter, physical, ctx, projection.messages, signal);
		if (signal?.aborted) return undefined;
		if (full) {
			counts.push(full);
		} else {
			if (!anchorInfo) {
				const inputs = systemInputs(counter, ctx, projection.messages);
				const system = await countSegments(counter, inputs.segments, signal);
				if (!system) return undefined;
				counts.push(system);
				const tools = await countTools(counter, inputs.tools, signal);
				if (!tools) return undefined;
				counts.push(tools);
			}
			for (const message of messages) {
				// Without an anchor the replayed system state above already covers every system message.
				if (!anchorInfo && message.role === "system") continue;
				const segments = messageSegments(message);
				const count = await countSegments(
					counter,
					message.role === "system" ? asSent(counter, segments) : segments,
					signal,
				);
				if (!count) return undefined;
				counts.push(count);
			}
		}
		if (signal?.aborted) return undefined;
		const anchor: TokenCount | undefined = anchorInfo
			? { tokens: anchorInfo.tokens, source: counter.anchorSource }
			: undefined;
		const tail = sumCounts(counts);
		const tokens = anchor ? sumCounts([anchor, tail]) : tail;
		return {
			provider: model.provider,
			model: model.id,
			contextWindow: model.contextWindow,
			tokens,
			percent:
				model.contextWindow && model.contextWindow > 0
					? (tokens.tokens / model.contextWindow) * 100
					: undefined,
			anchor,
			tail,
			tailMessages: messages.length,
			pi: ctx.getContextUsage()?.tokens,
			computedAt: now(),
		};
	}

	return { counterFor, context, breakdown };
}
