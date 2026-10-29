/** The `/auth` command family: one router, standalone entry points, headless text fallback. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Text } from "@earendil-works/pi-tui";
import type { CredentialStatus } from "../../core/auth/index.ts";
import { type AppSettings, SETTINGS } from "../../core/config/catalog.ts";
import type { Field, FieldValue, SaveScope } from "../../core/config/index.ts";
import { formatSaveOutcome, type SaveOutcome, type SettingsSaver } from "../../core/config/save.ts";
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
import { type SettingsTabDeps, SettingsView } from "../dashboard/settings.ts";
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
	readonly save: SettingsSaver;
	providerOptions?: SettingsTabDeps["providerOptions"];
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
	readonly saveSettings?: SettingsSaver;
	readonly loginCodex?: typeof loginCodex;
	readonly signal?: () => AbortSignal | undefined;
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
	return names.filter((name) => {
		const candidate = name.toLowerCase();
		return (
			(needle.length > 0 && (candidate.startsWith(needle) || needle.startsWith(candidate))) ||
			editDistance(needle, candidate) <= 2
		);
	});
}

/** `target` is the text after the section, e.g. the provider in `/auth quotas cc`. */
export type AuthArgs =
	| { readonly tab: TabId; readonly target?: string }
	| { readonly error: string };

