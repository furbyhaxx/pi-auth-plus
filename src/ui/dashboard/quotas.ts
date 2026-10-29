/** Owns the live quota dashboard body, provider selection and quota actions. */
import {
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { SETTINGS } from "../../core/config/catalog.ts";
import type { SaveScope } from "../../core/config/index.ts";
import { formatSaveOutcome, type SaveOutcome } from "../../core/config/save.ts";
import type { DrainageMetrics } from "../../quotas/drainage.ts";
import { type LineTheme, renderGradientBar, styleByStress } from "../../quotas/line/format.ts";
import {
	creditStress,
	formatPercent,
	formatResetCountdown,
	type LineConfig,
} from "../../quotas/line/values.ts";
import type { QuotaReport, ReportProvider } from "../../quotas/report.ts";
import { unsupportedResetMessage } from "../../quotas/resets.ts";
import { padTo, sanitize } from "../frame/index.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

/** The catalog's quota-line placement values. */
export type LinePlacement = (typeof SETTINGS)["quotas.linePlacement"]["default"];

/** Live report and settings access; no network work starts when the view opens. */
export interface QuotasTabDeps {
	/** Current normalized quota state. */
	report(): QuotaReport;
	/** Whether an enabled provider can spend reset credits. */
	resetSupport(id: string): boolean;
	/** Whether a provider has a refresh in flight. */
	refreshing(id: string): boolean;
	/** Refresh one provider; failures are reflected in the report. */
	refresh(id: string, force: boolean): Promise<void>;
	/** Subscribe to engine changes and return an unsubscribe function. */
	onChange(listener: () => void): () => void;
	/** Current percentage direction and balance thresholds. */
	lineConfig(): LineConfig;
	/** Current line placement. */
	linePlacement(): LinePlacement;
	/** Save a line placement to the chosen scope and report its outcome. */
	setLinePlacement(next: LinePlacement, scope: SaveScope): Promise<SaveOutcome>;
	/** Current time in milliseconds. */
	now(): number;
}

const PLACEMENTS: readonly LinePlacement[] = [
	"below-editor-first",
	"below-editor-last",
	"above-editor",
	"off",
];
const SCOPES: readonly { readonly key: string; readonly value: SaveScope }[] = [
	{ key: "r", value: "runtime" },
	{ key: "u", value: "user" },
	{ key: "p", value: "project" },
];

interface ProviderRange {
	first: number;
	last: number;
}

function text(value: string): string {
	return sanitize(value).replace(/\n/g, " ");
}

function age(provider: ReportProvider, now: number): string {
	const seconds =
		provider.fetchedAt === undefined
			? provider.ageSec
			: Math.max(0, Math.floor((now - provider.fetchedAt) / 1000));
	if (seconds === undefined) return "";
	if (seconds < 5) return " · just now";
	if (seconds < 60) return ` · ${Math.floor(seconds)}s ago`;
	if (seconds < 3600) return ` · ${Math.floor(seconds / 60)}m ago`;
	return ` · ${Math.floor(seconds / 3600)}h ago`;
}

function drainageText(metrics: DrainageMetrics, currency: string | undefined, now: number): string {
	const rates: string[] = [];
	for (const [label, rate] of [
		["window", metrics.window],
		["1h", metrics.h1],
		["24h", metrics.h24],
	] as const) {
		if (rate === undefined) continue;
		const value =
			currency === undefined
				? `${(rate.perHour * 100).toFixed(1)}%/h`
				: `${rate.perHour.toFixed(2)} ${text(currency)}/h`;
		rates.push(`${value} (${label})`);
	}
	const exhaustion = metrics.resetsBeforeExhaustion
		? "resets first"
		: metrics.etaSec === undefined
			? ""
			: `empty in ${formatResetCountdown(metrics.observedAt + metrics.etaSec * 1000, now)}`;
	if (exhaustion) rates.push(exhaustion);
	return rates.join(" · ");
}

/** A live, scrollable quotas tab. Selection is keyed by provider id. */
/** Clips a label but keeps a trailing "(5h)"-style qualifier, which tells sibling windows apart. */
export function fitLabel(label: string, width: number): string {
	if (visibleWidth(label) <= width) return label;
	const suffix = / \([^()]{1,12}\)$/.exec(label)?.[0];
	if (!suffix || visibleWidth(suffix) + 2 > width) return truncateToWidth(label, width, "…");
	const head = label.slice(0, -suffix.length);
	return `${truncateToWidth(head, width - visibleWidth(suffix), "…")}${suffix}`;
}

export class QuotasView implements TabView {
	readonly #host: TabViewHost;
	readonly #theme: LineTheme;
	readonly #deps: QuotasTabDeps;
	readonly #unsubscribe: () => void;
	readonly #running = new Map<string, number>();
	#solo: string | undefined;
	#selected: string | undefined;
	#offset = 0;
	#bodyRows = 1;
	#ranges = new Map<string, ProviderRange>();
	#reveal = true;
	#disposed = false;
	#mode: "list" | "placement" | "scope" = "list";
	#placementIndex = 0;
	#placementInitial: LinePlacement | undefined;
	#draftPlacement: LinePlacement | undefined;
	#scopeIndex = 0;
	#saving = false;
	#message = "";
	#messageOffset = 0;
	#messageRows = 0;
	#messageCapacity = 0;

	/** Open on all providers, or one provider without fetching. */
	constructor(host: TabViewHost, theme: LineTheme, deps: QuotasTabDeps, solo?: string) {
		this.#host = host;
		this.#theme = theme;
		this.#deps = deps;
		this.#solo = solo;
		this.#selected = solo;
		this.#unsubscribe = deps.onChange(() => this.#refreshHost());
	}

	#providers(): readonly ReportProvider[] {
		const all = this.#deps.report().providers;
		if (this.#solo && !all.some((provider) => provider.id === this.#solo)) this.#solo = undefined;
		const providers = this.#solo ? all.filter((provider) => provider.id === this.#solo) : all;
		if (!providers.some((provider) => provider.id === this.#selected)) {
			this.#selected = providers[0]?.id;
			this.#reveal = true;
		}
		return providers;
	}

	#content(width: number): { lines: string[]; ranges: Map<string, ProviderRange> } {
		const providers = this.#providers();
		const lines: string[] = [];
		const ranges = new Map<string, ProviderRange>();
		const { theme } = this.#host;
		const config = this.#deps.lineConfig();
		const now = this.#deps.now();
		const cells = width >= 95 ? 16 : width >= 70 ? 12 : width >= 50 ? 8 : 4;
		const labelWidth = Math.min(26, Math.max(8, Math.floor(width * 0.24)));
		const append = (line: string) => lines.push(truncateToWidth(line, Math.max(0, width), "…"));
		const addDrainage = (metrics: DrainageMetrics | undefined, currency?: string) => {
			if (!metrics) return;
			const value = drainageText(metrics, currency, now);
			if (value) append(`     ${theme.fg("dim", value)}`);
		};
		for (const provider of providers) {
			const first = lines.length;
			const selected = provider.id === this.#selected;
			const title = theme.bold(theme.fg(selected ? "accent" : "text", text(provider.title)));
			const tier = provider.tier ? ` ${theme.fg("muted", `[${text(provider.tier)}]`)}` : "";
			append(
				` ${selected ? theme.fg("accent", "❯") : " "} ${title} ${theme.fg("dim", `(${text(provider.short)})`)}${tier}${theme.fg("dim", age(provider, now))}`,
			);
			if (provider.needsAuth || provider.state === "needs-auth") {
				append(
					`     ${theme.fg("warning", "⚠")} ${text(provider.loginHint ?? `/login ${provider.id}`)}`,
				);
			}
			if (provider.error) append(`     ${theme.fg("error", "✗")} ${text(provider.error)}`);
			if (provider.state === "unknown" && !provider.credits && provider.windows.length === 0) {
				append(`     ${theme.fg("muted", "Loading quota… (press r to refresh)")}`);
			}
			const credits = provider.credits;
			if (credits) {
				const stress =
					credits.remaining === undefined ? undefined : creditStress(credits.remaining, config);
				const value = `${credits.remaining === undefined ? "?" : credits.remaining.toFixed(2)} ${text(credits.currency)}`;
				const balance =
					stress === undefined
						? theme.fg("muted", value)
						: styleByStress(this.#theme, value, stress, true);
				const detail = credits.detailText ? ` ${theme.fg("dim", text(credits.detailText))}` : "";
				append(
					`     ${padTo(theme.fg("muted", "Available credits"), labelWidth)} ${renderGradientBar(this.#theme, stress, cells)} ${balance}${detail}`,
				);
				addDrainage(credits.drainage, credits.currency);
			}
			for (const window of provider.windows) {
				const label = padTo(
					theme.fg("muted", fitLabel(text(window.label), labelWidth)),
					labelWidth,
				);
				const percent = formatPercent(window.usedFraction, config);
				const styledPercent =
					window.usedFraction === undefined
						? theme.fg("muted", percent)
						: styleByStress(this.#theme, percent, window.usedFraction, window.usedFraction >= 0.85);
				const tag = config.percentDisplay === "remaining" ? "left" : "used";
				const value = window.valueText
					? ` ${theme.fg("muted", `(${text(window.valueText)})`)}`
					: "";
				const countdown = formatResetCountdown(window.resetAtMs, now);
				const reset = countdown ? ` ${theme.fg("dim", `· ↻ ${countdown}`)}` : "";
				append(
					`     ${label} ${renderGradientBar(this.#theme, window.usedFraction, cells)} ${styledPercent} ${theme.fg("dim", tag)}${value}${reset}`,
				);
				addDrainage(window.drainage);
			}
			ranges.set(provider.id, { first, last: lines.length - 1 });
		}
		if (lines.length === 0) append(` ${theme.fg("muted", "No quota providers enabled.")}`);
		return { lines, ranges };
	}

	#renderProviders(width: number, bodyRows: number): TabBody {
		const { lines, ranges } = this.#content(width);
		this.#ranges = ranges;
		this.#bodyRows = Math.max(1, bodyRows);
		const range = this.#selected === undefined ? undefined : ranges.get(this.#selected);
		if (range) {
			if (this.#reveal || this.#offset < range.first || this.#offset > range.last)
				this.#offset = range.first;
			if (range.last - range.first + 1 <= bodyRows && range.last >= this.#offset + bodyRows) {
				this.#offset = range.last - bodyRows + 1;
			}
		}
		this.#reveal = false;
		this.#offset = Math.max(0, Math.min(this.#offset, lines.length - bodyRows));
		const refreshing =
			this.#running.size > 0 ||
			this.#deps.report().providers.some((provider) => this.#deps.refreshing(provider.id));
		return {
			lines: lines.slice(this.#offset, this.#offset + bodyRows),
			above: this.#offset,
			below: Math.max(0, lines.length - this.#offset - bodyRows),
			state: this.#host.theme.fg(
				refreshing ? "accent" : "dim",
				refreshing ? "refreshing" : this.#deps.linePlacement(),
			),
			hints: [
				{
					key: `${sanitize(this.#host.binding("tui.select.up"))}/${sanitize(this.#host.binding("tui.select.down"))}`,
					action: "provider",
					priority: 2,
				},
				{ key: "r/R", action: "refresh", priority: 2 },
				{ key: "a", action: this.#solo ? "show all" : "solo", priority: 3 },
				{ key: "p", action: "position", priority: 4 },
				...(this.#selected && this.#deps.resetSupport(this.#selected)
					? [{ key: "x", action: "reset", priority: 3 }]
					: []),
			],
		};
	}

	#renderChooser(width: number, bodyRows: number): TabBody {
		const { theme } = this.#host;
		const placement = this.#mode === "placement";
		const selected = placement ? this.#placementIndex : this.#scopeIndex;
		const choices = placement
			? PLACEMENTS.map((value) => {
					const label = SETTINGS["quotas.linePlacement"].options?.find(
						(option) => option.value === value,
					)?.label;
					return `${label ?? value}${value === this.#deps.linePlacement() ? " · current" : ""}`;
				})
			: SCOPES.map((scope) => `${scope.key} ${scope.value}`);
		const offset = Math.max(0, Math.min(selected, selected - bodyRows + 1));
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => this.#host.binding(id);
		const description = placement ? "Choose line placement." : "Choose save scope.";
		return {
			lines: choices
				.slice(offset, offset + bodyRows)
				.map((choice, index) =>
					truncateToWidth(
						` ${offset + index === selected ? theme.fg("accent", "❯") : " "} ${choice}`,
						Math.max(0, width),
						"…",
					),
				),
			above: offset,
			below: Math.max(0, choices.length - offset - bodyRows),
			modal: true,
			state: truncateToWidth(
				theme.fg(
					"dim",
					this.#saving
						? "saving"
						: placement
							? this.#deps.linePlacement()
							: `staged: ${this.#draftPlacement ?? ""}`,
				),
				Math.max(0, width),
				"…",
			),
			description: truncateToWidth(theme.fg("muted", description), Math.max(0, width), "…"),
			fullDescription: theme.fg("muted", sanitize(description)),
			hints: [
				{ key: binding("tui.select.confirm"), action: placement ? "choose" : "save", priority: 0 },
				{ key: binding("tui.select.cancel"), action: "back", priority: 0 },
				{
					key: `${binding("tui.select.up")}/${binding("tui.select.down")}`,
					action: "move",
					priority: 1,
				},
				...(!placement ? [{ key: "r/u/p", action: "scope", priority: 1 }] : []),
			],
		};
	}

	/** Render a width-safe slice and the tab's rule state and hints. */
	render(width: number, bodyRows: number): TabBody {
		const messageLines = this.#message
			? wrapTextWithAnsi(text(this.#message), Math.max(1, width - 1))
			: [];
		this.#messageRows = messageLines.length;
		this.#messageCapacity = Math.min(
			messageLines.length,
			bodyRows > 0 ? Math.max(1, Math.floor(bodyRows / 2)) : 0,
		);
		this.#messageOffset = Math.min(
			this.#messageOffset,
			Math.max(0, this.#messageRows - this.#messageCapacity),
		);
		const available = Math.max(0, bodyRows - this.#messageCapacity);
		const body =
			this.#mode === "list"
				? this.#renderProviders(width, available)
				: this.#renderChooser(width, available);
		const message = messageLines
			.slice(this.#messageOffset, this.#messageOffset + this.#messageCapacity)
			.map((line) =>
				truncateToWidth(` ${this.#host.theme.fg("warning", line)}`, Math.max(0, width), "…"),
			);
		const paged = this.#messageRows > this.#messageCapacity && this.#messageCapacity > 0;
		const scope = this.#mode === "scope" && available === 0 ? SCOPES[this.#scopeIndex] : undefined;
		const resultState = paged
			? `result ${this.#messageOffset + 1}-${Math.min(this.#messageRows, this.#messageOffset + this.#messageCapacity)}/${this.#messageRows}`
			: "";
		const selectedProvider = this.#providers().find((provider) => provider.id === this.#selected);
		const fullFeedback = [
			...(body.fullFeedback ?? []),
			...(selectedProvider &&
			(selectedProvider.needsAuth || selectedProvider.state === "needs-auth")
				? [
						this.#host.theme.fg(
							"warning",
							`${sanitize(selectedProvider.title)}: ${sanitize(selectedProvider.loginHint ?? `/login ${selectedProvider.id}`)}`,
						),
					]
				: []),
			...(selectedProvider?.error
				? [
						this.#host.theme.fg(
							"error",
							`${sanitize(selectedProvider.title)}: ${sanitize(selectedProvider.error)}`,
						),
					]
				: []),
			...(this.#message ? [this.#host.theme.fg("warning", sanitize(this.#message))] : []),
		];
		return {
			...body,
			lines: [...body.lines, ...message],
			...(fullFeedback.length > 0 ? { fullFeedback } : {}),
			...(scope || paged
				? {
						state: truncateToWidth(
							this.#host.theme.fg(
								"dim",
								[scope ? `scope: ${scope.value}` : "", resultState].filter(Boolean).join(" · "),
							),
							Math.max(0, width),
							"…",
						),
					}
				: {}),
			...(this.#message
				? {
						description: truncateToWidth(
							this.#host.theme.fg("warning", text(this.#message)),
							Math.max(0, width),
							"…",
						),
					}
				: {}),
			hints:
				this.#messageRows > this.#messageCapacity && this.#messageCapacity > 0
					? [
							...body.hints,
							{
								key: `${this.#host.binding("tui.select.pageUp")}/${this.#host.binding("tui.select.pageDown")}`,
								action: "result",
								priority: 0,
							},
						]
					: body.hints,
		};
	}

	#move(direction: number): void {
		const providers = this.#providers();
		const range = this.#selected === undefined ? undefined : this.#ranges.get(this.#selected);
		if (range && range.last - range.first + 1 > this.#bodyRows) {
			const nextOffset = this.#offset + direction;
			if (nextOffset >= range.first && nextOffset <= range.last - this.#bodyRows + 1) {
				this.#offset = nextOffset;
				return;
			}
		}
		const index = providers.findIndex((provider) => provider.id === this.#selected);
		this.#selected = providers[(index + direction + providers.length) % providers.length]?.id;
		this.#reveal = true;
	}

	#refreshHost(): void {
		if (!this.#disposed) this.#host.refresh();
	}

	async #refresh(ids: readonly string[]): Promise<void> {
		for (const id of ids) this.#running.set(id, (this.#running.get(id) ?? 0) + 1);
		this.#refreshHost();
		// The engine owns failure messages; allSettled also contains synchronous dependency failures.
		await Promise.allSettled(ids.map(async (id) => this.#deps.refresh(id, true)));
		for (const id of ids) {
			const remaining = (this.#running.get(id) ?? 1) - 1;
			if (remaining) this.#running.set(id, remaining);
			else this.#running.delete(id);
		}
		this.#refreshHost();
	}

	#setMessage(message: string): void {
		this.#message = message;
		this.#messageOffset = 0;
		this.#messageRows = 0;
		this.#messageCapacity = 0;
	}

	async #savePlacement(scope: SaveScope): Promise<void> {
		const placement = this.#draftPlacement;
		if (placement === undefined) return;
		this.#saving = true;
		this.#setMessage("");
		this.#refreshHost();
		try {
			const outcome = await this.#deps.setLinePlacement(placement, scope);
			if (this.#disposed) return;
			this.#setMessage(
				outcome.committed
					? formatSaveOutcome(outcome)
					: `Save failed: ${formatSaveOutcome(outcome)}`,
			);
			if (outcome.committed) {
				this.#draftPlacement = undefined;
				this.#placementInitial = undefined;
				this.#mode = "list";
			}
		} catch (error: unknown) {
			if (!this.#disposed)
				this.#setMessage(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.#saving = false;
			this.#refreshHost();
		}
	}

	/** True while a placement change is awaiting a scope or is being saved. */
	hasDrafts(): boolean {
		return this.#draftPlacement !== undefined;
	}

	/** True until the placement save and its effects finish. */
	isSaving(): boolean {
		return this.#saving;
	}

	/** Discard only this tab's placement draft. */
	discardDrafts(): void {
		if (this.#saving) return;
		this.#draftPlacement = undefined;
		this.#placementInitial = undefined;
		this.#mode = "list";
		this.#setMessage("");
	}

	/** Handle provider actions and the local placement and scope choosers. */
	handleInput(data: string): boolean {
		if (this.#disposed || this.#saving) return true;
		const { keys } = this.#host;
		const cancel = keys.matches(data, "tui.select.cancel");
		const confirm = keys.matches(data, "tui.select.confirm");
		const pageUp =
			keys.matches(data, "tui.select.pageUp") || keys.matches(data, "tui.editor.pageUp");
		const pageDown =
			keys.matches(data, "tui.select.pageDown") || keys.matches(data, "tui.editor.pageDown");
		if (!cancel && !confirm && (pageUp || pageDown) && this.#messageRows > this.#messageCapacity) {
			this.#messageOffset = Math.max(
				0,
				Math.min(
					this.#messageRows - this.#messageCapacity,
					this.#messageOffset + (pageUp ? -1 : 1) * Math.max(1, this.#messageCapacity),
				),
			);
			return true;
		}
		if (this.#mode !== "list") {
			if (cancel) {
				if (this.#mode === "scope") {
					this.#mode = "placement";
					this.#setMessage("");
				} else if (this.hasDrafts()) {
					this.#host.confirmDiscard?.(() => {
						if (!this.#disposed) this.discardDrafts();
					});
				} else this.discardDrafts();
			} else if (confirm) {
				if (this.#mode === "placement") {
					const choice = PLACEMENTS[this.#placementIndex];
					if (choice === undefined) return true;
					this.#draftPlacement = choice;
					this.#scopeIndex = 0;
					this.#mode = "scope";
					this.#setMessage("");
				} else {
					const scope = SCOPES[this.#scopeIndex];
					if (scope) void this.#savePlacement(scope.value);
				}
			} else if (keys.matches(data, "tui.select.up") || data === "k") {
				if (this.#mode === "placement") {
					this.#placementIndex = Math.max(0, this.#placementIndex - 1);
					const choice = PLACEMENTS[this.#placementIndex];
					this.#draftPlacement = choice === this.#placementInitial ? undefined : choice;
				} else this.#scopeIndex = Math.max(0, this.#scopeIndex - 1);
			} else if (keys.matches(data, "tui.select.down") || data === "j") {
				if (this.#mode === "placement") {
					this.#placementIndex = Math.min(PLACEMENTS.length - 1, this.#placementIndex + 1);
					const choice = PLACEMENTS[this.#placementIndex];
					this.#draftPlacement = choice === this.#placementInitial ? undefined : choice;
				} else this.#scopeIndex = Math.min(SCOPES.length - 1, this.#scopeIndex + 1);
			} else if (this.#mode === "scope") {
				const index = SCOPES.findIndex((option) => option.key === data);
				const scope = SCOPES[index];
				if (scope) {
					this.#scopeIndex = index;
					void this.#savePlacement(scope.value);
				}
			}
			return true;
		}
		if (
			cancel ||
			keys.matches(data, "tui.input.tab") ||
			keys.matches(data, "tui.editor.cursorLeft") ||
			keys.matches(data, "tui.editor.cursorRight") ||
			matchesKey(data, "shift+tab")
		)
			return false;
		if (keys.matches(data, "tui.select.up") || data === "k") this.#move(-1);
		else if (keys.matches(data, "tui.select.down") || data === "j") this.#move(1);
		else if (data === "a") {
			this.#providers();
			this.#solo = this.#solo ? undefined : this.#selected;
			this.#reveal = true;
		} else if (data === "r") {
			this.#providers();
			void this.#refresh(this.#selected === undefined ? [] : [this.#selected]);
		} else if (data === "R")
			void this.#refresh(this.#deps.report().providers.map((provider) => provider.id));
		else if (data === "p") {
			this.#placementInitial = this.#deps.linePlacement();
			this.#placementIndex = Math.max(0, PLACEMENTS.indexOf(this.#placementInitial));
			this.#mode = "placement";
			this.#setMessage("");
		} else if (data === "x") {
			this.#providers();
			const id = this.#selected;
			if (id && this.#deps.resetSupport(id)) this.#host.finish({ reset: id });
			else if (id) {
				this.#setMessage(
					unsupportedResetMessage(
						id,
						this.#deps
							.report()
							.providers.filter((provider) => this.#deps.resetSupport(provider.id))
							.map((provider) => provider.id),
					),
				);
				this.#refreshHost();
			}
		} else return false;
		return true;
	}

	/** Unsubscribe once; late async completions cannot redraw a closed dashboard. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe();
	}
}
