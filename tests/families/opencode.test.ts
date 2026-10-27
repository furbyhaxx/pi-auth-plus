import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { modelsPath } from "../../src/core/paths/index.ts";
import { applyCliIdentity, CLI_VERSION, IdSource } from "../../src/families/opencode/identity.ts";
import { createOpencodeFamily } from "../../src/families/opencode/index.ts";

type Handler = (event: { headers: Record<string, string | null> }) => void;

function fakePi() {
	const registered: Array<{ id: string; config: unknown }> = [];
	const handlers = new Map<string, Handler>();
	const pi = {
		registerProvider: (id: string, config: unknown) => registered.push({ id, config }),
		on: (event: string, handler: Handler) => handlers.set(event, handler),
	} as unknown as ExtensionAPI;
	return { pi, registered, handlers };
}

async function registerWith(env: Record<string, string | undefined>, models?: unknown) {
	const path = modelsPath(env);
	rmSync(path, { force: true });
	if (models !== undefined) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(models));
	}
	const fake = fakePi();
	await createOpencodeFamily(env, () => 1_700_000_000_000).register?.(fake.pi);
	return fake;
}

describe("families/opencode", () => {
	test("ids follow the CLI format: sessions sort newest first, requests oldest first", () => {
		const ids = new IdSource(() => new Uint8Array(14));
		const older = ids.session(1_000);
		const newer = ids.session(2_000);
		expect(older).toMatch(/^ses_[0-9a-f]{12}0{14}$/);
		expect(newer < older).toBe(true);
		const first = ids.request(2_000);
		const second = ids.request(2_000);
		expect(first).toMatch(/^msg_[0-9a-f]{12}0{14}$/);
		expect(first < second).toBe(true);
	});

	test("rewrites Pi's opencode stamp into the CLI identity and leaves other requests alone", () => {
		const opencode: Record<string, string | null> = {
			"user-agent": "pi-coding-agent/1.4.0",
			"x-opencode-client": "pi",
			"X-OpenCode-Session": "0b6c-pi-uuid",
			Authorization: "Bearer public",
		};
		expect(applyCliIdentity(opencode, "ses_a", "msg_b")).toBe(true);
		expect(opencode).toEqual({
			Authorization: "Bearer public",
			"User-Agent": `opencode/${CLI_VERSION}`,
			"x-opencode-client": "cli",
			"x-opencode-project": "global",
			"x-opencode-session": "ses_a",
			"x-opencode-request": "msg_b",
		});

		const anthropic = { "user-agent": "pi-coding-agent/1.4.0", "x-api-key": "k" };
		expect(applyCliIdentity(anthropic, "ses_a", "msg_b")).toBe(false);
		expect(anthropic).toEqual({ "user-agent": "pi-coding-agent/1.4.0", "x-api-key": "k" });
	});

	test("registers the anonymous Zen key only when no env or models.json key would be shadowed", async () => {
		const env = { ...process.env, OPENCODE_API_KEY: undefined };
		expect((await registerWith(env)).registered).toEqual([
			{ id: "opencode", config: { apiKey: "public" } },
		]);
		expect((await registerWith({ ...env, OPENCODE_API_KEY: "sk-zen" })).registered).toEqual([]);
		expect(
			(await registerWith(env, { providers: { opencode: { apiKey: "$ZEN" } } })).registered,
		).toEqual([]);
		expect(
			(await registerWith(env, { providers: { "opencode-go": { apiKey: "k" } } })).registered,
		).toHaveLength(1);
	});

	test("stamps each request with the session id and a fresh request id", async () => {
		const { handlers } = await registerWith({ ...process.env, OPENCODE_API_KEY: "k" });
		const first = { headers: { "x-opencode-client": "pi" } as Record<string, string | null> };
		const second = { headers: { "x-opencode-client": "pi" } as Record<string, string | null> };
		handlers.get("before_provider_headers")?.(first);
		handlers.get("before_provider_headers")?.(second);
		expect(first.headers["x-opencode-session"]).toBe(second.headers["x-opencode-session"]);
		expect(first.headers["x-opencode-request"]).not.toBe(second.headers["x-opencode-request"]);
	});
});
