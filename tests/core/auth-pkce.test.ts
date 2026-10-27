/** Exercises PKCE entropy, S256 derivation, and manual callback parsing. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseCodePaste } from "../../src/core/auth/code-paste.ts";
import { createPkce, randomState } from "../../src/core/auth/pkce.ts";

test("PKCE and state use 32 random bytes and base64url encoding", async () => {
	const lengths: number[] = [];
	const random = (length: number) => {
		lengths.push(length);
		return Uint8Array.from({ length }, (_, i) => i);
	};
	const pkce = await createPkce(random);
	expect(pkce.verifier).toHaveLength(43);
	expect(pkce.verifier).toMatch(/^[\w-]+$/);
	expect(pkce.challenge).toBe(createHash("sha256").update(pkce.verifier).digest("base64url"));
	expect(randomState(random)).toBe(pkce.verifier);
	expect(lengths).toEqual([32, 32]);
	expect((await createPkce()).verifier).not.toBe((await createPkce()).verifier);
});

test("manual callback formats are trimmed and decoded", () => {
	for (const input of [
		" https://platform.claude.com/oauth/code/callback?code=abc&state=xyz ",
		" abc#xyz ",
		" code=abc&state=xyz ",
	]) {
		expect(parseCodePaste(input)).toEqual({ code: "abc", state: "xyz" });
	}
	expect(parseCodePaste("code=a%2Bb&state=x%2Fy")).toEqual({ code: "a+b", state: "x/y" });
	for (const input of ["", "abc", "#xyz", "abc#", "abc#xyz#extra", "code=abc", "state=xyz"]) {
		expect(parseCodePaste(input)).toBeUndefined();
	}
});
