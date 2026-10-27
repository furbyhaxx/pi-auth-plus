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

type Handler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

function rig(
	mode: "tui" | "rpc",
	overrides: Partial<AuthCommandDeps> = {},
	results: DashboardResult[] = [],
) {
	let panels = 0;
	const handlers = new Map<string, Handler>();
	const notes: string[] = [];
	const notices: [string, string | undefined][] = [];
	const pi = {
		registerCommand: (name: string, options: { handler: Handler }) =>
			handlers.set(name, options.handler),
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
		hasUI: true,
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
		const handler = handlers.get(name);
		if (!handler) throw new Error(`/${name} is not registered`);
		return handler(args, ctx);
	};
	return { run, notes, notices, names: [...handlers.keys()], panels: () => panels };
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
			["claude", "credit", "panel"],
		]);
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
		// `/quota` stays with pi-quotas until the cutover.
		expect(rpc.names).toEqual(["auth", "quotas"]);
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
