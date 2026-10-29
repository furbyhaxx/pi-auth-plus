import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backoffFor, HostCache } from "../../src/core/cache/index.ts";
import { withFileLock } from "../../src/core/cache/lock.ts";

let path: string;
let clock: number;

function cache(
	parserVersion = 1,
	rateLimitStatuses?: readonly number[],
): HostCache<{ used: number }> {
	return new HostCache({
		path,
		now: () => clock,
		...(rateLimitStatuses === undefined ? {} : { rateLimitStatuses }),
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
	test("aborted queued mutations do not merge, write, notify or poison the queue", async () => {
		await cache().put("other", { used: 1 });
		const before = readFileSync(path, "utf8");
		const pendingCache = cache();
		const events: string[] = [];
		pendingCache.onChange((key) => events.push(key));
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const held = withFileLock(path, async () => {
			entered.resolve();
			await release.promise;
		});
		await entered.promise;
		const controller = new AbortController();
		let called = false;
		const pending = [
			pendingCache.tryAcquire("acquire", { minAgeMs: 0 }, controller.signal),
			pendingCache.putWith(
				"put",
				() => {
					called = true;
					return { used: 2 };
				},
				controller.signal,
			),
			pendingCache.patch(
				"patch",
				() => {
					called = true;
					return { used: 3 };
				},
				controller.signal,
			),
			pendingCache.fail("fail", { backoffMs: 30_000 }, controller.signal),
		];
		controller.abort();
		release.resolve();
		await held;
		const results = await Promise.all(pending);

		expect(results).toEqual([false, undefined, false, undefined]);
		expect(called).toBe(false);
		expect([...pendingCache.all()]).toEqual([]);
		expect(pendingCache.backoff("fail")).toBeUndefined();
		expect(events).toEqual([]);
		expect(readFileSync(path, "utf8")).toBe(before);
		await pendingCache.put("next", { used: 4 });
		expect(pendingCache.get("next")?.value).toEqual({ used: 4 });
	});

	test("an aborted merge stops notifying and a later sync reads the remaining entries", async () => {
		const writer = cache();
		await writer.put("first", { used: 1 });
		await writer.put("second", { used: 2 });
		const reader = cache();
		const controller = new AbortController();
		const events: string[] = [];
		reader.onChange((key) => {
			events.push(key);
			if (key === "first") controller.abort();
		});
		await reader.sync(false, controller.signal);
		expect(events).toEqual(["first"]);
		expect(reader.get("second")).toBeUndefined();
		await reader.sync();
		expect(events).toEqual(["first", "second"]);
		expect(reader.get("second")?.value).toEqual({ used: 2 });
	});

	test("a committed write remains stored when a listener aborts its signal", async () => {
		const writer = cache();
		const controller = new AbortController();
		const events: string[] = [];
		writer.onChange(() => {
			events.push("first");
			controller.abort();
		});
		writer.onChange(() => events.push("second"));
		await writer.putWith("committed", () => ({ used: 1 }), controller.signal);
		expect(events).toEqual(["first"]);
		expect(writer.get("committed")?.value).toEqual({ used: 1 });
		const reader = cache();
		await reader.sync();
		expect(reader.get("committed")?.value).toEqual({ used: 1 });
	});

	test("concurrent writers in separate sessions never lose each other's entries", async () => {
		const a = cache();
		const b = cache();
		const keys = ["claude", "synthetic", "codex", "xai", "openrouter", "deepseek"];
		await Promise.all(keys.map((key, i) => (i % 2 === 0 ? a : b).put(key, { used: i })));

		const reader = cache();
		await reader.sync();
		expect([...reader.all().keys()].sort()).toEqual([...keys].sort());
	});

	test("a write from another session in the same millisecond is neither ignored nor overwritten", async () => {
		const a = cache();
		const b = cache();
		await a.put("claude", { used: 1 });
		await b.sync();
		await b.patch("claude", () => ({ used: 2 }));

		await a.sync(true);
		expect(a.get("claude")?.value).toEqual({ used: 2 });
		await a.put("codex", { used: 3 });
		const reader = cache();
		await reader.sync();
		expect(reader.get("claude")?.value).toEqual({ used: 2 });
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

	test("patches propagate without refreshing endpoint freshness", async () => {
		const a = cache();
		const b = cache();
		await a.put("claude", { used: 1 });
		const fetchedAt = clock;
		await b.sync();
		clock += 60_001;
		const changes: number[] = [];
		a.onChange((_key, entry) => changes.push(entry.value.used));
		expect(await a.patch("claude", (current) => ({ used: (current?.used ?? 0) + 1 }))).toBe(true);
		expect(a.get("claude")).toEqual({
			value: { used: 2 },
			fetchedAt,
			updatedAt: clock,
			parserVersion: 1,
		});
		expect(changes).toEqual([2]);
		expect(await b.sync()).toBe(true);
		expect(b.get("claude")).toEqual(a.get("claude"));
		expect(await b.tryAcquire("claude", { minAgeMs: 60_000 })).toBe(true);
	});

	test("patches sync before changing values and preserve leases and backoff", async () => {
		const a = cache();
		const b = cache();
		await a.put("claude", { used: 1 });
		await b.sync();
		clock += 1_000;
		await a.put("claude", { used: 4 });
		expect(await a.tryAcquire("claude", { minAgeMs: 0 })).toBe(true);
		clock += 1_000;
		await b.patch("claude", (current) => ({ used: (current?.used ?? 0) + 1 }));
		expect(b.get("claude")?.value.used).toBe(5);
		expect(await cache().tryAcquire("claude", { minAgeMs: 0 })).toBe(false);

		await a.fail("claude", { backoffMs: 60_000, status: 429 });
		clock += 1_000;
		await b.patch("claude", () => ({ used: 6 }));
		expect(await cache().tryAcquire("claude", { minAgeMs: 0, force: true })).toBe(false);
	});

	test("a missing entry can be patched without becoming fresh; undefined leaves it unchanged", async () => {
		const a = cache();
		const changes: number[] = [];
		a.onChange((_key, entry) => changes.push(entry.value.used));
		expect(await a.patch("missing", () => undefined)).toBe(false);
		expect(a.get("missing")).toBeUndefined();
		expect(await a.patch("claude", (current) => ({ used: current?.used ?? 2 }))).toBe(true);
		const entry = a.get("claude");
		expect(entry).toEqual({
			value: { used: 2 },
			fetchedAt: 0,
			updatedAt: clock,
			parserVersion: 1,
		});
		clock += 1_000;
		expect(await a.patch("claude", () => undefined)).toBe(false);
		expect(a.get("claude")).toEqual(entry);
		expect(changes).toEqual([2]);
		expect(await a.tryAcquire("claude", { minAgeMs: 60_000 })).toBe(true);
	});

	test("legacy entries default updatedAt to fetchedAt and retain their parser version on patch", async () => {
		const a = cache();
		await a.put("claude", { used: 1 });
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				entries: { claude: { value: { used: 3 }, fetchedAt: clock, parserVersion: 2 } },
			}),
		);
		const reader = cache();
		await reader.sync();
		expect(reader.get("claude")?.updatedAt).toBe(clock);
		clock += 1_000;
		await reader.patch("claude", () => ({ used: 4 }));
		expect(reader.get("claude")?.parserVersion).toBe(2);
	});

	test("configured 403 rate limits block forced refreshes while defaults allow them", async () => {
		await cache().fail("claude", { backoffMs: 60_000, status: 403 });
		expect(await cache(1, [403, 429]).tryAcquire("claude", { minAgeMs: 0, force: true })).toBe(
			false,
		);
		expect(await cache().tryAcquire("claude", { minAgeMs: 0, force: true })).toBe(true);
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
		expect(backoffFor({ status: 403, retryAfterMs: 5_000 }, policy)).toBe(60_000);
		const configured = { ...policy, rateLimitStatuses: [403, 429] };
		expect(backoffFor({ status: 403, retryAfterMs: 5_000 }, configured)).toBe(5_000);
		expect(backoffFor({ status: 403 }, configured)).toBe(300_000);
	});
});
