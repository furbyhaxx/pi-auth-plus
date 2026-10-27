/** Locked slot writes to Pi's `auth.json`, sharing Pi's own file lock (proper-lockfile on the file). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";
import { authPath } from "../paths/index.ts";

/** The slice of Pi's credential store a one-time migration needs. */
export type SlotStore = Pick<CredentialStore, "read" | "modify">;

/** Raised when `auth.json` is not a JSON object; the file is never rewritten then. */
export class AuthFileError extends Error {
	override readonly name = "AuthFileError";
}

// Pi's values (`auth-storage.js` acquireLockAsync): a holder older than 30 s is stale.
const STALE_MS = 30_000;
const MAX_DELAY_MS = 1_000;
const WRITE_OPTIONS = { encoding: "utf8", mode: 0o600 } as const;

type Data = Record<string, unknown>;

function parse(text: string): Data {
	let data: unknown;
	try {
		data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch {
		// The parser's message can quote file content, which holds tokens.
		throw new AuthFileError("auth.json is not valid JSON");
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new AuthFileError("auth.json is not a JSON object");
	}
	return data as Data;
}

async function acquire(
	path: string,
	signal: AbortSignal | undefined,
	onCompromised: (error: Error) => void,
): Promise<() => Promise<void>> {
	const deadline = Date.now() + STALE_MS;
	for (let attempt = 0; ; attempt++) {
		signal?.throwIfAborted();
		try {
			return await lockfile.lock(path, {
				realpath: false,
				retries: 0,
				stale: STALE_MS,
				onCompromised,
			});
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ELOCKED" || Date.now() >= deadline) throw error;
			await sleep(Math.min(10 * 2 ** attempt, MAX_DELAY_MS), undefined, { signal });
		}
	}
}

/** A store over one `auth.json`; every read and write holds the lock Pi's `/login` takes. */
export function authFileStore(path = authPath()): SlotStore {
	async function locked<T>(
		fn: (data: Data) => Promise<{ result: T; next?: Data }>,
		signal?: AbortSignal,
	): Promise<T> {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		if (!existsSync(path)) writeFileSync(path, "{}", WRITE_OPTIONS);
		let compromised: Error | undefined;
		const release = await acquire(path, signal, (error) => {
			compromised = error;
		});
		try {
			const { result, next } = await fn(parse(readFileSync(path, "utf8")));
			if (compromised) throw compromised;
			if (next) writeFileSync(path, JSON.stringify(next, null, 2), WRITE_OPTIONS);
			return result;
		} finally {
			await release().catch(() => undefined);
		}
	}

	return {
		read: (providerId, options) =>
			locked(
				async (data) => ({ result: data[providerId] as Credential | undefined }),
				options?.signal,
			),
		modify: (providerId, fn, options) =>
			locked(async (data) => {
				const current = data[providerId] as Credential | undefined;
				const next = await fn(current);
				if (next === undefined) return { result: current };
				return { result: next, next: { ...data, [providerId]: next } };
			}, options?.signal),
	};
}
