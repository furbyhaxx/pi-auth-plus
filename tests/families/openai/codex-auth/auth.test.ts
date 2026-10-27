import { afterEach, beforeEach, expect, test } from "bun:test";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
	CodexAuthError,
	type CodexCredential,
	loadCodexCredential,
	loginCodex,
	resolveCodexToken,
} from "../../../../src/families/openai/codex-auth/index.ts";

const NOW = 1_800_000_000_000;
let dir: string;
let path: string;
const legacy: CodexCredential = {
	type: "oauth",
	access: "test-old-access",
	refresh: "test-old-refresh",
	expires: NOW - 1,
	accountId: "test-account",
	email: "test@example.invalid",
	planType: "plus",
};
function jwt(value: unknown): string {
	return `e30.${Buffer.from(JSON.stringify(value)).toString("base64url")}.test`;
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "codex-auth-"));
	path = join(dir, "quotas-codex-auth.json");
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("loads the pi-quotas format without changing its bytes", async () => {
	const bytes = `${JSON.stringify(legacy, null, 2)}\n`;
	await writeFile(path, bytes);
	expect(await loadCodexCredential(path)).toEqual(legacy);
	expect(await readFile(path, "utf8")).toBe(bytes);
});

test("absent and malformed credentials return undefined, with safe reporting", async () => {
	const errors: CodexAuthError[] = [];
	expect(await loadCodexCredential(path, (error) => errors.push(error))).toBeUndefined();
	for (const contents of [
		'{"access":"private-value',
		"null",
		"[]",
		JSON.stringify({ ...legacy, expires: "bad" }),
		JSON.stringify({ ...legacy, accountId: 12 }),
	]) {
		await writeFile(path, contents);
		expect(await loadCodexCredential(path, (error) => errors.push(error))).toBeUndefined();
	}
	expect(errors).toHaveLength(5);
	for (const error of errors) {
		expect(error).toBeInstanceOf(CodexAuthError);
		expect(error.message).not.toContain("private-value");
	}
});

test("missing files do not seed from adjacent auth files or request tokens", async () => {
	await writeFile(join(dir, ".auth.json"), JSON.stringify({ "openai-codex": legacy }));
	await writeFile(join(dir, "auth.json"), JSON.stringify({ "openai-codex": legacy }));
	expect(
		await resolveCodexToken({
			path,
			fetch: async () => {
				throw new Error("unexpected fetch");
			},
		}),
	).toBeUndefined();
});

test("fresh credentials use JWT hints without a network call", async () => {
	const access = jwt({
		"https://api.openai.com/auth": { chatgpt_account_id: "jwt-account", chatgpt_plan_type: "PLUS" },
	});
	await writeFile(
		path,
		JSON.stringify({ type: "oauth", access, refresh: legacy.refresh, expires: NOW + 300_000 }),
	);
	expect(
		await resolveCodexToken({
			path,
			now: () => NOW,
			fetch: async () => {
				throw new Error("unexpected fetch");
			},
		}),
	).toEqual({ token: access, accountId: "jwt-account", planType: "plus" });
});

