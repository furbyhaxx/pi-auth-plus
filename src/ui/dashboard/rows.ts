/** A read-only, scrollable list of label/value rows; the Providers and Tokens tabs use it. */
import { visibleWidth } from "@earendil-works/pi-tui";
import { padTo, sanitize } from "../frame/index.ts";
import type { Row, TabContent } from "./tabs.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

const GAP = 2;

export function rowLines(host: TabViewHost, rows: readonly Row[], width: number): string[] {
	const inner = Math.max(1, width - 1);
	const wantLabel = Math.max(...rows.map((row) => visibleWidth(row.label)));
	const labelWidth = Math.min(wantLabel, Math.max(8, Math.floor(inner * 0.4)));
	return rows.map(
		(row) =>
			` ${padTo(row.label, labelWidth)}${" ".repeat(GAP)}${host.theme.fg(row.tone, row.value)}`,
	);
}

export class RowsView implements TabView {
	readonly #host: TabViewHost;
	readonly #content: TabContent;
	#offset = 0;
	#maxOffset = 0;

	constructor(host: TabViewHost, content: TabContent) {
		this.#host = host;
		this.#content = content;
	}

	render(width: number, bodyRows: number): TabBody {
		const { theme } = this.#host;
		const lines =
			this.#content.rows.length > 0
				? rowLines(this.#host, this.#content.rows, width)
				: [` ${theme.fg("muted", this.#content.empty)}`];
		this.#maxOffset = Math.max(0, lines.length - bodyRows);
		this.#offset = Math.min(this.#offset, this.#maxOffset);
		const scroll = `${this.#host.binding("tui.select.up")}${this.#host.binding("tui.select.down")}`;
		const selected = this.#content.rows[this.#offset];
		const labelWidth =
			selected === undefined
				? 0
				: Math.min(
						Math.max(...this.#content.rows.map((row) => visibleWidth(row.label))),
						Math.max(8, Math.floor(Math.max(1, width - 1) * 0.4)),
					);
		const selectedLine = lines[this.#offset];
		const selectedClipped =
			selected !== undefined &&
			(visibleWidth(selected.label) > labelWidth ||
				(selectedLine !== undefined && visibleWidth(selectedLine) > width));
		return {
			lines: lines.slice(this.#offset, this.#offset + bodyRows),
			above: this.#offset,
			below: Math.max(0, lines.length - this.#offset - bodyRows),
			...(selectedClipped && selected
				? {
						fullDescription: `${sanitize(selected.label)}: ${theme.fg(selected.tone, sanitize(selected.value))}`,
					}
				: {}),
			hints: this.#maxOffset > 0 ? [{ key: scroll, action: "scroll", priority: 2 }] : [],
		};
	}

	handleInput(data: string): boolean {
		const { keys } = this.#host;
		if (keys.matches(data, "tui.select.up")) this.#offset = Math.max(0, this.#offset - 1);
		else if (keys.matches(data, "tui.select.down"))
			this.#offset = Math.min(this.#maxOffset, this.#offset + 1);
		else return false;
		return true;
	}
}
