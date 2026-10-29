/** Selects one footer owner; the caller wires session, placement and quota-change events. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { ContextReport } from "../../tokens/engine/index.ts";
import {
	type ContextPercentThresholds,
	createFooterWithQuotaLine,
	type FooterContext,
} from "./footer.ts";
import { asFooterHost, type FooterRows, type WorkbenchFooterHost } from "./workbench.ts";

/** UI and session data needed to mount the fallback footer. */
export type FooterPlacementContext = FooterContext &
	Pick<ExtensionContext, "mode" | "hasUI"> & {
		ui: Pick<ExtensionContext["ui"], "setFooter">;
	};

/** Session-scoped footer lifecycle; enable only for below-editor-last placement. */
export interface FooterPlacement {
	start(ctx: FooterPlacementContext, enabled: boolean): void;
	setEnabled(enabled: boolean): void;
	requestRender(): void;
	stop(): void;
	dispose(): void;
}

/** Creates the workbench push/pull handshake and an explicitly controlled footer mount. */
export function createFooterPlacement(
	pi: Pick<ExtensionAPI, "events" | "getThinkingLevel">,
	rows: FooterRows,
	tokens?: () => ContextReport | undefined,
	/** True while another surface (the workbench statusline segment) already shows the quotas. */
	suppressed: () => boolean = () => false,
	contextThresholds?: () => ContextPercentThresholds,
): FooterPlacement {
	let ctx: FooterPlacementContext | undefined;
	let enabled = false;
	let host: WorkbenchFooterHost | undefined;
	let owner: "own" | WorkbenchFooterHost | undefined;
	let tui: TUI | undefined;
	let generation = 0;

	function unmount(): void {
		if (owner === "own") ctx?.ui.setFooter(undefined);
		else owner?.setFooterRows("pi-auth-plus", undefined);
		owner = undefined;
		tui = undefined;
	}

	function requestRender(): void {
		if (owner === "own") tui?.requestRender();
		else owner?.requestFooterRender();
	}

	function sync(): void {
		const desired =
			!suppressed() && enabled && ctx?.mode === "tui" && ctx.hasUI ? (host ?? "own") : undefined;
		if (owner === desired) {
			requestRender();
			return;
		}
		unmount();
		owner = desired;
		if (desired === "own" && ctx) {
			const current = ctx;
			current.ui.setFooter((activeTui, theme, footerData) => {
				tui = activeTui;
				return createFooterWithQuotaLine(
					pi,
					current,
					activeTui,
					theme,
					footerData,
					rows,
					tokens,
					contextThresholds,
				);
			});
		} else if (desired && desired !== "own") {
			desired.setFooterRows("pi-auth-plus", rows);
		}
	}

	function attach(service: unknown): void {
		const next = asFooterHost(service);
		if (!next) return;
		host = next;
		sync();
	}

	const unsubscribe = pi.events.on("workbench:service", attach);
	function stop(): void {
		generation++;
		unmount();
		ctx = undefined;
		enabled = false;
	}

	return {
		start(context, active) {
			stop();
			ctx = context;
			enabled = active;
			const session = generation;
			pi.events.emit("workbench:service-request", (service: unknown) => {
				if (ctx && session === generation) attach(service);
			});
			sync();
		},
		setEnabled(active) {
			enabled = active;
			sync();
		},
		requestRender,
		stop,
		dispose() {
			stop();
			unsubscribe();
			host = undefined;
		},
	};
}
