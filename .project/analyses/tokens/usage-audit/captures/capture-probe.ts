// Throwaway capture probe for the M3 usage audit. Read-only observation only:
// wraps globalThis.fetch to record request/response bodies (never auth header
// values) plus Pi's provider_stream_event and message_end usage.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const dir = process.env.PROBE_DIR ?? "/tmp/liveaudit/caps";
mkdirSync(dir, { recursive: true });

const MAX_BODY = 2_000_000;
let counter = 0;
let pending: Promise<void>[] = [];
const label = process.env.PROBE_LABEL ?? "run";
const nextId = (prefix: string) => `${Date.now()}-${label}-${prefix}-${String(++counter).padStart(3, "0")}`;

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…[truncated]` : text;
	}
}

function save(name: string, value: unknown): Promise<void> {
	const job = (async () => {
		writeFileSync(join(dir, `${name}.json`), JSON.stringify(value, null, 2));
	})().catch(() => {});
	pending.push(job);
	return job;
}

const HEADER_KEEP = new Set([
	"content-type",
	"content-length",
	"x-request-id",
	"anthropic-ratelimit-input-tokens-remaining",
]);

function headerSummary(headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of headers) {
		const lower = key.toLowerCase();
		if (HEADER_KEEP.has(lower)) out[lower] = value;
		else if (lower === "user-agent" || lower === "x-opencode-client") out[lower] = value;
	}
	return out;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const id = nextId("req");
	let url = "";
	try {
		url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	} catch {}
	let requestBody: unknown;
	let sentHeaders: Record<string, string> = {};
	try {
		sentHeaders = headerSummary(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
		if (init?.body !== undefined) {
			if (typeof init.body === "string") requestBody = safeJson(init.body);
			else if (init.body instanceof Uint8Array) requestBody = safeJson(new TextDecoder().decode(init.body));
		} else if (input instanceof Request && input.method !== "GET" && input.method !== "HEAD") {
			requestBody = safeJson(await input.clone().text());
		}
	} catch {}

	const response = await originalFetch(input as RequestInfo, init);
	const record: Record<string, unknown> = {
		id,
		url,
		status: response.status,
		requestHeaders: sentHeaders,
		responseHeaders: Object.fromEntries(response.headers),
		requestBody,
	};
	const body = response.body;
	if (!body) {
		await save(id, record);
		return response;
	}
	const [keep, copy] = body.tee();
	void (async () => {
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for await (const chunk of copy as unknown as AsyncIterable<Uint8Array>) {
				if (size < MAX_BODY) chunks.push(chunk);
				size += chunk.length;
			}
		} catch {}
		const text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
		record.responseBytes = size;
		record.responseBody = safeJson(text);
		await save(id, record);
	})();
	return new Response(keep, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}) as typeof globalThis.fetch;

export default function (pi: ExtensionAPI) {
	pi.on("message_end", async (event) => {
		const message = event.message as Record<string, unknown>;
		await save(`msgend-${nextId("m")}`, {
			role: message.role,
			provider: message.provider,
			api: message.api,
			model: message.model,
			stopReason: message.stopReason,
			usage: message.usage,
			responseModel: message.responseModel,
			timestamp: message.timestamp,
			blocks: Array.isArray(message.content)
				? (message.content as Record<string, unknown>[]).map((b) => b.type)
				: [],
		});
		return undefined;
	});

	pi.on("before_provider_request", async (event) => {
		await save(`payload-${nextId("p")}`, { payload: event.payload });
		return undefined;
	});

	pi.on("provider_stream_event", async (event) => {
		const data = event.data as Record<string, unknown> | undefined;
		const type = typeof data?.type === "string" ? data.type : "?";
		await save(`stream-${nextId("s")}-${type.replace(/[^a-z0-9.]/gi, "_")}`, {
			provider: event.provider,
			api: event.api,
			model: event.model,
			data: event.data,
		});
		return undefined;
	});

	pi.on("agent_end", async () => {
		await Promise.allSettled(pending);
		pending = [];
		return undefined;
	});
}
