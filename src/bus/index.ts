/** Cheap typed consumers for pi-auth-plus' versioned quota and token buses. */
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { channelName, subscribe } from "../core/bus/index.ts";
import type {
	QuotaEventPayload,
	QuotaQueryRequest,
	QuotaReadyPayload,
	QuotaRefreshRequest,
	QuotaSnapshotPayload,
} from "../quotas/bus.ts";
import type { QuotaReport } from "../quotas/report.ts";
import type { ResetCreditList, ResetOutcome } from "../quotas/types.ts";
import {
	decodeEvent,
	decodeOutcome,
	decodeReady,
	decodeReply,
	decodeReport,
	decodeResets,
	decodeSnapshot,
} from "./decode.ts";
import { ask, type QuotaRequestOptions } from "./request.ts";

export { QuotaBusError, type QuotaRequestOptions } from "./request.ts";
export * from "./tokens.ts";

/** Versioned broadcast and request channels; replies use core/bus nonce envelopes. */
export const QUOTA_CHANNELS = {
	ready: channelName("quotas", "ready"),
	snapshot: channelName("quotas", "snapshot"),
	event: channelName("quotas", "event"),
	query: channelName("quotas", "query"),
	refresh: channelName("quotas", "refresh"),
	resets: channelName("quotas", "resets"),
	reset: channelName("quotas", "reset"),
} as const;

/** Reads cached quotas, fetching entries older than maxAgeSec first. */
export function queryQuotas(
	events: EventBus,
	query: QuotaQueryRequest = {},
	options: QuotaRequestOptions = {},
): Promise<QuotaReport> {
	return ask(
		events,
		"quotas",
		"query",
		query,
		(raw) => decodeReply(raw, "report", decodeReport),
		options,
	);
}
/** Fetches selected providers, optionally bypassing freshness and backoff. */
export function refreshQuotas(
	events: EventBus,
	refresh: QuotaRefreshRequest = {},
	options: QuotaRequestOptions = {},
): Promise<QuotaReport> {
	return ask(
		events,
		"quotas",
		"refresh",
		refresh,
		(raw) => decodeReply(raw, "report", decodeReport),
		options,
	);
}
/** Lists available on-demand reset credits without spending them. */
export function listQuotaResets(
	events: EventBus,
	provider: string,
	options: QuotaRequestOptions = {},
): Promise<ResetCreditList> {
	return ask(
		events,
		"quotas",
		"resets",
		{ provider },
		(raw) => decodeReply(raw, "resets", decodeResets),
		options,
	);
}
/** Requests a user-approved reset, waiting up to 180 seconds for the dialog by default. */
export function requestQuotaReset(
	events: EventBus,
	reset: { provider: string; creditId?: string; confirm: true },
	options: QuotaRequestOptions = {},
): Promise<ResetOutcome> {
	return ask(
		events,
		"quotas",
		"reset",
		reset,
		(raw) => decodeReply(raw, "outcome", decodeOutcome),
		{
			...options,
			timeoutMs: options.timeoutMs ?? 180_000,
		},
	);
}
/** Subscribes to validated service announcements; returns an unsubscribe function. */
export function subscribeQuotaReady(
	events: EventBus,
	handler: (payload: QuotaReadyPayload) => void,
): () => void {
	return subscribe(events, "quotas", "ready", decodeReady, handler);
}
/** Subscribes to validated changed provider rows; returns an unsubscribe function. */
export function subscribeQuotaSnapshot(
	events: EventBus,
	handler: (payload: QuotaSnapshotPayload) => void,
): () => void {
	return subscribe(events, "quotas", "snapshot", decodeSnapshot, handler);
}
/** Subscribes to validated quota transitions; returns an unsubscribe function. */
export function subscribeQuotaEvent(
	events: EventBus,
	handler: (payload: QuotaEventPayload) => void,
): () => void {
	return subscribe(events, "quotas", "event", decodeEvent, handler);
}
export type {
	/** Actionable quota transitions and confirmed reset events. */
	QuotaEventPayload,
	/** Cached quota query parameters. */
	QuotaQueryRequest,
	/** Service announcement with enabled providers and capabilities. */
	QuotaReadyPayload,
	/** Quota refresh parameters. */
	QuotaRefreshRequest,
	/** Quota report success or refusal inside a nonce envelope. */
	QuotaReply,
	/** Reset listing, outcome or refusal inside a nonce envelope. */
	QuotaResetReply,
	/** Reset spending wire parameters; the helper requires confirm to be true. */
	QuotaResetRequest,
	/** Read-only reset listing wire parameters. */
	QuotaResetsRequest,
	/** One changed provider's report row. */
	QuotaSnapshotPayload,
} from "../quotas/bus.ts";
export type {
	/** Versioned report for the requested providers. */
	QuotaReport,
	/** Balance and optional drainage metrics. */
	ReportCredits,
	/** One provider's public quota state. */
	ReportProvider,
	/** Normalized quota window with optional derived metrics. */
	ReportWindow,
} from "../quotas/report.ts";
export type {
	/** One on-demand reset credit. */
	ResetCredit,
	/** Provider reset credit inventory. */
	ResetCreditList,
	/** Provider verdict on a reset request. */
	ResetOutcome,
	/** Machine-readable reset verdict code. */
	ResetOutcomeCode,
} from "../quotas/types.ts";
