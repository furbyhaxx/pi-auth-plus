/** The `/auth` dashboard panel: one frame, a tab row, and the active tab's body. */
import { type KeybindingsManager, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import {
	bodyRowsFor,
	drawFrame,
	fitHint,
	type HintItem,
	type PanelHost,
	type PanelTheme,
} from "../frame/index.ts";
import { FramePanel } from "../panel/index.ts";
import { RowsView } from "./rows.ts";
import { type DashboardModel, TABS, type TabId, tabContent } from "./tabs.ts";
import type { DashboardResult, TabView, TabViewFactory, TabViewHost } from "./view.ts";

export * from "./rows.ts";
export * from "./tabs.ts";
export * from "./view.ts";

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

/** Static row views for every tab; the command replaces live tabs. */
export function staticViews(model: DashboardModel): Record<TabId, TabViewFactory> {
	const views = {} as Record<TabId, TabViewFactory>;
	for (const tab of TABS) views[tab.id] = (host) => new RowsView(host, tabContent(tab.id, model));
	return views;
}

type DiscardConfirmation =
	| { readonly kind: "all"; readonly result: DashboardResult }
	| { readonly kind: "local"; readonly discard: () => void };

export class AuthDashboard extends FramePanel<DashboardResult> {
	#tab: TabId;
	#confirmation: DiscardConfirmation | undefined;
	readonly #views: Record<TabId, TabView>;
	readonly #providerCount: number;
	readonly #factories: Readonly<Record<TabId, TabViewFactory>>;
	readonly #viewHost: TabViewHost;

	constructor(
		host: PanelHost,
		theme: PanelTheme,
		keys: KeybindingsManager,
		onDone: (result: DashboardResult) => void,
		views: Readonly<Record<TabId, TabViewFactory>>,
		tab: TabId,
		providerCount: number,
	) {
		super(host, theme, keys, onDone);
		this.#tab = tab;
		this.#factories = views;
		this.#providerCount = providerCount;
		const viewHost: TabViewHost = {
			theme,
			keys,
			binding: (id) => this.binding(id),
			refresh: () => this.refresh(),
			finish: (result) => this.finish(result),
			confirmDiscard: (discard) => this.#confirmDiscard(discard),
			navigate: (next) => this.#navigate(next),
		};
		this.#viewHost = viewHost;
		this.#views = {} as Record<TabId, TabView>;
		for (const spec of TABS) this.#views[spec.id] = views[spec.id](viewHost);
	}

	get tab(): TabId {
		return this.#tab;
	}

	protected override finish(result: DashboardResult): void {
		if (this.isClosed || this.#confirmation) return;
		if (!TABS.some((tab) => this.#views[tab.id].hasDrafts?.())) {
			super.finish(result);
			return;
		}
		this.#confirmation = { kind: "all", result };
		this.refresh();
	}

	#confirmDiscard(discard: () => void): void {
		if (this.isClosed || this.#confirmation) return;
		this.#confirmation = { kind: "local", discard };
		this.refresh();
	}

	render(width: number): string[] {
		const bodyRows = bodyRowsFor(this.host.terminal.rows, 1);
		const spec = TABS.find((tab) => tab.id === this.#tab);
		const count = this.#providerCount;
		if (this.#confirmation) {
			return drawFrame(this.theme, width, {
				crumbs: ["Auth", spec?.label ?? ""],
				state: this.theme.fg("dim", `${count} provider${count === 1 ? "" : "s"}`),
				header: [tabBar(this.theme, this.#tab, width - 1)],
				body: [
					this.theme.fg(
						"warning",
						this.#confirmation.kind === "all" ? " Discard all & exit?" : " Discard this draft?",
					),
				],
				bodyRows,
				description: fitHint(
					this.theme,
					[{ key: this.binding("tui.select.confirm"), action: "discard", priority: 0 }],
					width - 1,
				),
				footer: fitHint(
					this.theme,
					[{ key: this.binding("tui.select.cancel"), action: "keep", priority: 0 }],
					width - 1,
				),
			});
		}
		const body = this.#views[this.#tab].render(width, bodyRows);
		const hints: HintItem[] = body.modal
			? [...body.hints]
			: [
					{ key: this.binding("tui.input.tab"), action: "switch", priority: 1 },
					...body.hints,
					{ key: this.binding("tui.select.cancel"), action: "close", priority: 0 },
				];
		return drawFrame(this.theme, width, {
			crumbs: ["Auth", spec?.label ?? ""],
			state: body.state ?? this.theme.fg("dim", `${count} provider${count === 1 ? "" : "s"}`),
			header: [tabBar(this.theme, this.#tab, width - 1)],
			body: body.lines,
			bodyRows,
			above: body.above,
			below: body.below,
			description: body.description ?? this.theme.fg("muted", spec?.description ?? ""),
			footer: fitHint(this.theme, hints, width - 1),
		});
	}

	#navigate(next: TabId): void {
		if (this.isClosed || this.#confirmation || next === this.#tab) return;
		if (this.#tab === "tokens" && !this.#views.tokens.hasDrafts?.()) {
			this.#views.tokens.dispose?.();
			this.#views.tokens = this.#factories.tokens(this.#viewHost);
		}
		this.#tab = next;
		this.refresh();
	}

	#switch(step: number): void {
		const index = TABS.findIndex((tab) => tab.id === this.#tab);
		const next = TABS[(index + step + TABS.length) % TABS.length];
		if (next) this.#navigate(next.id);
	}

	handleInput(data: string): void {
		if (this.isClosed) return;
		const keys = this.keys;
		const confirmation = this.#confirmation;
		if (confirmation) {
			if (keys.matches(data, "tui.select.cancel")) {
				this.#confirmation = undefined;
				this.refresh();
			} else if (keys.matches(data, "tui.select.confirm")) {
				if (confirmation.kind === "all") {
					for (const tab of TABS) this.#views[tab.id].discardDrafts?.();
					this.#confirmation = undefined;
					super.finish(confirmation.result);
				} else {
					this.#confirmation = undefined;
					confirmation.discard();
					this.refresh();
				}
			} else if (matchesKey(data, "ctrl+c")) {
				this.#confirmation = undefined;
				this.refresh();
			}
			return;
		}
		if (matchesKey(data, "ctrl+c")) {
			this.finish(undefined);
			return;
		}
		if (this.#views[this.#tab].handleInput(data)) {
			this.refresh();
			return;
		}
		if (keys.matches(data, "tui.select.cancel")) {
			this.finish(undefined);
			return;
		}
		if (matchesKey(data, "shift+tab") || keys.matches(data, "tui.editor.cursorLeft"))
			this.#switch(-1);
		else if (keys.matches(data, "tui.input.tab") || keys.matches(data, "tui.editor.cursorRight"))
			this.#switch(1);
		else return;
	}

	override dispose(): void {
		if (this.isClosed) return;
		this.#confirmation = undefined;
		super.dispose();
		for (const spec of TABS) this.#views[spec.id].dispose?.();
	}
}
