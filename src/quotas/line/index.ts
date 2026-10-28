/** Mounts the quota line at the configured placement and re-renders it on quota changes. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { AppSettings } from "../../core/config/catalog.ts";
import type { Registry } from "../../core/registry/index.ts";
import type { TokenTracker } from "../../tokens/tracker/types.ts";
import type { QuotaEngine } from "../engine.ts";
import type { LineTheme } from "./format.ts";
import { createQuotaLineRenderer, limitQuotaRows, quotaLineConfig } from "./line.ts";
import { createFooterPlacement, type FooterPlacementContext } from "./placement.ts";
import { createQuotaStatusline } from "./statusline.ts";
import { compileLineTemplate } from "./template.ts";
import { QuotaLineWidget } from "./widget.ts";
import type { FooterRows } from "./workbench.ts";

const WIDGET_KEY = "pi-auth-plus-quotas";
const EDITOR_RESERVE_ROWS = 8;

/** UI surface the line mounts into. */
export type QuotaLineContext = FooterPlacementContext & {
	ui: FooterPlacementContext["ui"] & Pick<ExtensionContext["ui"], "setWidget">;
};

/** Session-scoped quota line. */
export interface QuotaLine {
	start(ctx: QuotaLineContext): void;
	stop(): void;
	/** Re-applies placement and redraws after a settings change. */
	settingsChanged(): void;
	/** Rows for an unsaved template at `width`, plus tokens it ignores. */
	preview(
		source: string,
		width: number,
		theme: LineTheme,
	): { rows: readonly string[]; unknown: readonly string[] };
}

/** Creates the line once per extension load; `start` binds it to a session. */
export function createQuotaLine(
	pi: Pick<ExtensionAPI, "events" | "getThinkingLevel">,
	deps: {
		readonly engine: QuotaEngine;
		readonly registry: Registry;
		readonly settings: () => AppSettings;
		readonly now: () => number;
		/** Replaces Pi's context percent in the fallback footer when it counts the current model. */
		readonly tokens?: TokenTracker;
	},
): QuotaLine {
	const resolve = (token: string) => deps.registry.resolve(token)?.provider.id;
	const render = createQuotaLineRenderer(resolve);
	let ctx: QuotaLineContext | undefined;
	let placement: string | undefined;
	let tui: TUI | undefined;
	let offChange: (() => void) | undefined;

	const rows: FooterRows = (width, theme, terminalRows) => {
		const settings = deps.settings();
		if (settings.get("quotas.linePlacement") === "off") return [];
		const config = quotaLineConfig(settings);
		const lines = render(width, theme, deps.engine.view(), config, deps.now());
		return limitQuotaRows(width, theme, lines, terminalRows - EDITOR_RESERVE_ROWS);
	};
	const statusline = createQuotaStatusline(pi, deps);
	const footer = createFooterPlacement(pi, rows, deps.tokens && (() => deps.tokens?.latest()), () =>
		statusline.owned(),
	);
	let offTokens: (() => void) | undefined;
	let offOwnership: (() => void) | undefined;

	function sync(): void {
		if (ctx?.mode !== "tui" || !ctx.hasUI) return;
		const desired = deps.settings().get("quotas.linePlacement");
		if (desired === placement) {
			tui?.requestRender();
			footer.requestRender();
			statusline.invalidate();
			return;
		}
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		tui = undefined;
		placement = desired;
		footer.setEnabled(desired === "below-editor-last");
		statusline.invalidate();
		if (desired !== "above-editor" && desired !== "below-editor-first") return;
		ctx.ui.setWidget(
			WIDGET_KEY,
			(active, theme) => {
				tui = active;
				return new QuotaLineWidget(theme, (width, current) =>
					rows(width, current, active.terminal.rows),
				);
			},
			{ placement: desired === "above-editor" ? "aboveEditor" : "belowEditor" },
		);
	}

	function stop(): void {
		statusline.stop();
		offChange?.();
		offChange = undefined;
		offTokens?.();
		offTokens = undefined;
		offOwnership?.();
		offOwnership = undefined;
		if (ctx?.mode === "tui" && ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
		footer.stop();
		ctx = undefined;
		placement = undefined;
		tui = undefined;
	}

	return {
		start(context) {
			stop();
			ctx = context;
			// Ownership decides whether the legacy rows may appear, so subscribe before registering.
			offOwnership = statusline.onOwnership(() => {
				footer.setEnabled(
					deps.settings().get("quotas.linePlacement") === "below-editor-last" &&
						!statusline.owned(),
				);
				statusline.invalidate();
			});
			statusline.start();
			footer.start(context, false);
			sync();
			offChange = deps.engine.onChange(sync);
			offTokens = deps.tokens?.onChange(() => {
				footer.requestRender();
				statusline.invalidate();
			});
		},
		stop,
		settingsChanged: sync,
		preview(source, width, theme) {
			const config = { ...quotaLineConfig(deps.settings()), lineTemplate: source };
			return {
				rows: render(width, theme, deps.engine.view(), config, deps.now()),
				unknown: compileLineTemplate(source, resolve).unknown,
			};
		},
	};
}
