/** The `/auth` command family: one router, standalone entry points, headless text fallback. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Text } from "@earendil-works/pi-tui";
import type { CredentialStatus } from "../../core/auth/index.ts";
import { type AppSettings, SETTINGS } from "../../core/config/catalog.ts";
import { type SaveScope, SettingsError } from "../../core/config/index.ts";
import type { Registry } from "../../core/registry/index.ts";
import { loginCodex } from "../../families/openai/codex-auth/index.ts";
import type { LineTheme } from "../../quotas/line/format.ts";
import type { TokenTracker } from "../../tokens/tracker/types.ts";
import { type GroupsTabDeps, GroupsView } from "../dashboard/groups.ts";
import {
	AuthDashboard,
	type DashboardModel,
	type DashboardResult,
	dashboardText,
	RowsView,
	resolveTab,
	staticViews,
	TABS,
	type TabId,
} from "../dashboard/index.ts";
import { type ModelsTabDeps, ModelsView } from "../dashboard/models.ts";
import { type QuotasTabDeps, QuotasView } from "../dashboard/quotas.ts";
import { SettingsView } from "../dashboard/settings.ts";
import { TokensView, tokensText } from "../dashboard/tokens.ts";
import { sanitize } from "../frame/index.ts";
import { type ResetFlowDeps, runResetFlow } from "./resets.ts";

export const NOTE_TYPE = "auth-plus-note";
export const AUTH_USAGE = `Usage: /auth [${TABS.map((tab) => tab.id).join("|")}]`;

/** The live Quotas tab plus its plain-text form for print and RPC modes. */
export interface QuotaPanelDeps extends QuotasTabDeps, ResetFlowDeps {
	text(provider?: string): string;
}

export interface SettingsPanelDeps {
	store(): AppSettings;
	onSaved(keys: readonly string[], scope: SaveScope): void;
	preview?(
		source: string,
		width: number,
		theme: LineTheme,
	): { rows: readonly string[]; unknown: readonly string[] };
}

export interface AuthCommandDeps {
	readonly registry: Registry;
	readonly status: (providerId: string) => CredentialStatus;
	readonly now: () => number;
	/** Live quotas, or why they are unavailable in this session. */
	readonly quotas?: () => QuotaPanelDeps | string;
	/** Live session token counts, when a tracker is available. */
	readonly tokens?: () => TokenTracker | undefined;
	readonly models?: ModelsTabDeps;
	readonly groups?: GroupsTabDeps;
	readonly settings?: SettingsPanelDeps;
	readonly loginCodex?: typeof loginCodex;
	readonly signal?: AbortSignal;
}

type SettingKey = keyof typeof SETTINGS;

const SCOPES: readonly { readonly label: string; readonly scope: SaveScope }[] = [
	{ label: "User (all projects)", scope: "user" },
	{ label: "Project", scope: "project" },
	{ label: "This session only", scope: "runtime" },
];

function settingsText(store: AppSettings): string {
	const lines = (Object.keys(SETTINGS) as SettingKey[]).map(
		(key) => `  ${key} = ${sanitize(JSON.stringify(store.get(key)))} (${store.sourceOf(key)})`,
	);
	return ["Auth › Settings", ...lines].join("\n");
}

function modelsText(models: ModelsTabDeps | undefined): string {
	if (!models) return "Auth › Models\n  Model visibility rules are unavailable in this session.";
	const rules = models.rules();
	const catalog = models.catalog();
	const hidden = catalog.filter(
		(item) => !models.evaluate(rules, item.provider, item.id).visible,
	).length;
	const ruleLines = rules.length
		? ["  Rules:", ...rules.map((rule) => `    ${sanitize(rule).replace(/\n/g, " ")}`)]
		: ["  No visibility rules."];
	return [
		"Auth › Models",
		...ruleLines,
		`  Models: ${hidden} hidden / ${catalog.length} total`,
	].join("\n");
}

