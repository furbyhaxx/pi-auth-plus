import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Registry } from "../../src/core/registry/index.ts";
import {
	authCompletions,
	parseAuthArgs,
	registerAuthCommands,
} from "../../src/ui/commands/index.ts";

type Handler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

function rig(mode: "tui" | "rpc") {
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
			providers: [{ id: "claude", label: "Claude", aliases: [] }],
		},
	]);
	registerAuthCommands(pi, { registry, status: () => ({ state: "missing" }), now: () => 0 });
	const ctx = {
		mode,
		hasUI: true,
		ui: { notify: (text: string, tone?: string) => notices.push([text, tone]) },
	} as unknown as ExtensionCommandContext;
	const run = (name: string, args = "") => {
		const handler = handlers.get(name);
		if (!handler) throw new Error(`/${name} is not registered`);
		return handler(args, ctx);
	};
	return { run, notes, notices, names: [...handlers.keys()] };
}

describe("ui/commands", () => {
	test("sections resolve by id, alias and singular form; unknown input names the closest", () => {
		expect(parseAuthArgs("")).toEqual({ tab: "providers" });
		expect(parseAuthArgs(" Quota ")).toEqual({ tab: "quotas" });
		expect(parseAuthArgs("config")).toEqual({ tab: "settings" });
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
		// No /quota entry point until the quota engine lands: pi-quotas owns that name meanwhile.
		expect(rpc.names).toEqual(["auth"]);
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
