import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { SettingsStore } from "../../src/core/config/index.ts";
import { Registry } from "../../src/core/registry/index.ts";
import {
	type AuthCommandDeps,
	authCompletions,
	parseAuthArgs,
	registerAuthCommands,
} from "../../src/ui/commands/index.ts";

import type { AuthDashboard } from "../../src/ui/dashboard/index.ts";
import type { DashboardResult } from "../../src/ui/dashboard/view.ts";
import type { PanelHost, PanelTheme } from "../../src/ui/frame/index.ts";

function rig(
	mode: "tui" | "rpc",
	overrides: Partial<AuthCommandDeps> = {},
	results: DashboardResult[] = [],
	hasUI = true,
	interact?: (panel: AuthDashboard) => Promise<void> | void,
) {
	let panels = 0;
	const rendered: string[][] = [];
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
			custom: async (
				factory: (
					host: PanelHost,
					theme: PanelTheme,
					keys: KeybindingsManager,
					done: (result: DashboardResult) => void,
				) => AuthDashboard,
			) => {
				panels++;
				const component = await factory(
					{ terminal: { rows: 40 }, requestRender: () => {} },
					{
						fg: (_color: string, text: string) => text,
						bg: (_color: string, text: string) => text,
						bold: (text: string) => text,
					},
					new KeybindingsManager(TUI_KEYBINDINGS),
					() => {},
				);
				await interact?.(component);
				rendered.push(component.render(140));
				component.dispose?.();
				return results.shift();
			},
		},
	} as unknown as ExtensionCommandContext;
	const run = (name: string, args = "") => {
		const handler = commands.get(name)?.handler;
		if (!handler) throw new Error(`/${name} is not registered`);
		return handler(args, ctx);
	};
	return {
		run,
		ctx,
		notes,
		notices,
		commands,
		rendered,
		names: [...commands.keys()],
		panels: () => panels,
	};
}

