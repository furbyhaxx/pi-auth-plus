/** The contract between the `/auth` dashboard frame and one tab's body. */
import type { Keybinding, KeybindingsManager } from "@earendil-works/pi-tui";
import type { HintItem, PanelTheme } from "../frame/index.ts";

/** A follow-up the command runs after the panel closes, because it needs a Pi dialog. */
export type DashboardResult = { readonly editSetting: string } | undefined;

export interface TabViewHost {
	readonly theme: PanelTheme;
	readonly keys: KeybindingsManager;
	binding(id: Keybinding): string;
	/** Re-render the panel; a no-op once it is closed. */
	refresh(): void;
	/** Close the dashboard with a follow-up action. */
	finish(result: DashboardResult): void;
}

export interface TabBody {
	/** Exactly the visible rows, at most `bodyRows`; each fits `width`. */
	readonly lines: readonly string[];
	/** Hidden rows above and below the visible ones. */
	readonly above: number;
	readonly below: number;
	/** Tab-specific key hints; the dashboard adds switch and close unless `modal`. */
	readonly hints: readonly HintItem[];
	/** An inline input or prompt owns every key, so switch and close are not offered. */
	readonly modal?: boolean;
	/** Right end of the top rule, already themed; the provider count otherwise. */
	readonly state?: string;
	/** Replaces the tab description, e.g. with the selected setting's help, already themed. */
	readonly description?: string;
}

export interface TabView {
	/** Rows this tab would like; the dashboard keeps one height across tabs. */
	wantedRows(): number;
	render(width: number, bodyRows: number): TabBody;
	/** True when the tab consumed the key; it then sees Tab, arrows and cancel first. */
	handleInput(data: string): boolean;
	dispose?(): void;
}

export type TabViewFactory = (host: TabViewHost) => TabView;
