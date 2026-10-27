/** The above/below-editor quota line component. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

/** Renders quota rows on each frame; data changes request renders from outside. */
export class QuotaLineWidget implements Component {
	private readonly theme: Theme;
	private readonly rows: (width: number, theme: Theme) => string[];

	constructor(theme: Theme, rows: (width: number, theme: Theme) => string[]) {
		this.theme = theme;
		this.rows = rows;
	}

	render(width: number): string[] {
		return this.rows(width, this.theme);
	}

	invalidate(): void {}
}
