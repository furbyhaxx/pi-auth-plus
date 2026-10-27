import { describe, expect, test } from "bun:test";
import {
	type FetchFn,
	ProviderHttpError,
	ProviderTimeoutError,
	parseRetryAfter,
	request,
} from "../../src/core/http/index.ts";

const SECRET = "opaque-credential-1234567890";

/** Never answers; rejects with the signal's reason once aborted. */
const hangingFetch: FetchFn = (_input, init) =>
	new Promise((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
	});

describe("core/http", () => {
	test("own deadline raises ProviderTimeoutError with provider and redacted url", async () => {
		const error = await request(`https://x.test/v1?key=${SECRET}`, {
			provider: "synthetic",
			timeoutMs: 10,
			fetch: hangingFetch,
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ProviderTimeoutError);
		expect(String((error as Error).message)).toContain("synthetic");
		expect(String((error as Error).message)).not.toContain(SECRET);
	});

	test("caller abort rethrows the caller's reason, not a timeout", async () => {
		const controller = new AbortController();
		const pending = request("https://x.test", {
			provider: "claude",
			signal: controller.signal,
			fetch: hangingFetch,
		});
		controller.abort(new Error("session ended"));
		const error = await pending.catch((e: unknown) => e);
		expect(error).not.toBeInstanceOf(ProviderTimeoutError);
		expect((error as Error).message).toBe("session ended");
	});

	test("non-2xx raises ProviderHttpError with redacted body and Retry-After", async () => {
		const fetchFn: FetchFn = async () =>
			new Response(`{"error":"bad token ${SECRET}"}`, {
				status: 429,
				headers: { "retry-after": "7" },
			});
		const error = await request("https://x.test", {
			provider: "antigravity",
			secrets: [SECRET],
			fetch: fetchFn,
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ProviderHttpError);
		const http = error as ProviderHttpError;
		expect(http.status).toBe(429);
		expect(http.retryAfterMs).toBe(7000);
		expect(http.message).not.toContain(SECRET);
	});

	test("Retry-After accepts HTTP-dates and clamps past dates to zero", () => {
		const now = Date.parse("2026-10-27T08:00:00Z");
		expect(parseRetryAfter("Tue, 27 Oct 2026 08:00:30 GMT", now)).toBe(30_000);
		expect(parseRetryAfter("Tue, 27 Oct 2026 07:00:00 GMT", now)).toBe(0);
		expect(parseRetryAfter("soon", now)).toBeUndefined();
	});
});
