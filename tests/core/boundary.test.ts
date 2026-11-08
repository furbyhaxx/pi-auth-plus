import { expect, test } from "bun:test";
import type {
	BoundaryState,
	ExtensionAPI,
	ExtensionContext,
	SessionBoundaryDraft,
} from "@earendil-works/pi-coding-agent";
import { shareBoundaryEvents } from "../../src/core/boundary/index.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function rig() {
	const registered: Array<{ event: string; handler: Handler }> = [];
	const pi: Pick<ExtensionAPI, "on"> = {
		on(event: string, handler: unknown) {
			if (typeof handler !== "function") throw new Error("Expected event handler");
			registered.push({ event, handler: (data, ctx) => handler(data, ctx) });
			return () => undefined;
		},
	};
	const shared = shareBoundaryEvents(pi);
	const emit = (event: string, state: BoundaryState) =>
		registered.find((item) => item.event === event)?.handler(state, ctx);
	return { shared, registered, emit };
}

const ctx = {} as ExtensionContext;
const edit = (targetId: string): SessionBoundaryDraft => ({
	type: "context_edit",
	targetId,
	replacement: null,
});
const state = (): BoundaryState => ({
	entries: [],
	continue: false,
	outcome: "error",
	context: {
		contextEntries: [],
		contextMessages: [],
		llmMessages: [],
		pendingMessages: [],
		canContinue: true,
	},
});

test("boundary handlers share one subscription per event; other events pass through", () => {
	const { shared, registered } = rig();
	shared.on("turn_end", () => undefined);
	shared.on("turn_end", () => undefined);
	shared.on("agent_before_settle", () => undefined);
	shared.on("agent_before_settle", () => undefined);
	shared.on("session_start", () => undefined);
	expect(registered.map((item) => item.event)).toEqual([
		"turn_end",
		"agent_before_settle",
		"session_start",
	]);
});

test("a proposal chains to the next handler as Pi chains it", async () => {
	const { shared, emit } = rig();
	const seen: boolean[] = [];
	shared.on("agent_before_settle", () => ({ continue: true }));
	shared.on("agent_before_settle", (event) => {
		seen.push(event.continue);
	});
	expect(await emit("agent_before_settle", state())).toEqual({ entries: [], continue: true });
	expect(seen).toEqual([true]);
});

test("dispatch stops after a handler replaces entries, since the preview is then stale", async () => {
	const { shared, emit } = rig();
	let later = 0;
	shared.on("agent_before_settle", (event) => ({
		entries: [...event.entries, edit("a")],
		continue: true,
	}));
	shared.on("agent_before_settle", () => {
		later += 1;
	});
	expect(await emit("agent_before_settle", state())).toEqual({
		entries: [edit("a")],
		continue: true,
	});
	expect(later).toBe(0);
});

test("handlers that propose nothing leave Pi's proposal untouched", async () => {
	const { shared, emit } = rig();
	shared.on("turn_end", () => undefined);
	shared.on("turn_end", (event) => ({ entries: event.entries, continue: event.continue }));
	expect(await emit("turn_end", state())).toBeUndefined();
});

test("an unsubscribed handler no longer runs", async () => {
	const { shared, emit } = rig();
	let calls = 0;
	const off = shared.on("turn_end", () => {
		calls += 1;
	});
	off();
	await emit("turn_end", state());
	expect(calls).toBe(0);
});
