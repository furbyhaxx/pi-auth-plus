/** `/auth` dashboard content as plain data, shared by the panel and the headless text output. */
import type { CredentialStatus } from "../../core/auth/index.ts";
import { sanitize } from "../frame/index.ts";

export type TabId = "providers" | "quotas" | "tokens" | "settings";

export interface TabSpec {
	readonly id: TabId;
	readonly label: string;
	/** Extra names `/auth <tab>` accepts, including singular and plural forms. */
	readonly aliases: readonly string[];
	readonly description: string;
}

export const TABS: readonly TabSpec[] = [
	{
		id: "providers",
		label: "Providers",
		aliases: ["provider", "status", "accounts", "account"],
		description: "Sign-in state per provider. Sign in with /login <provider>.",
	},
	{
		id: "quotas",
		label: "Quotas",
		aliases: ["quota", "usage", "limits"],
		description: "Usage windows and credits per provider.",
	},
	{
		id: "tokens",
		label: "Tokens",
		aliases: ["token", "count", "counts"],
		description: "Live session context counts and sources.",
	},
	{
		id: "settings",
		label: "Settings",
		aliases: ["setting", "config", "options"],
		description: "Display and provider options.",
	},
];

export function tabSpec(id: TabId): TabSpec {
	return TABS.find((tab) => tab.id === id) ?? (TABS[0] as TabSpec);
}

export function resolveTab(input: string): TabId | undefined {
	const name = input.trim().toLowerCase();
	return TABS.find((tab) => tab.id === name || tab.aliases.includes(name))?.id;
}

export interface ProviderStatus {
	readonly id: string;
	readonly label: string;
	readonly status: CredentialStatus;
	/** Replaces `/login <id>` in hints. */
	readonly loginHint?: string | undefined;
}

export interface DashboardModel {
	readonly providers: readonly ProviderStatus[];
	readonly nowMs: number;
}

export type Tone = "success" | "warning" | "muted";

export interface Row {
	readonly label: string;
	readonly value: string;
	readonly tone: Tone;
}

export interface TabContent {
	readonly rows: readonly Row[];
	/** Shown instead of rows when there are none. */
	readonly empty: string;
}

/** Compact duration: "45s", "12m", "3h 12m", "2d 4h". */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
	const days = Math.floor(hours / 24);
	return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}

function providerRow(provider: ProviderStatus, nowMs: number): Row {
	const label = sanitize(provider.label);
	const { status } = provider;
	const login = sanitize(provider.loginHint ?? `/login ${provider.id}`);
	if (status.state === "missing") {
		return { label, value: `not signed in · ${login}`, tone: "warning" };
	}
	if (status.state === "api_key") return { label, value: "API key", tone: "success" };
	if (status.state === "ambient") {
		const source = sanitize(status.source);
		return status.limited
			? {
					label,
					value: `${source} · limited · ${login} for full access`,
					tone: "warning",
				}
			: { label, value: `API key from ${source}`, tone: "success" };
	}
	if (status.expired) {
		return {
			label,
			value: "signed in · token expired, refreshes on next request",
			tone: "warning",
		};
	}
	return {
		label,
		value: `signed in · expires in ${formatDuration(status.expiresAt - nowMs)}`,
		tone: "success",
	};
}

export function tabContent(tab: TabId, model: DashboardModel): TabContent {
	switch (tab) {
		case "providers":
			return {
				rows: model.providers.map((provider) => providerRow(provider, model.nowMs)),
				empty: "No providers registered.",
			};
		case "quotas":
			return { rows: [], empty: "Quota monitoring is not available yet." };
		case "tokens":
			return { rows: [], empty: "Token tracker unavailable in this session." };
		case "settings":
			return { rows: [], empty: "No settings yet." };
	}
}

/** Plain-text rendering for RPC, print mode and the transcript. */
export function dashboardText(tab: TabId, model: DashboardModel): string {
	const spec = tabSpec(tab);
	const content = tabContent(tab, model);
	const lines = content.rows.map((row) => `  ${row.label}: ${row.value}`);
	return [`Auth › ${spec.label}`, ...(lines.length > 0 ? lines : [`  ${content.empty}`])].join(
		"\n",
	);
}