test("independent module sessions rotate an expired shared file exactly once", async () => {
	await writeFile(path, JSON.stringify(legacy));
	const children = [0, 1].map(() =>
		fork(new URL("./session.ts", import.meta.url), [path, String(NOW)], {
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		}),
	);
	let ready = 0;
	const results: unknown[] = [];
	try {
		await Promise.all(
			children.map(
				(child) =>
					new Promise<void>((resolve, reject) => {
						child.on("error", reject);
						child.on("message", (message: unknown) => {
							if (message === "ready") {
								ready++;
								if (ready === 2) for (const session of children) session.send("start");
							} else results.push(message);
						});
						child.on("exit", (code) =>
							code === 0 ? resolve() : reject(new Error(`Session exited with ${code}`)),
						);
					}),
			),
		);
	} finally {
		for (const child of children) if (child.exitCode === null) child.kill();
	}
	expect(await readFile(`${path}.requests`, "utf8")).toBe("refresh\n");
	expect(results).toHaveLength(2);
	expect(results[0]).toEqual(results[1]);
	expect(results[0]).toEqual({
		token: {
			token: "test-new-access",
			accountId: legacy.accountId,
			email: legacy.email,
			planType: legacy.planType,
		},
	});
	expect(await loadCodexCredential(path)).toEqual({
		...legacy,
		access: "test-new-access",
		refresh: "test-new-refresh",
		expires: NOW + 3_600_000,
	});
	expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("same-session callers deduplicate refresh and preserve the refresh token when not rotated", async () => {
	await writeFile(path, JSON.stringify(legacy));
	let calls = 0;
	const options = {
		path,
		now: () => NOW,
		fetch: async () => {
			calls++;
			await delay(30);
			return Response.json({ access_token: "test-new-access", expires_in: 3600 });
		},
	};
	await Promise.all([resolveCodexToken(options), resolveCodexToken(options)]);
	expect(calls).toBe(1);
	expect((await loadCodexCredential(path))?.refresh).toBe(legacy.refresh);
});

test("refresh failures are typed and never rewrite the existing credential", async () => {
	await writeFile(path, JSON.stringify(legacy));
	try {
		await resolveCodexToken({
			path,
			now: () => NOW,
			fetch: async () => new Response("private-value", { status: 401 }),
		});
		throw new Error("expected rejection");
	} catch (error) {
		expect(error).toBeInstanceOf(CodexAuthError);
		if (!(error instanceof CodexAuthError)) throw error;
		expect(error.status).toBe(401);
		expect(error.message).not.toContain("private-value");
	}
	expect(await loadCodexCredential(path)).toEqual(legacy);
});

test("device flow exchanges a mocked authorization code and stores compatible credentials", async () => {
	const requests: string[] = [];
	const statuses: string[] = [];
	const access = jwt({
		"https://api.openai.com/auth": {
			chatgpt_account_id: "test-account",
			chatgpt_plan_type: "PLUS",
		},
	});
	const id = jwt({ "https://api.openai.com/profile": { email: " Test@Example.Invalid " } });
	const credential = await loginCodex({
		mode: "device",
		path,
		now: () => NOW,
		onStatus: (message) => statuses.push(message),
		fetch: async (input, init) => {
			requests.push(String(input));
			if (String(input).endsWith("/usercode")) {
				expect(JSON.parse(String(init?.body))).toEqual({
					client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
				});
				return Response.json({
					device_auth_id: "test-device",
					user_code: "TEST-CODE",
					interval: "0",
				});
			}
			if (String(input).endsWith("/deviceauth/token")) {
				expect(JSON.parse(String(init?.body))).toEqual({
					device_auth_id: "test-device",
					user_code: "TEST-CODE",
				});
				return Response.json({ authorization_code: "test-code", code_verifier: "test-verifier" });
			}
			const form = new URLSearchParams(String(init?.body));
			expect(form.get("grant_type")).toBe("authorization_code");
			expect(form.get("code")).toBe("test-code");
			expect(form.get("code_verifier")).toBe("test-verifier");
			expect(form.get("redirect_uri")).toBe("https://auth.openai.com/deviceauth/callback");
			return Response.json({
				access_token: access,
				refresh_token: "test-login-refresh",
				id_token: id,
				expires_in: 3600,
			});
		},
	});
	expect(requests).toHaveLength(3);
	expect(statuses.some((message) => message.includes("TEST-CODE"))).toBe(true);
	expect(credential).toEqual({
		type: "oauth",
		access,
		refresh: "test-login-refresh",
		expires: NOW + 3_600_000,
		accountId: "test-account",
		email: "test@example.invalid",
		planType: "plus",
	});
	expect(await readFile(path, "utf8")).toBe(`${JSON.stringify(credential, null, 2)}\n`);
	expect((await stat(path)).mode & 0o777).toBe(0o600);
}, 10_000);

test("cancellation prevents device polling and writes", async () => {
	const controller = new AbortController();
	await expect(
		loginCodex({
			mode: "device",
			path,
			signal: controller.signal,
			onStatus: () => controller.abort(),
			fetch: async () =>
				Response.json({ device_auth_id: "test-device", user_code: "TEST", interval: 0 }),
		}),
	).rejects.toThrow();
	expect(await loadCodexCredential(path)).toBeUndefined();
});
