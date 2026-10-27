/** Checks lazy identity persistence and process-only fallbacks. */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deviceId, sessionId } from "../../../src/families/anthropic/identity.ts";

test("device id persists across processes and reuses existing state", async () => {
	const root = await mkdtemp(join(tmpdir(), "claude-device-"));
	try {
		const env = { XDG_STATE_HOME: root };
		const id = await deviceId(env);
		expect(await deviceId(env)).toBe(id);
		const child = spawnSync(
			process.execPath,
			[
				"--eval",
				`import { deviceId } from ${JSON.stringify(new URL("../../../src/families/anthropic/identity.ts", import.meta.url).pathname)}; console.log(await deviceId(${JSON.stringify(env)}));`,
			],
			{ encoding: "utf8" },
		);
		expect(child.status).toBe(0);
		expect(child.stdout.trim()).toBe(id);
		expect(await readFile(join(root, "pi-auth-plus", "claude-device-id"), "utf8")).toBe(id);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("unwritable state keeps an in-memory id and invalid sessions share a process UUID", async () => {
	const root = await mkdtemp(join(tmpdir(), "claude-fallback-"));
	try {
		const file = join(root, "file");
		await writeFile(file, "not a directory");
		const env = { XDG_STATE_HOME: file };
		const id = await deviceId(env);
		expect(id).toMatch(/^[0-9a-f]{64}$/);
		expect(await deviceId(env)).toBe(id);
		const fallback = sessionId(undefined);
		expect(fallback).toMatch(/^[0-9a-f-]{36}$/);
		expect(sessionId("invalid")).toBe(fallback);
		const valid = "019a2445-634a-7000-8000-000000000001";
		expect(sessionId(valid)).toBe(valid);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
