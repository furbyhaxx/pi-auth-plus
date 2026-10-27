/** Owns crash-safe file writes and JSON reads shared by config and cache. */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface WriteOptions {
	/** File mode; secrets and caches use 0o600. */
	readonly mode?: number;
	/** Mode for created parent directories. */
	readonly dirMode?: number;
}

/** Write via a sibling temp file and rename, so readers never see a partial file. */
export async function atomicWriteFile(
	path: string,
	content: string,
	options: WriteOptions = {},
): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, {
		recursive: true,
		...(options.dirMode === undefined ? {} : { mode: options.dirMode }),
	});
	const temp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
	try {
		await writeFile(temp, content, { encoding: "utf8", mode: options.mode ?? 0o644 });
		await rename(temp, path);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}

export type JsonRead =
	| { readonly kind: "missing" }
	| { readonly kind: "ok"; readonly value: unknown }
	| { readonly kind: "malformed"; readonly reason: string };

/** Read and parse JSON; a missing file is a normal outcome, not an error. */
export async function readJsonFile(path: string): Promise<JsonRead> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isErrno(error, "ENOENT")) return { kind: "missing" };
		throw error;
	}
	try {
		return { kind: "ok", value: JSON.parse(text) };
	} catch (error) {
		return { kind: "malformed", reason: error instanceof Error ? error.message : String(error) };
	}
}

export function isErrno(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
