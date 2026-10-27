/** Owns the live quota dashboard body, provider selection and quota actions. */
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SETTINGS } from "../../core/config/catalog.ts";
import type { DrainageMetrics } from "../../quotas/drainage.ts";
import { type LineTheme, renderGradientBar, styleByStress } from "../../quotas/line/format.ts";
import {
	creditStress,
	formatPercent,
	formatResetCountdown,
	type LineConfig,
} from "../../quotas/line/values.ts";
import type { QuotaReport, ReportProvider } from "../../quotas/report.ts";
import { padTo, sanitize } from "../frame/index.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

/** The catalog's quota-line placement values. */
export type LinePlacement = (typeof SETTINGS)["quotas.linePlacement"]["default"];

/** Live report and settings access; no network work starts when the view opens. */
export interface QuotasTabDeps {
	/** Current normalized quota state. */
	report(): QuotaReport;
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
	/** Persist and apply a line placement. */
	setLinePlacement(next: LinePlacement): Promise<void>;
	/** Current time in milliseconds. */
	now(): number;
}

const PLACEMENTS: readonly LinePlacement[] = [
	"below-editor-first",
	"below-editor-last",
	"above-editor",
	"off",
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
	#placementError = "";

	/** Open on all providers, or one provider without fetching. */
	constructor(host: TabViewHost, theme: LineTheme, deps: QuotasTabDeps, solo?: string) {
		this.#host = host;
		this.#theme = theme;
		this.#deps = deps;
		this.#solo = solo;
		this.#selected = solo;
		this.#unsubscribe = deps.onChange(() => this.#refreshHost());
	}

	/** Request the content height; the dashboard caps it to the terminal. */
	wantedRows(): number {
		return this.#content(80).lines.length;
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
				append(`     ${theme.fg("warning", "⚠")} /login ${text(provider.id)}`);
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

	/** Render a width-safe slice and the tab's rule state and hints. */
	render(width: number, bodyRows: number): TabBody {
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
					key: `${this.#host.binding("tui.select.up")}${this.#host.binding("tui.select.down")}`,
					action: "provider",
					priority: 2,
				},
				{ key: "r/R", action: "refresh", priority: 2 },
				{ key: "a", action: this.#solo ? "show all" : "solo", priority: 3 },
				{ key: "p", action: "position", priority: 4 },
			],
			...(this.#placementError
				? { description: this.#host.theme.fg("error", this.#placementError) }
				: {}),
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

	async #cyclePlacement(): Promise<void> {
		const next =
			PLACEMENTS[(PLACEMENTS.indexOf(this.#deps.linePlacement()) + 1) % PLACEMENTS.length] ??
			"below-editor-first";
		try {
			await this.#deps.setLinePlacement(next);
			if (!this.#disposed) this.#placementError = "";
		} catch (error: unknown) {
			if (!this.#disposed)
				this.#placementError = `Line placement failed: ${text(error instanceof Error ? error.message : String(error))}; retry p.`;
		}
		this.#refreshHost();
	}

	/** Handle provider actions; frame navigation and close keys remain unconsumed. */
	handleInput(data: string): boolean {
		const { keys } = this.#host;
		if (
			keys.matches(data, "tui.select.cancel") ||
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
		else if (data === "p") void this.#cyclePlacement();
		else return false;
		return true;
	}

	/** Unsubscribe once; late async completions cannot redraw a closed dashboard. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe();
	}
}