describe("ui/commands", () => {
	test("tokens opens its dashboard tab, aliases share handlers, and headless counts are text", async () => {
		const tui = rig("tui");
		await tui.run("tokens");
		expect(tui.rendered[0]?.join("\n")).toContain("▸Tokens");
		expect(tui.commands.get("token")).toBe(tui.commands.get("tokens"));
		expect(tui.commands.get("tokens")?.getArgumentCompletions?.("")).toBeNull();
		const rpc = rig("rpc");
		await rpc.run("tokens");
		expect(rpc.notices[0]?.[0]).toBe("Auth › Tokens\n  Token tracker unavailable in this session.");
		await rpc.run("tokens", "unexpected");
		expect(rpc.notices.at(-1)).toEqual(["Usage: /tokens (or /auth tokens).", "error"]);
		const print = rig("rpc", {}, [], false);
		await print.run("tokens");
		expect(print.notes[0]).toStartWith("Auth › Tokens");
	});
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
			signal: () => controller.signal,
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
		expect(events.at(-1)).toBe("refresh codex true");
		expect(events).toHaveLength(6);
		expect(f.notices).toHaveLength(noticesBeforeAbort);
	});

	test("Codex login belongs to the session that started it", async () => {
		const registry = new Registry([
			{ id: "openai", label: "OpenAI", providers: [{ id: "codex", label: "Codex", aliases: [] }] },
		]);
		let controller = new AbortController();
		let captures = 0;
		const login = Promise.withResolvers<{
			type: "oauth";
			access: string;
			refresh: string;
			expires: number;
		}>();
		let status: ((message: string) => void) | undefined;
		let received: AbortSignal | undefined;
		let refreshes = 0;
		let refreshStarted: (() => void) | undefined;
		let refreshWait: Promise<void> | undefined;
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
			refresh: async () => {
				refreshes++;
				refreshStarted?.();
				await refreshWait;
			},
			onChange: () => () => {},
			lineConfig: () => ({ percentDisplay: "used", creditHealthyUsd: 50, creditCriticalUsd: 5 }),
			linePlacement: () => "off",
			setLinePlacement: async () => {},
			now: () => 0,
			text: () => "",
		};
		const f = rig("rpc", {
			registry,
			quotas: () => quotas,
			signal: () => {
				captures++;
				return controller.signal;
			},
			loginCodex: async (options) => {
				received = options.signal;
				status = options.onStatus;
				return login.promise;
			},
		});
		const previous = controller.signal;
		const running = f.run("quota", "codex login");
		controller.abort();
		controller = new AbortController();
		status?.("late status");
		login.resolve({ type: "oauth", access: "test-access", refresh: "test-refresh", expires: 0 });
		await running;
		expect(previous.aborted).toBe(true);
		expect(refreshes).toBe(0);
		expect(f.notices).toEqual([]);
		expect(received).toBe(previous);
		expect(captures).toBe(1);

		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		refreshStarted = started.resolve;
		refreshWait = release.promise;
		const refreshing = f.run("quota", "codex login");
		await started.promise;
		controller.abort();
		controller = new AbortController();
		release.resolve();
		await refreshing;
		expect(refreshes).toBe(1);
		expect(captures).toBe(2);
		expect(f.notices).toEqual([]);

		const failed = Promise.withResolvers<void>();
		const startedAgain = Promise.withResolvers<void>();
		refreshStarted = startedAgain.resolve;
		refreshWait = failed.promise;
		const failing = f.run("quota", "codex login");
		await startedAgain.promise;
		controller.abort();
		controller = new AbortController();
		failed.reject(new Error("late refresh failure"));
		await failing;
		expect(refreshes).toBe(2);
		expect(captures).toBe(3);
		expect(f.notices).toEqual([]);
	});

	test("aborted sessions refuse every command before any work", async () => {
		const controller = new AbortController();
		controller.abort();
		let captures = 0;
		let work = 0;
		const f = rig("tui", {
			signal: () => {
				captures++;
				return controller.signal;
			},
			status: () => {
				work++;
				return { state: "missing" };
			},
			quotas: () => {
				work++;
				return "unavailable";
			},
		});
		for (const [name, args] of [
			["auth", "bad"],
			["auth", "settings"],
			["quota", "reset claude"],
			["quotas", "codex login"],
			["tokens", "bad"],
			["token", ""],
		] as const)
			await f.run(name, args);
		expect(captures).toBe(6);
		expect(work).toBe(0);
		expect(f.panels()).toBe(0);
		expect(f.notices).toEqual([]);
		expect(f.notes).toEqual([]);
	});

	test("replaced sessions cannot continue dashboard, JSON editor or scope dialogs", async () => {
		for (const boundary of ["dashboard", "editor", "editor-invalid", "scope", "none"] as const) {
			let controller = new AbortController();
			let captures = 0;
			const entered = Promise.withResolvers<void>();
			const dialog = Promise.withResolvers<string | undefined>();
			const store = new SettingsStore(SETTINGS, { user: "unused" });
			const saved: string[] = [];
			let editors = 0;
			let scopes = 0;
			let dashboards = 0;
			const f = rig("tui", {
				signal: () => {
					captures++;
					return controller.signal;
				},
				settings: { store: () => store, onSaved: (keys) => saved.push(...keys) },
			});
			Object.assign(f.ctx.ui, {
				custom: async () => {
					dashboards++;
					if (dashboards > 1) return undefined;
					if (boundary === "dashboard") {
						entered.resolve();
						await dialog.promise;
					}
					return { editSetting: "models.rules" };
				},
				editor: async () => {
					editors++;
					if (boundary === "editor" || boundary === "editor-invalid") {
						entered.resolve();
						return dialog.promise;
					}
					return '["vendor/*"]';
				},
				select: async () => {
					scopes++;
					if (boundary === "scope") {
						entered.resolve();
						return dialog.promise;
					}
					return "This session only";
				},
			});
			const running = f.run("auth", "settings");
			if (boundary !== "none") {
				await entered.promise;
				controller.abort();
				controller = new AbortController();
				dialog.resolve(
					boundary === "scope"
						? "This session only"
						: boundary === "editor-invalid"
							? "{"
							: '["vendor/*"]',
				);
			}
			await running;
			expect(editors).toBe(boundary === "dashboard" ? 0 : 1);
			expect(scopes).toBe(boundary === "scope" || boundary === "none" ? 1 : 0);
			expect(dashboards).toBe(boundary === "none" ? 2 : 1);
			expect(store.get("models.rules")).toEqual(boundary === "none" ? ["vendor/*"] : []);
			expect(saved).toEqual(boundary === "none" ? ["models.rules"] : []);
			expect(f.notices).toEqual([]);
			expect(captures).toBe(1);
		}
	});

	test("a save completing after replacement does not trigger effects or reopen the dashboard", async () => {
		let controller = new AbortController();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const store = new SettingsStore(SETTINGS, { user: "unused" });
		const save = store.save.bind(store);
		store.save = async (...args) => {
			await save(...args);
			started.resolve();
			await release.promise;
		};
		const saved: string[] = [];
		let panels = 0;
		const f = rig("tui", {
			signal: () => controller.signal,
			settings: { store: () => store, onSaved: (keys) => saved.push(...keys) },
		});
		Object.assign(f.ctx.ui, {
			custom: async () => {
				panels++;
				return { editSetting: "models.rules" };
			},
			editor: async () => '["vendor/*"]',
			select: async () => "This session only",
		});
		const running = f.run("auth", "settings");
		await started.promise;
		controller.abort();
		controller = new AbortController();
		release.resolve();
		await running;
		expect(store.get("models.rules")).toEqual(["vendor/*"]);
		expect(saved).toEqual([]);
		expect(panels).toBe(1);
		expect(f.notices).toEqual([]);
	});

	test("replacement while listing or confirming resets never spends a credit", async () => {
		for (const [requester, boundary] of [
			["command", "list"],
			["command", "confirm"],
			["command", "none"],
			["panel", "confirm"],
			["panel", "none"],
		] as const) {
			let controller = new AbortController();
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			let selected = 0;
			let consumed = 0;
			const quotas: ReturnType<NonNullable<AuthCommandDeps["quotas"]>> = {
				report: () => ({ v: 1, generatedAt: 0, providers: [] }),
				resetSupport: () => true,
				listResets: async (id) => {
					if (boundary === "list") {
						entered.resolve();
						await release.promise;
					}
					return {
						provider: id,
						fetchedAt: 0,
						available: 1,
						credits: [{ id: "credit", type: "reset", status: "available" }],
					};
				},
				consumeReset: async (id, creditId) => {
					consumed++;
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
			const f = rig(
				"tui",
				{ quotas: () => quotas, signal: () => controller.signal },
				requester === "panel" ? [{ reset: "claude" }, undefined] : [],
			);
			Object.assign(f.ctx.ui, {
				select: async () => {
					selected++;
					if (boundary === "confirm") {
						entered.resolve();
						await release.promise;
					}
					return "Spend 1 credit now (cannot be undone)";
				},
			});
			const running =
				requester === "panel" ? f.run("auth", "quotas") : f.run("quota", "reset claude");
			if (boundary !== "none") {
				await entered.promise;
				controller.abort();
				controller = new AbortController();
				release.resolve();
			}
			await running;
			expect(selected).toBe(boundary === "list" ? 0 : 1);
			expect(consumed).toBe(boundary === "none" ? 1 : 0);
			if (requester === "panel") expect(f.panels()).toBe(boundary === "none" ? 2 : 1);
			if (boundary !== "none") expect(f.notices).toEqual([]);
		}
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
			"Usage: /auth [providers|quotas|tokens|models|groups|settings]",
		);
		expect(parseAuthArgs("models")).toEqual({ tab: "models" });
		expect(parseAuthArgs("model")).toEqual({ tab: "models" });
		expect(authCompletions("mo")?.map((item) => item.value)).toEqual(["models"]);
		expect(authCompletions("u")?.map((item) => item.value)).toEqual(["quotas"]);
		expect(authCompletions("zz")).toBeNull();
	});

	test("models uses the live view and scoped save when available, with safe headless summaries", async () => {
		const saved: string[] = [];
		let currentRules = ["!vendor/private-model-one"];
		const models: NonNullable<AuthCommandDeps["models"]> = {
			rules: () => currentRules,
			catalog: () => [
				{
					provider: "vendor",
					id: "private-model-one",
					name: "First catalog model",
					contextWindow: 1000,
				},
				{
					provider: "vendor",
					id: "private-model-two",
					name: "Second catalog model",
					contextWindow: 2000,
				},
			],
			evaluate: (rules, _provider, id) => ({
				visible: id === "private-model-one" && !rules.includes("vendor/private-model-one"),
			}),
			save: async (rules, scope) => {
				currentRules = [...rules];
				saved.push(`${scope}:${rules.join("|")}`);
			},
		};
		const tui = rig("tui", { models }, [], true, async (panel) => {
			panel.handleInput("v");
			panel.handleInput("h");
			panel.handleInput("\x13");
			panel.handleInput("p");
			await Promise.resolve();
		});
		await tui.run("auth", "models");
		const live = tui.rendered[0]?.join("\n") ?? "";
		expect(live).toContain("Catalog");
		expect(live).toContain("2 hidden");
		expect(live).toContain("private-model-one");
		expect(saved).toEqual(["project:!vendor/private-model-one|vendor/private-model-one"]);
		expect(tui.commands.get("auth")?.description).toContain("models");

		const rpc = rig("rpc", {
			models: {
				...models,
				rules: () => ["vendor/*"],
				evaluate: (_rules, _provider, id) => ({ visible: id === "private-model-one" }),
			},
		});
		await rpc.run("auth", "models");
		const summary = rpc.notices[0]?.[0] ?? "";
		expect(summary).toContain("vendor/*");
		expect(summary).toContain("1 hidden / 2 total");
		expect(summary).not.toContain("private-model-one");
		expect(summary).not.toContain("First catalog model");

		const unavailable = rig("rpc");
		await unavailable.run("auth", "models");
		expect(unavailable.notices[0]?.[0]).toBe(
			"Auth › Models\n  Model visibility rules are unavailable in this session.",
		);
	});

	test("without a TUI the dashboard renders as text and opens the named section", async () => {
		const rpc = rig("rpc");
		expect(rpc.names).toEqual(["auth", "quotas", "quota", "tokens", "token"]);
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
