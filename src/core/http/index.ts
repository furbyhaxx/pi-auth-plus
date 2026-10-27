/** Owns outbound HTTP: abort + timeout, typed provider errors, Retry-After parsing. */
import { type KnownSecrets, redactError, redactText } from "../redact/index.ts";

export const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY_CHARS = 2_000;

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RequestOptions extends RequestInit {
	/** Family or provider id that owns the request; appears in every error. */
	readonly provider: string;
	readonly timeoutMs?: number;
	/** Credential values to scrub from error text. */
	readonly secrets?: KnownSecrets;
	readonly fetch?: FetchFn;
	readonly now?: () => number;
}

/** A non-2xx response; `body` is redacted and truncated, `retryAfterMs` parsed when present. */
export class ProviderHttpError extends Error {
	override readonly name = "ProviderHttpError";
	readonly provider: string;
	readonly status: number;
	readonly url: string;
	readonly body: string;
	readonly retryAfterMs: number | undefined;

	constructor(
		provider: string,
		status: number,
		url: string,
		body: string,
		retryAfterMs: number | undefined,
	) {
		super(`${provider}: HTTP ${status} from ${url}${body ? `: ${body}` : ""}`);
		this.provider = provider;
		this.status = status;
		this.url = url;
		this.body = body;
		this.retryAfterMs = retryAfterMs;
	}
}

/** The request hit its own deadline; distinct from a caller abort, which rethrows as-is. */
export class ProviderTimeoutError extends Error {
	override readonly name = "ProviderTimeoutError";
	readonly provider: string;
	readonly url: string;
	readonly timeoutMs: number;

	constructor(provider: string, url: string, timeoutMs: number) {
		super(
			`${provider}: no response from ${url} within ${timeoutMs} ms; retry or raise the timeout`,
		);
		this.provider = provider;
		this.url = url;
		this.timeoutMs = timeoutMs;
	}
}

/** Fetch that fails typed: timeout, transport errors and non-2xx all carry provider and URL. */
export async function request(url: string | URL, options: RequestOptions): Promise<Response> {
	const { provider, timeoutMs = DEFAULT_TIMEOUT_MS, secrets = [], now = Date.now } = options;
	const fetchFn = options.fetch ?? fetch;
	const safeUrl = redactText(String(url), secrets);
	const deadline = AbortSignal.timeout(timeoutMs);
	const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
	let response: Response;
	try {
		response = await fetchFn(url, { ...stripOptions(options), signal });
	} catch (error) {
		if (deadline.aborted && !options.signal?.aborted) {
			throw new ProviderTimeoutError(provider, safeUrl, timeoutMs);
		}
		if (options.signal?.aborted) throw error;
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`${provider}: request to ${safeUrl} failed: ${redactText(reason, secrets)}`, {
			cause: redactError(error, secrets),
		});
	}
	if (response.ok) return response;
	const text = await response.text().catch(() => "");
	throw new ProviderHttpError(
		provider,
		response.status,
		safeUrl,
		redactText(text.slice(0, MAX_ERROR_BODY_CHARS), secrets),
		parseRetryAfter(response.headers.get("retry-after"), now()),
	);
}

/** `Retry-After` as delay-seconds or HTTP-date, in milliseconds from `nowMs`; never negative. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
	if (value === null) return undefined;
	const trimmed = value.trim();
	if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
	const at = Date.parse(trimmed);
	if (Number.isNaN(at)) return undefined;
	return Math.max(0, at - nowMs);
}

function stripOptions(options: RequestOptions): RequestInit {
	const { provider: _p, timeoutMs: _t, secrets: _s, fetch: _f, now: _n, ...init } = options;
	return init;
}
