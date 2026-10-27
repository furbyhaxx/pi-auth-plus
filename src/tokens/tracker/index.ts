/** Owns cancellable token recomputations and reports for the live Pi session. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextReport, TokenEngine } from "../engine/index.ts";
import type { TokenTracker, TrackerReason } from "./types.ts";

/** Registers session events without starting work until a context arrives. */
export function createTokenTracker(
	pi: Pick<ExtensionAPI, "on">,
	options: { readonly engine: TokenEngine; readonly debounceMs?: number },
): TokenTracker & { dispose(): void } {
	let ctx: ExtensionContext | undefined;
	let latest: ContextReport | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	const listeners = new Set<Parameters<TokenTracker["onChange"]>[0]>();

	function cancel(): void {
		clearTimeout(timer);
		timer = undefined;
		controller?.abort();
		controller = undefined;
	}

	function notify(reason: TrackerReason): void {
		for (const listener of listeners) {
			try {
				listener(latest, reason);
			} catch {
				// Consumer failures must not interrupt report delivery to other listeners.
			}
		}
	}

	async function refresh(reason: TrackerReason = "request"): Promise<ContextReport | undefined> {
		cancel();
		if (!ctx?.model) {
			latest = undefined;
			notify(reason);
			return undefined;
		}
		const current = new AbortController();
		controller = current;
		let report: ContextReport | undefined;
		try {
			report = await options.engine.context(ctx, current.signal);
		} catch {
			report = undefined;
		}
		if (controller !== current || current.signal.aborted) return undefined;
		controller = undefined;
		latest = report;
		notify(reason);
		return report;
	}

	function schedule(context: ExtensionContext, reason: TrackerReason): void {
		cancel();
		ctx = context;
		timer = setTimeout(() => {
			void refresh(reason);
		}, options.debounceMs ?? 250);
		timer.unref();
	}

	function shutdown(): void {
		cancel();
		ctx = undefined;
		latest = undefined;
		notify("session_shutdown");
	}

	const unsubscribe = [
		pi.on("session_start", (_event, context) => schedule(context, "session_start")),
		pi.on("model_select", (_event, context) => schedule(context, "model_select")),
		pi.on("message_end", (_event, context) => schedule(context, "message_end")),
		pi.on("turn_end", (_event, context) => schedule(context, "turn_end")),
		pi.on("session_compact", (_event, context) => schedule(context, "session_compact")),
		pi.on("session_tree", (_event, context) => schedule(context, "session_tree")),
		pi.on("session_shutdown", shutdown),
	];

	return {
		latest: () => latest,
		refresh,
		async breakdown(signal) {
			if (!ctx?.model) return undefined;
			try {
				return await options.engine.breakdown(ctx, signal);
			} catch {
				return undefined;
			}
		},
		onChange(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose() {
			for (const off of unsubscribe) off();
			shutdown();
			listeners.clear();
		},
	};
}
