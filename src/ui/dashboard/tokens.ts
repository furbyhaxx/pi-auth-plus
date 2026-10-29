/** Live context totals and cancellable, on-demand contribution counts. */
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { BreakdownPart, ContextReport } from "../../tokens/engine/index.ts";
import type { TokenTracker } from "../../tokens/tracker/types.ts";
import type { TokenCount } from "../../tokens/types.ts";
import { sanitize } from "../frame/index.ts";
import { rowLines } from "./rows.ts";
import type { Row, TabContent } from "./tabs.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: "compact" });

function number(value: number): string {
	return numberFormat.format(value);
}

function plural(value: number, noun: string): string {
	return `${number(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function count(value: TokenCount): string {
	const source =
		value.source === "provider" || value.source === "count-endpoint"
			? `exact (${value.source === "provider" ? "usage" : "count API"})`
			: value.source === "tokenizer"
				? "tokenizer estimate"
				: "estimate";
	return `${number(value.tokens)} · ${source}`;
}

function content(report: ContextReport | undefined, available: boolean): TabContent {
	if (!available) return { rows: [], empty: "Token tracker unavailable in this session." };
	if (!report) return { rows: [], empty: "No model or session count yet." };
	const row = (label: string, value: string): Row => ({
		label,
		value: sanitize(value).replaceAll("\n", " "),
		tone: "muted",
	});
	const delta = report.pi == null ? undefined : report.tokens.tokens - report.pi;
	return {
		rows: [
			row("Provider", report.provider),
			row("Model", report.model),
			row("Total", count(report.tokens)),
			row(
				"Context",
				`${report.percent === undefined ? "?" : report.percent.toFixed(1)}% of ${report.contextWindow === undefined ? "?" : number(report.contextWindow)}`,
			),
			row("Pi", report.pi == null ? "unknown" : number(report.pi)),
			row(
				"Delta",
				delta === undefined ? "unknown" : `${delta >= 0 ? "+" : ""}${number(delta)} vs Pi`,
			),
			row("Anchor", report.anchor ? count(report.anchor) : "No provider usage yet"),
			row(
				"Tail",
				report.tailMessages === 0
					? "none"
					: `${plural(report.tailMessages, "message")} · ${count(report.tail)}`,
			),
		],
		empty: "",
	};
}

/** Cached context totals for print and RPC modes; opening never forces a recount. */
export function tokensText(tracker: TokenTracker | undefined): string {
	const data = content(tracker?.latest(), tracker !== undefined);
	return [
		"Auth › Tokens",
		...(data.rows.length
			? data.rows.map((row) => `  ${row.label}: ${row.value}`)
			: [`  ${data.empty}`]),
	].join("\n");
}

/** Read-only live counts; counting starts only when this tab is rendered. */
export class TokensView implements TabView {
	readonly #host: TabViewHost;
	readonly #tracker: TokenTracker | undefined;
	#report: ContextReport | undefined;
	#parts: readonly BreakdownPart[] | undefined;
	#message = "counting…";
	#failure: string | undefined;
	#controller: AbortController | undefined;
	#unsubscribe: (() => void) | undefined;
	#disposed = false;
	#offset = 0;
	#maxOffset = 0;

	constructor(host: TabViewHost, tracker: TokenTracker | undefined) {
		this.#host = host;
		this.#tracker = tracker;
		this.#report = tracker?.latest();
	}

	async #count(): Promise<void> {
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		this.#parts = undefined;
		this.#message = "counting…";
		this.#failure = undefined;
		try {
			const parts = await this.#tracker?.breakdown(controller.signal);
			if (this.#disposed || controller.signal.aborted) return;
			this.#parts = parts;
			this.#message = "No session breakdown yet.";
		} catch (error) {
			if (this.#disposed || controller.signal.aborted) return;
			const reason = error instanceof Error ? error.message : String(error);
			this.#failure = `Counting failed: ${reason}; reopen Tokens to retry.`;
			this.#message = sanitize(this.#failure).replaceAll("\n", " ");
		}
		this.#host.refresh();
	}

	/** Render sanitized, width-bounded rows using the dashboard's scroll mechanics. */
	render(width: number, bodyRows: number): TabBody {
		if (!this.#disposed && !this.#unsubscribe && this.#tracker) {
			this.#report = this.#tracker.latest();
			this.#unsubscribe = this.#tracker.onChange((report) => {
				if (this.#disposed) return;
				this.#report = report;
				void this.#count();
				this.#host.refresh();
			});
			void this.#count();
		}
		const data = content(this.#report, this.#tracker !== undefined);
		const rows: Row[] = [...data.rows];
		if (this.#tracker && this.#report) {
			rows.push({
				label: "Breakdown",
				value: this.#parts ? "Full request" : this.#message,
				tone: "muted",
			});
			for (const part of this.#parts ?? [])
				rows.push({
					label: part.kind,
					value:
						part.items === 0
							? "none · 0 items"
							: `${count(part.count)} · ${plural(part.items, "item")}`,
					tone: "muted",
				});
		}
		const lines = rows.length ? rowLines(this.#host, rows, width) : [` ${data.empty}`];
		const clipped = lines.map((line) => truncateToWidth(line, width, "…"));
		this.#maxOffset = Math.max(0, clipped.length - bodyRows);
		this.#offset = Math.min(this.#offset, this.#maxOffset);
		return {
			lines: clipped.slice(this.#offset, this.#offset + bodyRows),
			above: this.#offset,
			below: Math.max(0, clipped.length - this.#offset - bodyRows),
			...(this.#failure
				? { fullFeedback: [this.#host.theme.fg("error", sanitize(this.#failure))] }
				: {}),
			hints: this.#maxOffset
				? [
						{
							key: `${sanitize(this.#host.binding("tui.select.up"))}/${sanitize(this.#host.binding("tui.select.down"))}`,
							action: "scroll",
							priority: 2,
						},
					]
				: [],
		};
	}

	/** Forward scrolling keys; dashboard navigation remains unconsumed. */
	handleInput(data: string): boolean {
		if (this.#host.keys.matches(data, "tui.select.up"))
			this.#offset = Math.max(0, this.#offset - 1);
		else if (this.#host.keys.matches(data, "tui.select.down"))
			this.#offset = Math.min(this.#maxOffset, this.#offset + 1);
		else return false;
		return true;
	}

	/** Cancel pending counts and remove the live subscription exactly once. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#controller?.abort();
		this.#unsubscribe?.();
	}
}
