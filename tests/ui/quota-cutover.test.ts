import { expect, spyOn, test } from "bun:test";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { channelName } from "../../src/core/bus/index.ts";
import piAuthPlus from "../../src/index.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";

function rig(packages: string[]) {
	const handlers = new Map<string, Array<(payload?: Record<string, unknown>) => unknown>>();
	const bus = createEventBus();
	const notices: [string, string | undefined][] = [];
	const ctx = {
		cwd: process.env["HOME"],
		model: { provider: "openai-codex" },
		modelRegistry: {
			refresh: async () => ({ errors: new Map(), aborted: false }),
			getAll: () => [],
			getAvailable: () => [],
		},
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
			const list = handlers.get(event) ?? [];
			list.push((payload) => handler({ type: event, ...payload }, ctx));
			handlers.set(event, list);
			return () => {};
		},
		registerFlag: () => {},
		getFlag: () => false,
		registerCommand: () => {},
		registerEntryRenderer: () => {},
		registerProvider: () => {},
		getSettings: () => ({ packages }),
		getCommands: () => [],
		events: bus,
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
	return {
		pi,
		bus,
		notices,
		run: async (event: string, payload?: Record<string, unknown>) => {
			for (const handler of handlers.get(event) ?? []) await handler(payload);
		},
	};
}

test("pi-quotas in settings keeps the engine off and warns once with a removal hint", async () => {
	const { pi, notices, run } = rig(["npm:pi-quotas"]);
	const start = spyOn(QuotaEngine.prototype, "start").mockResolvedValue(undefined);
	try {
		await piAuthPlus(pi);
		for (let session = 0; session < 2; session++) await run("session_start");
		expect(start).not.toHaveBeenCalled();
		expect(notices.filter(([message]) => message.includes("pi-quotas"))).toEqual([
			[
				"pi-auth-plus replaces pi-quotas. Running both duplicates providers and commands. Remove: pi remove npm:pi-quotas",
				"warning",
			],
		]);
	} finally {
		await run("session_shutdown");
		start.mockRestore();
	}
});

test("Codex turns ingest headers and publish codex, then refresh the canonical id", async () => {
	const { pi, bus, run } = rig([]);
	const snapshots: unknown[] = [];
	const off = bus.on(channelName("quotas", "snapshot"), (raw) => snapshots.push(raw));
	const refresh = spyOn(QuotaEngine.prototype, "refresh").mockResolvedValue(undefined);
	const ingest = spyOn(QuotaEngine.prototype, "ingestHeaders");
	try {
		await piAuthPlus(pi);
		await run("session_start");
		refresh.mockClear();
		await run("after_provider_response", {
			headers: { "x-codex-primary-used-percent": "25", "x-codex-primary-window-minutes": "300" },
		});
		expect(ingest).toHaveBeenCalledWith(
			{ "x-codex-primary-used-percent": "25", "x-codex-primary-window-minutes": "300" },
			"openai-codex",
		);
		expect(await ingest.mock.results[0]?.value).toBe("codex");
		expect(snapshots).toContainEqual({
			v: 1,
			provider: expect.objectContaining({ id: "codex", title: "OpenAI Codex", short: "cox" }),
		});
		await run("agent_end");
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledWith("codex", { minAgeMs: 2000 });
	} finally {
		await run("session_shutdown");
		off();
		ingest.mockRestore();
		refresh.mockRestore();
	}
});
