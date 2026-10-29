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

/** Rows a full frame adds to its header and body. */
export const FRAME_ROWS = 5;
const COMPACT_FRAME_ROWS = 3;
const MIN_BODY_ROWS = 4;
const RESERVED_ROWS = 8;

/** User preferences for a frame's density and maximum body height. */
export interface FrameLayoutOptions {
	readonly density?: "compact" | "comfortable";
	readonly maxBodyRows?: number;
}

/** The body budget and chrome selected for the current terminal. */
export interface FrameLayout {
	readonly bodyRows: number;
	readonly compact: boolean;
}

/** Budget the frame after reserving space for the surrounding Pi interface. */
export function layoutFor(
	terminalRows: number,
	headerRows: number,
	options: FrameLayoutOptions = {},
): FrameLayout {
	// Pi also inserts panel spacing above its footer and quota widget.
	const reserved = Math.min(RESERVED_ROWS, Math.max(4, Math.floor(terminalRows / 2)));
	const available = terminalRows - reserved;
	const compact =
		options.density === "compact" || available - headerRows - FRAME_ROWS < MIN_BODY_ROWS;
	const bodyRows = Math.max(
		1,
		available - (compact ? COMPACT_FRAME_ROWS : headerRows + FRAME_ROWS),
	);
	const cap = options.maxBodyRows ?? 0;
	return {
		bodyRows: cap > 0 ? Math.max(1, Math.min(bodyRows, Math.floor(cap))) : bodyRows,
		compact,
	};
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
		Math.min(lastCrumb, width - rightWidth - 5),
		width - rightWidth - 5 - (center ? centerWidth + 2 : 0),
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

/** Fit prioritized hints, abbreviating essential actions before dropping any. */
export function fitHint(
	theme: PanelTheme,
	items: readonly HintItem[],
	width: number,
	essential = false,
): string {
	const plain = (list: readonly HintItem[], separator: string) =>
		list.map((item) => (item.key ? `${item.key} ${item.action}` : item.action)).join(separator);
	let kept = items.filter((item) => item.key !== "" || item.action !== "");
	let separator = " · ";
	if (essential && visibleWidth(plain(kept, separator)) > width) {
		const original = kept;
		for (const actionWidth of [4, 3, 2, 1]) {
			kept = original.map((item) => ({
				...item,
				action: truncateToWidth(item.action, item.action === "cancel" ? 6 : actionWidth, ""),
				priority: item.action === "cancel" ? -1 : item.priority,
			}));
			separator = " ";
			if (visibleWidth(plain(kept, separator)) <= width) break;
		}
	}
	while (kept.length > 1 && visibleWidth(plain(kept, separator)) > width) {
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
		.join(theme.fg("dim", separator));
}

/** Everything a panel contributes; the frame adds rules and clips the body to its viewport. */
export interface FrameSpec {
	readonly crumbs: readonly string[];
	/** Right end of the top rule, already themed. */
	readonly state?: string;
	/** Persistent top-rule action, already themed. */
	readonly affordance?: string;
	readonly header: readonly string[];
	readonly body: readonly string[];
	readonly bodyRows: number;
	readonly compact?: boolean;
	/** Hidden rows above and below the visible body. */
	readonly above?: number;
	readonly below?: number;
	readonly description: string;
	readonly footer: string;
}

/** Render the visible content without padding; every line fits `width`. */
export function drawFrame(theme: PanelTheme, width: number, spec: FrameSpec): string[] {
	const w = Math.max(1, width);
	const above = spec.above ?? 0;
	const below = spec.below ?? 0;
	const body = spec.body.slice(0, spec.bodyRows);
	const overflow = spec.compact
		? `${above > 0 ? `↑${above}` : ""}${below > 0 ? `↓${below}` : ""}`
		: above > 0
			? `↑ ${above} more`
			: "";
	let state = spec.state ?? "";
	const compactOverflow = spec.compact && overflow ? theme.fg("dim", overflow) : "";
	if (spec.affordance) {
		const lastCrumb = spec.crumbs.at(-1) ?? "";
		const overflowWidth = Math.max(
			0,
			w - visibleWidth(lastCrumb) - visibleWidth(spec.affordance) - 11,
		);
		const suffix = [truncateToWidth(compactOverflow, overflowWidth, "…"), spec.affordance]
			.filter((part) => visibleWidth(part) > 0)
			.join(" ");
		const stateWidth = Math.max(0, w - visibleWidth(lastCrumb) - visibleWidth(suffix) - 10);
		state = truncateToWidth(state, stateWidth, "…");
		state = [state, suffix].filter((part) => visibleWidth(part) > 0).join(" ");
	} else if (compactOverflow) {
		const lastCrumb = spec.crumbs.at(-1) ?? "";
		const stateWidth = Math.max(0, w - visibleWidth(lastCrumb) - visibleWidth(overflow) - 11);
		state = truncateToWidth(state, stateWidth, "…");
		state = `${state}${visibleWidth(state) > 0 ? " " : ""}${compactOverflow}`;
	}
	const top = rule(
		theme,
		w,
		{
			crumbs: spec.crumbs,
			center: !spec.compact && overflow ? theme.fg("dim", overflow) : "",
			right: state,
		},
		"borderAccent",
	);
	const lines = spec.compact
		? [top, ...body, ` ${spec.footer}`, rule(theme, w, {}, "borderAccent")]
		: [
				top,
				...spec.header.map((line) => ` ${line}`),
				...body,
				rule(theme, w, { center: below > 0 ? theme.fg("dim", `↓ ${below} more`) : "" }, "border"),
				` ${spec.description}`,
				` ${spec.footer}`,
				rule(theme, w, {}, "borderAccent"),
			];
	return lines.map((line) => truncateToWidth(line, w, "…"));
}
