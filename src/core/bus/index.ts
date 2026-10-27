/** Owns the versioned `pi-auth-plus:v1:<area>:<event>` contract on Pi's shared event bus. */
import { randomUUID } from "node:crypto";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { redactValue } from "../redact/index.ts";

export type BusArea = "quotas" | "tokens" | "auth";
export type Decode<T> = (raw: unknown) => T | undefined;

export const BUS_VERSION = "v1";
export const DEFAULT_REQUEST_TIMEOUT_MS = 1_000;

export function channelName(area: BusArea, event: string): string {
	return `pi-auth-plus:${BUS_VERSION}:${area}:${event}`;
}

/** Fire-and-forget broadcast; the payload is redacted before it leaves this package. */
export function publish(bus: EventBus, area: BusArea, event: string, payload: unknown): void {
	bus.emit(channelName(area, event), redactValue(payload));
}

/** Listen to a broadcast; payloads that fail `decode` are dropped. */
export function subscribe<T>(
	bus: EventBus,
	area: BusArea,
	event: string,
	decode: Decode<T>,
	handler: (payload: T) => void,
): () => void {
	return bus.on(channelName(area, event), (raw) => {
		const payload = decode(raw);
		if (payload !== undefined) handler(payload);
	});
}

interface Envelope {
	readonly nonce: string;
	readonly payload: unknown;
}

/** Answer requests on `area:event`; each reply carries the requester's nonce. */
export function serve<Req, Res>(
	bus: EventBus,
	area: BusArea,
	event: string,
	decode: Decode<Req>,
	handler: (request: Req) => Res | Promise<Res>,
): () => void {
	const channel = channelName(area, event);
	return bus.on(channel, async (raw) => {
		const envelope = parseEnvelope(raw);
		if (envelope === undefined) return;
		const request = decode(envelope.payload);
		if (request === undefined) return;
		const response = await handler(request);
		bus.emit(`${channel}:reply`, { nonce: envelope.nonce, payload: redactValue(response) });
	});
}

/** Ask whoever serves `area:event`; resolves undefined when nobody answers in time. */
export function request<Res>(
	bus: EventBus,
	area: BusArea,
	event: string,
	payload: unknown,
	decode: Decode<Res>,
	options: { readonly timeoutMs?: number } = {},
): Promise<Res | undefined> {
	const channel = channelName(area, event);
	const nonce = randomUUID();
	return new Promise((resolve) => {
		const finish = (value: Res | undefined) => {
			clearTimeout(timer);
			off();
			resolve(value);
		};
		const off = bus.on(`${channel}:reply`, (raw) => {
			const envelope = parseEnvelope(raw);
			if (envelope?.nonce !== nonce) return;
			const response = decode(envelope.payload);
			if (response !== undefined) finish(response);
		});
		const timer = setTimeout(
			() => finish(undefined),
			options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		);
		bus.emit(channel, { nonce, payload: redactValue(payload) });
	});
}

function parseEnvelope(raw: unknown): Envelope | undefined {
	if (typeof raw !== "object" || raw === null || !("nonce" in raw) || !("payload" in raw)) {
		return undefined;
	}
	return typeof raw.nonce === "string" ? { nonce: raw.nonce, payload: raw.payload } : undefined;
}
