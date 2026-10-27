/** Read-only access to our provider slots in Pi's `auth.json`; Pi's `/login` owns every write. */
import { readFileSync } from "node:fs";
import { authPath } from "../paths/index.ts";

/** A stored API key. `key` may be a literal, an env var name or a `!command`, as Pi resolves it. */
export interface StoredApiKey {
	readonly type: "api_key";
	readonly key: string | undefined;
	readonly env: Readonly<Record<string, string>> | undefined;
}

/** A stored OAuth credential; provider-specific extras (account id, project id) stay in `extra`. */
export interface StoredOAuth {
	readonly type: "oauth";
	readonly access: string;
	readonly refresh: string;
	readonly expires: number;
	readonly extra: Readonly<Record<string, unknown>>;
}

export type StoredCredential = StoredApiKey | StoredOAuth;

/** Non-secret summary of a slot, safe for the dashboard, logs and bus payloads. */
export type CredentialStatus =
	| { readonly state: "missing" }
	| { readonly state: "api_key" }
	| { readonly state: "oauth"; readonly expiresAt: number; readonly expired: boolean };

const OAUTH_FIELDS = new Set(["type", "access", "refresh", "expires"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
	if (!isRecord(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) if (typeof entry === "string") out[key] = entry;
	return out;
}

/** Validates one raw slot; anything that is not a credential Pi would accept is `undefined`. */
export function parseCredential(raw: unknown): StoredCredential | undefined {
	if (!isRecord(raw)) return undefined;
	if (raw["type"] === "api_key") {
		const key = raw["key"];
		return {
			type: "api_key",
			key: typeof key === "string" && key.length > 0 ? key : undefined,
			env: stringRecord(raw["env"]),
		};
	}
	if (raw["type"] !== "oauth") return undefined;
	const { access, refresh, expires } = raw;
	if (typeof access !== "string" || typeof refresh !== "string") return undefined;
	if (typeof expires !== "number" || !Number.isFinite(expires)) return undefined;
	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) if (!OAUTH_FIELDS.has(key)) extra[key] = value;
	return { type: "oauth", access, refresh, expires, extra };
}

/**
 * Reads one slot synchronously, for factory-time decisions before any session exists.
 * A missing, unreadable or malformed file reads as no credential, as in Pi's own reader.
 */
export function readCredential(
	providerId: string,
	path = authPath(),
): StoredCredential | undefined {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	try {
		const data: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
		return isRecord(data) ? parseCredential(data[providerId]) : undefined;
	} catch {
		return undefined;
	}
}

export function credentialStatus(
	credential: StoredCredential | undefined,
	nowMs: number,
): CredentialStatus {
	if (!credential) return { state: "missing" };
	if (credential.type === "api_key") return { state: "api_key" };
	return { state: "oauth", expiresAt: credential.expires, expired: credential.expires <= nowMs };
}
