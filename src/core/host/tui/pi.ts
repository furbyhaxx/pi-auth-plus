/** Pi's terminal-UI kit: pi-tui's own helpers and components. Imported only by the Pi entry. */
import * as tui from "@earendil-works/pi-tui";
import type { Color, KeyMap, LineInput, TuiKit, UiHost } from "./index.ts";

/** pi-tui's key helpers parse any chord string at runtime; method syntax widens their key types. */
interface ChordMatcher {
	matchesKey(data: string, key: string): boolean;
}

interface PiKeybindings {
	matches(data: string, id: string): boolean;
	getKeys(id: string): readonly string[];
	getResolvedBindings(): Readonly<Record<string, string | readonly string[] | undefined>>;
}

interface PiTui {
	requestRender(): void;
	terminal: { rows: number };
}

const chords: ChordMatcher = tui;

function isPiKeybindings(value: unknown): value is PiKeybindings {
	return (
		typeof value === "object" &&
		value !== null &&
		"matches" in value &&
		typeof value.matches === "function" &&
		"getKeys" in value &&
		typeof value.getKeys === "function" &&
		"getResolvedBindings" in value &&
		typeof value.getResolvedBindings === "function"
	);
}

function isPiTui(value: unknown): value is PiTui {
	return (
		typeof value === "object" &&
		value !== null &&
		"requestRender" in value &&
		typeof value.requestRender === "function" &&
		"terminal" in value &&
		typeof value.terminal === "object" &&
		value.terminal !== null
	);
}

function keyMap(host: unknown): KeyMap {
	if (!isPiKeybindings(host))
		throw new Error("pi-auth-plus: Pi handed over no keybindings manager.");
	return {
		matches: (data, id) => host.matches(data, id),
		getKeys: (id) => host.getKeys(id),
		claims: (data) =>
			Object.values(host.getResolvedBindings()).some((binding) =>
				(typeof binding === "string" ? [binding] : (binding ?? [])).some((key) =>
					chords.matchesKey(data, key),
				),
			),
	};
}

function uiHost(host: unknown): UiHost {
	if (!isPiTui(host)) throw new Error("pi-auth-plus: Pi handed over no TUI handle.");
	return { requestRender: () => host.requestRender(), rows: () => host.terminal.rows };
}

const parseColor: ((value: string) => Color | undefined) | undefined =
	typeof tui.parseColor === "function" ? tui.parseColor : undefined;
const mixColors: ((first: Color, second: Color, amount: number) => Color) | undefined =
	typeof tui.mixColors === "function" ? tui.mixColors : undefined;

/** The kit the Pi entry installs. */
export const piTuiKit: TuiKit = {
	visibleWidth: tui.visibleWidth,
	truncateToWidth: tui.truncateToWidth,
	wrapTextWithAnsi: tui.wrapTextWithAnsi,
	sliceByColumn: (text, start, length) => tui.sliceByColumn(text, start, length, true),
	stripTerminalSequences: tui.stripTerminalSequences,
	matchesKey: (data, key) => chords.matchesKey(data, key),
	decodeKittyPrintable: tui.decodeKittyPrintable,
	createInput: (options): LineInput => new tui.Input(options),
	keyMap,
	uiHost,
	mixColors,
	parseColor,
	ownFooter: true,
};
