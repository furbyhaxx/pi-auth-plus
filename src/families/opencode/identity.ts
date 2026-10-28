/** The OpenCode CLI identity Zen's free tier checks: user agent, client headers and native ids. */

/** CLI version imitated in `User-Agent`; tracked in `.project/analyses/opencode-cli/tracking.md`. */
export const CLI_VERSION = "2.1.2";
/** The CLI's `opencode/<channel>/<version>/<client>` user agent. */
export const CLI_USER_AGENT = `opencode/latest/${CLI_VERSION}/cli`;
/** Project id the CLI sends outside a git repository. */
export const CLI_PROJECT = "global";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TIME_BYTES = 6;
const RANDOM_CHARS = 14;
const TIME_MASK = (1n << BigInt(TIME_BYTES * 8)) - 1n;

/** Session ids in the CLI's descending-ULID format: newer sessions sort first. */
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

	session(nowMs: number): string {
		return `ses_${this.#id(nowMs)}`;
	}

	#id(nowMs: number): string {
		if (nowMs !== this.#lastMs) {
			this.#lastMs = nowMs;
			this.#counter = 0;
		}
		this.#counter += 1;
		const stamp = BigInt(nowMs) * 0x1000n + BigInt(this.#counter);
		const value = ~stamp & TIME_MASK;
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
	const lower = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === lower) delete headers[key];
	}
	headers[name] = value;
}

/**
 * Rewrites Pi's OpenCode attribution (`x-opencode-client: pi`, Pi's session id) into the CLI's
 * identity, in place. Pi's own `x-opencode-*` stamp is the only marker of an OpenCode request in
 * `before_provider_headers`, so headers without it are left alone unless the provider is verified.
 * Zen requires the `opencode/` agent, client `cli` and a `ses_` session-affinity id.
 */
export function applyCliIdentity(headers: Headers, sessionId: string, force = false): boolean {
	const stamped =
		headerKey(headers, "x-opencode-client") !== undefined ||
		headerKey(headers, "x-opencode-session") !== undefined;
	if (!stamped && !force) return false;
	setHeader(headers, "User-Agent", CLI_USER_AGENT);
	setHeader(headers, "x-opencode-client", "cli");
	setHeader(headers, "x-opencode-project", CLI_PROJECT);
	for (const name of [
		"x-opencode-session",
		"x-opencode-session-id",
		"x-session-affinity",
		"X-Session-Id",
	]) {
		setHeader(headers, name, sessionId);
	}
	return true;
}

/** The CLI's environment block; Zen's free tier refuses system prompts without its working directory. */
export function envBlock(cwd: string, platform: string): string {
	return `<env>\n  Working directory: ${cwd}\n  Platform: ${platform}\n</env>`;
}

interface ChatMessage {
	role?: unknown;
	content?: unknown;
}

/**
 * Appends the env block to the system message of a chat-completions payload, in place. Every free
 * Zen model speaks chat completions; other payload shapes and prompts that already carry an
 * `<env>` block are left alone. Returns whether it changed the payload.
 */
export function applyCliEnv(payload: unknown, block: string): boolean {
	if (typeof payload !== "object" || payload === null) return false;
	const messages = (payload as { messages?: unknown }).messages;
	if (!Array.isArray(messages)) return false;
	const system = messages.find(
		(message: ChatMessage) => message?.role === "system" || message?.role === "developer",
	) as ChatMessage | undefined;
	if (!system) return false;
	if (typeof system.content === "string") {
		if (system.content.includes("<env>")) return false;
		system.content = `${system.content}\n\n${block}`;
		return true;
	}
	if (Array.isArray(system.content)) {
		const parts = system.content as Array<{ type?: unknown; text?: unknown }>;
		if (parts.some((part) => typeof part?.text === "string" && part.text.includes("<env>")))
			return false;
		parts.push({ type: "text", text: block });
		return true;
	}
	return false;
}
