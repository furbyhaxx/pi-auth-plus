import { expect, test } from "bun:test";
import { type QuotaCliDependencies, runQuotaCli } from "../../src/cli/index.ts";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { SettingsStore } from "../../src/core/config/index.ts";
import { Registry } from "../../src/core/registry/index.ts";
import { FAMILIES } from "../../src/families/index.ts";

function setup(state: "ok" | "error" = "ok") {
	const output: [number, string][] = [];
	const calls: unknown[] = [];
	const deps: QuotaCliDependencies = {
		registry: new Registry(FAMILIES),
		settings: new SettingsStore(SETTINGS, { user: "/unused" }),
		engine: {
			cache: {
				sync: async () => {
					calls.push("sync");
					return true;
				},
			},
			refresh: async (id, options) => {
				calls.push([id, options]);
			},
			stop: () => {
				calls.push("stop");
			},
		},
		report: (ids) => ({
			v: 1,
			generatedAt: 0,
			providers: ids.map((id) => ({
				id,
				title: id,
				short: id,
				state,
				windows: [],
			})),
		}),
		write: (fd, text) => {
			output.push([fd, text]);
		},
		color: false,
	};
	return { deps, output, calls };
}

test("resolves cc to Pi id claude and refreshes with the configured age", async () => {
	const { deps, output, calls } = setup();
	expect(await runQuotaCli({ json: true, provider: "cc" }, deps)).toBe(0);
	expect(JSON.parse(output[0]?.[1] ?? "{}").providers[0].id).toBe("claude");
	expect(calls).toEqual([
		"sync",
		[
			"claude",
			{
				minAgeMs: deps.settings.get("quotas.refreshIntervalSec") * 1000,
			},
		],
		"stop",
	]);
});

test("unknown provider prints known Pi ids without fetching", async () => {
	const { deps, output, calls } = setup();
	expect(await runQuotaCli({ json: true, provider: "nope" }, deps)).toBe(2);
	expect(output).toEqual([
		[
			2,
			'Unknown provider "nope". Known: synthetic, claude, antigravity, openai, xai, openrouter, deepseek\n',
		],
	]);
	expect(calls).toEqual(["stop"]);
});

test("table writes diagnostics and exits partial for a failed provider", async () => {
	const { deps, output } = setup("error");
	expect(await runQuotaCli({ json: false, provider: "cc" }, deps)).toBe(1);
	expect(output[0]?.[0]).toBe(1);
	expect(output[1]).toEqual([2, "claude: error\n"]);
});

test("queries all enabled providers when no positional is supplied", async () => {
	const { deps, calls } = setup();
	await runQuotaCli({ json: true }, deps);
	expect(calls).toHaveLength(9);
});

test("a disabled provider returns usage rather than a successful empty report", async () => {
	const { deps, output, calls } = setup();
	await deps.settings.save("runtime", { "quotas.providers": ["synthetic"] });
	expect(await runQuotaCli({ json: true, provider: "cc" }, deps)).toBe(2);
	expect(output).toEqual([
		[2, 'Quota provider "claude" is disabled. Enable it in quotas.providers.\n'],
	]);
	expect(calls).toEqual(["stop"]);
});

test("stops the engine on storage failure", async () => {
	const { deps, calls } = setup();
	deps.engine.cache.sync = async () => {
		throw new Error("storage failed");
	};
	await expect(runQuotaCli({ json: true }, deps)).rejects.toThrow("storage failed");
	expect(calls).toEqual(["stop"]);
});
