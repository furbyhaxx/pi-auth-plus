/** Shared request failures and bounded nonce transport for typed bus consumers. */
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { type BusArea, channelName, request } from "../core/bus/index.ts";

/** Bounds requests to 15 seconds by default and supports caller cancellation. */
export interface QuotaRequestOptions {
	readonly timeoutMs?: number | undefined;
	readonly signal?: AbortSignal | undefined;
}
/** A refused, unanswered or cancelled bus request. */
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
/** Requests a decoded success, preserving quota error compatibility across bus areas. */
export async function ask<T>(
	events: EventBus,
	area: BusArea,
	event: string,
	payload: unknown,
	decode: (raw: unknown) => { ok: true; value: T } | { ok: false; error: string } | undefined,
	options: QuotaRequestOptions,
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 15_000;
	let reply: { ok: true; value: T } | { ok: false; error: string } | undefined;
	try {
		reply = await request(events, area, event, payload, decode, {
			timeoutMs,
			signal: options.signal,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError")
			throw new QuotaBusError(
				"aborted",
				`${area === "quotas" ? "Quota" : "Token"} request aborted`,
			);
		throw error;
	}
	if (reply === undefined)
		throw new QuotaBusError(
			"timeout",
			`pi-auth-plus did not answer ${channelName(area, event)} within ${timeoutMs} ms; is the extension loaded?`,
		);
	if (!reply.ok) throw new QuotaBusError("rejected", reply.error);
	return reply.value;
}
