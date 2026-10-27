import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchFn } from "../../src/core/http/index.ts";
import { xdgCacheDir } from "../../src/core/paths/index.ts";
import { createTokenizerStore } from "../../src/tokens/tokenizer/index.ts";

const fixture = await readFile(new URL("./fixtures/tiny-tokenizer.json", import.meta.url));
const repo = "test/tiny";
const revision = "a".repeat(40);
const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function directory() {
	const dir = await mkdtemp(join(tmpdir(), "tokenizer-test-"));
	dirs.push(dir);
	return dir;
}
function transport(lfs: boolean, mismatch = false, config = false) {
	const calls: string[] = [];
	const hash = lfs
		? createHash("sha256").update(fixture).digest("hex")
		: createHash("sha1").update(`blob ${fixture.length}\0`).update(fixture).digest("hex");
	const fetch: FetchFn = async (url, init) => {
		const path = String(url);
		calls.push(path);
		if (path.endsWith("/revision/main")) return Response.json({ sha: revision });
		if (path.includes("/paths-info/")) {
			expect(init?.method).toBe("POST");
			expect(String(init?.body)).toBe(
				"paths=tokenizer.json&paths=tokenizer_config.json&expand=true",
			);
			return Response.json([
				{
					path: "tokenizer.json",
					size: fixture.length,
					oid: mismatch ? "0".repeat(40) : hash,
					...(lfs ? { lfs: { oid: mismatch ? "0".repeat(64) : hash } } : {}),
				},
				...(config
					? [
							{
								path: "tokenizer_config.json",
								size: 2,
								oid: createHash("sha1").update("blob 2\0{}").digest("hex"),
							},
						]
					: []),
			]);
		}
		return new Response(path.endsWith("tokenizer_config.json") ? "{}" : fixture);
	};
	return { fetch, calls };
}
const offline: FetchFn = async () => {
	throw new Error("offline");
};

for (const lfs of [false, true]) {
	test(`downloads, pins and serves offline (${lfs ? "LFS" : "git blob"})`, async () => {
		const dir = await directory();
		const { fetch, calls } = transport(lfs, false, true);
		const store = createTokenizerStore({ dir, fetch });
		expect(store.peek(repo)).toBeUndefined();
		const [tok, same] = await Promise.all([store.load(repo), store.load(repo)]);
		expect(tok).toBeDefined();
		expect(same).toBe(tok);
		expect(store.peek(repo)).toBe(tok);
		expect(tok?.id).toBe(`${repo}@aaaaaaa`);
		expect(tok?.count("hello world")).toBe(2);
		expect(tok?.count("hello ".repeat(300))).toBe(300);
		expect(tok?.count("hello ".repeat(300))).toBe(300);
		expect(calls).toHaveLength(4);
		const cached = await createTokenizerStore({ dir, fetch: offline }).load(repo);
		expect(cached?.count("hello world")).toBe(2);
		const path = join(dir, "tokenizers", encodeURIComponent(repo), revision, "tokenizer.json");
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await stat(join(dir, "tokenizers"))).mode & 0o777).toBe(0o700);
		await writeFile(path, "corrupt");
		expect(await createTokenizerStore({ dir, fetch: offline }).load(repo)).toBeUndefined();
		const repaired = await createTokenizerStore({ dir, fetch }).load(repo);
		expect(repaired?.count("hello world")).toBe(2);
		expect(calls).toHaveLength(8);
	});
	test(`hash mismatch writes nothing (${lfs ? "LFS" : "git blob"})`, async () => {
		const dir = await directory();
		const { fetch, calls } = transport(lfs, true);
		const store = createTokenizerStore({ dir, fetch });
		expect(await store.load(repo)).toBeUndefined();
		expect(await store.load(repo)).toBeUndefined();
		expect(calls).toHaveLength(3);
		expect(await readdir(dir)).toEqual([]);
	});
}

test("optional config, size cap, offline failure and unsafe repo", async () => {
	const dir = await directory();
	const { fetch, calls } = transport(false);
	expect(await createTokenizerStore({ dir, fetch, maxFileBytes: 1 }).load(repo)).toBeUndefined();
	expect(calls).toHaveLength(2);
	expect(await createTokenizerStore({ dir, fetch: offline }).load(repo)).toBeUndefined();
	expect(await createTokenizerStore({ dir, fetch }).load("../escape")).toBeUndefined();
	const tok = await createTokenizerStore({ dir, fetch }).load(repo);
	expect(tok?.count("hello world")).toBe(2);
});

test("a failed load is retried after the retry window", async () => {
	const dir = await directory();
	const { fetch } = transport(false);
	let online = false;
	let clock = 0;
	const store = createTokenizerStore({
		dir,
		fetch: (url, init) => (online ? fetch(url, init) : offline(url, init)),
		now: () => clock,
		retryAfterMs: 1000,
	});
	expect(await store.load(repo)).toBeUndefined();
	online = true;
	expect(await store.load(repo)).toBeUndefined();
	clock = 1000;
	expect((await store.load(repo))?.count("hello world")).toBe(2);
});

test("concurrent stores merge their index entries", async () => {
	const dir = await directory();
	const { fetch } = transport(false);
	const first = createTokenizerStore({ dir, fetch });
	const second = createTokenizerStore({ dir, fetch });
	const repos = ["test/first", "test/second"];
	expect(
		(await Promise.all([first.load(repos[0] ?? ""), second.load(repos[1] ?? "")])).every(Boolean),
	).toBe(true);
	const cached = createTokenizerStore({ dir, fetch: offline });
	for (const name of repos) expect((await cached.load(name))?.count("hello world")).toBe(2);
});

test("verified invalid JSON never writes an artifact", async () => {
	const dir = await directory();
	const body = "not json";
	const fetch: FetchFn = async (url) => {
		if (String(url).endsWith("/revision/main")) return Response.json({ sha: revision });
		if (String(url).includes("/paths-info/"))
			return Response.json([
				{
					path: "tokenizer.json",
					size: body.length,
					oid: createHash("sha1").update(`blob ${body.length}\0${body}`).digest("hex"),
				},
			]);
		return new Response(body);
	};
	expect(await createTokenizerStore({ dir, fetch }).load(repo)).toBeUndefined();
	expect(await readdir(dir)).toEqual([]);
});

test("XDG cache directory follows the environment", () => {
	expect(xdgCacheDir({ HOME: "/h", XDG_CACHE_HOME: "/c" })).toBe("/c/pi-auth-plus");
	expect(xdgCacheDir({ HOME: "/h" })).toBe("/h/.cache/pi-auth-plus");
});
