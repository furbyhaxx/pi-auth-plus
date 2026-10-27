/** The `/auth` dashboard panel: one frame, a tab row, and the active tab's rows. */
import { type KeybindingsManager, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import {
	bodyRowsFor,
	drawFrame,
	fitHint,
	type HintItem,
	type PanelHost,
	type PanelTheme,
	padTo,
} from "../frame/index.ts";
import { FramePanel } from "../panel/index.ts";
import { type DashboardModel, type Row, TABS, type TabId, tabContent } from "./tabs.ts";

export * from "./tabs.ts";

const GAP = 2;

/**
 * Tab row. Every tab has a marker column (`▸` when active), so color is not the only signal and
 * switching never shifts the row; below the full width only the active tab and its position show.
 */
export function tabBar(theme: PanelTheme, active: TabId, width: number): string {
	const index = TABS.findIndex((tab) => tab.id === active);
	const paint = (label: string, on: boolean) =>
		on ? theme.fg("accent", `▸${theme.bold(label)}`) : theme.fg("muted", ` ${label}`);
	for (const separator of ["  ", ""]) {
		const plain = TABS.map((tab) => ` ${tab.label}`).join(separator);
		if (visibleWidth(plain) <= width) {
			return TABS.map((tab) => paint(tab.label, tab.id === active)).join(separator);
		}
	}
	const label = TABS[index]?.label ?? "";
	return `${paint(label, true)} ${theme.fg("dim", `${index + 1}/${TABS.length}`)}`;
}

export class AuthDashboard extends FramePanel<void> {
	#tab: TabId;
	#offset = 0;
	readonly #model: DashboardModel;

	constructor(
		host: PanelHost,
		theme: PanelTheme,
		keys: KeybindingsManager,
		onDone: () => void,
		model: DashboardModel,
		tab: TabId,
	) {
		super(host, theme, keys, onDone);
		this.#model = model;
		this.#tab = tab;
	}

	get tab(): TabId {
		return this.#tab;
	}

	#bodyRows(): number {
		const wanted = Math.max(...TABS.map((tab) => tabContent(tab.id, this.#model).rows.length), 1);
		return bodyRowsFor(this.host.terminal.rows, 1, wanted);
	}

	#rowLines(rows: readonly Row[], width: number): string[] {
		const inner = Math.max(1, width - 1);
		const wantLabel = Math.max(...rows.map((row) => visibleWidth(row.label)));
		const labelWidth = Math.min(wantLabel, Math.max(8, Math.floor(inner * 0.4)));
		return rows.map(
			(row) =>
				` ${padTo(row.label, labelWidth)}${" ".repeat(GAP)}${this.theme.fg(row.tone, row.value)}`,
		);
	}

	render(width: number): string[] {
		const content = tabContent(this.#tab, this.#model);
		const bodyRows = this.#bodyRows();
		const lines =
			content.rows.length > 0
				? this.#rowLines(content.rows, width)
				: [` ${this.theme.fg("muted", content.empty)}`];
		const maxOffset = Math.max(0, lines.length - bodyRows);
		this.#offset = Math.min(this.#offset, maxOffset);
		const count = this.#model.providers.length;
		const hints: HintItem[] = [
			{ key: this.binding("tui.input.tab"), action: "switch", priority: 1 },
			...(maxOffset > 0
				? [
						{
							key: `${this.binding("tui.select.up")}${this.binding("tui.select.down")}`,
							action: "scroll",
							priority: 2,
						},
					]
				: []),
			{ key: this.binding("tui.select.cancel"), action: "close", priority: 0 },
		];
		const spec = TABS.find((tab) => tab.id === this.#tab);
		return drawFrame(this.theme, width, {
			crumbs: ["Auth", spec?.label ?? ""],
			state: this.theme.fg("dim", `${count} provider${count === 1 ? "" : "s"}`),
			header: [tabBar(this.theme, this.#tab, width - 1)],
			body: lines.slice(this.#offset, this.#offset + bodyRows),
			bodyRows,
			above: this.#offset,
			below: Math.max(0, lines.length - this.#offset - bodyRows),
			description: this.theme.fg("muted", spec?.description ?? ""),
			footer: fitHint(this.theme, hints, width - 1),
		});
	}

	#switch(step: number): void {
		const index = TABS.findIndex((tab) => tab.id === this.#tab);
		const next = TABS[(index + step + TABS.length) % TABS.length];
		if (!next) return;
		this.#tab = next.id;
		this.#offset = 0;
	}

	handleInput(data: string): void {
		const keys = this.keys;
		if (keys.matches(data, "tui.select.cancel")) {
			this.finish();
			return;
		}
		if (matchesKey(data, "shift+tab") || keys.matches(data, "tui.editor.cursorLeft"))
			this.#switch(-1);
		else if (keys.matches(data, "tui.input.tab") || keys.matches(data, "tui.editor.cursorRight")) {
			this.#switch(1);
		} else if (keys.matches(data, "tui.select.up")) this.#offset = Math.max(0, this.#offset - 1);
		else if (keys.matches(data, "tui.select.down")) this.#offset += 1;
		else return;
		this.refresh();
	}
}
