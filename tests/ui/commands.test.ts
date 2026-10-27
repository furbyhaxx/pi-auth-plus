import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Registry } from "../../src/core/registry/index.ts";
import {
	type AuthCommandDeps,
	authCompletions,
	parseAuthArgs,
	registerAuthCommands,
} from "../../src/ui/commands/index.ts";

import type { DashboardResult } from "../../src/ui/dashboard/view.ts";

function rig(
	mode: "tui" | "rpc",
	overrides: Partial<AuthCommandDeps> = {},
	results: DashboardResult[] = [],
	hasUI = true,
) {
	let panels = 0;
	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	const notes: string[] = [];
	const notices: [string, string | undefined][] = [];
	const pi = {
		registerCommand: (name: string, options: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
			commands.set(name, options);
		},
		registerEntryRenderer: () => {},
		appendEntry: (_type: string, data: { text: string }) => notes.push(data.text),
	} as unknown as ExtensionAPI;
	const registry = new Registry([
		{
			id: "anthropic",
			label: "Anthropic",
			providers: [{ id: "claude", label: "Claude", aliases: ["cc"] }],
		},
	]);
	registerAuthCommands(pi, {
		registry,
		status: () => ({ state: "missing" }),
		now: () => 0,
		...overrides,
	});
	const ctx = {
		mode,
		hasUI,
		ui: {
			notify: (text: string, tone?: string) => notices.push([text, tone]),
			select: async () => "Spend 1 credit now (cannot be undone)",
			custom: async () => {
				panels++;
				return results.shift();
			},
		},
	} as unknown as ExtensionCommandContext;
	const run = (name: string, args = "") => {
		const handler = commands.get(name)?.handler;
		if (!handler) throw new Error(`/${name} is not registered`);
		return handler(args, ctx);
	};
	return { run, notes, notices, commands, names: [...commands.keys()], panels: () => panels };
}

