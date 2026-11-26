/**
 * oh-my-pi's terminal-UI kit: its width helpers and key decoder, plus our own line input.
 * Imported only by the oh-my-pi entry; oh-my-pi refuses Pi's pi-tui.
 */
import { decodeKey } from "@oh-my-pi/pi-tui/driver/input/keys";
import { stripEscapes } from "@oh-my-pi/pi-tui/text/ansi";
import { sliceCells, truncate, visibleWidth, wrap } from "@oh-my-pi/pi-tui/text/width";
import type { Keybinding, KeyMap, TuiKit, UiHost } from "./index.ts";
import { LineInputField } from "./line-input.ts";

const DECODE = { kitty: false, backspaceIsCtrl: false } as const;
const MODIFIERS = ["ctrl", "alt", "shift", "super"] as const;
const KEY_NAMES: Readonly<Record<string, string>> = {
	esc: "escape",
	return: "enter",
	pageup: "pageUp",
	pagedown: "pageDown",
};

interface OmpKeybindings {
	matchesId(id: string, action: string): boolean;
	keysFor(action: string): readonly string[];
	resolvedBindings(): Readonly<Record<string, string | readonly string[] | undefined>>;
}

interface OmpUi {
	requestRender(): void;
	size(): { readonly rows: number };
}

/** The pressed chord as oh-my-pi's canonical key id; releases and non-keys are undefined. */
function pressed(data: string): string | undefined {
	const key = decodeKey(data, DECODE);
	return key && key.kind !== "release" ? key.id : undefined;
}

/** A configured chord (`"Alt+Ctrl+X"`, `"esc"`) in oh-my-pi's canonical key id form. */
function canonical(chord: string): string {
	const plus = chord.endsWith("++");
	const parts = (plus ? chord.slice(0, -2) : chord).split("+");
	const last = plus ? "+" : (parts.pop() ?? "");
	const modifiers = new Set(parts.map((part) => part.toLowerCase()));
	const lower = last.toLowerCase();
	if (/^[A-Z]$/.test(last)) modifiers.add("shift");
	let id = "";
	for (const modifier of MODIFIERS) if (modifiers.has(modifier)) id += `${modifier}+`;
	return id + (KEY_NAMES[lower] ?? lower);
}

function isOmpKeybindings(value: unknown): value is OmpKeybindings {
	return (
		typeof value === "object" &&
		value !== null &&
		"matchesId" in value &&
		typeof value.matchesId === "function" &&
		"keysFor" in value &&
		typeof value.keysFor === "function" &&
		"resolvedBindings" in value &&
		typeof value.resolvedBindings === "function"
	);
}

function isOmpUi(value: unknown): value is OmpUi {
	return (
		typeof value === "object" &&
		value !== null &&
		"requestRender" in value &&
		typeof value.requestRender === "function" &&
		"size" in value &&
		typeof value.size === "function"
	);
}

function keyMap(host: unknown): KeyMap {
	if (!isOmpKeybindings(host))
		throw new Error("pi-auth-plus: oh-my-pi handed over no keybindings manager.");
	return {
		matches: (data: string, action: Keybinding) => {
			const id = pressed(data);
			return id !== undefined && host.matchesId(id, action);
		},
		getKeys: (action: Keybinding) => host.keysFor(action),
		claims: (data: string) => {
			const id = pressed(data);
			if (id === undefined) return false;
			return Object.values(host.resolvedBindings()).some((binding) =>
				(typeof binding === "string" ? [binding] : (binding ?? [])).some(
					(key) => canonical(key) === id,
				),
			);
		},
	};
}

function uiHost(host: unknown): UiHost {
	if (!isOmpUi(host)) throw new Error("pi-auth-plus: oh-my-pi handed over no UI host.");
	return { requestRender: () => host.requestRender(), rows: () => host.size().rows };
}

function decodeKittyPrintable(data: string): string | undefined {
	if (!data.startsWith("\x1b[")) return undefined;
	const key = decodeKey(data, DECODE);
	return key && key.kind !== "release" ? key.text : undefined;
}

function printable(data: string): string | undefined {
	if (!data.startsWith("\x1b")) return data;
	return decodeKittyPrintable(data);
}

/** The kit the oh-my-pi entry installs. */
export const ompTuiKit: TuiKit = {
	visibleWidth,
	truncateToWidth: truncate,
	wrapTextWithAnsi: wrap,
	sliceByColumn: (text, start, length) => sliceCells(text, start, length, true).text,
	stripTerminalSequences: stripEscapes,
	matchesKey: (data, key) => pressed(data) === canonical(key),
	decodeKittyPrintable,
	createInput: (options) => new LineInputField(options, printable),
	keyMap,
	uiHost,
	mixColors: undefined,
	parseColor: undefined,
	ownFooter: false,
};
