/** Cheap typed consumers for pi-auth-plus' versioned quota bus. */
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { channelName, request, subscribe } from "../core/bus/index.ts";
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

/** Bounds requests to 15 seconds by default and supports caller cancellation. */
export interface QuotaRequestOptions {
	readonly timeoutMs?: number | undefined;
	readonly signal?: AbortSignal | undefined;
}
/** A refused, unanswered or cancelled quota request. */
export class QuotaBusError extends Error {
	/** Machine-readable request failure. */
	readonly reason: "rejected" | "timeout" | "aborted";
	/** Creates a failure with the service's refusal or transport recovery message. */
	constructor(reason: "rejected" | "timeout" | "aborted", message: string) {
		super(message);
		this.name = "QuotaBusError";
		this.reason = reason;
	}
}
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

async function ask<T>(
	events: EventBus,
	event: string,
	payload: unknown,
	key: string,
	decode: (raw: unknown) => T | undefined,
	options: QuotaRequestOptions,
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 15_000;
	let reply: { ok: true; value: T } | { ok: false; error: string } | undefined;
	try {
		reply = await request(
			events,
			"quotas",
			event,
			payload,
			(raw) => decodeReply(raw, key, decode),
			{ timeoutMs, signal: options.signal },
		);
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError")
			throw new QuotaBusError("aborted", "Quota request aborted");
		throw error;
	}
	if (reply === undefined)
		throw new QuotaBusError(
			"timeout",
			`pi-auth-plus did not answer ${channelName("quotas", event)} within ${timeoutMs} ms; is the extension loaded?`,
		);
	if (!reply.ok) throw new QuotaBusError("rejected", reply.error);
	return reply.value;
}
/** Reads cached quotas, fetching entries older than maxAgeSec first. */
export function queryQuotas(
	events: EventBus,
	query: QuotaQueryRequest = {},
	options: QuotaRequestOptions = {},
): Promise<QuotaReport> {
	return ask(events, "query", query, "report", decodeReport, options);
}
/** Fetches selected providers, optionally bypassing freshness and backoff. */
export function refreshQuotas(
	events: EventBus,
	refresh: QuotaRefreshRequest = {},
	options: QuotaRequestOptions = {},
): Promise<QuotaReport> {
	return ask(events, "refresh", refresh, "report", decodeReport, options);
}
/** Lists available on-demand reset credits without spending them. */
export function listQuotaResets(
	events: EventBus,
	provider: string,
	options: QuotaRequestOptions = {},
): Promise<ResetCreditList> {
	return ask(events, "resets", { provider }, "resets", decodeResets, options);
}
/** Requests a user-approved reset, waiting up to 180 seconds for the dialog by default. */
export function requestQuotaReset(
	events: EventBus,
	reset: { provider: string; creditId?: string; confirm: true },
	options: QuotaRequestOptions = {},
): Promise<ResetOutcome> {
	return ask(events, "reset", reset, "outcome", decodeOutcome, {
		...options,
		timeoutMs: options.timeoutMs ?? 180_000,
	});
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
