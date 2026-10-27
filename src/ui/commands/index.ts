/** The `/auth` command family: one router, standalone entry points, headless text fallback. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Text } from "@earendil-works/pi-tui";
import type { CredentialStatus } from "../../core/auth/index.ts";
import type { Registry } from "../../core/registry/index.ts";
import {
	AuthDashboard,
	type DashboardModel,
	dashboardText,
	resolveTab,
	TABS,
	type TabId,
} from "../dashboard/index.ts";
import { sanitize } from "../frame/index.ts";

export const NOTE_TYPE = "auth-plus-note";
export const AUTH_USAGE = `Usage: /auth [${TABS.map((tab) => tab.id).join("|")}]`;

export interface AuthCommandDeps {
	readonly registry: Registry;
	readonly status: (providerId: string) => CredentialStatus;
	readonly now: () => number;
}

/** Standalone commands and the dashboard tab each one opens. */
export const ENTRY_POINTS: Readonly<Record<string, TabId>> = {
	quota: "quotas",
	quotas: "quotas",
	tokens: "tokens",
};

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

export type AuthArgs = { readonly tab: TabId } | { readonly error: string };

export function parseAuthArgs(args: string): AuthArgs {
	const word = args.trim().split(/\s+/)[0] ?? "";
	if (word === "") return { tab: "providers" };
	const tab = resolveTab(word);
	if (tab) return { tab };
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
		})),
	};
}

export function registerAuthCommands(pi: ExtensionAPI, deps: AuthCommandDeps): void {
	pi.registerEntryRenderer<{ text?: unknown }>(
		NOTE_TYPE,
		(entry, _options, theme) =>
			new Text(theme.fg("toolOutput", sanitize(String(entry.data?.text ?? ""))), 0, 0),
	);

	const report = (ctx: ExtensionCommandContext, text: string, tone: "info" | "error") => {
		if (ctx.hasUI && (ctx.mode !== "tui" || tone === "error" || !text.includes("\n"))) {
			ctx.ui.notify(text, tone);
		} else pi.appendEntry(NOTE_TYPE, { text });
	};

	const open = async (ctx: ExtensionCommandContext, tab: TabId) => {
		const model = dashboardModel(deps);
		if (ctx.mode !== "tui" || !ctx.hasUI) return report(ctx, dashboardText(tab, model), "info");
		await ctx.ui.custom<void>(
			(tui, theme, keys, done) => new AuthDashboard(tui, theme, keys, done, model, tab),
		);
	};

	pi.registerCommand("auth", {
		description: "Provider status, quotas, token counts and settings",
		getArgumentCompletions: authCompletions,
		handler: async (args, ctx) => {
			const parsed = parseAuthArgs(args);
			if ("error" in parsed) return report(ctx, parsed.error, "error");
			await open(ctx, parsed.tab);
		},
	});
	for (const [name, tab] of Object.entries(ENTRY_POINTS)) {
		pi.registerCommand(name, {
			description: `Open /auth ${tab}`,
			handler: (_args, ctx) => open(ctx, tab),
		});
	}
}
