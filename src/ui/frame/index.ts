/** The one panel frame: rules, header, scrolling body, description and key hints. */
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Keybinding,
	type KeybindingsManager,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

/** Theme tokens the panels use; a structural subset of Pi's `Theme`. */
export type PanelTheme = Pick<Theme, "fg" | "bg" | "bold">;

/** The part of the TUI a panel needs: repainting and the terminal height. */
export type PanelHost = Pick<TUI, "requestRender"> & { terminal: Pick<TUI["terminal"], "rows"> };

/** Rows a frame adds to its header and body: top rule, bottom rule, description, hints, close. */
export const FRAME_ROWS = 5;
const MIN_BODY_ROWS = 4;
// Pi's editor and footer plus a few transcript lines stay visible below and above a panel.
const RESERVED_ROWS = 8;

/** Body height: `wanted` rows, capped by the terminal, never below four. */
export function bodyRowsFor(terminalRows: number, headerRows: number, wanted: number): number {
	const available = terminalRows - headerRows - FRAME_ROWS - RESERVED_ROWS;
	return Math.max(MIN_BODY_ROWS, Math.min(Math.floor(wanted), available));
}

const CONTROL_RE = /[\p{Cc}\uFFF9-\uFFFB]/gu;

/** Strips escape sequences from provider-supplied text; other control characters become spaces. */
export function sanitize(text: string): string {
	return stripVTControlCharacters(text).replace(CONTROL_RE, (char) => (char === "\n" ? char : " "));
}

/** Clips `text` to `width` columns and pads it to exactly that width. */
export function padTo(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(0, width), "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

type RuleColor = "borderAccent" | "border";

export interface RuleParts {
	readonly crumbs?: readonly string[];
	readonly center?: string;
	readonly right?: string;
}

function fitCrumbs(theme: PanelTheme, crumbs: readonly string[], budget: number): string {
	const width = (shown: readonly string[]) =>
		shown.reduce((sum, crumb) => sum + visibleWidth(crumb), 0) + 3 * (shown.length - 1);
	let start = 0;
	while (start < crumbs.length - 1 && width(crumbs.slice(start)) > budget) start++;
	const text = crumbs
		.slice(start)
		.map((crumb) => theme.bold(crumb))
		.join(` ${theme.fg("dim", "›")} `);
	return truncateToWidth(text, Math.max(1, budget), "…");
}

/** Full-width rule `── crumbs ── center ── right ──`; the last crumb and `right` win when narrow. */
export function rule(theme: PanelTheme, width: number, parts: RuleParts, color: RuleColor): string {
	const dash = (count: number) => theme.fg(color, "─".repeat(Math.max(0, count)));
	const right = parts.right ? ` ${parts.right} ${dash(2)}` : dash(2);
	const rightWidth = visibleWidth(right);
	const crumbs = parts.crumbs ?? [];
	const center = parts.center ? ` ${parts.center} ` : "";
	const centerWidth = visibleWidth(center);
	const lastCrumb = visibleWidth(crumbs[crumbs.length - 1] ?? "");
	const crumbBudget = Math.max(
		Math.min(lastCrumb, width - rightWidth - 6),
		width - rightWidth - 6 - (center ? centerWidth + 2 : 0),
	);
	const left = crumbs.length > 0 ? `${dash(2)} ${fitCrumbs(theme, crumbs, crumbBudget)} ` : dash(2);
	const fill = width - visibleWidth(left) - rightWidth;
	if (center && fill - centerWidth >= 2) {
		const before = Math.max(
			1,
			Math.min(fill - centerWidth - 1, Math.floor((width - centerWidth) / 2) - visibleWidth(left)),
		);
		return truncateToWidth(
			left + dash(before) + center + dash(fill - centerWidth - before) + right,
			width,
			"",
		);
	}
	return truncateToWidth(left + dash(fill) + right, width, "");
}

const KEY_GLYPHS: Readonly<Record<string, string>> = {
	escape: "esc",
	up: "↑",
	down: "↓",
	left: "←",
	right: "→",
	pageUp: "pgup",
	pageDown: "pgdn",
};

/** The user's first key for a binding, in hint notation. */
export function bindingLabel(keys: KeybindingsManager, id: Keybinding): string {
	const key = keys.getKeys(id)[0];
	return key === undefined ? "" : (KEY_GLYPHS[key] ?? key);
}

/** One key hint; when the row is too narrow the highest `priority` goes first. */
export interface HintItem {
	readonly key: string;
	readonly action: string;
	readonly priority: number;
}

export function fitHint(theme: PanelTheme, items: readonly HintItem[], width: number): string {
	const plain = (list: readonly HintItem[]) =>
		list.map((item) => (item.key ? `${item.key} ${item.action}` : item.action)).join(" · ");
	const kept = items.filter((item) => item.key !== "" || item.action !== "");
	while (kept.length > 1 && visibleWidth(plain(kept)) > width) {
		let drop = 0;
		for (const [index, item] of kept.entries()) {
			if (item.priority > (kept[drop]?.priority ?? 0)) drop = index;
		}
		kept.splice(drop, 1);
	}
	return kept
		.map((item) =>
			item.key
				? `${theme.fg("dim", item.key)} ${theme.fg("muted", item.action)}`
				: theme.fg("muted", item.action),
		)
		.join(theme.fg("dim", " · "));
}

/** Everything a panel contributes; the frame adds rules, padding and a constant height. */
export interface FrameSpec {
	readonly crumbs: readonly string[];
	/** Right end of the top rule, already themed. */
	readonly state?: string;
	readonly header: readonly string[];
	readonly body: readonly string[];
	readonly bodyRows: number;
	/** Hidden rows above and below the visible body. */
	readonly above?: number;
	readonly below?: number;
	readonly description: string;
	readonly footer: string;
}

/** Same header and `bodyRows` always yield the same line count; every line fits `width`. */
export function drawFrame(theme: PanelTheme, width: number, spec: FrameSpec): string[] {
	const w = Math.max(1, width);
	const above = spec.above ?? 0;
	const below = spec.below ?? 0;
	const body = spec.body.slice(0, spec.bodyRows);
	while (body.length < spec.bodyRows) body.push("");
	const lines = [
		rule(
			theme,
			w,
			{
				crumbs: spec.crumbs,
				center: above > 0 ? theme.fg("dim", `↑ ${above} more`) : "",
				right: spec.state ?? "",
			},
			"borderAccent",
		),
		...spec.header.map((line) => ` ${line}`),
		...body,
		rule(theme, w, { center: below > 0 ? theme.fg("dim", `↓ ${below} more`) : "" }, "border"),
		` ${spec.description}`,
		` ${spec.footer}`,
		rule(theme, w, {}, "borderAccent"),
	];
	return lines.map((line) => truncateToWidth(line, w, "…"));
}
