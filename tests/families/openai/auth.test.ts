import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexCredentialStatus } from "../../../src/families/openai/auth.ts";
import { createOpenaiFamily } from "../../../src/families/openai/index.ts";
import type { QuotaAuth, QuotaFetchContext, QuotaSource } from "../../../src/quotas/types.ts";
import usage from "../../fixtures/quotas/openai-usage.json";

const NOW = Date.now();
let dir: string;
let path: string;
const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "codex-quota-auth-"));
	path = join(dir, "quotas-codex-auth.json");
	process.env["PI_CODING_AGENT_DIR"] = dir;
});
afterEach(() => {
	if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
	else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
	rmSync(dir, { recursive: true, force: true });
});

function source(): QuotaSource {
	const quota = createOpenaiFamily({ codexAuth: { path } }).providers[0]?.quota;
	if (!quota) throw new Error("codex quota missing");
	return quota;
}

async function fetchWith(pi: Record<string, QuotaAuth>) {
	const quota = source();
	const requests: Headers[] = [];
	const lookups: string[] = [];
	const signal = new AbortController().signal;
	const ctx: QuotaFetchContext = {
		auth: () =>
			quota.auth
				? quota.auth(async (id) => {
						lookups.push(id);
						return pi[id];
					}, signal)
				: Promise.resolve(undefined),
		fetch: async (_url, init) => {
			requests.push(new Headers(init?.headers));
			return Response.json(usage);
		},
		signal,
		now: () => NOW,
	};
	return { snapshot: await quota.fetch(ctx), requests, lookups };
}

describe("codex quota credentials", () => {
	test("falls back to the pi-quotas Codex file when Pi has no openai-codex login", async () => {
		writeFileSync(
			path,
			JSON.stringify({
				type: "oauth",
				access: "file-token",
				refresh: "file-refresh",
				expires: NOW + 3_600_000,
				accountId: "acct-file",
			}),
		);
		const { snapshot, requests, lookups } = await fetchWith({
			openai: { token: "chatgpt-sign-in-token", extra: {} },
		});
		expect(lookups).toEqual(["openai-codex"]);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.get("authorization")).toBe("Bearer file-token");
		expect(requests[0]?.get("chatgpt-account-id")).toBe("acct-file");
		expect(snapshot).toMatchObject({ provider: "codex", source: "endpoint" });
	});

	test("prefers Pi's openai-codex login over the file", async () => {
		writeFileSync(
			path,
			JSON.stringify({
				type: "oauth",
				access: "file-token",
				refresh: "r",
				expires: NOW + 3_600_000,
			}),
		);
		const { requests } = await fetchWith({
			"openai-codex": { token: "pi-token", extra: { accountId: "acct-pi" } },
		});
		expect(requests[0]?.get("authorization")).toBe("Bearer pi-token");
		expect(requests[0]?.get("chatgpt-account-id")).toBe("acct-pi");
	});

	test("without either credential it needs auth, names both logins and sends nothing", async () => {
		const { snapshot, requests } = await fetchWith({
			openai: { token: "chatgpt-sign-in-token", extra: {} },
		});
		expect(requests).toHaveLength(0);
		expect(snapshot).toMatchObject({ provider: "codex", needsAuth: true });
		expect(snapshot.error).toContain("/quota codex login");
		expect(snapshot.error).toContain("/login openai-codex");
	});

	test("status reads Pi's openai-codex slot first, then the Codex file", () => {
		expect(codexCredentialStatus(NOW, path)).toEqual({ state: "missing" });
		writeFileSync(path, "{ not json");
		expect(codexCredentialStatus(NOW, path)).toEqual({ state: "missing" });
		writeFileSync(
			path,
			JSON.stringify({ type: "oauth", access: "a", refresh: "r", expires: NOW - 1 }),
		);
		expect(codexCredentialStatus(NOW, path)).toEqual({
			state: "oauth",
			expiresAt: NOW - 1,
			expired: true,
		});
		writeFileSync(
			join(dir, "auth.json"),
			JSON.stringify({
				"openai-codex": { type: "oauth", access: "p", refresh: "q", expires: NOW + 60_000 },
			}),
		);
		expect(codexCredentialStatus(NOW, path)).toEqual({
			state: "oauth",
			expiresAt: NOW + 60_000,
			expired: false,
		});
	});
});
