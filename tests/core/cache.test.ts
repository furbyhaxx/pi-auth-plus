import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backoffFor, HostCache } from "../../src/core/cache/index.ts";

let path: string;
let clock: number;

function cache(parserVersion = 1): HostCache<{ used: number }> {
	return new HostCache({
		path,
		now: () => clock,
		parserVersion: () => parserVersion,
		parse: (raw) =>
			typeof raw === "object" && raw !== null && "used" in raw && typeof raw.used === "number"
				? { used: raw.used }
				: undefined,
	});
}

beforeEach(() => {
	path = join(mkdtempSync(join(tmpdir(), "cache-")), "nested", "quotas.json");
	clock = 1_000_000;
});

describe("core/cache", () => {
	test("concurrent writers in separate sessions never lose each other's entries", async () => {
		const a = cache();
		const b = cache();
		const keys = ["claude", "synthetic", "codex", "xai", "openrouter", "deepseek"];
		await Promise.all(keys.map((key, i) => (i % 2 === 0 ? a : b).put(key, { used: i })));

		const reader = cache();
		await reader.sync();
		expect([...reader.all().keys()].sort()).toEqual([...keys].sort());
	});

	test("entries written by an older parser are ignored", async () => {
		await cache(1).put("claude", { used: 5 });
		const newer = cache(2);
		await newer.sync();
		expect(newer.get("claude")).toBeUndefined();
	});

	test("a lease blocks other sessions until the value lands; fresh values are not refetched", async () => {
		const a = cache();
		const b = cache();
		expect(await a.tryAcquire("claude", { minAgeMs: 60_000 })).toBe(true);
		expect(await b.tryAcquire("claude", { minAgeMs: 60_000 })).toBe(false);

		await a.put("claude", { used: 1 });
		clock += 1_000;
		expect(await b.tryAcquire("claude", { minAgeMs: 60_000 })).toBe(false);
		expect(await b.tryAcquire("claude", { minAgeMs: 60_000, force: true })).toBe(true);
	});

	test("force bypasses ordinary backoff but never a rate limit", async () => {
		const a = cache();
		await a.fail("synthetic", { backoffMs: 60_000, status: 500 });
		expect(await a.tryAcquire("synthetic", { minAgeMs: 0 })).toBe(false);
		expect(await a.tryAcquire("synthetic", { minAgeMs: 0, force: true })).toBe(true);

		await a.fail("claude", { backoffMs: 60_000, status: 429, error: "rate limited" });
		const b = cache();
		expect(await b.tryAcquire("claude", { minAgeMs: 0, force: true })).toBe(false);
		expect(b.backoff("claude")?.error).toBe("rate limited");
		clock += 60_001;
		expect(await b.tryAcquire("claude", { minAgeMs: 0 })).toBe(true);
	});

	test("a corrupt cache file is treated as empty and then replaced", async () => {
		await cache().put("claude", { used: 1 });
		writeFileSync(path, "{ torn");
		const a = cache();
		await a.put("xai", { used: 2 });
		const reader = cache();
		await reader.sync();
		expect([...reader.all().keys()]).toEqual(["xai"]);
	});

	test("backoff honors Retry-After on 429 within the cap", () => {
		const policy = { defaultMs: 60_000, rateLimitMs: 300_000, maxMs: 900_000 };
		expect(backoffFor({ status: 429, retryAfterMs: 5_000 }, policy)).toBe(5_000);
		expect(backoffFor({ status: 429, retryAfterMs: 9_999_999 }, policy)).toBe(900_000);
		expect(backoffFor({ status: 429 }, policy)).toBe(300_000);
		expect(backoffFor({ status: 503 }, policy)).toBe(60_000);
	});
});
