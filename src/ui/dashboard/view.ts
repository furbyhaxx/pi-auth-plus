/** The contract between the `/auth` dashboard frame and one tab's body. */
import type { Keybinding, KeybindingsManager } from "@earendil-works/pi-tui";
import type { HintItem, PanelTheme } from "../frame/index.ts";
import type { TabId } from "./tabs.ts";

/** A follow-up the command runs after the panel closes, because it needs a Pi dialog. */
export type DashboardResult =
	| { readonly editSetting: string }
	| { readonly reset: string }
	| undefined;

export interface TabViewHost {
	readonly theme: PanelTheme;
	readonly keys: KeybindingsManager;
	binding(id: Keybinding): string;
	/** Re-render the panel; a no-op once it is closed. */
	refresh(): void;
	/** Close the dashboard with a follow-up action. */
	finish(result: DashboardResult): void;
	/** Confirm a local discard without closing the dashboard or discarding other tabs. */
	confirmDiscard?(discard: () => void): void;
	/** Switch tabs without discarding drafts. */
	navigate?(tab: TabId): void;
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
	/** Unclipped, themed description for help; sanitize external text before styling it. */
	readonly fullDescription?: string;
	/** Unclipped, themed feedback for help; sanitize external text before styling it. */
	readonly fullFeedback?: readonly string[];
	/** Complete current plain-text hints when the normal body filters them. */
	readonly fullHints?: readonly HintItem[];
}

export interface TabView {
	render(width: number, bodyRows: number): TabBody;
	/** True when the tab consumed the key; it then sees Tab, arrows and cancel first. */
	handleInput(data: string): boolean;
	/** True while this tab or one of its subviews is saving. */
	isSaving?(): boolean;
	/** True when this tab or one of its subviews has unsaved changes. */
	hasDrafts?(): boolean;
	/** Discard this tab's unsaved changes, including drafts in subviews. */
	discardDrafts?(): void;
	dispose?(): void;
}

export type TabViewFactory = (host: TabViewHost) => TabView;