function groupsText(groups: GroupsTabDeps | undefined): string {
	if (!groups) return "Auth › Groups\n  Model groups are unavailable in this session.";
	const list = groups.groups();
	if (list.length === 0) return "Auth › Groups\n  No groups configured. Add one in /auth groups.";
	const lines = list.map(
		(group) =>
			`  ${sanitize(group.id)} · ${group.strategy} · ${group.members.map((member) => `${sanitize(member.provider)}/${sanitize(member.id)}`).join(" → ")}`,
	);
	return ["Auth › Groups", ...lines].join("\n");
}

function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current.push(
				Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost),
			);
		}
		previous = current;
	}
	return previous[b.length] ?? 0;
}

/** Valid names close to `input`: shared prefix or at most two edits away. */
export function closestNames(input: string, names: readonly string[]): string[] {
	const needle = input.trim().toLowerCase();
	return names.filter(
		(name) =>
			(needle.length > 0 && (name.startsWith(needle) || needle.startsWith(name))) ||
			editDistance(needle, name) <= 2,
	);
}

/** `target` is the word after the section, e.g. the provider in `/auth quotas cc`. */
export type AuthArgs =
	| { readonly tab: TabId; readonly target?: string }
	| { readonly error: string };

export function parseAuthArgs(args: string): AuthArgs {
	const [word = "", target] = args.trim().split(/\s+/);
	if (word === "") return { tab: "providers" };
	const tab = resolveTab(word);
	if (tab) return target ? { tab, target } : { tab };
	const near = TABS.filter((spec) => closestNames(word, [spec.id, ...spec.aliases]).length > 0).map(
		(spec) => spec.id,
	);
	const hint = near.length > 0 ? ` Did you mean: ${near.join(", ")}?` : "";
	return { error: `Unknown section "${sanitize(word)}".${hint} ${AUTH_USAGE}` };
}

export function authCompletions(prefix: string): AutocompleteItem[] | null {
	const needle = prefix.trim().toLowerCase();
	const items = TABS.filter(
		(tab) => tab.id.startsWith(needle) || tab.aliases.some((alias) => alias.startsWith(needle)),
	).map((tab) => ({ value: tab.id, label: tab.id, description: tab.description }));
	return items.length > 0 ? items : null;
}

function dashboardModel(deps: AuthCommandDeps): DashboardModel {
	return {
		nowMs: deps.now(),
		providers: deps.registry.providers().map(({ provider }) => ({
			id: provider.id,
			label: provider.label,
			status: deps.status(provider.id),
			loginHint: provider.login?.hint,
		})),
	};
}

