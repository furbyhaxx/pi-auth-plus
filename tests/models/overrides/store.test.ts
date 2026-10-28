import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { ModelConfig } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-config.js";
import {
	readOverride,
	updateOverride,
	updateOverrides,
} from "../../../src/models/overrides/index.ts";

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

	test("applies a staged group atomically and leaves the file untouched when an edit is invalid", async () => {
		const path = await pathForTest();
		const source =
			'{"providers":{"p":{"modelOverrides":{"m":{"contextWindow":100}}}},"other":true}';
		await writeFile(path, source);
		await expect(
			updateOverrides(path, "p", "m", [
				{ field: ["contextWindow"], edit: { kind: "set", value: 200 } },
				{ field: ["cost", "input"], edit: { kind: "set", value: Number.NaN } },
			]),
		).rejects.toThrow("JSON-compatible");
		expect(await readFile(path, "utf8")).toBe(source);
		await updateOverrides(path, "p", "m", [
			{ field: ["contextWindow"], edit: { kind: "set", value: 200 } },
			{ field: ["cost", "input"], edit: { kind: "set", value: 0 } },
		]);
		expect(await readOverride(path, "p", "m")).toEqual({ contextWindow: 200, cost: { input: 0 } });
		expect(await readFile(path, "utf8")).toContain('"other":true');
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

	test("preserves comments inside a deleted object", async () => {
		const path = await pathForTest();
		await writeFile(
			path,
			'{"providers":{"p":{"modelOverrides":{"m":{"cost":{\r\n // retain nested\r\n "input":1},"name":"n"}}}}}',
		);
		await updateOverride(path, "p", "m", ["cost"], { kind: "remove" });
		const result = await readFile(path, "utf8");
		expect(result).toContain("// retain nested\r\n");
		expect(await readOverride(path, "p", "m")).toEqual({ name: "n" });
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

	test("writes through a symlink while preserving CRLF, indentation and comments", async () => {
		const path = await pathForTest();
		const target = join(path, "..", "managed.json");
		const source =
			'{\r\n  "providers": {\r\n    "p": {\r\n      "modelOverrides": {\r\n        "m": {\r\n          // preserve\r\n          "name": "old" // sibling\r\n        }\r\n      }\r\n    }\r\n  }\r\n}\r\n';
		await writeFile(target, source, { mode: 0o640 });
		await symlink("managed.json", path);
		await updateOverride(path, "p", "m", ["maxTokens"], { kind: "set", value: 10 });
		expect((await lstat(path)).isSymbolicLink()).toBe(true);
		expect(await readFile(target, "utf8")).toBe(
			source.replace(
				'"name": "old" // sibling',
				'"name": "old", // sibling\r\n          "maxTokens": 10',
			),
		);
		expect((await stat(target)).mode & 0o777).toBe(0o640);
		expect(await readOverride(path, "p", "m")).toEqual({ name: "old", maxTokens: 10 });
	});

	test("preserves trailing commas and empty object indentation with CRLF", async () => {
		const path = await pathForTest();
		const source =
			'{\r\n  "providers": {\r\n    "p": {\r\n      "modelOverrides": {\r\n        "m": {\r\n          "name": "n", // keep\r\n        },\r\n        "empty": {\r\n        }\r\n      }\r\n    }\r\n  }\r\n}\r\n';
		await writeFile(path, source);
		await updateOverride(path, "p", "m", ["maxTokens"], { kind: "set", value: 10 });
		await updateOverride(path, "p", "empty", ["name"], { kind: "set", value: "e" });
		expect(await readFile(path, "utf8")).toBe(
			source
				.replace(
					'"name": "n", // keep\r\n',
					'"name": "n", // keep\r\n          "maxTokens": 10\r\n',
				)
				.replace('"empty": {\r\n', '"empty": {\r\n          "name": "e"\r\n'),
		);
	});

	test("derives tab indentation for empty objects", async () => {
		const path = await pathForTest();
		const source =
			'{\n\t"providers": {\n\t\t"p": {\n\t\t\t"modelOverrides": {\n\t\t\t\t"m": {\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n';
		await writeFile(path, source);
		await updateOverride(path, "p", "m", ["name"], { kind: "set", value: "n" });
		expect(await readFile(path, "utf8")).toBe(
			source.replace('"m": {\n', '"m": {\n\t\t\t\t\t"name": "n"\n'),
		);
	});

	test("ignores unsupported directory fsync after the rename", async () => {
		const path = await pathForTest();
		const original = fs.fsyncSync;
		let directoryAttempted = false;
		const sync = spyOn(fs, "fsyncSync").mockImplementation((fd) => {
			if (fs.fstatSync(fd).isDirectory()) {
				directoryAttempted = true;
				throw Object.assign(new Error("unsupported"), { code: "EINVAL" });
			}
			original(fd);
		});
		try {
			await updateOverride(path, "p", "m", ["name"], { kind: "set", value: "n" });
			expect(directoryAttempted).toBe(true);
			expect(await readOverride(path, "p", "m")).toEqual({ name: "n" });
		} finally {
			sync.mockRestore();
		}
	});

	test("rejects dangling links without replacing them", async () => {
		const path = await pathForTest();
		await symlink("missing.json", path);
		await expect(
			updateOverride(path, "p", "m", ["name"], { kind: "set", value: "n" }),
		).rejects.toThrow(/symlink.*missing|symlink.*dangling/i);
		await expect(readOverride(path, "p", "m")).rejects.toThrow(
			/symlink.*missing|symlink.*dangling/i,
		);
		expect((await lstat(path)).isSymbolicLink()).toBe(true);
	});

	test("reports malformed UTF-8 with the path and repair guidance", async () => {
		const path = await pathForTest();
		const source = Buffer.from([0x7b, 0xff, 0x7d]);
		await writeFile(path, source);
		for (const operation of [
			() => readOverride(path, "p", "m"),
			() => updateOverride(path, "p", "m", ["name"], { kind: "set", value: "n" }),
		]) {
			try {
				await operation();
				throw new Error("expected an error");
			} catch (error) {
				expect(String(error)).toContain(path);
				expect(String(error)).toMatch(/UTF-8.*(fix|correct|repair)/i);
			}
		}
		expect(await readFile(path)).toEqual(source);
	});

	test("reports lock contention through a symlink without modifying the target", async () => {
		const path = await pathForTest();
		const target = join(path, "..", "managed.json");
		const source = '{"providers":{}}';
		await writeFile(target, source);
		await symlink("managed.json", path);
		const release = await lockfile.lock(target, { realpath: false });
		try {
			await expect(
				updateOverride(path, "p", "m", ["name"], { kind: "set", value: "n" }),
			).rejects.toThrow(new RegExp(`${target}.*retry`, "i"));
			expect(await readFile(target, "utf8")).toBe(source);
		} finally {
			await release();
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
