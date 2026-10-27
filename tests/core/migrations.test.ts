import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOnce } from "../../src/core/migrations/index.ts";

test("a finished migration never runs again; an unfinished one retries", async () => {
	const path = join(await mkdtemp(join(tmpdir(), "apx-migrations-")), "migrations.json");
	let runs = 0;
	const run = (finished: boolean) => async () => {
		runs++;
		return finished;
	};
	expect(await runOnce("a", run(false), path)).toBe(false);
	expect(await runOnce("a", run(true), path)).toBe(true);
	expect(await runOnce("a", run(true), path)).toBe(false);
	expect(await runOnce("b", async () => true, path)).toBe(true);
	expect(runs).toBe(2);
	expect(Object.keys(JSON.parse(await readFile(path, "utf8")))).toEqual(["a", "b"]);
});