export function registerAuthCommands(pi: ExtensionAPI, deps: AuthCommandDeps): void {
	pi.registerEntryRenderer<{ text?: unknown }>(
		NOTE_TYPE,
		(entry, _options, theme) =>
			new Text(theme.fg("toolOutput", sanitize(String(entry.data?.text ?? ""))), 0, 0),
	);

	const report = (
		ctx: ExtensionCommandContext,
		text: string,
		tone: "info" | "warning" | "error",
	) => {
		if (ctx.hasUI && (ctx.mode !== "tui" || tone === "error" || !text.includes("\n"))) {
			ctx.ui.notify(text, tone);
		} else pi.appendEntry(NOTE_TYPE, { text });
	};

	const quotaTarget = (target: string | undefined): string | undefined =>
		target === undefined ? undefined : deps.registry.resolve(target)?.provider.id;

	const headless = (tab: TabId, model: DashboardModel, target?: string): string => {
		if (tab === "tokens") return tokensText(deps.tokens?.());
		if (tab === "models") return modelsText(deps.models);
		if (tab === "groups") return groupsText(deps.groups);
		const quotas = deps.quotas?.();
		if (tab === "quotas" && quotas !== undefined)
			return typeof quotas === "string"
				? `Auth › Quotas\n  ${quotas}`
				: `Auth › Quotas\n${quotas.text(quotaTarget(target))}`;
		if (tab === "settings" && deps.settings) return settingsText(deps.settings.store());
		return dashboardText(tab, model);
	};

	const editSetting = async (ctx: ExtensionCommandContext, key: string): Promise<void> => {
		const settings = deps.settings;
		if (!settings || !(key in SETTINGS)) return;
		const name = key as SettingKey;
		const field = SETTINGS[name];
		const store = settings.store();
		const edited = await ctx.ui.editor(
			`${field.label} (JSON)`,
			JSON.stringify(store.get(name), null, 2),
		);
		if (edited === undefined) return;
		let raw: unknown;
		try {
			raw = JSON.parse(edited);
		} catch (error) {
			return report(
				ctx,
				`${field.label}: not valid JSON (${String(error)}); nothing saved.`,
				"error",
			);
		}
		const value = field.parse(raw);
		if (value === undefined)
			return report(ctx, `${field.label}: value has the wrong shape; nothing saved.`, "error");
		const choice = await ctx.ui.select(
			`Save ${field.label} to`,
			SCOPES.map((entry) => entry.label),
		);
		const scope = SCOPES.find((entry) => entry.label === choice)?.scope;
		if (!scope) return;
		try {
			await store.save(scope, { [name]: value });
		} catch (error) {
			if (error instanceof SettingsError) return report(ctx, error.message, "error");
			throw error;
		}
		settings.onSaved([name], scope);
	};

	const open = async (ctx: ExtensionCommandContext, tab: TabId, target?: string) => {
		const model = dashboardModel(deps);
		if (ctx.mode !== "tui" || !ctx.hasUI) return report(ctx, headless(tab, model, target), "info");
		let current: { tab: TabId; select?: string } = { tab, ...(target ? { select: target } : {}) };
		for (;;) {
			const opened = current;
			const result = await ctx.ui.custom<DashboardResult>((tui, theme, keys, done) => {
				const views = staticViews(dashboardModel(deps));
				views.tokens = (host) => new TokensView(host, deps.tokens?.());
				const models = deps.models;
				if (models) views.models = (host) => new ModelsView(host, models);
				const quotas = deps.quotas?.();
				if (typeof quotas === "string")
					views.quotas = (host) => new RowsView(host, { rows: [], empty: quotas });
				else if (quotas)
					views.quotas = (host) =>
						new QuotasView(
							host,
							theme,
							quotas,
							opened.tab === "quotas" ? quotaTarget(opened.select) : undefined,
						);
				const groups = deps.groups;
				if (groups) views.groups = (host) => new GroupsView(host, groups);
				const settings = deps.settings;
				if (settings)
					views.settings = (host) =>
						new SettingsView(
							host,
							{
								store: settings.store,
								onSaved: settings.onSaved,
								...(settings.preview
									? {
											previewTemplate: (source: string, width: number) =>
												settings.preview?.(source, width, theme) ?? { rows: [], unknown: [] },
										}
									: {}),
							},
							opened.tab === "settings" ? opened.select : undefined,
						);
				return new AuthDashboard(tui, theme, keys, done, views, opened.tab, model.providers.length);
			});
			if (!result) return;
			if ("reset" in result) {
				const quotas = deps.quotas?.();
				if (quotas && typeof quotas !== "string")
					await runResetFlow(ctx, result.reset, "panel", quotas, deps.registry, (text, tone) =>
						report(ctx, text, tone),
					);
				current = { tab: "quotas", select: result.reset };
			} else {
				await editSetting(ctx, result.editSetting);
				current = { tab: "settings", select: result.editSetting };
			}
		}
	};

	pi.registerCommand("auth", {
		description: "Provider status, quotas, token counts, models and settings",
		getArgumentCompletions: authCompletions,
		handler: async (args, ctx) => {
			const parsed = parseAuthArgs(args);
			if ("error" in parsed) return report(ctx, parsed.error, "error");
			await open(ctx, parsed.tab, parsed.target);
		},
	});

	const runCodexLogin = async (
		ctx: ExtensionCommandContext,
		mode: "auto" | "device" | "browser",
	): Promise<void> => {
		if (!ctx.hasUI) return report(ctx, "Codex login needs an interactive session", "error");
		try {
			const credential = await (deps.loginCodex ?? loginCodex)({
				mode,
				onStatus: (message) => {
					if (!deps.signal?.aborted) ctx.ui.notify(sanitize(message), "info");
				},
				...(deps.signal ? { signal: deps.signal } : {}),
			});
			if (deps.signal?.aborted) return;
			const quotas = deps.quotas?.();
			if (quotas && typeof quotas !== "string") await quotas.refresh("codex", true);
			if (deps.signal?.aborted) return;
			report(
				ctx,
				`Codex quota authenticated${credential.email ? ` (${sanitize(credential.email)})` : ""}${credential.planType ? ` [${sanitize(credential.planType)}]` : ""}`,
				"info",
			);
		} catch (error) {
			if (deps.signal?.aborted) return;
			report(
				ctx,
				`Codex login failed: ${sanitize(error instanceof Error ? error.message : String(error))}`,
				"error",
			);
		}
	};

	const quotaCommand: Parameters<ExtensionAPI["registerCommand"]>[1] = {
		description:
			"Quota windows and credits; <provider> focuses one; codex login [--device|--browser]",
		getArgumentCompletions: (prefix) => {
			const items = [
				"reset",
				...deps.registry.providers().map(({ provider }) => provider.id),
				"codex login",
				"codex login --device",
				"codex login --browser",
			]
				.filter((name) => name.startsWith(prefix.trim().toLowerCase()))
				.map((name) => ({ value: name, label: name }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/);
			const [word, target, extra] = tokens;
			if (word?.toLowerCase() === "login" || target?.toLowerCase() === "login") {
				const provider = word?.toLowerCase() === "login" ? target : word;
				if (
					!provider ||
					quotaTarget(provider) !== "codex" ||
					tokens.length > 3 ||
					(extra !== undefined && extra !== "--device" && extra !== "--browser")
				)
					return report(
						ctx,
						"Usage: /quota codex login [--device|--browser] (or /quota login codex).",
						"error",
					);
				return runCodexLogin(
					ctx,
					extra === "--device" ? "device" : extra === "--browser" ? "browser" : "auto",
				);
			}
			if (word?.toLowerCase() !== "reset" && word?.toLowerCase() !== "resets")
				return open(ctx, "quotas", word || undefined);
			const quotas = deps.quotas?.();
			if (!quotas || typeof quotas === "string")
				return report(
					ctx,
					typeof quotas === "string" ? quotas : "Quotas are unavailable in this session.",
					"warning",
				);
			const supported = deps.registry
				.providers()
				.map(({ provider }) => provider.id)
				.filter((id) => quotas.resetSupport(id));
			const id = target ? quotaTarget(target) : supported[0];
			if (!id || !supported.includes(id) || extra)
				return report(
					ctx,
					`Usage: /quotas reset [provider]. Supported: ${supported.join(", ") || "none"}.`,
					"error",
				);
			await runResetFlow(ctx, id, "command", quotas, deps.registry, (text, tone) =>
				report(ctx, text, tone),
			);
		},
	};
	pi.registerCommand("quotas", quotaCommand);
	pi.registerCommand("quota", quotaCommand);
	const tokenCommand: Parameters<ExtensionAPI["registerCommand"]>[1] = {
		description: "Live session context token counts; opens Auth › Tokens",
		getArgumentCompletions: () => null,
		handler: async (args, ctx) => {
			if (args.trim()) return report(ctx, "Usage: /tokens (or /auth tokens).", "error");
			await open(ctx, "tokens");
		},
	};
	pi.registerCommand("tokens", tokenCommand);
	pi.registerCommand("token", tokenCommand);
}
