/**
 * Theme compatibility for the quota line: Pi's theme exposes `colors` and `style`, oh-my-pi's
 * exposes token lookups and single-color helpers instead. Everything here keeps Pi's output
 * byte-identical and gives the other host the same gradient and explicit colors.
 */
import type { Theme, ThemeColor, ThemeStyle, ThemeToken } from "@earendil-works/pi-coding-agent";
import { type Color, tuiKit } from "../../core/host/tui/index.ts";
import type { LineTheme } from "./format.ts";

export const THEME_TOKENS: readonly ThemeToken[] = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"scrollbarTrack",
	"scrollbarThumb",
	"selectedBg",
	"searchMatchBg",
	"searchMatchText",
	"userMessageBg",
	"userMessageText",
	"customMessageBg",
	"customMessageText",
	"customMessageLabel",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"bashMode",
];

type ColorMode = "256color" | "truecolor";

interface HostTheme {
	readonly colors?: Readonly<Record<ThemeToken, Color>>;
	readonly style?: (text: string, options: ThemeStyle) => string;
	fg(color: ThemeColor, text: string): string;
	getColorHex?(token: string): string;
	getBgHex?(token: string): string;
	getColorMode?(): ColorMode;
}

const BASIC_COLORS: readonly Rgb[] = [
	{ r: 0, g: 0, b: 0 },
	{ r: 128, g: 0, b: 0 },
	{ r: 0, g: 128, b: 0 },
	{ r: 128, g: 128, b: 0 },
	{ r: 0, g: 0, b: 128 },
	{ r: 128, g: 0, b: 128 },
	{ r: 0, g: 128, b: 128 },
	{ r: 192, g: 192, b: 192 },
	{ r: 128, g: 128, b: 128 },
	{ r: 255, g: 0, b: 0 },
	{ r: 0, g: 255, b: 0 },
	{ r: 255, g: 255, b: 0 },
	{ r: 0, g: 0, b: 255 },
	{ r: 255, g: 0, b: 255 },
	{ r: 0, g: 255, b: 255 },
	{ r: 255, g: 255, b: 255 },
];
const CUBE_VALUES = [0, 95, 135, 175, 215, 255] as const;
const GRAY_VALUES = Array.from({ length: 24 }, (_, index) => 8 + index * 10);

interface Rgb {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

function rgbColor(r: number, g: number, b: number): Color & Rgb {
	return { kind: "rgb", r, g, b };
}

function parseHex(value: string): Color | undefined {
	const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
	if (!hex) return undefined;
	const raw = hex[1] ?? "";
	const digits = raw.length === 3 ? [...raw].map((digit) => digit + digit).join("") : raw;
	return rgbColor(
		Number.parseInt(digits.slice(0, 2), 16),
		Number.parseInt(digits.slice(2, 4), 16),
		Number.parseInt(digits.slice(4, 6), 16),
	);
}

function rgbOf(color: Color): Rgb {
	switch (color.kind) {
		case "rgb":
			return color;
		case "indexed":
			return BASIC_COLORS[color.index] ?? { r: 0, g: 0, b: 0 };
		case "oklch":
			return oklchToRgb(color.l, color.c, color.h);
	}
}

function oklchToRgb(l: number, c: number, h: number): Rgb {
	const hue = (h * Math.PI) / 180;
	const a = c * Math.cos(hue);
	const b = c * Math.sin(hue);
	const lms = [
		l + 0.3963377774 * a + 0.2158037573 * b,
		l - 0.1055613458 * a - 0.0638541728 * b,
		l - 0.0894841775 * a - 1.291485548 * b,
	].map((value) => value ** 3);
	const [c0, c1, c2] = lms as [number, number, number];
	const linear = [
		4.0767416621 * c0 - 3.3077115913 * c1 + 0.2309699292 * c2,
		-1.2684380046 * c0 + 2.6097574011 * c1 - 0.3413193965 * c2,
		-0.0041960863 * c0 - 0.7034186147 * c1 + 1.707614701 * c2,
	];
	const [r, g, bChannel] = linear.map((value) => {
		const encoded =
			value <= 0.0031308
				? 12.92 * value
				: 1.055 * Math.sign(value) * Math.abs(value) ** (1 / 2.4) - 0.055;
		return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
	}) as [number, number, number];
	return { r, g, b: bChannel };
}

function mix(first: Color, second: Color, amount: number): Color {
	const a = rgbOf(first);
	const b = rgbOf(second);
	return rgbColor(
		a.r + (b.r - a.r) * amount,
		a.g + (b.g - a.g) * amount,
		a.b + (b.b - a.b) * amount,
	);
}

/** Pi's OKLCH mix when the host exports it, sRGB otherwise. */
export function mixColors(first: Color, second: Color, amount: number): Color {
	const hostMix = tuiKit().mixColors;
	return hostMix ? hostMix(first, second, amount) : mix(first, second, amount);
}

/** Hex input is the only form the template accepts; returns undefined on anything else. */
export function parseHexColor(value: string): Color | undefined {
	const hostParse = tuiKit().parseColor;
	return hostParse ? (parseHex(value) ?? hostParse(value)) : parseHex(value);
}

function nearest(values: readonly number[], target: number): number {
	let index = 0;
	let distance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < values.length; i++) {
		const current = Math.abs(target - (values[i] ?? 0));
		if (current < distance) {
			distance = current;
			index = i;
		}
	}
	return index;
}

