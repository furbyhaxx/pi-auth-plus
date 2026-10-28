import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { ModelConfig } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-config.js";
import { readOverride, updateOverride } from "../../../src/models/overrides/index.ts";

const dirs: string[] = [];
async function pathForTest(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-overrides-"));
	dirs.push(dir);
	return join(dir, "models.json");
}
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("model overrides", () => {
	test("edits JSONC without disturbing unrelated bytes", async () => {
		const path = await pathForTest();
		const source =
			'\ufeff{\n  // heading\n  "providers": {\n    "provider": {\n      "apiKey": "dummy", // keep\n      "modelOverrides": {\n        "vendor/quoted\\"id": {\n          "contextWindow": 100, // limit\n          "maxTokens": 10,\n          "cost": { "input": 1, "output": 2 },\n        },\n      },\n    },\n  },\n}\n';
		await writeFile(path, source, { mode: 0o600 });
		await updateOverride(path, "provider", 'vendor/quoted"id', ["contextWindow"], {
			kind: "set",
			value: 200,
		});
		await updateOverride(path, "provider", 'vendor/quoted"id', ["maxTokens"], { kind: "remove" });
		const result = await readFile(path, "utf8");
		expect(result).toBe(
			source
				.replace('"contextWindow": 100', '"contextWindow": 200')
				.replace('"maxTokens": 10,', ""),
		);
		expect(await readOverride(path, "provider", 'vendor/quoted"id')).toEqual({
			contextWindow: 200,
			cost: { input: 1, output: 2 },
		});
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		const config = await ModelConfig.load(path);
		expect(config.getError()).toBeUndefined();
		expect(
			config.getProvider("provider")?.modelOverrides?.['vendor/quoted"id']?.contextWindow,
		).toBe(200);
	});

	test("serializes concurrent edits and preserves nested values", async () => {
		const path = await pathForTest();
		await Promise.all([
			updateOverride(path, "p", "a/b", ["cost", "input"], { kind: "set", value: 1 }),
			updateOverride(path, "p", "a/b", ["cost", "output"], { kind: "set", value: 2 }),
		]);
		await updateOverride(path, "p", "a/b", ["cost", "input"], { kind: "remove" });
		expect(await readOverride(path, "p", "a/b")).toEqual({ cost: { output: 2 } });
	});

	test("removes the last field and retains other settings and comments", async () => {
		const path = await pathForTest();
		await writeFile(
			path,
			'{"providers":{"p":{"modelOverrides":{"m":{"cost":{"input":1, // keep\n "output":2}, "maxTokens":3}},"baseUrl":"https://example.invalid"}}}',
		);
		await updateOverride(path, "p", "m", ["maxTokens"], { kind: "remove" });
		await updateOverride(path, "p", "m", ["cost", "output"], { kind: "remove" });
		const result = await readFile(path, "utf8");
		expect(result).toContain("// keep");
		expect(result).toContain('"baseUrl":"https://example.invalid"');
		expect(await readOverride(path, "p", "m")).toEqual({ cost: { input: 1 } });
		const config = await ModelConfig.load(path);
		expect(config.getError()).toBeUndefined();
	});

	test("rejects malformed and ambiguous files without changing them", async () => {
		const path = await pathForTest();
		for (const source of ['{"providers":', '{"providers":{},"providers":{}}', '{"providers":[]}']) {
			await writeFile(path, source);
			await expect(
				updateOverride(path, "p", "m", ["name"], { kind: "set", value: "n" }),
			).rejects.toThrow();
			expect(await readFile(path, "utf8")).toBe(source);
		}
	});

	test("does not write without acquiring the lock", async () => {
		const path = await pathForTest();
		await writeFile(path, '{"providers":{}}');
		const release = await lockfile.lock(path, { realpath: false });
		try {
			await expect(
				updateOverride(path, "p", "m", ["name"], { kind: "set", value: "n" }),
			).rejects.toThrow();
			expect(await readFile(path, "utf8")).toBe('{"providers":{}}');
		} finally {
			await release();
		}
	});
});