export function parseAuthArgs(args: string): AuthArgs {
	const [word = "", ...rest] = args.trim().split(/\s+/);
	if (word === "") return { tab: "providers" };
	const tab = resolveTab(word);
	const target = rest.join(" ");
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

interface TargetOption {
	readonly value: string;
	readonly label: string;
	readonly aliases: readonly string[];
}

function normalizeTarget(input: string): string {
	return input.trim().replace(/\s+/g, " ").toLowerCase();
}

function resolveTarget(input: string, options: readonly TargetOption[]): string | undefined {
	const needle = normalizeTarget(input);
	const named = options.find((option) =>
		[option.value, ...option.aliases].some((name) => normalizeTarget(name) === needle),
	);
	if (named) return named.value;
	const labels = options.filter((option) => normalizeTarget(option.label) === needle);
	return labels.length === 1 ? labels[0]?.value : undefined;
}

function targetCompletions(prefix: string, options: readonly TargetOption[]): AutocompleteItem[] {
	const needle = normalizeTarget(prefix);
	const names = [
		...options.map((option) => ({ name: option.value, option })),
		...options.flatMap((option) => option.aliases.map((name) => ({ name, option }))),
	];
	return names
		.filter(
			({ name, option }) =>
				normalizeTarget(name).startsWith(needle) ||
				(name === option.value && normalizeTarget(option.label).startsWith(needle)),
		)
		.map(({ name, option }) => ({ value: name, label: name, description: option.label }));
}

function targetError(
	kind: string,
	target: string,
	options: readonly TargetOption[],
	usage: string,
): string {
	const names = options.flatMap((option) => [option.value, ...option.aliases, option.label]);
	const near = closestNames(target, names).filter(
		(name, index, matches) =>
			matches.findIndex((match) => normalizeTarget(match) === normalizeTarget(name)) === index,
	);
	const hint = near.length ? ` Did you mean: ${near.map(sanitize).join(", ")}?` : "";
	return `Unknown ${kind} "${sanitize(target)}".${hint} ${usage}`;
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

function cancelledSave(): SaveOutcome {
	return { committed: false, error: "Settings save cancelled because the session ended" };
}

async function sessionCall<T>(signal: AbortSignal | undefined, call: () => Promise<T>): Promise<T> {
	signal?.throwIfAborted();
	const result = await call();
	signal?.throwIfAborted();
	return result;
}

function sessionModels(source: ModelsTabDeps, signal: AbortSignal | undefined): ModelsTabDeps {
	const details = source.details;
	const aliases = details?.aliases;
	return {
		rules: () => (signal?.aborted ? [] : source.rules()),
		catalog: () => (signal?.aborted ? [] : source.catalog()),
		evaluate: (rules, provider, id) =>
			signal?.aborted ? { visible: false } : source.evaluate(rules, provider, id),
		save: (rules, scope) =>
			signal?.aborted ? Promise.resolve(cancelledSave()) : source.save(rules, scope),
		...(details
			? {
					details: {
						...(aliases
							? {
									aliases: {
										list: () => (signal?.aborted ? [] : aliases.list()),
										supported: (provider: string) =>
											!signal?.aborted && aliases.supported(provider),
										save: (next, scope) =>
											signal?.aborted
												? Promise.resolve(cancelledSave())
												: aliases.save(next, scope),
									},
								}
							: {}),
						read: (provider, id) => sessionCall(signal, () => details.read(provider, id)),
						...(details.current
							? {
									current: (provider: string, id: string) =>
										signal?.aborted ? undefined : details.current?.(provider, id),
								}
							: {}),
						save: (provider, id, changes) =>
							sessionCall(signal, () => details.save(provider, id, changes)),
					},
				}
			: {}),
	};
}

function sessionGroups(source: GroupsTabDeps, signal: AbortSignal | undefined): GroupsTabDeps {
	return {
		groups: () => (signal?.aborted ? [] : source.groups()),
		catalog: () => (signal?.aborted ? [] : source.catalog()),
		...(source.health
			? {
					health: (member) =>
						signal?.aborted
							? { state: "unknown", routable: false }
							: (source.health?.(member) ?? { state: "unknown", routable: false }),
				}
			: {}),
		save: (groups, scope) =>
			signal?.aborted ? Promise.resolve(cancelledSave()) : source.save(groups, scope),
	};
}

function sessionQuotas(source: QuotaPanelDeps, signal: AbortSignal | undefined): QuotaPanelDeps {
	return {
		report: () => (signal?.aborted ? { v: 1, generatedAt: 0, providers: [] } : source.report()),
		resetSupport: (id) => !signal?.aborted && source.resetSupport(id),
		refreshing: (id) => !signal?.aborted && source.refreshing(id),
		refresh: (id, force) => sessionCall(signal, () => source.refresh(id, force)),
		onChange: (listener) =>
			signal?.aborted
				? () => {}
				: source.onChange(() => {
						if (!signal?.aborted) listener();
					}),
		lineConfig: () =>
			signal?.aborted
				? {
						percentDisplay: SETTINGS["quotas.percentDisplay"].default,
						creditHealthyUsd: SETTINGS["quotas.creditHealthyUsd"].default,
						creditCriticalUsd: SETTINGS["quotas.creditCriticalUsd"].default,
					}
				: source.lineConfig(),
		linePlacement: () =>
			signal?.aborted ? SETTINGS["quotas.linePlacement"].default : source.linePlacement(),
		setLinePlacement: (next, scope) =>
			signal?.aborted ? Promise.resolve(cancelledSave()) : source.setLinePlacement(next, scope),
		now: () => (signal?.aborted ? 0 : source.now()),
		text: (provider) => (signal?.aborted ? "" : source.text(provider)),
		listResets: (provider) => sessionCall(signal, () => source.listResets(provider)),
		consumeReset: (provider, credit, requester) =>
			sessionCall(signal, () => source.consumeReset(provider, credit, requester)),
	};
}

function sessionTokens(source: TokenTracker, signal: AbortSignal | undefined): TokenTracker {
	return {
		latest: () => (signal?.aborted ? undefined : source.latest()),
		refresh: (reason) => sessionCall(signal, () => source.refresh(reason)),
		breakdown: (countSignal) => sessionCall(signal, () => source.breakdown(countSignal)),
		onChange: (listener) =>
			signal?.aborted
				? () => {}
				: source.onChange((report, reason) => {
						if (!signal?.aborted) listener(report, reason);
					}),
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

	const providerTargets: TargetOption[] = deps.registry.providers().map(({ provider }) => ({
		value: provider.id,
		label: provider.label,
		aliases: provider.aliases,
	}));
	const settingTargets: TargetOption[] = (Object.keys(SETTINGS) as SettingKey[]).map((key) => ({
		value: key,
		label: SETTINGS[key].label,
		aliases: [],
	}));
	const quotaTarget = (target: string | undefined): string | undefined =>
		target === undefined ? undefined : resolveTarget(target, providerTargets);

	const headless = (
		tab: TabId,
		model: DashboardModel,
		store: AppSettings | undefined,
		target?: string,
	): string => {
		if (tab === "tokens") return tokensText(deps.tokens?.());
		if (tab === "models") return modelsText(deps.models);
		if (tab === "groups") return groupsText(deps.groups);
		const quotas = deps.quotas?.();
		if (tab === "quotas" && quotas !== undefined)
			return typeof quotas === "string"
				? `Auth › Quotas\n  ${quotas}`
				: `Auth › Quotas\n${quotas.text(target)}`;
		if (tab === "settings" && store) return settingsText(store);
		return dashboardText(tab, model);
	};

	const editSetting = async (
		ctx: ExtensionCommandContext,
		key: string,
		signal: AbortSignal | undefined,
		settings: SettingsPanelDeps | undefined,
	): Promise<void> => {
		if (signal?.aborted) return;
		if (!settings || !(key in SETTINGS)) return;
		const name = key as SettingKey;
		const field: Field<FieldValue> = SETTINGS[name];
		const store = settings.store();
		const edited = await ctx.ui.editor(
			`${field.label} (JSON)`,
			JSON.stringify(store.get(name), null, 2),
		);
		if (signal?.aborted || edited === undefined) return;
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
		const scopes = SCOPES.filter((entry) => field.allowedScopes?.includes(entry.scope) ?? true);
		const choice = await ctx.ui.select(
			`Save ${field.label} to`,
			scopes.map((entry) => entry.label),
		);
		if (signal?.aborted) return;
		const scope = scopes.find((entry) => entry.label === choice)?.scope;
		if (!scope) return;
		const outcome = await settings.save(scope, { [name]: value });
		if (!signal?.aborted)
			report(
				ctx,
				formatSaveOutcome(outcome),
				!outcome.committed
					? "error"
					: outcome.shadowed.length || outcome.warnings.length
						? "warning"
						: "info",
			);
	};

	const reset = async (
		ctx: ExtensionCommandContext,
		id: string,
		requester: "panel" | "command",
		quotas: QuotaPanelDeps,
		signal: AbortSignal | undefined,
	): Promise<void> => {
		if (signal?.aborted) return;
		await runResetFlow(
			{
				hasUI: ctx.hasUI,
				ui: {
					select: async (...args) => {
						signal?.throwIfAborted();
						const result = await ctx.ui.select(...args);
						signal?.throwIfAborted();
						return result;
					},
				},
			},
			id,
			requester,
			{
				resetSupport: (provider) => quotas.resetSupport(provider),
				report: () => quotas.report(),
				listResets: async (provider) => {
					signal?.throwIfAborted();
					const list = await quotas.listResets(provider);
					signal?.throwIfAborted();
					return list;
				},
				consumeReset: async (provider, credit, origin) => {
					signal?.throwIfAborted();
					const outcome = await quotas.consumeReset(provider, credit, origin);
					signal?.throwIfAborted();
					return outcome;
				},
			},
			deps.registry,
			(text, tone) => {
				if (!signal?.aborted) report(ctx, text, tone);
			},
		);
	};

	const open = async (
		ctx: ExtensionCommandContext,
		tab: TabId,
		target: string | undefined,
		signal: AbortSignal | undefined,
	) => {
		if (signal?.aborted) return;
		let select = target;
		if (target !== undefined) {
			if (tab === "quotas" || tab === "settings") {
				const options = tab === "quotas" ? providerTargets : settingTargets;
				select = resolveTarget(target, options);
				if (select === undefined)
					return report(
						ctx,
						targetError(
							tab === "quotas" ? "provider" : "setting",
							target,
							options,
							tab === "quotas"
								? "Usage: /auth quotas [provider] (or /quota [provider])."
								: "Usage: /auth settings [key].",
						),
						"error",
					);
			} else return report(ctx, `Usage: /auth ${tab}.`, "error");
		}
		let quotaSource: QuotaPanelDeps | string | undefined;
		if (tab === "quotas" && select !== undefined) {
			const quotas = deps.quotas?.();
			quotaSource = quotas;
			if (
				quotas &&
				typeof quotas !== "string" &&
				!quotas.report().providers.some((provider) => provider.id === select)
			) {
				const action = deps.registry.byId(select)?.provider.quota
					? "Enable it in /auth settings quotas.providers."
					: "Choose a provider with a quota source.";
				return report(ctx, `Quotas for "${sanitize(select)}" are unavailable. ${action}`, "error");
			}
		}
		const source = deps.settings;
		const store = source?.store();
		const settings: SettingsPanelDeps | undefined =
			source && store
				? {
						store: () => store,
						save: (scope, changes) =>
							signal?.aborted ? Promise.resolve(cancelledSave()) : source.save(scope, changes),
						...(source.providerOptions
							? {
									providerOptions: (key) =>
										signal?.aborted ? [] : (source.providerOptions?.(key) ?? []),
								}
							: {}),
						...(source.preview
							? {
									preview: (template, width, theme) =>
										signal?.aborted
											? { rows: [], unknown: [] }
											: (source.preview?.(template, width, theme) ?? { rows: [], unknown: [] }),
								}
							: {}),
					}
				: undefined;
		const model = dashboardModel(deps);
		if (ctx.mode !== "tui" || !ctx.hasUI)
			return report(ctx, headless(tab, model, store, select), "info");
		if (signal?.aborted) return;
		const dashboardSources = { registry: deps.registry, status: deps.status, now: deps.now };
		const tokenSource = deps.tokens?.();
		const modelSource = deps.models;
		const groupSource = deps.groups;
		const tokens = tokenSource ? sessionTokens(tokenSource, signal) : undefined;
		const models = modelSource ? sessionModels(modelSource, signal) : undefined;
		const groups = groupSource ? sessionGroups(groupSource, signal) : undefined;
		quotaSource ??= deps.quotas?.();
		const quotas =
			typeof quotaSource === "string" || !quotaSource
				? quotaSource
				: sessionQuotas(quotaSource, signal);
		if (signal?.aborted) return;
		let current: { tab: TabId; select?: string } = { tab, ...(select ? { select } : {}) };
		for (;;) {
			const opened = current;
			let panel: AuthDashboard | undefined;
			const dispose = () => panel?.dispose();
			signal?.addEventListener("abort", dispose, { once: true });
			let result: DashboardResult;
			try {
				result = await ctx.ui.custom<DashboardResult>((tui, theme, keys, done) => {
					const views = staticViews(signal?.aborted ? model : dashboardModel(dashboardSources));
					views.tokens = (host) => new TokensView(host, tokens);
					if (models) views.models = (host) => new ModelsView(host, models);
					if (typeof quotas === "string")
						views.quotas = (host) => new RowsView(host, { rows: [], empty: quotas });
					else if (quotas)
						views.quotas = (host) =>
							new QuotasView(
								host,
								theme,
								quotas,
								opened.tab === "quotas" ? opened.select : undefined,
							);
					if (groups) views.groups = (host) => new GroupsView(host, groups);
					if (settings)
						views.settings = (host) =>
							new SettingsView(
								host,
								{
									store: settings.store,
									save: settings.save,
									...(settings.providerOptions
										? { providerOptions: settings.providerOptions }
										: {}),
									...(settings.preview
										? {
												previewTemplate: (source: string, width: number) =>
													settings.preview?.(source, width, theme) ?? { rows: [], unknown: [] },
											}
										: {}),
								},
								opened.tab === "settings" ? opened.select : undefined,
							);
					panel = new AuthDashboard(
						tui,
						theme,
						keys,
						done,
						views,
						opened.tab,
						model.providers.length,
						() => ({
							density: store?.get("dashboard.density") ?? "comfortable",
							maxBodyRows: store?.get("dashboard.maxBodyRows") ?? 0,
						}),
					);
					if (signal?.aborted) panel.dispose();
					return panel;
				});
			} finally {
				signal?.removeEventListener("abort", dispose);
			}
			if (signal?.aborted || !result) return;
			if ("reset" in result) {
				if (quotas && typeof quotas !== "string")
					await reset(ctx, result.reset, "panel", quotas, signal);
				if (signal?.aborted) return;
				current = { tab: "quotas", select: result.reset };
			} else {
				await editSetting(ctx, result.editSetting, signal, settings);
				if (signal?.aborted) return;
				current = { tab: "settings", select: result.editSetting };
			}
		}
	};

	pi.registerCommand("auth", {
		description: "Provider status, quotas, token counts, models and settings",
		getArgumentCompletions: (prefix) => {
			const match = /^\s*(\S+)\s+(.*)$/s.exec(prefix);
			if (!match) return authCompletions(prefix);
			const section = match[1] ?? "";
			const tab = resolveTab(section);
			const options = tab === "quotas" ? providerTargets : tab === "settings" ? settingTargets : [];
			const items = targetCompletions(match[2] ?? "", options).map((item) => ({
				...item,
				value: `${section} ${item.value}`,
			}));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const signal = deps.signal?.();
			if (signal?.aborted) return;
			const parsed = parseAuthArgs(args);
			if ("error" in parsed) return report(ctx, parsed.error, "error");
			await open(ctx, parsed.tab, parsed.target, signal);
		},
	});

	const runCodexLogin = async (
		ctx: ExtensionCommandContext,
		mode: "auto" | "device" | "browser",
		signal: AbortSignal | undefined,
	): Promise<void> => {
		if (signal?.aborted) return;
		if (!ctx.hasUI) return report(ctx, "Codex login needs an interactive session", "error");
		try {
			const credential = await (deps.loginCodex ?? loginCodex)({
				mode,
				onStatus: (message) => {
					if (!signal?.aborted) ctx.ui.notify(sanitize(message), "info");
				},
				...(signal ? { signal } : {}),
			});
			if (signal?.aborted) return;
			const quotas = deps.quotas?.();
			if (signal?.aborted) return;
			if (quotas && typeof quotas !== "string") await quotas.refresh("codex", true);
			if (signal?.aborted) return;
			report(
				ctx,
				`Codex quota authenticated${credential.email ? ` (${sanitize(credential.email)})` : ""}${credential.planType ? ` [${sanitize(credential.planType)}]` : ""}`,
				"info",
			);
		} catch (error) {
			if (signal?.aborted) return;
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
			const needle = normalizeTarget(prefix);
			const reset = "reset".startsWith(needle) ? [{ value: "reset", label: "reset" }] : [];
			const login = ["codex login", "codex login --device", "codex login --browser"]
				.filter((name) => name.startsWith(needle))
				.map((name) => ({ value: name, label: name }));
			const items = [...reset, ...targetCompletions(prefix, providerTargets), ...login];
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const signal = deps.signal?.();
			if (signal?.aborted) return;
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
					signal,
				);
			}
			if (word?.toLowerCase() !== "reset" && word?.toLowerCase() !== "resets")
				return open(ctx, "quotas", tokens.join(" ") || undefined, signal);
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
			await reset(ctx, id, "command", quotas, signal);
		},
	};
	pi.registerCommand("quotas", quotaCommand);
	pi.registerCommand("quota", quotaCommand);
	const tokenCommand: Parameters<ExtensionAPI["registerCommand"]>[1] = {
		description: "Live session context token counts; opens Auth › Tokens",
		getArgumentCompletions: () => null,
		handler: async (args, ctx) => {
			const signal = deps.signal?.();
			if (signal?.aborted) return;
			if (args.trim()) return report(ctx, "Usage: /tokens (or /auth tokens).", "error");
			await open(ctx, "tokens", undefined, signal);
		},
	};
	pi.registerCommand("tokens", tokenCommand);
	pi.registerCommand("token", tokenCommand);
}
