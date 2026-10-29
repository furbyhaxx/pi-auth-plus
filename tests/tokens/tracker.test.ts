import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextReport, TokenEngine } from "../../src/tokens/engine/index.ts";
import { createTokenTracker } from "../../src/tokens/tracker/index.ts";

const report: ContextReport = {
	provider: "fake",
	model: "m",
	contextWindow: 1000,
	tokens: { tokens: 10, source: "tokenizer" },
	percent: 1,
	anchor: undefined,
	tail: { tokens: 10, source: "tokenizer" },
	tailMessages: 1,
	pi: undefined,
	computedAt: 42,
};
const ctx = {
	model: { provider: "fake", id: "m" },
	sessionManager: {
		getSessionId: () => "session",
		getLeafId: () => "leaf",
	},
} as ExtensionContext;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function context(
	modelId: string,
	sessionId: string,
	getLeafId: () => string | null = () => "leaf",
): ExtensionContext {
	return {
		model: { provider: "fake", id: modelId },
		sessionManager: { getSessionId: () => sessionId, getLeafId },
	} as ExtensionContext;
}

function rig(context: TokenEngine["context"] = async () => report) {
	const handlers = new Map<string, (ctx: ExtensionContext) => unknown>();
	const pi: Pick<ExtensionAPI, "on"> = {
		on(event: string, handler: unknown) {
			if (typeof handler !== "function") throw new Error("Expected event handler");
			handlers.set(event, (current) => handler({ type: event }, current));
			return () => {
				handlers.delete(event);
			};
		},
	};
	const engine: TokenEngine = {
		context,
		breakdown: async () => [],
		counterFor: () => {
			throw new Error("Unused counter");
		},
	};
	const tracker = createTokenTracker(pi, { engine, debounceMs: 10 });
	return {
		tracker,
		engine,
		handlers,
		run: (event: string, current = ctx) => handlers.get(event)?.(current),
	};
}

test("event bursts debounce once and publish the last event reason", async () => {
	let calls = 0;
	const { tracker, run } = rig(async () => {
		calls++;
		return report;
	});
	const changes: unknown[] = [];
	tracker.onChange((value, reason) => changes.push([value, reason]));
	try {
		for (const event of [
			"session_start",
			"model_select",
			"message_end",
			"turn_end",
			"session_compact",
			"session_tree",
		])
			run(event);
		expect(calls).toBe(0);
		await wait(30);
		expect(calls).toBe(1);
		expect(tracker.latest()).toBe(report);
		expect(changes).toEqual([[report, "session_tree"]]);
	} finally {
		tracker.dispose();
	}
});

test("model changes invalidate immediately, suppress stale work, and same-model turns retain reports", async () => {
	const { tracker, run, engine } = rig();
	const changes: unknown[] = [];
	tracker.onChange((value, reason) => changes.push([value, reason]));
	try {
		run("session_start", ctx);
		await tracker.refresh();

		let finish: (value: ContextReport) => void = () => {};
		engine.context = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const pending = tracker.refresh();
		const nextContext = context("next", "session");
		run("model_select", nextContext);
		expect(tracker.latest()).toBeUndefined();
		expect(changes.at(-1)).toEqual([undefined, "model_select"]);

		finish(report);
		expect(await pending).toBeUndefined();
		expect(tracker.latest()).toBeUndefined();

		const nextReport = { ...report, model: "next", computedAt: 43 };
		engine.context = async () => nextReport;
		await wait(30);
		expect(tracker.latest()).toBe(nextReport);

		run("turn_end", nextContext);
		expect(tracker.latest()).toBe(nextReport);
		await wait(30);
		expect(tracker.latest()).toBe(nextReport);
		expect(changes).toContainEqual([nextReport, "turn_end"]);
	} finally {
		tracker.dispose();
	}
});

