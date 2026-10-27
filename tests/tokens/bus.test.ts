import { expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
	onTokenContext,
	onTokensReady,
	QuotaBusError,
	queryTokens,
	TOKEN_CHANNELS,
} from "@furbyhaxx/pi-auth-plus/bus";
import { channelName, request, serve } from "../../src/core/bus/index.ts";
import { registerTokenBus } from "../../src/tokens/bus.ts";
import type { BreakdownPart, ContextReport } from "../../src/tokens/engine/index.ts";
import type { TokenTracker, TrackerReason } from "../../src/tokens/tracker/types.ts";

const report: ContextReport = {
	provider: "test-provider",
	model: "test-model",
	contextWindow: 1000,
	tokens: { tokens: 100, source: "provider" },
	percent: 10,
	anchor: { tokens: 80, source: "count-endpoint" },
	tail: { tokens: 20, source: "tokenizer" },
	tailMessages: 1,
	pi: null,
	computedAt: 42,
};
const breakdown: readonly BreakdownPart[] = [
	{ kind: "user", count: { tokens: 100, source: "estimate" }, items: 1 },
];
function setup() {
	const events = createEventBus();
	const listeners = new Set<Parameters<TokenTracker["onChange"]>[0]>();
	let latest: ContextReport | undefined = report;
	let refreshReason: TrackerReason | undefined;
	let breakdownSignal: AbortSignal | undefined;
	const tracker: TokenTracker = {
		latest: () => latest,
		refresh: async (reason) => {
			refreshReason = reason;
			return latest;
		},
		breakdown: async (signal) => {
			breakdownSignal = signal;
			return breakdown;
		},
		onChange: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return {
		events,
		tracker,
		listeners,
		refreshReason: () => refreshReason,
		breakdownSignal: () => breakdownSignal,
		change: (value: ContextReport | undefined, reason: TrackerReason) => {
			latest = value;
			for (const listener of listeners) listener(value, reason);
		},
	};
}

test("typed queries, ready, context changes and disposal share the token contract", async () => {
	const s = setup();
	const ready: unknown[] = [];
	const changes: unknown[] = [];
	const offReady = onTokensReady(s.events, (payload) => ready.push(payload));
	const offContext = onTokenContext(s.events, (payload) => changes.push(payload));
	const stop = registerTokenBus(s.events, s.tracker);
	expect(TOKEN_CHANNELS.query).toBe(channelName("tokens", "query"));
	expect(ready).toEqual([{ v: 1, capabilities: ["query", "context"] }]);
	expect(await queryTokens(s.events, { refresh: true, breakdown: true })).toEqual({
		report,
		breakdown,
	});
	expect(s.refreshReason()).toBe("request");
	expect(s.breakdownSignal()?.aborted).toBe(false);
	expect(await queryTokens(s.events)).toEqual({ report });
	s.change(report, "turn_end");
	s.change(undefined, "session_shutdown");
	expect(changes).toEqual([
		{ v: 1, reason: "turn_end", report },
		{ v: 1, reason: "session_shutdown", report: null },
	]);
	expect(await queryTokens(s.events)).toEqual({ report: null });
	stop();
	expect(s.breakdownSignal()?.aborted).toBe(true);
	expect(s.listeners.size).toBe(0);
	s.change(report, "message_end");
	expect(changes).toHaveLength(2);
	await expect(queryTokens(s.events, {}, { timeoutMs: 5 })).rejects.toMatchObject({
		reason: "timeout",
	});
	offReady();
	offContext();
});

test("malformed requests are dropped like quota queries", async () => {
	const s = setup();
	const stop = registerTokenBus(s.events, s.tracker);
	for (const payload of [null, [], false, { refresh: 1 }, { breakdown: "yes" }]) {
		expect(
			await request(s.events, "tokens", "query", payload, (raw) => raw, { timeoutMs: 5 }),
		).toBeUndefined();
	}
	expect(await queryTokens(s.events, { refresh: false, breakdown: false })).toEqual({ report });
	stop();
});

test("failures and caller aborts preserve the shared error API", async () => {
	const s = setup();
	s.tracker.refresh = async () => {
		throw new Error("count failed");
	};
	const stop = registerTokenBus(s.events, s.tracker);
	await expect(queryTokens(s.events, { refresh: true })).rejects.toMatchObject({
		name: "QuotaBusError",
		reason: "rejected",
		message: "Token query failed: count failed. Retry the request.",
	});
	const controller = new AbortController();
	controller.abort();
	await expect(queryTokens(s.events, {}, { signal: controller.signal })).rejects.toBeInstanceOf(
		QuotaBusError,
	);
	stop();
	const waiting = queryTokens(s.events, {}, { signal: AbortSignal.abort() });
	await expect(waiting).rejects.toMatchObject({ reason: "aborted" });
	const pendingController = new AbortController();
	const pending = queryTokens(s.events, {}, { signal: pendingController.signal });
	pendingController.abort();
	await expect(pending).rejects.toMatchObject({ reason: "aborted" });
});

test("untrusted replies and broadcasts validate nested counts and optional fields", async () => {
	const events = createEventBus();
	for (const bad of [
		{ ...report, tokens: { tokens: NaN, source: "provider" } },
		{ ...report, tail: { tokens: 1, source: "unknown" } },
		{ ...report, anchor: {} },
		{ ...report, pi: "unknown" },
		{ ...report, percent: Infinity },
		{ ...report, contextWindow: "100" },
		{ ...report, tailMessages: null },
	]) {
		const off = serve(
			events,
			"tokens",
			"query",
			() => ({}),
			() => ({ v: 1, ok: true, report: bad }),
		);
		await expect(queryTokens(events, {}, { timeoutMs: 5 })).rejects.toMatchObject({
			reason: "timeout",
		});
		off();
	}
	for (const payload of [
		{ v: 2, ok: true, report },
		{ v: 1, ok: true },
		{ v: 1, ok: true, report, breakdown: [{}] },
		{ v: 1, ok: true, report, breakdown: [{ ...breakdown[0], kind: "bad" }] },
		{ v: 1, ok: true, report, breakdown: [{ ...breakdown[0], items: "1" }] },
		{ v: 1, ok: true, report, breakdown: null },
		{ v: 1, ok: false, error: 1 },
	]) {
		const off = serve(
			events,
			"tokens",
			"query",
			() => ({}),
			() => payload,
		);
		await expect(queryTokens(events, {}, { timeoutMs: 5 })).rejects.toMatchObject({
			reason: "timeout",
		});
		off();
	}
	const received: unknown[] = [];
	const off = onTokenContext(events, (payload) => received.push(payload));
	const offReady = onTokensReady(events, (payload) => received.push(payload));
	for (const payload of [
		null,
		{ v: 2, reason: "request", report },
		{ v: 1, reason: "bad", report },
		{ v: 1, reason: "request" },
	])
		events.emit(TOKEN_CHANNELS.context, payload);
	for (const payload of [null, { v: 2, capabilities: [] }, { v: 1, capabilities: ["bad"] }])
		events.emit(TOKEN_CHANNELS.ready, payload);
	expect(received).toEqual([]);
	events.emit(TOKEN_CHANNELS.context, {
		v: 1,
		reason: "model_select",
		report: {
			...report,
			pi: undefined,
			anchor: undefined,
			percent: undefined,
			contextWindow: undefined,
		},
	});
	expect(received).toHaveLength(1);
	off();
	offReady();
	events.emit(TOKEN_CHANNELS.context, { v: 1, reason: "request", report });
	expect(received).toHaveLength(1);
});

test("stop suppresses in-flight replies and aborts breakdown work", async () => {
	const s = setup();
	let finish: ((parts: readonly BreakdownPart[]) => void) | undefined;
	s.tracker.breakdown = (signal) =>
		new Promise((resolve) => {
			finish = resolve;
			signal?.addEventListener("abort", () => resolve(breakdown), { once: true });
		});
	const stop = registerTokenBus(s.events, s.tracker);
	const pending = queryTokens(s.events, { breakdown: true }, { timeoutMs: 5 });
	stop();
	finish?.(breakdown);
	await expect(pending).rejects.toMatchObject({ reason: "timeout" });
});
