/** Owns the legacy Codex credential contract and safe authentication failures. */
import type { FetchFn } from "../../../core/http/index.ts";

/** Byte-compatible with pi-quotas' quotas-codex-auth.json. Expiry is epoch milliseconds. */
export interface CodexCredential {
	readonly type: "oauth";
	readonly access: string;
	readonly refresh: string;
	readonly expires: number;
	readonly accountId?: string | undefined;
	readonly email?: string | undefined;
	readonly planType?: string | undefined;
}

/** A safe error that never includes provider payloads or credential values. */
export class CodexAuthError extends Error {
	override readonly name = "CodexAuthError";
	readonly status: number | undefined;
	readonly operation: string;
	readonly endpoint: string;

	constructor(operation: string, endpoint: string, status?: number) {
		super(
			`codex: ${operation} at ${endpoint}${status === undefined ? "" : ` (HTTP ${status})`}; retry Codex login`,
		);
		this.operation = operation;
		this.endpoint = endpoint;
		this.status = status;
	}
}

/** Injectable dependencies shared by login and token resolution. */
export interface CodexOptions {
	readonly path?: string;
	readonly fetch?: FetchFn;
	readonly now?: () => number;
	readonly signal?: AbortSignal;
	readonly onError?: (error: CodexAuthError) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}
