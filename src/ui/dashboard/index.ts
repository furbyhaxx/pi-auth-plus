/** The `/auth` dashboard panel: one frame, a tab row, and the active tab's body. */
import {
	type KeybindingsManager,
	matchesKey,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	drawFrame,
	type FrameLayoutOptions,
	fitHint,
	type HintItem,
	layoutFor,
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

const HELP_KEYS = [
	{ key: "f1", input: "\x1bOP", label: "F1" },
	{ key: "f2", input: "\x1bOQ", label: "F2" },
	{ key: "f3", input: "\x1bOR", label: "F3" },
	{ key: "f4", input: "\x1bOS", label: "F4" },
	{ key: "f5", input: "\x1b[15~", label: "F5" },
	{ key: "f6", input: "\x1b[17~", label: "F6" },
	{ key: "f7", input: "\x1b[18~", label: "F7" },
	{ key: "f8", input: "\x1b[19~", label: "F8" },
	{ key: "f9", input: "\x1b[20~", label: "F9" },
	{ key: "f10", input: "\x1b[21~", label: "F10" },
	{ key: "f11", input: "\x1b[23~", label: "F11" },
	{ key: "f12", input: "\x1b[24~", label: "F12" },
	{ key: "alt+?", input: "\x1b?", label: "alt+?" },
] as const;
const HELP_SCROLL_KEYS = [
	{ down: "j", up: "k" },
	{ down: "n", up: "p" },
	{ down: "f", up: "b" },
	{ down: "d", up: "u" },
] as const;

function isUnbound(keys: KeybindingsManager, input: string): boolean {
	return Object.values(keys.getResolvedBindings()).every((binding) => {
		const list = Array.isArray(binding) ? binding : [binding];
		return list.every((key) => key === undefined || !matchesKey(input, key));
	});
}

export class AuthDashboard extends FramePanel<DashboardResult> {
	#tab: TabId;
	#confirmation: DiscardConfirmation | undefined;
	#helpOpen = false;
	#helpOffset = 0;
	#helpMaxOffset = 0;
	#helpPageSize = 1;
	readonly #views: Record<TabId, TabView>;
	readonly #providerCount: number;
	readonly #factories: Readonly<Record<TabId, TabViewFactory>>;
	readonly #viewHost: TabViewHost;
	readonly #preferences: (() => FrameLayoutOptions) | undefined;

	constructor(
		host: PanelHost,
		theme: PanelTheme,
		keys: KeybindingsManager,
		onDone: (result: DashboardResult) => void,
		views: Readonly<Record<TabId, TabViewFactory>>,
		tab: TabId,
		providerCount: number,
		preferences?: () => FrameLayoutOptions,
	) {
		super(host, theme, keys, onDone);
		this.#preferences = preferences;
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

	#isSaving(): boolean {
		return TABS.some((tab) => this.#views[tab.id].isSaving?.());
	}

	protected override finish(result: DashboardResult): void {
		if (this.isClosed || this.#confirmation || this.#isSaving()) return;
		if (!TABS.some((tab) => this.#views[tab.id].hasDrafts?.())) {
			super.finish(result);
			return;
		}
		this.#confirmation = { kind: "all", result };
		this.refresh();
	}

	#confirmDiscard(discard: () => void): void {
		if (this.isClosed || this.#confirmation || this.#isSaving()) return;
		this.#confirmation = { kind: "local", discard };
		this.refresh();
	}

	#helpKey(): (typeof HELP_KEYS)[number] | undefined {
		return HELP_KEYS.find(({ input }) => isUnbound(this.keys, input));
	}

	#helpScrollKeys(): (typeof HELP_SCROLL_KEYS)[number] | undefined {
		return HELP_SCROLL_KEYS.find(
			({ down, up }) => isUnbound(this.keys, down) && isUnbound(this.keys, up),
		);
	}

	#renderHelp(
		width: number,
		bodyRows: number,
		description: string,
		feedback: readonly string[],
		hints: readonly HintItem[],
	): string[] {
		const helpKey = this.#helpKey();
		const scrollKeys = this.#helpScrollKeys();
		const hintText = (item: HintItem) =>
			item.key
				? `${this.theme.fg("dim", item.key)} ${this.theme.fg("muted", item.action)}`
				: this.theme.fg("muted", item.action);
		const content = [
			this.theme.bold("Description"),
			description,
			...(feedback.length ? [this.theme.bold("Feedback"), ...feedback] : []),
			this.theme.bold("Keys"),
			...hints.map(hintText),
		];
		const lines = content.flatMap((text) =>
			wrapTextWithAnsi(text, Math.max(1, width - 1)).map((line) => ` ${line}`),
		);
		this.#helpPageSize = Math.max(1, bodyRows);
		this.#helpMaxOffset = Math.max(0, lines.length - bodyRows);
		this.#helpOffset = Math.min(this.#helpOffset, this.#helpMaxOffset);
		const scroll = scrollKeys
			? `${scrollKeys.down}/${scrollKeys.up}`
			: this.binding("tui.select.down") || this.binding("tui.select.pageDown");
		return drawFrame(this.theme, width, {
			crumbs: ["Auth", "Help"],
			body: lines.slice(this.#helpOffset, this.#helpOffset + bodyRows),
			bodyRows,
			compact: true,
			header: [],
			above: this.#helpOffset,
			below: Math.max(0, lines.length - this.#helpOffset - bodyRows),
			description: "",
			footer: fitHint(
				this.theme,
				[
					{ key: scroll, action: "scroll", priority: 0 },
					{ key: helpKey?.label ?? this.binding("tui.select.cancel"), action: "back", priority: 0 },
				],
				width - 1,
				true,
			),
		});
	}

	render(width: number): string[] {
		const { bodyRows, compact } = layoutFor(this.host.terminal.rows, 1, this.#preferences?.());
		const spec = TABS.find((tab) => tab.id === this.#tab);
		const count = this.#providerCount;
		const helpKey = this.#helpKey();
		const affordance = helpKey ? this.theme.fg("dim", `${helpKey.label} help`) : "";
		if (this.#confirmation) {
			const discard = { key: this.binding("tui.select.confirm"), action: "discard", priority: 0 };
			const keep = { key: this.binding("tui.select.cancel"), action: "keep", priority: 0 };
			const prompt = this.#isSaving()
				? "Saving; wait."
				: this.#confirmation.kind === "all"
					? "Discard all & exit?"
					: "Discard this draft?";
			if (this.#helpOpen)
				return this.#renderHelp(
					width,
					bodyRows,
					this.theme.fg("warning", prompt),
					[],
					[discard, keep],
				);
			const combined = fitHint(this.theme, [discard, keep], width - 1, true);
			const split =
				compact &&
				bodyRows > 1 &&
				((discard.key !== "" && !combined.includes(discard.key)) ||
					!combined.includes(discard.action.slice(0, 4)));
			return drawFrame(this.theme, width, {
				crumbs: ["Auth", spec?.label ?? ""],
				state: this.theme.fg("dim", `${count} provider${count === 1 ? "" : "s"}`),
				affordance,
				header: [tabBar(this.theme, this.#tab, width - 1)],
				body: [
					this.theme.fg("warning", ` ${prompt}`),
					...(split ? [` ${fitHint(this.theme, [discard], width - 1)}`] : []),
				],
				bodyRows,
				compact,
				description: fitHint(this.theme, [discard], width - 1),
				footer: compact && !split ? combined : fitHint(this.theme, [keep], width - 1),
			});
		}
		const body = this.#views[this.#tab].render(width, bodyRows);
		const tabHints = this.#helpOpen ? (body.fullHints ?? body.hints) : body.hints;
		const hints: HintItem[] = body.modal
			? [...tabHints]
			: [
					{ key: this.binding("tui.input.tab"), action: "switch", priority: 1 },
					...tabHints,
					{ key: this.binding("tui.select.cancel"), action: "close", priority: 0 },
				];
		const description = body.description ?? this.theme.fg("muted", spec?.description ?? "");
		if (this.#helpOpen)
			return this.#renderHelp(
				width,
				bodyRows,
				body.fullDescription ?? description,
				body.fullFeedback ?? [],
				hints,
			);
		return drawFrame(this.theme, width, {
			crumbs: ["Auth", spec?.label ?? ""],
			state: body.state ?? this.theme.fg("dim", `${count} provider${count === 1 ? "" : "s"}`),
			affordance,
			header: [tabBar(this.theme, this.#tab, width - 1)],
			body: body.lines,
			bodyRows,
			compact,
			above: body.above,
			below: body.below,
			description,
			footer: fitHint(this.theme, hints, width - 1, body.modal ?? false),
		});
	}

	#navigate(next: TabId): void {
		if (this.isClosed || this.#confirmation || next === this.#tab || this.#isSaving()) return;
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
		const helpKey = this.#helpKey();
		if (helpKey && matchesKey(data, helpKey.key)) {
			this.#helpOpen = !this.#helpOpen;
			this.#helpOffset = 0;
			this.refresh();
			return;
		}
		if (this.#helpOpen) {
			if (keys.matches(data, "tui.select.cancel") || matchesKey(data, "ctrl+c")) {
				this.#helpOpen = false;
			} else {
				const scrollKeys = this.#helpScrollKeys();
				const up =
					keys.matches(data, "tui.select.up") ||
					(scrollKeys !== undefined && matchesKey(data, scrollKeys.up));
				const down =
					keys.matches(data, "tui.select.down") ||
					(scrollKeys !== undefined && matchesKey(data, scrollKeys.down));
				const pageUp =
					keys.matches(data, "tui.select.pageUp") || keys.matches(data, "tui.editor.pageUp");
				const pageDown =
					keys.matches(data, "tui.select.pageDown") || keys.matches(data, "tui.editor.pageDown");
				const step = pageUp || pageDown ? this.#helpPageSize : 1;
				if (up || down || pageUp || pageDown)
					this.#helpOffset = Math.max(
						0,
						Math.min(this.#helpMaxOffset, this.#helpOffset + (up || pageUp ? -step : step)),
					);
			}
			this.refresh();
			return;
		}
		const confirmation = this.#confirmation;
		if (confirmation) {
			if (keys.matches(data, "tui.select.cancel")) {
				this.#confirmation = undefined;
				this.refresh();
			} else if (keys.matches(data, "tui.select.confirm")) {
				if (this.#isSaving()) {
					this.refresh();
					return;
				}
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
		this.#helpOpen = false;
		super.dispose();
		for (const spec of TABS) this.#views[spec.id].dispose?.();
	}
}
