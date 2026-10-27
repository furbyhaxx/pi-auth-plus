/** Cross-process advisory lock via an exclusively created sibling file. */
import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { isErrno } from "../fs/index.ts";

export interface LockOptions {
	/** A lock older than this is treated as abandoned by a crashed process. */
	readonly staleMs?: number;
	/** Give up waiting after this long and run unlocked; the cache is best-effort. */
	readonly waitMs?: number;
	/** Mode for a created parent directory. */
	readonly dirMode?: number;
}

const RETRY_MS = 15;

/** Run `fn` while holding `<path>.lock`. */
export async function withFileLock<T>(
	path: string,
	fn: () => Promise<T>,
	options: LockOptions = {},
): Promise<T> {
	const lockPath = `${path}.lock`;
	await mkdir(dirname(path), { recursive: true, mode: options.dirMode ?? 0o700 });
	const held = await acquire(lockPath, options.staleMs ?? 5_000, options.waitMs ?? 2_000);
	try {
		return await fn();
	} finally {
		if (held) await rm(lockPath, { force: true });
	}
}

async function acquire(lockPath: string, staleMs: number, waitMs: number): Promise<boolean> {
	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			const handle = await open(lockPath, "wx", 0o600);
			await handle.writeFile(String(process.pid));
			await handle.close();
			return true;
		} catch (error) {
			if (!isErrno(error, "EEXIST")) throw error;
		}
		const age = await stat(lockPath).then(
			(s) => Date.now() - s.mtimeMs,
			() => 0,
		);
		if (age > staleMs) {
			await rm(lockPath, { force: true });
			continue;
		}
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
	}
}
