/**
 * Single-line text field for hosts without pi-tui's `Input`: editing chords, bracketed paste and
 * horizontal scrolling around a reverse-video cursor, measured with the active kit.
 */
import {
	type LineInput,
	type LineInputOptions,
	matchesKey,
	sliceByColumn,
	truncateToWidth,
	visibleWidth,
} from "./index.ts";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const LINE_BREAKS = /[\r\n]+/g;
const WORD = /[\p{L}\p{N}_]/u;
const segmenter = new Intl.Segmenter();

function hasControl(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

function cursorCell(text: string): string {
	return `\x1b[7m${text}\x1b[27m`;
}

/** Decodes printable input; a key the field does not edit with yields undefined. */
export type PrintableDecoder = (data: string) => string | undefined;

export class LineInputField implements LineInput {
	focused = false;
	readonly #prompt: string;
	readonly #placeholder: string;
	readonly #printable: PrintableDecoder;
	#value = "";
	#cursor = 0;
	#paste: string | undefined;

	constructor(options: LineInputOptions, printable: PrintableDecoder) {
		this.#prompt = options.prompt;
		this.#placeholder = options.placeholder;
		this.#printable = printable;
	}

	getValue(): string {
		return this.#value;
	}

	setValue(value: string): void {
		this.#value = value;
		this.#cursor = Math.min(this.#cursor, value.length);
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (this.#paste !== undefined || data.includes(PASTE_START)) {
			this.#takePaste(data);
			return;
		}
		if (matchesKey(data, "backspace") || matchesKey(data, "ctrl+h")) this.#deleteBack();
		else if (matchesKey(data, "delete") || matchesKey(data, "ctrl+d")) this.#deleteForward();
		else if (matchesKey(data, "left") || matchesKey(data, "ctrl+b")) this.#cursor = this.#prev();
		else if (matchesKey(data, "right") || matchesKey(data, "ctrl+f")) this.#cursor = this.#next();
		else if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) this.#cursor = 0;
		else if (matchesKey(data, "end") || matchesKey(data, "ctrl+e"))
			this.#cursor = this.#value.length;
		else if (matchesKey(data, "ctrl+left") || matchesKey(data, "alt+left"))
			this.#cursor = this.#wordStart();
		else if (matchesKey(data, "ctrl+right") || matchesKey(data, "alt+right"))
			this.#cursor = this.#wordEnd();
		else if (matchesKey(data, "ctrl+w") || matchesKey(data, "alt+backspace"))
			this.#remove(this.#wordStart(), this.#cursor);
		else if (matchesKey(data, "ctrl+u")) this.#remove(0, this.#cursor);
		else if (matchesKey(data, "ctrl+k")) this.#remove(this.#cursor, this.#value.length);
		else {
			const text = this.#printable(data);
			if (text !== undefined && !hasControl(text)) this.#insert(text);
		}
	}

	render(width: number): string[] {
		const available = width - visibleWidth(this.#prompt);
		if (available <= 0) return [truncateToWidth(this.#prompt, width, "")];
		if (this.#value.length === 0 && this.#placeholder) {
			const placeholder = truncateToWidth(this.#placeholder, available, "");
			const first = segmenter.segment(placeholder)[Symbol.iterator]().next().value?.segment ?? " ";
			const shown = cursorCell(first) + placeholder.slice(first.length);
			return [this.#prompt + shown + " ".repeat(Math.max(0, available - visibleWidth(shown)))];
		}
		const total = visibleWidth(this.#value);
		const cursorColumn = visibleWidth(this.#value.slice(0, this.#cursor));
		const room = this.#cursor === this.#value.length ? available - 1 : available;
		let start = 0;
		if (total >= available && room > 0) {
			const half = Math.floor(room / 2);
			if (cursorColumn > total - half) start = Math.max(0, total - room);
			else if (cursorColumn >= half) start = cursorColumn - half;
		}
		const before = sliceByColumn(this.#value, start, Math.max(0, cursorColumn - start));
		const after = this.#value.slice(this.#cursor);
		const at = segmenter.segment(after)[Symbol.iterator]().next().value?.segment ?? "";
		const tail = truncateToWidth(
			after.slice(at.length),
			Math.max(0, available - visibleWidth(before) - Math.max(1, visibleWidth(at))),
			"",
		);
		const line = before + cursorCell(at || " ") + tail;
		return [this.#prompt + line + " ".repeat(Math.max(0, available - visibleWidth(line)))];
	}

	#takePaste(data: string): void {
		const buffer = (this.#paste ?? "") + data.replace(PASTE_START, "");
		const end = buffer.indexOf(PASTE_END);
		if (end === -1) {
			this.#paste = buffer;
			return;
		}
		this.#paste = undefined;
		this.#insert(buffer.slice(0, end).replace(LINE_BREAKS, ""));
		const rest = buffer.slice(end + PASTE_END.length);
		if (rest) this.handleInput(rest);
	}

	#insert(text: string): void {
		this.#value = this.#value.slice(0, this.#cursor) + text + this.#value.slice(this.#cursor);
		this.#cursor += text.length;
	}

	#remove(from: number, to: number): void {
		if (to <= from) return;
		this.#value = this.#value.slice(0, from) + this.#value.slice(to);
		this.#cursor = from;
	}

	#deleteBack(): void {
		this.#remove(this.#prev(), this.#cursor);
	}

	#deleteForward(): void {
		const end = this.#next();
		this.#remove(this.#cursor, end);
		this.#cursor = Math.min(this.#cursor, this.#value.length);
	}

	#prev(): number {
		let last = 0;
		for (const { index } of segmenter.segment(this.#value.slice(0, this.#cursor))) last = index;
		return last;
	}

	#next(): number {
		const first = segmenter
			.segment(this.#value.slice(this.#cursor))
			[Symbol.iterator]()
			.next().value;
		return first ? this.#cursor + first.segment.length : this.#cursor;
	}

	#wordStart(): number {
		let index = this.#cursor;
		while (index > 0 && !WORD.test(this.#value[index - 1] ?? "")) index--;
		while (index > 0 && WORD.test(this.#value[index - 1] ?? "")) index--;
		return index;
	}

	#wordEnd(): number {
		let index = this.#cursor;
		while (index < this.#value.length && !WORD.test(this.#value[index] ?? "")) index++;
		while (index < this.#value.length && WORD.test(this.#value[index] ?? "")) index++;
		return index;
	}
}
