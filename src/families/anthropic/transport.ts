/**
 * The request-local fetch for OAuth turns: shapes URL, headers and body once on the way out and
 * restores Pi's tool names on the way back. It never patches global fetch.
 */
import type { FetchFunction, StreamOptions } from "@earendil-works/pi-ai";
import type { TextRule } from "../../core/config/fields.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import { insecureTls, mergeRequestHeaders, shapeBody, shapeHeaders, shapeUrl } from "./request.ts";
import { restoreToolNames } from "./response.ts";

const BEARER_PREFIX = "Bearer ";
const OAUTH_KEY_MARKER = "sk-ant-oat";
const STALE_BODY_HEADERS = ["content-length", "content-md5", "content-digest", "digest"] as const;

/** Bun's fetch extension; Node rejects it, so it is only sent under Bun. */
type BunRequestInit = RequestInit & { tls?: { rejectUnauthorized: boolean } };

/** `ANTHROPIC_INSECURE` needs Bun's per-request TLS option; Node has no equivalent. */
export class InsecureTlsUnsupportedError extends Error {
	override readonly name = "InsecureTlsUnsupportedError";

	constructor() {
		super(
			"claude: ANTHROPIC_INSECURE needs Pi-Bolt or Pi on Bun; trust the proxy's certificate or unset it.",
		);
	}
}

export interface ClaudeTransport {
	readonly token: string;
	readonly version: () => Promise<string>;
	readonly rules: readonly TextRule[];
	readonly restore: (wire: string) => string;
	readonly env: PathEnv;
	readonly underlying?: FetchFunction;
}

/** The subscription token of a request, from header-owned auth or an `sk-ant-oat` key. */
export function oauthToken(options: StreamOptions | undefined): string | undefined {
	for (const [key, value] of Object.entries(options?.headers ?? {})) {
		if (key.toLowerCase() !== "authorization") continue;
		if (value?.startsWith(BEARER_PREFIX)) return value.slice(BEARER_PREFIX.length);
	}
	const key = options?.apiKey;
	return key?.includes(OAUTH_KEY_MARKER) ? key : undefined;
}

async function requestBody(
	input: string | URL | Request,
	init: RequestInit | undefined,
): Promise<RequestInit["body"]> {
	if (init?.body !== undefined) return init.body;
	if (input instanceof Request && input.method !== "GET" && input.method !== "HEAD") {
		return input.clone().text();
	}
	return undefined;
}

export function claudeFetch(transport: ClaudeTransport): FetchFunction {
	const underlying = transport.underlying ?? globalThis.fetch;
	const insecure = insecureTls(transport.env);
	const wrapped = async (input: string | URL | Request, init?: RequestInit) => {
		if (insecure && !("Bun" in globalThis)) throw new InsecureTlsUnsupportedError();
		const version = await transport.version();
		const headers = shapeHeaders(mergeRequestHeaders(input, init), transport.token, version);
		let body = await requestBody(input, init);
		if (typeof body === "string") {
			body = shapeBody(body, version, transport.rules);
			for (const name of STALE_BODY_HEADERS) headers.delete(name);
		}
		const shaped: BunRequestInit = { ...init, body, headers };
		if (insecure) shaped.tls = { rejectUnauthorized: false };
		const response = await underlying(shapeUrl(input, transport.env), shaped);
		return restoreToolNames(response, transport.restore);
	};
	return Object.assign(wrapped, { preconnect: underlying.preconnect });
}
