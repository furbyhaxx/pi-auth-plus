import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { AuthFileError, authFileStore } from "../../src/core/auth/store.ts";

let dir: string;
let path: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "auth-plus-store-"));
	path = join(dir, "auth.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const oauth = { type: "oauth", access: "a", refresh: "r", expires: 2_000 } as const;

describe("core/auth/store", () => {
	test("a write waits for Pi's lock on auth.json and keeps the other slots", async () => {
		await writeFile(path, JSON.stringify({ google: { type: "api_key", key: "k" } }), {
			mode: 0o600,
		});
		const releasePi = await lockfile.lock(path, { realpath: false, stale: 30_000 });
		let written = false;
		const write = authFileStore(path)
			.modify("antigravity", async () => oauth)
			.then(() => {
				written = true;
			});

		await Bun.sleep(150);
		expect(written).toBe(false);
		// Pi rewrote the file while holding the lock; the store must see that version.
		await writeFile(path, JSON.stringify({ google: { type: "api_key", key: "k2" } }));
		await releasePi();
		await write;

		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
			google: { type: "api_key", key: "k2" },
			antigravity: oauth,
		});
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	test("a malformed auth.json is never rewritten and its content is not echoed", async () => {
		const broken = '{"google": {"access": "ya29.secret-token"';
		await writeFile(path, broken, { mode: 0o600 });

		const error = await authFileStore(path)
			.modify("antigravity", async () => oauth)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(AuthFileError);
		expect(String(error)).not.toContain("ya29");
		expect(await readFile(path, "utf8")).toBe(broken);
	});
});