describe("ui/commands", () => {
	test("reset resolves aliases and defaults, rejects unknown providers, and reopens after panel reset", async () => {
		const consumed: [string, string, string | undefined][] = [];
		const quotas: ReturnType<NonNullable<AuthCommandDeps["quotas"]>> = {
			report: () => ({ v: 1, generatedAt: 0, providers: [] }),
			resetSupport: (id) => id === "claude",
			listResets: async (id) => ({
				provider: id,
				fetchedAt: 0,
				available: 1,
				credits: [{ id: "credit", type: "reset", status: "available" }],
			}),
			consumeReset: async (id, creditId, requester) => {
				consumed.push([id, creditId, requester]);
				return { provider: id, creditId, windowsReset: 1, code: "reset" };
			},
			refreshing: () => false,
			refresh: async () => {},
			onChange: () => () => {},
			lineConfig: () => ({ percentDisplay: "used", creditHealthyUsd: 50, creditCriticalUsd: 5 }),
			linePlacement: () => "off",
			setLinePlacement: async () => {},
			now: () => 0,
			text: () => "",
		};
		const f = rig("tui", { quotas: () => quotas }, [{ reset: "claude" }, undefined]);
		await f.run("quotas", "reset cc");
		await f.run("quotas", "resets");
		await f.run("quota", "reset");
		await f.run("quota", "reset cc");
		await f.run("quotas", "reset unknown");
		expect(f.notices.at(-1)).toEqual([
			"Usage: /quotas reset [provider]. Supported: claude.",
			"error",
		]);
		await f.run("auth", "quotas");
		expect(f.panels()).toBe(2);
		expect(consumed).toEqual([
			["claude", "credit", "command"],
			["claude", "credit", "command"],
			["claude", "credit", "command"],
			["claude", "credit", "command"],
			["claude", "credit", "panel"],
		]);
	});
	test("quota shares the quotas handler, completions and provider routing", async () => {
		const registry = new Registry([
			{
				id: "openai",
				label: "OpenAI",
				providers: [{ id: "codex", label: "OpenAI Codex", aliases: ["openai"] }],
			},
		]);
		const rpc = rig("rpc", { registry });
		const singular = rpc.commands.get("quota");
		const plural = rpc.commands.get("quotas");
		expect(singular).toBeDefined();
		expect(singular?.handler).toBe(plural?.handler);
		expect(singular?.getArgumentCompletions).toBe(plural?.getArgumentCompletions);
		expect((await singular?.getArgumentCompletions?.("co"))?.map((item) => item.value)).toEqual([
			"codex",
			"codex login",
			"codex login --device",
			"codex login --browser",
		]);
		expect((await singular?.getArgumentCompletions?.("re"))?.map((item) => item.value)).toEqual([
			"reset",
		]);
		await rpc.run("quota", "codex");
		await rpc.run("quotas", "codex");
		expect(rpc.notices[0]).toEqual(rpc.notices[1]);
		expect(rpc.notices[0]?.[0]).toStartWith("Auth › Quotas");
	});
	test("Codex login forwards device status, refreshes quota, and leaves provider routing intact", async () => {
		const registry = new Registry([
			{
				id: "openai",
				label: "OpenAI",
				providers: [{ id: "codex", label: "Codex", aliases: ["cx", "openai"] }],
			},
		]);
		const events: string[] = [];
		const controller = new AbortController();
		const quotas: ReturnType<NonNullable<AuthCommandDeps["quotas"]>> = {
			report: () => ({ v: 1, generatedAt: 0, providers: [] }),
			resetSupport: () => false,
			listResets: async () => {
				throw new Error("unexpected reset");
			},
			consumeReset: async () => {
				throw new Error("unexpected reset");
			},
			refreshing: () => false,
			refresh: async (id, force) => {
				events.push(`refresh ${id} ${force}`);
			},
			onChange: () => () => {},
			lineConfig: () => ({ percentDisplay: "used", creditHealthyUsd: 50, creditCriticalUsd: 5 }),
			linePlacement: () => "off",
			setLinePlacement: async () => {},
			now: () => 0,
			text: (id) => `Focused ${id}`,
		};
		const f = rig("rpc", {
			registry,
			quotas: () => quotas,
			signal: controller.signal,
			loginCodex: async ({ mode, onStatus, signal }) => {
				events.push(`login ${mode}`);
				expect(signal).toBe(controller.signal);
				onStatus("Visit https://example.test/device and enter ABCD");
				return {
					type: "oauth",
					access: "test-access",
					refresh: "test-refresh",
					expires: 0,
					email: "person@example.test",
					planType: "plus",
				};
			},
		});
		await f.run("quota", "codex login --device");
		expect(events).toEqual(["login device", "refresh codex true"]);
		expect(f.notices).toEqual([
			["Visit https://example.test/device and enter ABCD", "info"],
			["Codex quota authenticated (person@example.test) [plus]", "info"],
		]);
		await f.run("quotas", "cx login");
		await f.run("quota", "login openai --browser");
		expect(events.slice(2)).toEqual([
			"login auto",
			"refresh codex true",
			"login browser",
			"refresh codex true",
		]);
		await f.run("quota", "codex");
		expect(f.notices.at(-1)).toEqual(["Auth › Quotas\nFocused codex", "info"]);
		expect(events).toHaveLength(6);
		controller.abort();
		const noticesBeforeAbort = f.notices.length;
		await f.run("quota", "cx login");
		expect(events.at(-1)).toBe("login auto");
		expect(events).toHaveLength(7);
		expect(f.notices).toHaveLength(noticesBeforeAbort);
	});

	test("Codex login rejects malformed arguments and handles failure without throwing", async () => {
		const registry = new Registry([
			{
				id: "openai",
				label: "OpenAI",
				providers: [{ id: "codex", label: "Codex", aliases: ["cx"] }],
			},
		]);
		let calls = 0;
		const deps: Partial<AuthCommandDeps> = {
			registry,
			loginCodex: async () => {
				calls++;
				throw new Error("device authorization rejected");
			},
		};
		const f = rig("rpc", deps);
		for (const args of [
			"codex login --bad",
			"codex login extra",
			"codex login --device --browser",
			"login cx --browser extra",
			"login unknown",
		]) {
			await f.run("quota", args);
			expect(f.notices.at(-1)?.[0]).toStartWith("Usage: /quota");
			expect(f.notices.at(-1)?.[1]).toBe("error");
		}
		expect(calls).toBe(0);
		await f.run("quota", "codex login");
		expect(calls).toBe(1);
		expect(f.notices.at(-1)).toEqual([
			"Codex login failed: device authorization rejected",
			"error",
		]);
		const headless = rig("rpc", deps, [], false);
		await headless.run("quota", "cx login");
		expect(calls).toBe(1);
		expect(headless.notes).toEqual(["Codex login needs an interactive session"]);
	});

	test("Codex login succeeds without a quota engine or optional identity fields", async () => {
		const f = rig("rpc", {
			registry: new Registry([
				{
					id: "openai",
					label: "OpenAI",
					providers: [{ id: "codex", label: "Codex", aliases: [] }],
				},
			]),
			quotas: () => "Quotas unavailable",
			loginCodex: async () => ({
				type: "oauth",
				access: "test-access",
				refresh: "test-refresh",
				expires: 0,
			}),
		});
		await f.run("quota", "codex login");
		expect(f.notices).toEqual([["Codex quota authenticated", "info"]]);
	});

	test("sections resolve by id, alias and singular form; unknown input names the closest", () => {
		expect(parseAuthArgs("")).toEqual({ tab: "providers" });
		expect(parseAuthArgs(" Quota ")).toEqual({ tab: "quotas" });
		expect(parseAuthArgs("config")).toEqual({ tab: "settings" });
		expect(parseAuthArgs("quotas  cc")).toEqual({ tab: "quotas", target: "cc" });
		const unknown = parseAuthArgs("tokns");
		expect("error" in unknown && unknown.error).toContain("Did you mean: tokens");
		expect("error" in unknown && unknown.error).toContain(
			"Usage: /auth [providers|quotas|tokens|settings]",
		);
		expect(authCompletions("u")?.map((item) => item.value)).toEqual(["quotas"]);
		expect(authCompletions("zz")).toBeNull();
	});

	test("without a TUI the dashboard renders as text and opens the named section", async () => {
		const rpc = rig("rpc");
		expect(rpc.names).toEqual(["auth", "quotas", "quota"]);
		await rpc.run("auth");
		expect(rpc.notices[0]).toEqual([
			"Auth › Providers\n  Claude: not signed in · /login claude",
			"info",
		]);
		await rpc.run("auth", "quota");
		expect(rpc.notices[1]?.[0]).toStartWith("Auth › Quotas");
		await rpc.run("auth", "nope");
		expect(rpc.notices[2]?.[1]).toBe("error");
	});
});
