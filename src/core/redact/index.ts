/** Owns secret redaction for errors, captures, logs and bus payloads. */

export const REDACTED = "[redacted]";

/** Exact credential values known at the call site (access token, API key, refresh token). */
export type KnownSecrets = readonly (string | undefined)[];

const MIN_EXACT_SECRET_LENGTH = 8;

const SENSITIVE_KEY =
	/^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|secret|client[-_]?secret|(?:access|refresh|id|session|bearer)[-_]?token|token)$/i;

const TEXT_PATTERNS: readonly RegExp[] = [
	/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
	/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
	/\bsk-ant-[A-Za-z0-9_-]{8,}/g,
	/\bsk-[A-Za-z0-9_-]{20,}/g,
	/\bya29\.[A-Za-z0-9._-]+/g,
	/\b1\/\/[A-Za-z0-9_-]{20,}/g,
	/\bxai-[A-Za-z0-9]{20,}/g,
	/\bsyn_[A-Za-z0-9]{16,}/g,
];

const JSON_FIELD =
	/("(?:access_token|refresh_token|id_token|api_key|apiKey|client_secret|password|token)"\s*:\s*")[^"]*(")/g;
const QUERY_FIELD = /([?&](?:key|api_key|access_token|token)=)[^&#\s]+/gi;

/** Replace known secret values and recognizable token shapes in free text. */
export function redactText(text: string, secrets: KnownSecrets = []): string {
	let out = text;
	for (const secret of secrets) {
		if (secret !== undefined && secret.length >= MIN_EXACT_SECRET_LENGTH) {
			out = out.split(secret).join(REDACTED);
		}
	}
	for (const pattern of TEXT_PATTERNS) out = out.replace(pattern, REDACTED);
	return out.replace(JSON_FIELD, `$1${REDACTED}$2`).replace(QUERY_FIELD, `$1${REDACTED}`);
}

/** Deep copy with sensitive keys masked and every string scrubbed; cycles become "[circular]". */
export function redactValue(value: unknown, secrets: KnownSecrets = []): unknown {
	return scrub(value, secrets, new WeakSet());
}

/** A new Error with a scrubbed message, name and own fields; a secret-bearing cause is dropped. */
export function redactError(error: unknown, secrets: KnownSecrets = []): Error {
	if (!(error instanceof Error)) return new Error(redactText(String(error), secrets));
	const safe = new Error(redactText(error.message, secrets));
	safe.name = redactText(error.name, secrets);
	for (const key of Object.keys(error)) {
		if (key === "message" || key === "name" || key === "cause") continue;
		Object.defineProperty(safe, key, {
			value: redactValue((error as unknown as Record<string, unknown>)[key], secrets),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	if (error.cause !== undefined) safe.cause = redactError(error.cause, secrets);
	return safe;
}

function scrub(value: unknown, secrets: KnownSecrets, seen: WeakSet<object>): unknown {
	if (typeof value === "string") return redactText(value, secrets);
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	if (value instanceof Error) return redactError(value, secrets);
	if (Array.isArray(value)) return value.map((item) => scrub(item, secrets, seen));
	if (value instanceof Headers) {
		const headers: Record<string, string> = {};
		for (const [key, item] of value) headers[key] = maskField(key, item, secrets);
		return headers;
	}
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		out[key] =
			SENSITIVE_KEY.test(key) && item !== undefined ? REDACTED : scrub(item, secrets, seen);
	}
	return out;
}

function maskField(key: string, value: string, secrets: KnownSecrets): string {
	return SENSITIVE_KEY.test(key) ? REDACTED : redactText(value, secrets);
}
