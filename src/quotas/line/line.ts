/** Packs the quota template into width-bounded rows without dropping providers. */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { AppSettings } from "../../core/config/catalog.ts";
import type { QuotaView } from "../engine.ts";
import type { LineTheme } from "./format.ts";
import { compileLineTemplate, renderLineTemplate } from "./template.ts";
import type { CompiledTemplate } from "./template-parser.ts";
import type { LineConfig } from "./values.ts";

/** Settings the quota line reads on every render. */
export interface QuotaLineConfig extends LineConfig {
	readonly lineTemplate: string;
	readonly compactWidthCols: number;
	readonly alwaysShortIds: boolean;
}

/** Reads the line settings from the catalog. */
export function quotaLineConfig(settings: AppSettings): QuotaLineConfig {
	return {
		lineTemplate: settings.get("quotas.lineTemplate"),
		compactWidthCols: settings.get("quotas.compactWidthCols"),
		alwaysShortIds: settings.get("quotas.alwaysShortIds"),
		percentDisplay: settings.get("quotas.percentDisplay"),
		creditHealthyUsd: settings.get("quotas.creditHealthyUsd"),
		creditCriticalUsd: settings.get("quotas.creditCriticalUsd"),
	};
}

/** Keeps editor space available; the last visible row names how many rows were hidden. */
export function limitQuotaRows(
	width: number,
	theme: LineTheme,
	rows: string[],
	maxRows: number,
): string[] {
	const height = Math.max(1, maxRows);
	if (rows.length <= height) return rows;
	return [
		...rows.slice(0, height - 1),
		truncateToWidth(theme.fg("dim", `… quota line has ${rows.length} rows`), width),
	];
}

/** Renders rows for a width, compiling the template once per template text. */
export function createQuotaLineRenderer(resolve: (token: string) => string | undefined) {
	let compiled: { source: string; template: CompiledTemplate } | undefined;
	return (
		width: number,
		theme: LineTheme,
		views: readonly QuotaView[],
		config: QuotaLineConfig,
		now: number,
		inUse?: readonly string[],
	): string[] => {
		if (width < 1) return [];
		if (compiled?.source !== config.lineTemplate)
			compiled = {
				source: config.lineTemplate,
				template: compileLineTemplate(config.lineTemplate, resolve),
			};
		const shortIds = config.alwaysShortIds || width < config.compactWidthCols;
		const segments = renderLineTemplate(
			theme,
			compiled.template,
			views,
			config,
			now,
			shortIds,
			inUse,
		);
		const separator = theme.fg("dim", " · ");
		const rows: string[] = [];
		let row = "";
		for (const segment of segments) {
			if (!segment) continue;
			const joined = row ? `${row}${separator}${segment}` : segment;
			if (visibleWidth(joined) <= width) {
				row = joined;
				continue;
			}
			if (row) rows.push(row);
			const wrapped = wrapTextWithAnsi(segment, width);
			rows.push(...wrapped.slice(0, -1));
			row = wrapped.at(-1) ?? "";
		}
		if (row) rows.push(row);
		return rows;
	};
}
