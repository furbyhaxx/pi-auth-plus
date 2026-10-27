/** Owns stress-colored text and bars. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Color, mixColors } from "@earendil-works/pi-tui";
import { clamp01 } from "./values.ts";

/** The theme surface used by quota renderers. */
export type LineTheme = Pick<Theme, "colors" | "fg" | "style">;

/** Interpolates the theme's success, warning and error colors in OKLCH. */
export function gradientColor(theme: LineTheme, stress: number): Color {
	const s = clamp01(stress);
	return s <= 0.5
		? mixColors(theme.colors.success, theme.colors.warning, s * 2)
		: mixColors(theme.colors.warning, theme.colors.error, (s - 0.5) * 2);
}

/** Styles text by quota stress. */
export function styleByStress(
	theme: LineTheme,
	text: string,
	stress: number,
	bold = false,
): string {
	return theme.style(text, { fg: gradientColor(theme, stress), bold });
}

/** Renders unknown usage as a marker rather than an empty bar. */
export function renderGradientBar(
	theme: LineTheme,
	usedFraction: number | undefined,
	cells = 14,
): string {
	if (usedFraction === undefined) return theme.fg("muted", "?");
	const u = clamp01(usedFraction);
	const filled = Math.round(u * cells);
	let bar = theme.fg("dim", "▕");
	for (let i = 0; i < cells; i++) {
		if (i < filled) {
			const posStress = cells > 1 ? i / (cells - 1) : u;
			bar += theme.style("█", { fg: gradientColor(theme, clamp01(posStress * 0.45 + u * 0.55)) });
		} else bar += theme.fg("dim", "░");
	}
	return bar + theme.fg("dim", "▏");
}
