import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialStatus, readCredential } from "../../src/core/auth/index.ts";

let dir: string;
let path: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "auth-plus-auth-"));
	path = join(dir, "auth.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("core/auth", () => {
	test("reads an OAuth slot with provider extras and leaves auth.json untouched", async () => {
		const original = `\ufeff${JSON.stringify({
			antigravity: { type: "oauth", access: "a", refresh: "r", expires: 2_000, projectId: "p-1" },
			other: { type: "api_key", key: "k" },
		})}`;
		await writeFile(path, original, { mode: 0o600 });
		const before = await stat(path);

		const credential = readCredential("antigravity", path);

		expect(credential).toEqual({
			type: "oauth",
			access: "a",
			refresh: "r",
			expires: 2_000,
			extra: { projectId: "p-1" },
		});
		expect(credentialStatus(credential, 1_000)).toEqual({
			state: "oauth",
			expiresAt: 2_000,
			expired: false,
		});
		expect(credentialStatus(credential, 2_000)).toMatchObject({ expired: true });
		expect(await readFile(path, "utf8")).toBe(original);
		expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
	});

	test("missing, malformed and foreign-shaped slots read as no credential", async () => {
		expect(readCredential("claude", path)).toBeUndefined();
		await writeFile(path, "{not json");
		expect(readCredential("claude", path)).toBeUndefined();
		await writeFile(
			path,
			JSON.stringify({ claude: { type: "oauth", access: "a", refresh: "r", expires: "soon" } }),
		);
		expect(readCredential("claude", path)).toBeUndefined();
		expect(credentialStatus(undefined, 0)).toEqual({ state: "missing" });
	});

	test("an API-key slot without a key stays an API-key slot", async () => {
		await writeFile(
			path,
			JSON.stringify({ synthetic: { type: "api_key", env: { A: "1", B: 2 } } }),
		);
		expect(readCredential("synthetic", path)).toEqual({
			type: "api_key",
			key: undefined,
			env: { A: "1" },
		});
	});
});
