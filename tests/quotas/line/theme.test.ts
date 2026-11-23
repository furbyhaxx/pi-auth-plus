import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { parseColor } from "@earendil-works/pi-tui";
import { gradientColor, styleByStress } from "../../../src/quotas/line/format.ts";
import { adaptLineTheme } from "../../../src/quotas/line/theme.ts";

const piTheme = {
	colors: {
		success: parseColor("#00ff00"),
		warning: parseColor("#ffff00"),
		error: parseColor("#ff0000"),
		muted: parseColor("#aaaaaa"),
		text: parseColor("#ffffff"),
	},
	fg: (_token: string, text: string) => text,
	style: (text: string) => text,
} as unknown as Theme;

const HOST_HEXES: Record<string, string> = {
	success: "#00ff88",
	warning: "#ffb347",
	error: "#ff4757",
	muted: "#9ca3b0",
	dim: "#6b7280",
	text: "#e5e5e7",
	accent: "#00b4ff",
	border: "#2a3038",
};

const hostTheme = {
	getColorHex(token: string): string {
		const hex = HOST_HEXES[token];
		if (!hex) throw new Error(`Unknown theme color: ${token}`);
		return hex;
	},
	getBgHex(token: string): string {
		const hex = HOST_HEXES[token];
		if (!hex) throw new Error(`Unknown theme background: ${token}`);
		return hex;
	},
	getColorMode: () => "truecolor" as const,
	fg: (token: string, text: string) => `<${token}>${text}`,
	bold: (text: string) => `*${text}*`,
} as unknown as Theme;

describe("quota line theme compatibility", () => {
	test("Pi's own theme passes through unchanged", () => {
		expect(adaptLineTheme(piTheme)).toBe(piTheme);
	});

	test("token lookups become concrete colors and ANSI styling", () => {
		const theme = adaptLineTheme(hostTheme);
		expect(theme.colors.success).toEqual({ kind: "rgb", r: 0, g: 255, b: 136 });
		expect(theme.colors.text).toEqual({ kind: "rgb", r: 229, g: 229, b: 231 });
		const styled = theme.style("50%", { fg: "warning", bold: true });
		expect(styled).toBe("\x1b[38;2;255;179;71m\x1b[1m50%\x1b[22m\x1b[39m");
		const explicit = theme.style("x", { fg: { kind: "rgb", r: 1, g: 2, b: 3 } });
		expect(explicit).toBe("\x1b[38;2;1;2;3mx\x1b[39m");
	});

	test("the gradient reaches the host's resolved colors", () => {
		const theme = adaptLineTheme(hostTheme);
		expect(gradientColor(theme, 0)).toBeDefined();
		expect(styleByStress(theme, "danger", 1)).toContain("\x1b[38;2;");
	});
});
