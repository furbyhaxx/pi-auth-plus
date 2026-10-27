/** Session-scoped token queries and context broadcasts on the versioned bus. */
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { publish, serve } from "../core/bus/index.ts";
import type { BreakdownPart, ContextReport } from "./engine/index.ts";
import type { TokenTracker, TrackerReason } from "./tracker/types.ts";

/** Reads the latest context, optionally recomputing it and counting contributions. */
export interface TokenQueryRequest {
	readonly refresh?: boolean | undefined;
	readonly breakdown?: boolean | undefined;
}

/** Advertises the token service's supported channels. */
export interface TokenReadyPayload {
	readonly v: 1;
	readonly capabilities: readonly ("query" | "context")[];
}

/** A tracker change; null clears the previous session or model report. */
export interface TokenContextPayload {
	readonly v: 1;
	readonly reason: TrackerReason;
	readonly report: ContextReport | null;
}

/** Decoded token query result; unavailable breakdowns are omitted. */
export interface TokenQueryResult {
	readonly report: ContextReport | null;
	readonly breakdown?: readonly BreakdownPart[] | undefined;
}

/** Query success or refusal inside the core/bus nonce envelope. */
export type TokenReply =
	| ({ v: 1; ok: true } & TokenQueryResult)
	| { v: 1; ok: false; error: string };

/** Drops malformed queries using the same boundary policy as quota queries. */
export function parseTokenQuery(raw: unknown): TokenQueryRequest | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
	const refresh = "refresh" in raw ? raw.refresh : undefined;
	const breakdown = "breakdown" in raw ? raw.breakdown : undefined;
	if (
		(refresh !== undefined && typeof refresh !== "boolean") ||
		(breakdown !== undefined && typeof breakdown !== "boolean")
	)
		return undefined;
	return { refresh, breakdown };
}

/** Registers token channels; disposal cancels breakdown work and suppresses late replies. */
export function registerTokenBus(events: EventBus, tracker: TokenTracker): () => void {
	let active = true;
	const controller = new AbortController();
	const bus: EventBus = {
		on: (channel, listener) => events.on(channel, listener),
		emit: (channel, payload) => {
			if (active) events.emit(channel, payload);
		},
	};
	const off = [
		serve(bus, "tokens", "query", parseTokenQuery, async (query): Promise<TokenReply> => {
			try {
				const report = query.refresh ? await tracker.refresh("request") : tracker.latest();
				const breakdown =
					query.breakdown && active ? await tracker.breakdown(controller.signal) : undefined;
				return {
					v: 1,
					ok: true,
					report: report ?? null,
					...(breakdown === undefined ? {} : { breakdown }),
				};
			} catch (error) {
				return {
					v: 1,
					ok: false,
					error: `Token query failed: ${error instanceof Error ? error.message : String(error)}. Retry the request.`,
				};
			}
		}),
		tracker.onChange((report, reason) => {
			publish(bus, "tokens", "context", {
				v: 1,
				reason,
				report: report ?? null,
			} satisfies TokenContextPayload);
		}),
	];
	publish(bus, "tokens", "ready", {
		v: 1,
		capabilities: ["query", "context"],
	} satisfies TokenReadyPayload);
	return () => {
		active = false;
		controller.abort();
		for (const unsubscribe of off) unsubscribe();
	};
}
