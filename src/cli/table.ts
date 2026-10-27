/** The `--list-quotas` table: one row per window, one table, plus stderr diagnostics. */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { DrainageMetrics, DrainageRate } from "../quotas/drainage.ts";
import { plainText as clean } from "../quotas/line/values.ts";
import type { QuotaReport, ReportProvider, ReportWindow } from "../quotas/report.ts";

export interface TableOptions {
	color: boolean;
}

const HEADERS = [
	"Provider",
	"Window",
	"Used",
	"Remaining",
	"Resets at",
	"Drainage (window)",
	"Drainage (1h)",
	"Drainage (24h)",
] as const;
const RIGHT_ALIGNED = new Set([2, 3, 5, 6, 7]);
const HOUR_SEC = 3600;
/** A lookback rate is shown only once observations cover most of that lookback. */
const MIN_LOOKBACK_COVERAGE = 0.8;

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
	timeZone: "Europe/Zurich",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
	timeZoneName: "longOffset",
});

/** Two decimals at most; a non-zero or non-full value never rounds onto the boundary. */
function twoDecimals(value: number, max?: number): string {
	const rounded = Math.round(value * 100) / 100;
	if (value > 0 && rounded === 0) return "<0.01";
	if (max !== undefined && value < max && rounded === max) return `>${(max - 0.01).toFixed(2)}`;
	return String(rounded);
}

function percent(value: number | undefined): string {
	if (value === undefined) return "?";
	return `${twoDecimals(value, 100)}%`;
}

function money(value: number | undefined, currency: string): string {
	if (value === undefined) return "?";
	const unit = clean(currency);
	const amount = value > 0 && value < 0.005 ? "<0.01" : value.toFixed(2);
	return unit.length === 1 ? `${amount}${unit}` : `${amount} ${unit}`;
}

export function timestamp(at: number | undefined): string {
	if (at === undefined || !Number.isFinite(at)) return "";
	return dateFormat.format(new Date(at)).replace("GMT", "");
}

function duration(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	if (minutes < 1) return "<1m";
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	const rest = minutes % 60;
	if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`;
	if (hours > 0) return rest > 0 ? `${hours}h${rest}m` : `${hours}h`;
	return `${rest}m`;
}

function rate(value: DrainageRate | undefined, currency: string | undefined): string {
	if (!value) return "";
	return currency
		? `${money(value.perHour, currency)}/h`
		: `${twoDecimals(value.perHour * 100)}%/h`;
}

function lookbackRate(
	value: DrainageRate | undefined,
	lookbackSec: number,
	currency: string | undefined,
): string {
	if (!value || value.coverageSec < lookbackSec * MIN_LOOKBACK_COVERAGE) return "";
	return rate(value, currency);
}

function drainageCells(metrics: DrainageMetrics | undefined, currency?: string): string[] {
	const window = rate(metrics?.window, currency);
	const eta = window && metrics?.etaSec !== undefined ? ` → ${duration(metrics.etaSec)}` : "";
	return [
		window + eta,
		lookbackRate(metrics?.h1, HOUR_SEC, currency),
		lookbackRate(metrics?.h24, 24 * HOUR_SEC, currency),
	];
}

export function windowName(window: ReportWindow): string {
	const period = window.period && clean(window.period);
	const scope = window.scope && clean(window.scope);
	if (period && scope) return `${period} (${scope})`;
	return period || scope || clean(window.label);
}

function paint(value: string, code: number, color: boolean): string {
	return color && value ? `\x1b[${code}m${value}\x1b[0m` : value;
}

function stressCode(usedFraction: number | undefined): number {
	if (usedFraction === undefined) return 39;
	if (usedFraction >= 1) return 31;
	return usedFraction >= 0.8 ? 33 : 32;
}

function providerRows(provider: ReportProvider, color: boolean): string[][] {
	const id = clean(provider.id);
	const rows: string[][] = [];
	if (provider.credits) {
		const { credits } = provider;
		rows.push([
			id,
			"credits",
			"",
			money(credits.remaining, credits.currency),
			"",
			...drainageCells(credits.drainage, credits.currency),
		]);
	}
	for (const window of provider.windows) {
		if (provider.credits && window.id === "credits") continue;
		rows.push([
			id,
			windowName(window),
			paint(percent(window.usedPercent), stressCode(window.usedFraction), color),
			percent(window.remainingPercent),
			timestamp(window.resetAtMs),
			...drainageCells(window.drainage),
		]);
	}
	if (rows.length === 0) rows.push([id, "", "", "", "", "", "", ""]);
	return rows;
}

function pad(cell: string, width: number, right: boolean): string {
	const fill = " ".repeat(Math.max(0, width - visibleWidth(cell)));
	return right ? fill + cell : cell + fill;
}

/** Aligned columns separated by two spaces, with a bold header when colored. */
export function renderColumns(
	headers: readonly string[],
	rows: readonly (readonly string[])[],
	rightAligned: ReadonlySet<number>,
	color: boolean,
): string {
	const widths = headers.map((header, column) =>
		Math.max(visibleWidth(header), ...rows.map((row) => visibleWidth(row[column] ?? ""))),
	);
	const line = (cells: readonly string[]) =>
		cells
			.map((cell, column) => pad(cell, widths[column] ?? 0, rightAligned.has(column)))
			.join("  ")
			.trimEnd();
	const header = line(headers);
	return `${[color ? `\x1b[1m${header}\x1b[0m` : header, ...rows.map(line)].join("\n")}\n`;
}

export function renderQuotaTable(report: QuotaReport, opts: TableOptions): string {
	const rows = report.providers.flatMap((provider) => providerRows(provider, opts.color));
	return renderColumns(HEADERS, rows, RIGHT_ALIGNED, opts.color);
}

/** One line per provider whose data is not fresh, for stderr. */
export function renderQuotaDiagnostics(report: QuotaReport): string {
	const lines: string[] = [];
	for (const provider of report.providers) {
		if (provider.state === "ok") continue;
		const id = clean(provider.id);
		if (provider.state === "unknown") {
			lines.push(`${id}: not fetched yet`);
			continue;
		}
		const reason = provider.error ? `: ${clean(provider.error)}` : "";
		const age =
			provider.fetchedAt === undefined ? "" : `; data from ${timestamp(provider.fetchedAt)}`;
		lines.push(`${id}: ${provider.state}${reason}${age}`);
	}
	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
