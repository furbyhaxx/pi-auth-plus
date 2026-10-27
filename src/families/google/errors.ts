/** Owns Antigravity RPC and stream failure diagnostics. */
import { parseRetryAfter } from "../../core/http/index.ts";
import { type KnownSecrets, redactText } from "../../core/redact/index.ts";

const ENDPOINT = "v1internal:streamGenerateContent";
const RECOVERY: Readonly<Record<string, string>> = {
	RATE_LIMIT_EXCEEDED: "Wait for this model's quota to reset or select another model.",
	INSUFFICIENT_G1_CREDITS_BALANCE: "Check your AI credits balance in Antigravity before retrying.",
	VALIDATION_REQUIRED: "Open Antigravity and complete the account verification before retrying.",
	MODEL_CAPACITY_EXHAUSTED: "Retry later or select another model while capacity is unavailable.",
	RESPONSE_TIMEOUT: "Retry the request; the backend did not answer in time.",
	STREAM_STALLED: "Retry the request; the backend stopped sending mid-response.",
};

/** Safe context for HTTP or in-band RPC failures; include the project id in secrets. */
export interface AntigravityErrorOptions {
	readonly status?: number | undefined;
	readonly retryAfterMs?: number | undefined;
	readonly secrets?: KnownSecrets | undefined;
}

/** A redacted provider failure with a machine-readable reason and recovery action. */
export class AntigravityError extends Error {
	override readonly name = "AntigravityError";
	readonly reason: string;
	readonly status: number | undefined;
	readonly retryAfterMs: number | undefined;
	readonly recovery: string;

	constructor(reason: string, message: string, options: AntigravityErrorOptions = {}) {
		const recovery =
			(Object.hasOwn(RECOVERY, reason) ? RECOVERY[reason] : undefined) ??
			"Retry the request; if it persists, sign in with /login antigravity.";
		super(
			redactText(
				`antigravity: ${ENDPOINT} (${reason}, HTTP ${options.status ?? "unknown"}): ${message}; ${recovery}`,
				options.secrets,
			),
		);
		this.reason = redactText(reason, options.secrets);
		this.status = options.status;
		this.retryAfterMs = options.retryAfterMs;
		this.recovery = recovery;
	}
}

/** Parse raw JSON, a google.rpc Status, or an error envelope without retaining unsafe input. */
export function parseAntigravityError(
	body: unknown,
	options: AntigravityErrorOptions = {},
): AntigravityError {
	let value = body;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			value = { message: value };
		}
	}
	let status = record(value);
	status = record(status?.["response"]) ?? status;
	status = record(status?.["error"]) ?? status;
	const details: unknown[] = Array.isArray(status?.["details"]) ? status["details"] : [];
	let reason = typeof status?.["status"] === "string" ? status["status"] : "UNKNOWN";
	let retryAfterMs = options.retryAfterMs;
	for (const item of details) {
		const detail = record(item);
		if (typeof detail?.["reason"] === "string") reason = detail["reason"];
		if (typeof detail?.["retryDelay"] === "string") {
			const delay = detail["retryDelay"];
			if (/^\d+(?:\.\d+)?s$/.test(delay)) retryAfterMs = parseRetryAfter(delay.slice(0, -1), 0);
		}
	}
	return new AntigravityError(
		reason,
		typeof status?.["message"] === "string" ? status["message"] : "Request failed",
		{
			...options,
			status: options.status ?? (typeof status?.["code"] === "number" ? status["code"] : undefined),
			retryAfterMs,
		},
	);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
