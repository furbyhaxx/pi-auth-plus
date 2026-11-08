/** Owns the one Pi subscription per actionable boundary event that internal consumers share. */

import type {
	BoundaryResult,
	BoundaryState,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type Handler = (...args: never[]) => unknown;

function boundaryResult(value: unknown): BoundaryResult | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const entries = Reflect.get(value, "entries");
	const proceed = Reflect.get(value, "continue");
	return {
		...(Array.isArray(entries) ? { entries } : {}),
		...(typeof proceed === "boolean" ? { continue: proceed } : {}),
	};
}

/**
 * Chains handlers the way Pi's `emitBoundary` does: each sees the proposal the previous one
 * left. Pi rebuilds `context` after every handler; one subscription cannot, so dispatch stops
 * once a handler replaces `entries`, before a later handler could read a stale preview.
 */
function dispatcher(handlers: readonly Handler[]) {
	return async (
		event: BoundaryState,
		ctx: ExtensionContext,
	): Promise<BoundaryResult | undefined> => {
		let entries = event.entries;
		let shouldContinue = event.continue;
		let changed = false;
		for (const handler of [...handlers]) {
			const value: unknown = await Reflect.apply(handler, undefined, [
				{ ...event, entries, continue: shouldContinue },
				ctx,
			]);
			const result = boundaryResult(value);
			if (result?.continue !== undefined && result.continue !== shouldContinue) {
				shouldContinue = result.continue;
				changed = true;
			}
			if (result?.entries !== undefined && result.entries !== entries) {
				entries = result.entries;
				changed = true;
				break;
			}
		}
		return changed ? { entries, continue: shouldContinue } : undefined;
	};
}

/**
 * Return `pi` with `turn_end` and `agent_before_settle` handlers multiplexed onto one Pi
 * subscription each. pig sends a boundary event to every handler as its own IPC frame that
 * carries the whole context preview, so each extra handler costs a full copy per turn.
 */
export function shareBoundaryEvents<T extends Pick<ExtensionAPI, "on">>(pi: T): T {
	const shared = new Map<"turn_end" | "agent_before_settle", Handler[]>();
	const on: ExtensionAPI["on"] = (event: string, handler: Handler) => {
		if (event !== "turn_end" && event !== "agent_before_settle")
			return Reflect.apply(pi.on, pi, [event, handler]);
		let handlers = shared.get(event);
		if (!handlers) {
			handlers = [];
			shared.set(event, handlers);
			const dispatch = dispatcher(handlers);
			if (event === "turn_end") pi.on("turn_end", dispatch);
			else pi.on("agent_before_settle", dispatch);
		}
		const list = handlers;
		list.push(handler);
		return () => {
			const index = list.indexOf(handler);
			if (index >= 0) list.splice(index, 1);
		};
	};
	return { ...pi, on };
}
