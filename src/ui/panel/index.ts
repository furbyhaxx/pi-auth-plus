/** Base for frame panels shown through `ctx.ui.custom`: focus, single-shot close, disposal. */
import type { Component, Focusable, Keybinding, KeybindingsManager } from "@earendil-works/pi-tui";
import { bindingLabel, type PanelHost, type PanelTheme } from "../frame/index.ts";

/** Async continuations check `isClosed` before touching the screen. */
export abstract class FramePanel<R> implements Component, Focusable {
	focused = false;
	protected readonly host: PanelHost;
	protected readonly theme: PanelTheme;
	protected readonly keys: KeybindingsManager;
	readonly #onDone: (result: R) => void;
	#closed = false;

	constructor(
		host: PanelHost,
		theme: PanelTheme,
		keys: KeybindingsManager,
		onDone: (result: R) => void,
	) {
		this.host = host;
		this.theme = theme;
		this.keys = keys;
		this.#onDone = onDone;
	}

	protected get isClosed(): boolean {
		return this.#closed;
	}

	protected refresh(): void {
		if (!this.#closed) this.host.requestRender();
	}

	/** Closes once; later calls are ignored. */
	protected finish(result: R): void {
		if (this.#closed) return;
		this.dispose();
		this.#onDone(result);
	}

	protected binding(id: Keybinding): string {
		return bindingLabel(this.keys, id);
	}

	abstract render(width: number): string[];
	abstract handleInput(data: string): void;

	invalidate(): void {}

	dispose(): void {
		this.#closed = true;
	}
}
