import { expect, spyOn, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piAuthPlus from "../../src/index.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";

test("pi-quotas in settings keeps the engine off and warns once with a removal hint", async () => {
	const starts: Array<() => unknown> = [];
	const shutdowns: Array<() => unknown> = [];
	const notices: [string, string | undefined][] = [];
	const ctx = {
		cwd: process.env["HOME"],
		mode: "rpc",
		hasUI: true,
		isProjectTrusted: () => false,
		ui: { notify: (message: string, tone?: string) => notices.push([message, tone]) },
	};
	const unexpected = (): never => {
		throw new Error("Unexpected Pi API call");
	};
	const pi: ExtensionAPI = {
		on: (event: string, handler: unknown) => {
			if (typeof handler !== "function") return unexpected();
			if (event === "session_start") starts.push(() => handler({ type: event }, ctx));
			if (event === "session_shutdown") shutdowns.push(() => handler({ type: event }, ctx));
			return () => {};
		},
		registerFlag: () => {},
		getFlag: () => false,
		registerCommand: () => {},
		registerEntryRenderer: () => {},
		registerProvider: () => {},
		getSettings: () => ({ packages: ["npm:pi-quotas"] }),
		getCommands: () => [],
		events: { on: () => () => {}, emit: unexpected },
		registerTool: unexpected,
		registerShortcut: unexpected,
		registerMessageRenderer: unexpected,
		registerMarkdownTransformer: unexpected,
		registerToolRenderer: unexpected,
		sendMessage: unexpected,
		sendUserMessage: unexpected,
		appendEntry: unexpected,
		setSessionName: unexpected,
		getSessionName: unexpected,
		setLabel: unexpected,
		exec: unexpected,
		getActiveTools: unexpected,
		getAllTools: unexpected,
		setActiveTools: unexpected,
		setModel: unexpected,
		getThinkingLevel: unexpected,
		setThinkingLevel: unexpected,
		unregisterProvider: unexpected,
		registerMcpServer: unexpected,
		unregisterMcpServer: unexpected,
		getMcpServers: unexpected,
		registerVirtualModel: unexpected,
		unregisterVirtualModel: unexpected,
	};
	const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
	try {
		await piAuthPlus(pi);
		for (let session = 0; session < 2; session++) {
			for (const handler of starts) await handler();
		}
		expect(start).not.toHaveBeenCalled();
		expect(notices.filter(([message]) => message.includes("pi-quotas"))).toEqual([
			[
				"pi-auth-plus replaces pi-quotas. Running both duplicates providers and commands. Remove: pi remove npm:pi-quotas",
				"warning",
			],
		]);
	} finally {
		for (const handler of shutdowns) await handler();
		start.mockRestore();
	}
});
