/**
 * Host terminal-UI kit: the text, key and view helpers our panels and lines need. Pi and
 * oh-my-pi ship different TUI packages (oh-my-pi refuses to load any module that imports Pi's
 * `@earendil-works/pi-tui`), so each host entry installs its own kit before the extension runs
 * and every other module imports only this one.
 */

/** A concrete color, structurally equal to pi-tui's `Color`. */
export type Color =
	| { readonly kind: "indexed"; readonly index: number }
	| { readonly kind: "rgb"; readonly r: number; readonly g: number; readonly b: number }
	| { readonly kind: "oklch"; readonly l: number; readonly c: number; readonly h: number };

/** A view drawn as rows; both hosts accept it from `ctx.ui.custom`, widgets, footers and renderers. */
export interface Component {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate(): void;
}

/** A view that is told when it holds keyboard focus. */
export interface Focusable {
	focused: boolean;
}

/** One slash-command argument completion. */
export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

/** Host keybinding ids our panels answer to; both hosts define every one of them. */
export type Keybinding =
	| "tui.editor.cursorLeft"
	| "tui.editor.cursorRight"
	| "tui.editor.pageDown"
	| "tui.editor.pageUp"
	| "tui.input.tab"
	| "tui.select.cancel"
	| "tui.select.confirm"
	| "tui.select.down"
	| "tui.select.pageDown"
	| "tui.select.pageUp"
	| "tui.select.up";

/** The user's keybindings, matched against raw terminal input. */
export interface KeyMap {
	matches(data: string, id: Keybinding): boolean;
	/** Bound chords, primary first; empty when unbound. */
	getKeys(id: Keybinding): readonly string[];
	/** Whether any host keybinding, ours or not, is bound to the chord `data` presses. */
	claims(data: string): boolean;
}

/** What a view needs from the host TUI: a repaint and the terminal height. */
export interface UiHost {
	requestRender(): void;
	rows(): number;
}

/** A single-line text field. */
export interface LineInput extends Component, Focusable {
	getValue(): string;
	setValue(value: string): void;
	handleInput(data: string): void;
}

/** Options of {@link createInput}. */
export interface LineInputOptions {
	prompt: string;
	placeholder: string;
}

/** The helpers one host provides. */
export interface TuiKit {
	visibleWidth(text: string): number;
	truncateToWidth(text: string, width: number, ellipsis: string, pad: boolean): string;
	wrapTextWithAnsi(text: string, width: number): string[];
	sliceByColumn(text: string, start: number, length: number): string;
	stripTerminalSequences(text: string): string;
	matchesKey(data: string, key: string): boolean;
	/** The printable text of a kitty-protocol key sequence, else undefined. */
	decodeKittyPrintable(data: string): string | undefined;
	createInput(options: LineInputOptions): LineInput;
	/** Adapts the keybindings a host hands to `ctx.ui.custom`. */
	keyMap(host: unknown): KeyMap;
	/** Adapts the TUI handle a host hands to `ctx.ui.custom`, widget and footer factories. */
	uiHost(host: unknown): UiHost;
	/** OKLCH mixing, when the host has it. */
	readonly mixColors: ((first: Color, second: Color, amount: number) => Color) | undefined;
	/** The host's color parser, when it has one. */
	readonly parseColor: ((value: string) => Color | undefined) | undefined;
	/** The host's `setFooter` hands over its footer data, so the extension can own the footer. */
	readonly ownFooter: boolean;
}

let installed: TuiKit | undefined;

/** Makes `kit` the active kit; the host entry calls this before anything renders. */
export function installTuiKit(kit: TuiKit): void {
	installed = kit;
}

/** The active kit. */
export function tuiKit(): TuiKit {
	if (installed) return installed;
	throw new Error(
		"pi-auth-plus: no terminal UI kit installed. Load the extension through src/index.ts (Pi) or src/omp.ts (oh-my-pi).",
	);
}

export function visibleWidth(text: string): number {
	return tuiKit().visibleWidth(text);
}

/** Cuts `text` to `width` cells; the ellipsis counts toward the width, `pad` fills to it. */
export function truncateToWidth(
	text: string,
	width: number,
	ellipsis = "...",
	pad = false,
): string {
	return tuiKit().truncateToWidth(text, width, ellipsis, pad);
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
	return tuiKit().wrapTextWithAnsi(text, width);
}

/** `length` cells of styled text from column `start`; a wide grapheme straddling an edge is dropped. */
export function sliceByColumn(text: string, start: number, length: number): string {
	return tuiKit().sliceByColumn(text, start, length);
}

export function stripTerminalSequences(text: string): string {
	return tuiKit().stripTerminalSequences(text);
}

/** Whether raw input `data` is the chord `key` (`"ctrl+s"`, `"shift+tab"`, …). */
export function matchesKey(data: string, key: string): boolean {
	return tuiKit().matchesKey(data, key);
}

export function decodeKittyPrintable(data: string): string | undefined {
	return tuiKit().decodeKittyPrintable(data);
}

export function createInput(options: LineInputOptions): LineInput {
	return tuiKit().createInput(options);
}

export function keyMap(host: unknown): KeyMap {
	return tuiKit().keyMap(host);
}

export function uiHost(host: unknown): UiHost {
	return tuiKit().uiHost(host);
}

/** A plain text block, wrapped to the width. */
export function textRows(text: string): Component {
	return {
		render: (width) => text.split("\n").flatMap((line) => wrapTextWithAnsi(line, width)),
		invalidate: () => {},
	};
}
