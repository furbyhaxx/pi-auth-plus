/** The oh-my-pi 19.2 TUI modules the omp kit imports; the host resolves them to its bundled copy. */
declare module "@oh-my-pi/pi-tui/text/width" {
	export function visibleWidth(text: string): number;
	export function truncate(text: string, width: number, ellipsis?: string, pad?: boolean): string;
	export function wrap(text: string, width: number): string[];
	export function sliceCells(
		text: string,
		start: number,
		length: number,
		strict?: boolean,
	): { readonly text: string; readonly width: number };
}

declare module "@oh-my-pi/pi-tui/text/ansi" {
	export function stripEscapes(text: string): string;
}

declare module "@oh-my-pi/pi-tui/driver/input/keys" {
	export function decodeKey(
		seq: string,
		ctx: { readonly kitty: boolean; readonly backspaceIsCtrl: boolean },
	): {
		readonly id: string;
		readonly text?: string;
		readonly kind: "press" | "repeat" | "release";
		readonly raw: string;
	} | null;
}
