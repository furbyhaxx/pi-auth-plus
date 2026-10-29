/** Owns cancellable token recomputations and reports for the live Pi session. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextReport, TokenEngine } from "../engine/index.ts";
import type { TokenTracker, TrackerReason } from "./types.ts";

type ModelIdentity = { readonly provider: string; readonly id: string } | undefined;
type BranchIdentity = { readonly sessionId: string; readonly leafId: string | null } | undefined;

function modelIdentity(context: ExtensionContext): ModelIdentity {
	const model = context.model;
	return model ? { provider: model.provider, id: model.id } : undefined;
}

function branchIdentity(context: ExtensionContext): BranchIdentity {
	const sessionManager = context.sessionManager;
	return sessionManager
		? { sessionId: sessionManager.getSessionId(), leafId: sessionManager.getLeafId() }
		: undefined;
}

function sameModel(left: ModelIdentity, right: ModelIdentity): boolean {
	return left?.provider === right?.provider && left?.id === right?.id;
}

function sameBranch(left: BranchIdentity, right: BranchIdentity): boolean {
	return left?.sessionId === right?.sessionId && left?.leafId === right?.leafId;
}

/** Registers session events without starting work until a context arrives. */
export function createTokenTracker(
	pi: Pick<ExtensionAPI, "on">,
	options: { readonly engine: TokenEngine; readonly debounceMs?: number },
): TokenTracker & { dispose(): void } {
	let ctx: ExtensionContext | undefined;
	let latest: ContextReport | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	let scheduledModel: ModelIdentity;
	let scheduledBranch: BranchIdentity;
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
		const nextModel = modelIdentity(context);
		const nextBranch = branchIdentity(context);
		const invalidate =
			reason === "session_start" ||
			reason === "thinking_level_select" ||
			!sameModel(scheduledModel, nextModel) ||
			(reason === "session_tree" && !sameBranch(scheduledBranch, nextBranch));
		cancel();
		ctx = context;
		scheduledModel = nextModel;
		scheduledBranch = nextBranch;
		if (invalidate && latest !== undefined) {
			latest = undefined;
			notify(reason);
		}
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
		pi.on("thinking_level_select", (_event, context) => schedule(context, "thinking_level_select")),
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
