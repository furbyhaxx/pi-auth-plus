/** Bounded response-stream restoration of Claude's wire tool names. */
import { TOOL_PREFIX } from "./tool-names.ts";

export const MAX_SSE_LINE_BYTES = 5 * 1024 * 1024;
export const MAX_JSON_TOOL_NAME_BYTES = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
const prefixBytes = encoder.encode(TOOL_PREFIX);
const nameKey = encoder.encode('name"');
const sseName = /("name"[^\S\r\n]*:[^\S\r\n]*")((?:[^"\\\r\n]|\\.)*)(")/g;
const staleHeaders = [
	"content-length",
	"content-encoding",
	"content-md5",
	"content-digest",
	"digest",
	"content-range",
	"etag",
];

/** An upstream line or candidate exceeded the bounded restoration buffer. */
export class ResponseRestoreLimitError extends Error {
	override readonly name = "ResponseRestoreLimitError";

	constructor(kind: string, limit: number) {
		super(`claude: ${kind} exceeds ${limit} byte limit; retry with shorter tool names or content`);
	}
}

function restoreValue(raw: string, restore: (wire: string) => string): string {
	let wire: unknown;
	try {
		wire = JSON.parse(`"${raw}"`);
	} catch {
		return raw;
	}
	return typeof wire === "string" && wire.startsWith(TOOL_PREFIX)
		? JSON.stringify(restore(wire)).slice(1, -1)
		: raw;
}

function sseStream(body: ReadableStream<Uint8Array>, restore: (wire: string) => string) {
	let pending = new Uint8Array(1024);
	let length = 0;
	const rewrite = (text: string) =>
		encoder.encode(
			text.replace(
				sseName,
				(_match, before: string, raw: string, after: string) =>
					`${before}${raw.startsWith(TOOL_PREFIX) ? restoreValue(raw, restore) : raw}${after}`,
			),
		);
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				let lineLength = length;
				let lastBreak = -1;
				let index = 0;
				for (const byte of chunk) {
					if (byte === 10 || byte === 13) {
						lineLength = 0;
						lastBreak = index;
					} else if (++lineLength > MAX_SSE_LINE_BYTES) {
						throw new ResponseRestoreLimitError("SSE line", MAX_SSE_LINE_BYTES);
					}
					index++;
				}
				if (lastBreak >= 0) {
					const text =
						decoder.decode(pending.subarray(0, length), { stream: true }) +
						decoder.decode(chunk.subarray(0, lastBreak + 1));
					controller.enqueue(rewrite(text));
					length = 0;
				}
				const tail = chunk.subarray(lastBreak + 1);
				const required = length + tail.length;
				if (required > pending.length) {
					const grown = new Uint8Array(
						Math.min(MAX_SSE_LINE_BYTES, Math.max(required, pending.length * 2)),
					);
					grown.set(pending.subarray(0, length));
					pending = grown;
				}
				pending.set(tail, length);
				length = required;
			},
			flush(controller) {
				if (length > 0) controller.enqueue(rewrite(decoder.decode(pending.subarray(0, length))));
			},
		}),
	);
}

type JsonState = "outside" | "string" | "colon" | "value" | "candidate";

function jsonStream(body: ReadableStream<Uint8Array>, restore: (wire: string) => string) {
	let state: JsonState = "outside";
	let escaped = false;
	let keyIndex = -1;
	const held = new Uint8Array(MAX_JSON_TOOL_NAME_BYTES);
	let length = 0;
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				let output = new Uint8Array(chunk.length + length + 32);
				let written = 0;
				const append = (bytes: Uint8Array) => {
					const required = written + bytes.length + chunk.length;
					if (required > output.length) {
						const grown = new Uint8Array(Math.max(output.length * 2, required));
						grown.set(output.subarray(0, written));
						output = grown;
					}
					output.set(bytes, written);
					written += bytes.length;
				};
				for (const byte of chunk) {
					if (state === "candidate") {
						if (byte === 34 && !escaped) {
							let raw: string | undefined;
							try {
								raw = fatalDecoder.decode(held.subarray(0, length));
							} catch {
								// Invalid UTF-8 must remain byte-identical, rather than become U+FFFD.
								raw = undefined;
							}
							append(
								raw === undefined
									? held.subarray(0, length)
									: encoder.encode(restoreValue(raw, restore)),
							);
							length = 0;
							state = "outside";
							output[written++] = byte;
							continue;
						}
						if (length === MAX_JSON_TOOL_NAME_BYTES) {
							throw new ResponseRestoreLimitError("JSON tool name", MAX_JSON_TOOL_NAME_BYTES);
						}
						held[length++] = byte;
						if (length <= prefixBytes.length && byte !== prefixBytes[length - 1]) {
							append(held.subarray(0, length));
							length = 0;
							state = byte === 34 ? "outside" : "string";
							keyIndex = -1;
						}
						escaped = !escaped && byte === 92;
						continue;
					}
					output[written++] = byte;
					if (state === "string") {
						if (keyIndex >= 0) {
							keyIndex = byte === nameKey[keyIndex] ? keyIndex + 1 : -1;
						}
						if (byte === 34 && !escaped) {
							state = keyIndex === nameKey.length ? "colon" : "outside";
						}
						escaped = !escaped && byte === 92;
						continue;
					}
					if (state === "colon" || state === "value") {
						if (byte === 32 || byte === 9 || byte === 10 || byte === 13) continue;
						if (state === "colon" && byte === 58) {
							state = "value";
							continue;
						}
						if (state === "value" && byte === 34) {
							state = "candidate";
							escaped = false;
							continue;
						}
						state = "outside";
					}
					if (byte === 34) {
						state = "string";
						keyIndex = 0;
						escaped = false;
					}
				}
				if (written > 0) controller.enqueue(output.subarray(0, written));
			},
			flush(controller) {
				if (length > 0) controller.enqueue(held.slice(0, length));
			},
		}),
	);
}

/** Restores only prefixed tool names, leaving unrelated response media types untouched. */
export function restoreToolNames(response: Response, restore: (wire: string) => string): Response {
	const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
	if (!response.body) return response;
	const json = type === "application/json" || type?.endsWith("+json");
	if (!json && type !== "text/event-stream") return response;
	const headers = new Headers(response.headers);
	for (const name of staleHeaders) headers.delete(name);
	return new Response(
		json ? jsonStream(response.body, restore) : sseStream(response.body, restore),
		{
			status: response.status,
			statusText: response.statusText,
			headers,
		},
	);
}
