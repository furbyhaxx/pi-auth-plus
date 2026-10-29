/** Cheap typed consumers for the session token bus; service imports are type-only. */
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { channelName, subscribe } from "../core/bus/index.ts";
import type {
	TokenContextPayload,
	TokenQueryRequest,
	TokenQueryResult,
	TokenReadyPayload,
} from "../tokens/bus.ts";
import { decodeTokenContext, decodeTokenReady, decodeTokenReply } from "./decode.ts";
import { ask, type QuotaRequestOptions } from "./request.ts";

/** Versioned token channels; requests use core/bus nonce reply envelopes. */
export const TOKEN_CHANNELS = {
	ready: channelName("tokens", "ready"),
	context: channelName("tokens", "context"),
	query: channelName("tokens", "query"),
} as const;

/** Queries context and optional contributions with the quota helpers' timeout and abort policy. */
export function queryTokens(
	events: EventBus,
	request: TokenQueryRequest = {},
	options: QuotaRequestOptions = {},
): Promise<TokenQueryResult> {
	return ask(events, "tokens", "query", request, decodeTokenReply, options);
}

/** Subscribes to validated context changes; returns an unsubscribe function. */
export function onTokenContext(
	events: EventBus,
	listener: (payload: TokenContextPayload) => void,
): () => void {
	return subscribe(events, "tokens", "context", decodeTokenContext, listener);
}

/** Subscribes to validated service announcements; subscribe before service registration. */
export function onTokensReady(
	events: EventBus,
	listener: (payload: TokenReadyPayload) => void,
): () => void {
	return subscribe(events, "tokens", "ready", decodeTokenReady, listener);
}

export type {
	/** A versioned context update, including explicit clearing. */
	TokenContextPayload,
	/** Recompute and full-request contribution query flags. */
	TokenQueryRequest,
	/** A nullable context report with optional contributions. */
	TokenQueryResult,
	/** The token service's supported channels. */
	TokenReadyPayload,
	/** Query success or refusal within a nonce envelope. */
	TokenReply,
} from "../tokens/bus.ts";
export type {
	/** A full-request contribution count. */
	BreakdownPart,
	/** The current model's context count and comparison metrics. */
	ContextReport,
} from "../tokens/engine/index.ts";
export type {
	/** Why the session tracker recomputed. */
	TrackerReason,
} from "../tokens/tracker/types.ts";
export type {
	/** A token count tagged with its authority. */
	TokenCount,
	/** A user-actionable explanation for a token count that needs authentication. */
	TokenDiagnostic,
	/** The origin of a token count. */
	TokenSource,
} from "../tokens/types.ts";