function ansi256(color: Rgb): number {
	const rIndex = nearest(CUBE_VALUES, color.r);
	const gIndex = nearest(CUBE_VALUES, color.g);
	const bIndex = nearest(CUBE_VALUES, color.b);
	const cube = {
		r: CUBE_VALUES[rIndex] ?? 0,
		g: CUBE_VALUES[gIndex] ?? 0,
		b: CUBE_VALUES[bIndex] ?? 0,
	};
	const gray = Math.round(0.299 * color.r + 0.587 * color.g + 0.114 * color.b);
	const grayIndex = nearest(GRAY_VALUES, gray);
	const grayValue = GRAY_VALUES[grayIndex] ?? 0;
	const cubeDistance = (cube.r - color.r) ** 2 + (cube.g - color.g) ** 2 + (cube.b - color.b) ** 2;
	const grayDistance = 3 * (grayValue - gray) ** 2;
	return grayDistance < cubeDistance ? 232 + grayIndex : 16 + 36 * rIndex + 6 * gIndex + bIndex;
}

function colorCode(color: Color, mode: ColorMode, background: boolean): string {
	const rgb = rgbOf(color);
	const [r, g, b] = [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)];
	return mode === "truecolor"
		? `${background ? 48 : 38};2;${r};${g};${b}`
		: `${background ? 48 : 38};5;${ansi256({ r, g, b })}`;
}

function paint(
	text: string,
	fg: Color | undefined,
	bg: Color | undefined,
	mode: ColorMode,
): string {
	if (!fg && !bg) return text;
	const codes: string[] = [];
	if (fg) codes.push(colorCode(fg, mode, false));
	if (bg) codes.push(colorCode(bg, mode, true));
	const close = `${fg ? "\x1b[39m" : ""}${bg ? "\x1b[49m" : ""}`;
	return `\x1b[${codes.join(";")}m${text}${close}`;
}

function attributes(text: string, options: ThemeStyle): string {
	let out = text;
	if (options.bold) out = `\x1b[1m${out}\x1b[22m`;
	if (options.dim) out = `\x1b[2m${out}\x1b[22m`;
	if (options.italic) out = `\x1b[3m${out}\x1b[23m`;
	if (options.underline) out = `\x1b[4m${out}\x1b[24m`;
	if (options.inverse) out = `\x1b[7m${out}\x1b[27m`;
	if (options.strikethrough) out = `\x1b[9m${out}\x1b[29m`;
	return out;
}

function tokenHex(host: HostTheme, token: string): string | undefined {
	for (const lookup of [host.getColorHex, host.getBgHex]) {
		if (!lookup) continue;
		try {
			const value = lookup.call(host, token);
			if (value) return value;
		} catch {
			// Unknown token on this host; try the background lookup or the fallback.
		}
	}
	return undefined;
}

function hostLineTheme(theme: Theme): LineTheme {
	const host: HostTheme = theme;
	const fallback = rgbColor(128, 128, 128);
	const resolved = new Map<string, Color>();
	for (const token of THEME_TOKENS) {
		const hex = tokenHex(host, token);
		resolved.set(token, (hex ? parseHex(hex) : undefined) ?? fallback);
	}
	const colors = Object.fromEntries(resolved) as Readonly<Record<string, Color>>;
	const mode: ColorMode = (() => {
		try {
			return host.getColorMode?.() ?? "truecolor";
		} catch {
			return "truecolor";
		}
	})();
	const colorOf = (value: string | Color): Color =>
		typeof value === "string" ? (colors[value] ?? fallback) : value;
	return {
		colors,
		fg: (color, text) => host.fg(color, text),
		style: (text, options) => {
			const styled = attributes(text, options);
			const fg = options.fg === undefined ? undefined : colorOf(options.fg);
			const bg = options.bg === undefined ? undefined : colorOf(options.bg);
			return paint(styled, fg, bg, mode);
		},
	};
}

const adapted = new WeakMap<Theme, LineTheme>();

/** Pi's own theme when it has the full surface; an adapter for hosts that expose token lookups. */
export function adaptLineTheme(theme: Theme): LineTheme {
	const surface = theme as { colors?: unknown; style?: unknown };
	if (surface.colors !== undefined && typeof surface.style === "function") return theme;
	const cached = adapted.get(theme);
	if (cached) return cached;
	const line = hostLineTheme(theme);
	adapted.set(theme, line);
	return line;
}
