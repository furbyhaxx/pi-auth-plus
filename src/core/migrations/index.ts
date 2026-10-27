/** Records one-time carry-overs, so a re-run never undoes a later user edit. */
import { join } from "node:path";
import { atomicWriteFile, type JsonRead, readJsonFile } from "../fs/index.ts";
import { type PathEnv, stateDir } from "../paths/index.ts";

/** The marker file listing finished migrations by key. */
export function migrationsPath(env: PathEnv = process.env): string {
	return join(stateDir(env), "migrations.json");
}

async function readDone(path: string): Promise<Record<string, string>> {
	const read: JsonRead = await readJsonFile(path);
	if (read.kind !== "ok" || typeof read.value !== "object" || read.value === null) return {};
	return Object.fromEntries(
		Object.entries(read.value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

/**
 * Runs `migrate` unless `key` is recorded, and records `key` when `migrate` returns true
 * (finished, including "nothing to carry over"). Migrations must be idempotent: two sessions
 * starting at once may both run one.
 */
export async function runOnce(
	key: string,
	migrate: () => Promise<boolean>,
	path: string = migrationsPath(),
): Promise<boolean> {
	if ((await readDone(path))[key] !== undefined) return false;
	if (!(await migrate())) return false;
	const done = await readDone(path);
	done[key] = new Date().toISOString();
	await atomicWriteFile(path, `${JSON.stringify(done, null, "\t")}\n`);
	return true;
}
