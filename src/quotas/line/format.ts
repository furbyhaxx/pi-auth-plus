/** Owns concrete token colors and stress-colored text and bars without loading Pi at runtime. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Color } from "@earendil-works/pi-tui";
import { clamp01 } from "./values.ts";

/** The theme surface used by quota renderers. */
export type LineTheme = Pick<Theme, "colors" | "fg" | "style">;

/** Parses a validated three- or six-digit hexadecimal color. */
export function hexColor(value: string): Color {
	const hex = value.slice(1);
	const digits = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
	return {
		kind: "rgb",
		r: Number.parseInt(digits.slice(0, 2), 16),
		g: Number.parseInt(digits.slice(2, 4), 16),
		b: Number.parseInt(digits.slice(4, 6), 16),
	};
}

function oklch(color: Color): { l: number; c: number; h: number } {
	if (color.kind === "oklch") return color;
	let r: number;
	let g: number;
	let b: number;
	if (color.kind === "rgb") ({ r, g, b } = color);
	else {
		const i = color.index;
		if (i < 16) {
			const bright = i >= 8;
			const base = i % 8;
			const channel = bright ? 255 : 128;
			r = base & 1 ? channel : 0;
			g = base & 2 ? channel : 0;
			b = base & 4 ? channel : 0;
			if (i === 7) r = g = b = 192;
			if (i === 8) r = g = b = 128;
		} else if (i < 232) {
			const cube = (n: number) => (n === 0 ? 0 : 55 + n * 40);
			r = cube(Math.floor((i - 16) / 36));
			g = cube(Math.floor(((i - 16) % 36) / 6));
			b = cube((i - 16) % 6);
		} else r = g = b = 8 + (i - 232) * 10;
	}
	const linear = (v: number) => {
		const x = v / 255;
		return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	};
	r = linear(r);
	g = linear(g);
	b = linear(b);
	const l = Math.cbrt(0.4122214694707629 * r + 0.5363325372617349 * g + 0.0514459932675022 * b);
	const m = Math.cbrt(0.2119034958178251 * r + 0.6806995506452344 * g + 0.1073969535369405 * b);
	const s = Math.cbrt(0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738222 * b);
	const a = 1.9779985324311684 * l - 2.42859224204858 * m + 0.450593709617411 * s;
	const y = 0.0259040424655478 * l + 0.7827717124575296 * m - 0.8086757549230774 * s;
	return {
		l: 0.210454268309314 * l + 0.793617774702305 * m - 0.0040720430116193 * s,
		c: Math.hypot(a, y),
		h: ((Math.atan2(y, a) * 180) / Math.PI + 360) % 360,
	};
}
function mix(first: Color, second: Color, amount: number): Color {
	const a = oklch(first);
	const b = oklch(second);
	const firstHue = a.c < 1e-7 ? b.h : a.h;
	const secondHue = b.c < 1e-7 ? firstHue : b.h;
	const delta = ((secondHue - firstHue + 540) % 360) - 180;
	return {
		kind: "oklch",
		l: a.l + (b.l - a.l) * amount,
		c: a.c + (b.c - a.c) * amount,
		h: (((firstHue + delta * amount) % 360) + 360) % 360,
	};
}

/** Interpolates the theme's success, warning and error colors in OKLCH. */
export function gradientColor(theme: LineTheme, stress: number): Color {
	const s = clamp01(stress);
	return s <= 0.5
		? mix(theme.colors.success, theme.colors.warning, s * 2)
		: mix(theme.colors.warning, theme.colors.error, (s - 0.5) * 2);
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
