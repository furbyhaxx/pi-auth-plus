import { expect, test } from "bun:test";
import { normalizeContext, type Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ModelRegistry, ProviderConfig } from "@earendil-works/pi-coding-agent";
import {
	type ProviderRegistration,
	type ProviderSink,
	Registry,
	registerFamilyProviders,
} from "../../../src/core/registry/index.ts";
import { createAnthropicFamily } from "../../../src/families/anthropic/index.ts";
import { createGoogleFamily } from "../../../src/families/google/index.ts";
import { FAMILIES } from "../../../src/families/index.ts";
import { testHost } from "../../host.ts";

class RecordingSink implements ProviderSink {
	readonly registrations: ProviderRegistration[] = [];

	registerProvider(provider: Provider): void;
	registerProvider(name: string, config: ProviderConfig): void;
	registerProvider(provider: Provider | string, config?: ProviderConfig): void {
		if (typeof provider !== "string") this.registrations.push({ provider });
		else {
			if (!config) throw new Error("A named registration needs a config");
			this.registrations.push({ name: provider, config });
		}
	}

	native(): Provider {
		const registration = this.registrations[0];
		if (!registration || !("provider" in registration)) throw new Error("No native provider");
		return registration.provider;
	}
}

type RegistryConfig = Parameters<ModelRegistry["registerProvider"]>[1];
const compatible: [
	ExtensionAPI extends ProviderSink ? true : false,
	ModelRegistry extends ProviderSink ? true : false,
	ProviderConfig extends RegistryConfig ? true : false,
	RegistryConfig extends ProviderConfig ? true : false,
] = [true, true, true, false];

test("all family registrations reach a standalone sink in Pi registration order", async () => {
	expect(compatible).toEqual([true, true, true, false]);
	const sink = new RecordingSink();
	await registerFamilyProviders(sink, new Registry(FAMILIES), await testHost());
	const ids = sink.registrations.map((entry) =>
		"provider" in entry ? entry.provider.id : entry.name,
	);
	expect(ids).toEqual(
		process.env["OPENCODE_API_KEY"]
			? ["synthetic", "claude", "antigravity"]
			: ["opencode", "synthetic", "claude", "antigravity"],
	);
});

const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] });

function sessionHooks() {
	const handlers: Array<() => unknown> = [];
	const warnings: string[] = [];
	const ctx = { ui: { notify: (message: string) => warnings.push(message) } };
	const unexpected = (): never => {
		throw new Error("Unexpected Pi API call");
	};
	const pi: ExtensionAPI = {
		on: (event: string, handler: unknown) => {
			if (event !== "session_start" || typeof handler !== "function") return unexpected();
			handlers.push(() => handler({ type: "session_start" }, ctx));
			return () => {};
		},
		registerTool: unexpected,
		registerCommand: unexpected,
		registerShortcut: unexpected,
		registerFlag: unexpected,
		getFlag: unexpected,
		registerMessageRenderer: unexpected,
		registerMarkdownTransformer: unexpected,
		registerEntryRenderer: unexpected,
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
		getSettings: unexpected,
		setActiveTools: unexpected,
		getCommands: unexpected,
		setModel: unexpected,
		getThinkingLevel: unexpected,
		setThinkingLevel: unexpected,
		registerProvider: unexpected,
		unregisterProvider: unexpected,
		registerMcpServer: unexpected,
		unregisterMcpServer: unexpected,
		getMcpServers: unexpected,
		registerVirtualModel: unexpected,
		unregisterVirtualModel: unexpected,
		events: { on: unexpected, emit: unexpected },
	};
	return {
		pi,
		warnings,
		start: async () => {
			for (const handler of handlers) await handler();
		},
	};
}

test("Claude's provider and warning retain one version snapshot and never probe at registration", async () => {
	const env = { ANTHROPIC_CLAUDE_CODE_VERSION: "1.0.0" };
	let probes = 0;
	const family = createAnthropicFamily(env, async () => {
		probes++;
		return undefined;
	});
	const host = await testHost();
	const sink = new RecordingSink();
	await registerFamilyProviders(sink, new Registry([family]), host);
	expect(probes).toBe(0);
	env.ANTHROPIC_CLAUDE_CODE_VERSION = "2.1.999";
	const hooks = sessionHooks();
	await family.register?.(hooks.pi, host);
	await hooks.start();
	await hooks.start();
	expect(hooks.warnings).toHaveLength(1);
	expect(hooks.warnings[0]).toContain("=1.0.0 is older");
	const provider = sink.native();
	const model = provider.getModels()[0];
	if (!model) throw new Error("Claude has no models");
	const versions: Array<string | null> = [];
	await provider
		.streamSimple(model, context, {
			headers: { Authorization: "Bearer test-oauth" },
			maxRetries: 0,
			fetch: Object.assign(
				async (_input: string | URL | Request, init?: RequestInit) => {
					if (init?.method === "HEAD") return new Response(null);
					versions.push(new Headers(init?.headers).get("user-agent"));
					return Response.json(
						{ error: { type: "invalid_request_error", message: "test end" } },
						{ status: 400 },
					);
				},
				{ preconnect: () => {} },
			),
		})
		.result();
	expect(versions).toEqual(["claude-cli/1.0.0 (external, cli)"]);
	expect(probes).toBe(0);
});

test("Google session starts reset the project cached by the registered provider", async () => {
	let discoveries = 0;
	const family = createGoogleFamily(async (input) => {
		if (String(input).endsWith(":loadCodeAssist")) {
			discoveries++;
			return Response.json({ cloudaicompanionProject: "test-project" });
		}
		return new Response(
			`data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] } })}\r\n\r\n`,
		);
	});
	const host = await testHost();
	const sink = new RecordingSink();
	await registerFamilyProviders(sink, new Registry([family]), host);
	expect(discoveries).toBe(0);
	const hooks = sessionHooks();
	await family.register?.(hooks.pi, host);
	const provider = sink.native();
	const model = provider.getModels()[0];
	if (!model) throw new Error("Antigravity has no models");
	const turn = () =>
		provider
			.streamSimple(model, context, { headers: { Authorization: "Bearer test-oauth" } })
			.result();
	expect((await turn()).stopReason).toBe("stop");
	expect((await turn()).stopReason).toBe("stop");
	expect(discoveries).toBe(1);
	await hooks.start();
	expect((await turn()).stopReason).toBe("stop");
	expect(discoveries).toBe(2);
});
