import { describe, expect, test } from "bun:test";
import { AntigravityError, parseAntigravityError } from "../../../src/families/google/errors.ts";

// Synthetic google.rpc Status, using the reason table in 05-quota.md §3.3.
export const rateLimit = {
	error: {
		code: 429,
		status: "RESOURCE_EXHAUSTED",
		message: "Quota exhausted",
		details: [
			{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" },
			{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "12.250s" },
		],
	},
};

describe("families/google/errors", () => {
	test("maps a 429 Status and RetryInfo to a recoverable named error", () => {
		const error = parseAntigravityError(JSON.stringify(rateLimit), {
			status: 429,
			retryAfterMs: 1000,
		});
		expect(error).toBeInstanceOf(AntigravityError);
		expect(error.reason).toBe("RATE_LIMIT_EXCEEDED");
		expect(error.status).toBe(429);
		expect(error.retryAfterMs).toBe(12250);
		expect(error.recovery).toContain("quota to reset");
		expect(error.message).toContain("antigravity: v1internal:streamGenerateContent");
	});

	test.each([
		["INSUFFICIENT_G1_CREDITS_BALANCE", "AI credits balance"],
		["VALIDATION_REQUIRED", "verification"],
		["MODEL_CAPACITY_EXHAUSTED", "capacity"],
	])("provides recovery for %s", (reason, recovery) => {
		const error = parseAntigravityError({ message: "Server refused", details: [{ reason }] });
		expect(error.reason).toBe(reason);
		expect(error.recovery).toContain(recovery);
	});

	test("unknown reasons preserve the message but redact tokens and project ids", () => {
		const project = "private-project-123";
		const error = parseAntigravityError(
			{
				message: `Failure for ${project} with ya29.fake-token`,
				details: [{ reason: "NEW_REASON" }],
			},
			{ secrets: [project] },
		);
		expect(error.reason).toBe("NEW_REASON");
		expect(error.message).toContain("Failure for [redacted] with [redacted]");
		expect(JSON.stringify(error)).not.toContain(project);
		expect(error.recovery).toContain("/login antigravity");
	});

	test("tolerates truncated HTTP diagnostics and preserves header delay", () => {
		const error = parseAntigravityError('{"broken', { status: 503, retryAfterMs: 5000 });
		expect(error.status).toBe(503);
		expect(error.retryAfterMs).toBe(5000);
		expect(error.message).toContain('{"broken');
	});
});
