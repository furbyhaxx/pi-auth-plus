import { describe, expect, test } from "bun:test";
import { REDACTED, redactError, redactText, redactValue } from "../../src/core/redact/index.ts";

const OAUTH = "sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUv";
const OPAQUE = "opaque-credential-1234567890";

describe("core/redact", () => {
	test("token shapes and known opaque values never survive free text", () => {
		const text = [
			`Authorization: Bearer ${OPAQUE}`,
			`key ${OAUTH}`,
			"google ya29.a0AfH6SMBx-abc and 1//0gAbCdEfGhIjKlMnOpQrSt",
			"synthetic syn_AbCdEfGhIjKlMnOp, openrouter sk-or-v1-0123456789abcdef0123",
			'{"refresh_token":"r-123","access_token": "a-456"}',
			"https://x.test/v1?key=AIzaSecret&alt=sse",
			`raw ${OPAQUE}`,
		].join("\n");
		const out = redactText(text, [OPAQUE]);
		for (const leaked of [
			OPAQUE,
			OAUTH,
			"ya29.",
			"1//0g",
			"syn_Ab",
			"sk-or",
			"r-123",
			"a-456",
			"AIza",
		]) {
			expect(out).not.toContain(leaked);
		}
		expect(out).toContain("alt=sse");
	});

	test("bus payloads keep shape but mask sensitive keys and nested strings", () => {
		const payload = {
			provider: "claude",
			headers: new Headers({ authorization: `Bearer ${OPAQUE}`, "x-trace": "t1" }),
			nested: [{ apiKey: "anything", note: `got ${OAUTH}` }],
		};
		const out = redactValue(payload, [OPAQUE]);
		expect(out).toEqual({
			provider: "claude",
			headers: { authorization: REDACTED, "x-trace": "t1" },
			nested: [{ apiKey: REDACTED, note: `got ${REDACTED}` }],
		});
	});

	test("errors keep diagnostics but lose secrets in message, fields and cause", () => {
		const cause = new Error(`refresh failed for ${OPAQUE}`);
		const error = Object.assign(new Error(`401 with Bearer ${OPAQUE}`, { cause }), {
			status: 401,
			body: `{"access_token":"${OPAQUE}"}`,
		});
		const safe = redactError(error, [OPAQUE]);
		const serialized = JSON.stringify({
			...safe,
			message: safe.message,
			cause: String(safe.cause),
		});
		expect(serialized).not.toContain(OPAQUE);
		expect((safe as Error & { status?: number }).status).toBe(401);
	});

	test("cyclic payloads terminate", () => {
		const a: Record<string, unknown> = { name: "a" };
		a["self"] = a;
		expect(redactValue(a)).toEqual({ name: "a", self: "[circular]" });
	});
});
