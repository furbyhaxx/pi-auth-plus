/** The OpenCode CLI identity Zen's free tier checks: user agent, client headers and native ids. */

/** CLI version imitated in `User-Agent`; tracked in `.project/analyses/opencode-cli/tracking.md`. */
export const CLI_VERSION = "1.18.18";
export const CLI_PROJECT = "global";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TIME_BYTES = 6;
const RANDOM_CHARS = 14;
const TIME_MASK = (1n << BigInt(TIME_BYTES * 8)) - 1n;

/** Monotonic id source matching the CLI's `packages/schema/src/identifier.ts` format. */
export class IdSource {
	#lastMs = 0;
	#counter = 0;
	readonly #random: (length: number) => Uint8Array;

	constructor(
		random: (length: number) => Uint8Array = (length) =>
			crypto.getRandomValues(new Uint8Array(length)),
	) {
		this.#random = random;
	}

	/** `ses_` + descending id: newer sessions sort first. */
	session(nowMs: number): string {
		return `ses_${this.#id(nowMs, true)}`;
	}

	/** `msg_` + ascending id: the per-request user-message id. */
	request(nowMs: number): string {
		return `msg_${this.#id(nowMs, false)}`;
	}

	#id(nowMs: number, descending: boolean): string {
		if (nowMs !== this.#lastMs) {
			this.#lastMs = nowMs;
			this.#counter = 0;
		}
		this.#counter += 1;
		const stamp = BigInt(nowMs) * 0x1000n + BigInt(this.#counter);
		const value = (descending ? ~stamp : stamp) & TIME_MASK;
		const hex = value.toString(16).padStart(TIME_BYTES * 2, "0");
		const tail = Array.from(this.#random(RANDOM_CHARS), (byte) => BASE62[byte % 62]).join("");
		return hex + tail;
	}
}

type Headers = Record<string, string | null>;

function headerKey(headers: Headers, name: string): string | undefined {
	const lower = name.toLowerCase();
	return Object.keys(headers).find((key) => key.toLowerCase() === lower);
}

function setHeader(headers: Headers, name: string, value: string): void {
	const existing = headerKey(headers, name);
	if (existing !== undefined) delete headers[existing];
	headers[name] = value;
}

/**
 * Rewrites Pi's OpenCode attribution (`x-opencode-client: pi`, Pi's session id) into the CLI's
 * identity, in place. Pi's own `x-opencode-*` stamp is the only marker of an OpenCode request in
 * `before_provider_headers`, so headers without it are left alone. Returns whether it rewrote.
 */
export function applyCliIdentity(headers: Headers, sessionId: string, requestId: string): boolean {
	const stamped =
		headerKey(headers, "x-opencode-client") !== undefined ||
		headerKey(headers, "x-opencode-session") !== undefined;
	if (!stamped) return false;
	setHeader(headers, "User-Agent", `opencode/${CLI_VERSION}`);
	setHeader(headers, "x-opencode-client", "cli");
	setHeader(headers, "x-opencode-project", CLI_PROJECT);
	setHeader(headers, "x-opencode-session", sessionId);
	setHeader(headers, "x-opencode-request", requestId);
	return true;
}
