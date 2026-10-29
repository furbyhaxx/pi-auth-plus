/** The live session's token report, shared by the bus, the /auth Tokens tab and the footer. */
import type { BreakdownPart, ContextReport } from "../engine/index.ts";

/** Why the tracker recomputed; carried on bus broadcasts. */
export type TrackerReason =
	| "session_start"
	| "model_select"
	| "thinking_level_select"
	| "message_end"
	| "turn_end"
	| "session_compact"
	| "session_tree"
	| "session_shutdown"
	| "request";

/** Keeps the latest report for the current session and model, recomputed on Pi events. */
export interface TokenTracker {
	/** Last finished report; undefined before the first one, without a model, or after shutdown. */
	latest(): ContextReport | undefined;
	/** Recomputes now, superseding a scheduled or running computation. */
	refresh(reason?: TrackerReason): Promise<ContextReport | undefined>;
	/** Recounts the full request by contribution; computed on demand, never cached by the tracker. */
	breakdown(signal?: AbortSignal): Promise<readonly BreakdownPart[] | undefined>;
	/** Called after every finished recompute, and with undefined on shutdown; returns unsubscribe. */
	onChange(
		listener: (report: ContextReport | undefined, reason: TrackerReason) => void,
	): () => void;
}
