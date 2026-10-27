import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CodexAuthError,
	loadCodexCredential,
	loginCodex,
	resolveCodexToken,
} from "../../../../src/families/openai/codex-auth/index.ts";

const NOW = 1_800_000_000_000;
let dir: string;
let path: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "codex-payloads-"));
	path = join(dir, "quotas-codex-auth.json");
	await writeFile(
		path,
		JSON.stringify({
			type: "oauth",
			access: "test-access",
			refresh: "test-refresh",
			expires: NOW - 1,
		}),
	);
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("invalid token payloads fail typed without modifying credentials, and failures can retry", async () => {
	const initial = await loadCodexCredential(path);
	for (const value of [
		null,
		{},
		{ access_token: "" },
		{ access_token: "test-next", expires_in: "3600" },
		{ access_token: "test-next", expires_in: -1 },
		{ access_token: "test-next", expires_in: 1e308 },
	]) {
		await expect(
			resolveCodexToken({ path, now: () => NOW, fetch: async () => Response.json(value) }),
		).rejects.toBeInstanceOf(CodexAuthError);
		expect(await loadCodexCredential(path)).toEqual(initial);
	}
	const result = await resolveCodexToken({
		path,
		now: () => NOW,
		fetch: async () => Response.json({ access_token: "test-success" }),
	});
	expect(result?.token).toBe("test-success");
	expect((await loadCodexCredential(path))?.expires).toBe(NOW + 3_600_000);
});

test("refresh uses JWT expiry and ignores malformed profile claims", async () => {
	const access = `e30.${Buffer.from(JSON.stringify({ exp: NOW / 1000 + 7200, "https://api.openai.com/auth": ["invalid"], "https://api.openai.com/profile": { email: 123 } })).toString("base64url")}.test`;
	const result = await resolveCodexToken({
		path,
		now: () => NOW,
		fetch: async () => Response.json({ access_token: access }),
	});
	expect(result).toEqual({ token: access, accountId: undefined });
	expect((await loadCodexCredential(path))?.expires).toBe(NOW + 7_200_000);
});

test("device init validates external payloads before polling", async () => {
	for (const value of [
		null,
		{},
		{ device_auth_id: "test-device", user_code: "TEST", interval: "bad" },
		{ device_auth_id: "test-device", user_code: "TEST", interval: -1 },
		{ device_auth_id: "test-device", user_code: "TEST", interval: 1e308 },
	]) {
		let calls = 0;
		await expect(
			loginCodex({
				mode: "device",
				path,
				onStatus: () => {},
				fetch: async () => {
					calls++;
					return Response.json(value);
				},
			}),
		).rejects.toBeInstanceOf(CodexAuthError);
		expect(calls).toBe(1);
	}
});