test("session starts and branch replacements invalidate same-model reports", async () => {
	const { tracker, run } = rig();
	const changes: unknown[] = [];
	tracker.onChange((value, reason) => changes.push([value, reason]));
	let leafId = "leaf-a";
	const firstSession = context("m", "session-a", () => leafId);
	const nextSession = context("m", "session-b", () => leafId);
	try {
		run("session_start", firstSession);
		await tracker.refresh();
		run("session_start", nextSession);
		expect(tracker.latest()).toBeUndefined();
		expect(changes.at(-1)).toEqual([undefined, "session_start"]);

		await tracker.refresh();
		leafId = "leaf-b";
		run("session_tree", nextSession);
		expect(tracker.latest()).toBeUndefined();
		expect(changes.at(-1)).toEqual([undefined, "session_tree"]);
	} finally {
		tracker.dispose();
	}
});

test("immediate refresh supersedes slow work even when the engine ignores abort", async () => {
	const pending: Array<{
		signal: AbortSignal | undefined;
		resolve: (value: ContextReport) => void;
	}> = [];
	const { tracker, run } = rig(
		(_ctx, signal) => new Promise((resolve) => pending.push({ signal, resolve })),
	);
	try {
		run("session_start");
		const first = tracker.refresh();
		const second = tracker.refresh();
		expect(pending[0]?.signal?.aborted).toBe(true);
		const newer = { ...report, computedAt: 43 };
		pending[1]?.resolve(newer);
		expect(await second).toBe(newer);
		pending[0]?.resolve(report);
		expect(await first).toBeUndefined();
		expect(tracker.latest()).toBe(newer);
		await wait(30);
		expect(pending).toHaveLength(2);
	} finally {
		tracker.dispose();
	}
});

test("shutdown clears, aborts running work, cancels debounce and releases context", async () => {
	const { tracker, run, engine } = rig();
	const changes: unknown[] = [];
	tracker.onChange((value) => changes.push(value));
	run("session_start");
	await tracker.refresh();
	let signal: AbortSignal | undefined;
	let finish: (value: ContextReport) => void = () => {};
	engine.context = (_ctx, current) => {
		signal = current;
		return new Promise((resolve) => {
			finish = resolve;
		});
	};
	const pending = tracker.refresh();
	run("session_shutdown");
	expect(signal?.aborted).toBe(true);
	expect(tracker.latest()).toBeUndefined();
	expect(changes).toEqual([report, undefined]);
	finish(report);
	expect(await pending).toBeUndefined();
	expect(await tracker.refresh()).toBeUndefined();
	expect(await tracker.breakdown()).toBeUndefined();
	await wait(30);
	expect(tracker.latest()).toBeUndefined();
	tracker.dispose();
});

test("shutdown cancels a pending debounce", async () => {
	let calls = 0;
	const { tracker, run } = rig(async () => {
		calls++;
		return report;
	});
	try {
		run("session_start");
		run("session_shutdown");
		await wait(30);
		expect(calls).toBe(0);
		expect(tracker.latest()).toBeUndefined();
	} finally {
		tracker.dispose();
	}
});

test("failures and throwing listeners are isolated; breakdown forwards the caller signal", async () => {
	const { tracker, run, engine, handlers } = rig();
	const changes: unknown[] = [];
	tracker.onChange(() => {
		throw new Error("Listener failed");
	});
	const off = tracker.onChange((value) => changes.push(value));
	try {
		expect(await tracker.refresh()).toBeUndefined();
		run("session_start");
		await tracker.refresh();
		expect(changes).toEqual([undefined, report]);
		off();
		const controller = new AbortController();
		engine.breakdown = async (current, signal) => {
			expect(current).toBe(ctx);
			expect(signal).toBe(controller.signal);
			return [];
		};
		expect(await tracker.breakdown(controller.signal)).toEqual([]);
		engine.context = async () => {
			throw new Error("Count failed");
		};
		expect(await tracker.refresh()).toBeUndefined();
		run("message_end");
		await wait(30);
		engine.breakdown = async () => {
			throw new Error("Breakdown failed");
		};
		expect(await tracker.breakdown()).toBeUndefined();
		run("model_select", { model: undefined } as ExtensionContext);
		expect(await tracker.refresh()).toBeUndefined();
		expect(tracker.latest()).toBeUndefined();
	} finally {
		tracker.dispose();
	}
	expect(handlers.size).toBe(0);
});
