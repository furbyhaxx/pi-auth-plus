import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { modelsPath } from "../../src/core/paths/index.ts";
import {
	applyCliIdentity,
	CLI_USER_AGENT,
	IdSource,
} from "../../src/families/opencode/identity.ts";
import { createOpencodeFamily } from "../../src/families/opencode/index.ts";
import { testHost } from "../host.ts";

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
	const family = createOpencodeFamily(env, () => 1_700_000_000_000);
	await family.register?.(fake.pi, await testHost());
	const ambient = family.providers.map((provider) => provider.ambient?.()?.source);
	return { ...fake, ambient };
}

describe("families/opencode", () => {
	test("session ids follow the CLI format and sort newest first", () => {
		const ids = new IdSource(() => new Uint8Array(14));
		const older = ids.session(1_000);
		const newer = ids.session(2_000);
		expect(older).toMatch(/^ses_[0-9a-f]{12}0{14}$/);
		expect(newer < older).toBe(true);
	});

	test("rewrites Pi's opencode stamp into the CLI identity and leaves other requests alone", () => {
		const opencode: Record<string, string | null> = {
			"user-agent": "pi-coding-agent/1.4.0",
			"x-opencode-client": "pi",
			"X-OpenCode-Session": "0b6c-pi-uuid",
			Authorization: "Bearer public",
		};
		expect(applyCliIdentity(opencode, "ses_a")).toBe(true);
		expect(opencode).toEqual({
			Authorization: "Bearer public",
			"User-Agent": CLI_USER_AGENT,
			"x-opencode-client": "cli",
			"x-opencode-project": "global",
			"x-opencode-session": "ses_a",
			"x-opencode-session-id": "ses_a",
			"x-session-affinity": "ses_a",
			"X-Session-Id": "ses_a",
		});

		const anthropic = { "user-agent": "pi-coding-agent/1.4.0", "x-api-key": "k" };
		expect(applyCliIdentity(anthropic, "ses_a")).toBe(false);
		expect(anthropic).toEqual({ "user-agent": "pi-coding-agent/1.4.0", "x-api-key": "k" });
	});

	test("registers the anonymous Zen key only when no env or models.json key would be shadowed", async () => {
		const env = { ...process.env, OPENCODE_API_KEY: undefined };
		const anonymous = await registerWith(env);
		expect(anonymous.registered).toEqual([{ id: "opencode", config: { apiKey: "public" } }]);
		expect(anonymous.ambient).toEqual(["anonymous", undefined]);

		const keyed = await registerWith({ ...env, OPENCODE_API_KEY: "sk-zen" });
		expect(keyed.registered).toEqual([]);
		expect(keyed.ambient).toEqual(["OPENCODE_API_KEY", "OPENCODE_API_KEY"]);

		const configured = await registerWith(env, { providers: { opencode: { apiKey: "$ZEN" } } });
		expect(configured.registered).toEqual([]);
		expect(configured.ambient).toEqual(["models.json", undefined]);

		const goOnly = await registerWith(env, { providers: { "opencode-go": { apiKey: "k" } } });
		expect(goOnly.registered).toHaveLength(1);
		expect(goOnly.ambient).toEqual(["anonymous", "models.json"]);
	});

	test("adds the env block only to chat payloads for the active opencode model", async () => {
		const { handlers } = await registerWith({ ...process.env, OPENCODE_API_KEY: "k" });
		const shape = handlers.get("before_provider_request") as unknown as (
			event: { payload: unknown },
			ctx: { model?: { provider: string; id: string }; cwd: string },
		) => unknown;
		const zen = { provider: "opencode", id: "big-pickle" };
		const chat = () => ({
			model: "big-pickle",
			messages: [
				{ role: "system", content: "You are Pi." },
				{ role: "user", content: "hi" },
			],
		});

		const shaped = shape({ payload: chat() }, { model: zen, cwd: "/work" }) as ReturnType<
			typeof chat
		>;
		expect(shaped.messages[0]?.content).toBe(
			`You are Pi.\n\n<env>\n  Working directory: /work\n  Platform: ${process.platform}\n</env>`,
		);
		expect(shape({ payload: shaped }, { model: zen, cwd: "/work" })).toBeUndefined();

		expect(
			shape({ payload: { ...chat(), model: "gpt-x" } }, { model: zen, cwd: "/work" }),
		).toBeUndefined();
		expect(
			shape(
				{ payload: chat() },
				{ model: { provider: "openrouter", id: "big-pickle" }, cwd: "/work" },
			),
		).toBeUndefined();
		expect(
			shape({ payload: { model: "big-pickle", system: "x" } }, { model: zen, cwd: "/work" }),
		).toBeUndefined();
	});

	test("stamps every request with the session affinity id", async () => {
		const { handlers } = await registerWith({ ...process.env, OPENCODE_API_KEY: "k" });
		const first = { headers: { "x-opencode-client": "pi" } as Record<string, string | null> };
		const second = { headers: { "x-opencode-client": "pi" } as Record<string, string | null> };
		handlers.get("before_provider_headers")?.(first);
		handlers.get("before_provider_headers")?.(second);
		expect(first.headers["x-session-affinity"]).toMatch(/^ses_/);
		expect(second.headers["x-session-affinity"]).toBe(first.headers["x-session-affinity"]);
	});
});
