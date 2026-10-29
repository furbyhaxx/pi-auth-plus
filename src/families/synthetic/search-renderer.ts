/** Compact, bounded terminal rendering for Synthetic web searches. */
import type {
	AgentToolResult,
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	sliceByColumn,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { redactText } from "../../core/redact/index.ts";
import { sanitize } from "../../ui/frame/index.ts";

export const MAX_PREVIEW_RESULTS = 50;
const MAX_EXPANDED_LINES = 200;

export interface SearchPreview {
	readonly title: string;
	readonly url: string;
	readonly published: string | undefined;
}

export type SearchDetails =
	| { readonly kind: "progress"; readonly query: string }
	| { readonly kind: "aborted" }
	| {
			readonly kind: "error";
			readonly code: "auth" | "http" | "network" | "timeout" | "parse";
			readonly message: string;
			readonly status?: number;
	  }
	| {
			readonly kind: "success";
			readonly query: string;
			readonly results: readonly SearchPreview[];
			readonly resultCount: number;
			readonly fullOutputPath: string | undefined;
			readonly truncated: boolean;
	  };

export interface SearchRowState {
	phase?: "done" | "error" | "aborted";
	query?: string;
	count?: number;
	truncated?: boolean;
	expandable?: boolean;
}

const MARKERS = {
	args: ["○", "dim"],
	queued: ["○", "dim"],
	running: ["◌", "accent"],
	done: ["✓", "success"],
	error: ["✗", "error"],
	aborted: ["■", "warning"],
} as const;

type Context = Parameters<
	NonNullable<ToolDefinition<TSchema, SearchDetails, SearchRowState>["renderCall"]>
>[2];

/** Sanitize and bound values stored in renderer details, including known credentials. */
export function previewText(value: string, limit: number, secret?: string): string {
	let safe = value.slice(0, 4096);
	if (secret) safe = safe.replaceAll(secret, "[redacted]");
	safe = redactText(sanitize(safe).replace(/[\n\u2028\u2029]/gu, " "));
	safe = safe.replace(/(https?:\/\/)[^/\s@]+@/giu, "$1[redacted]@");
	safe = safe.replace(
		/([?&](?:password|secret|client[-_]?secret|authorization|cookie|session(?:[-_]?token)?)=)[^&#\s]*/giu,
		"$1[redacted]",
	);
	return safe.length <= limit ? safe : `${safe.slice(0, Math.max(0, limit - 1))}…`;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function lines(build: (width: number) => string[], outputPad: number): Component {
	return {
		render(width) {
			const pad = Math.max(0, Math.min(Math.floor(outputPad), Math.floor((width - 1) / 2)));
			const prefix = " ".repeat(pad);
			const available = Math.max(0, width - 2 * pad);
			return build(available).map((line) => prefix + truncateToWidth(line, available, "…"));
		},
		invalidate() {},
	};
}

/** Render the call lazily because Pi invokes renderCall before renderResult. */
export function renderSearchCall(name: string, theme: Theme, context: Context): Component {
	const state = context.state;
	return lines((width) => {
		const phase =
			state.phase ??
			(!context.argsComplete ? "args" : !context.executionStarted ? "queued" : "running");
		const [symbol, tone] = MARKERS[phase];
		const label = phase === "done" && state.count === 0 ? "empty" : phase;
		const heading = `${theme.fg(tone, symbol)} ${theme.bold(theme.fg("toolTitle", name))} ${theme.fg(tone, label)}`;
		const rawCount =
			phase === "done" && state.count !== undefined && state.count > 0 ? ` · ${state.count}` : "";
		const count =
			rawCount && visibleWidth(`${heading}${rawCount} results`) <= width
				? `${rawCount} results`
				: rawCount;
		const truncated = phase === "done" && state.truncated ? " · truncated" : "";
		const expand = phase === "done" && state.expandable && !context.expanded ? " · expand" : "";
		return [
			`${heading}${theme.fg("muted", count + truncated + expand)}${state.query ? ` ${theme.fg("accent", `“${state.query}”`)}` : ""}`,
		];
	}, context.outputPad);
}

/** Render only bounded titles, URLs and the full-text pointer, never model content. */
export function renderSearchResult(
	result: AgentToolResult<unknown>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: Context,
): Component {
	const state = context.state;
	const details = record(result.details);
	const content = result.content[0];
	if (
		(!options.isPartial || !state.phase) &&
		(details?.["kind"] === "progress" || details?.["kind"] === "success") &&
		typeof details["query"] === "string"
	) {
		state.query = previewText(details["query"], 160);
	}
	if (!options.isPartial) {
		const aborted =
			details?.["kind"] === "aborted" ||
			(context.isError && content?.type === "text" && content.text === "Operation aborted");
		state.phase = aborted ? "aborted" : context.isError ? "error" : "done";
		const count =
			details?.["resultCount"] ??
			(Array.isArray(details?.["results"]) ? details["results"].length : undefined);
		if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) state.count = count;
		else delete state.count;
		state.truncated = details?.["truncated"] === true;
		state.expandable =
			(state.count ?? 0) > 0 || state.truncated || typeof details?.["fullOutputPath"] === "string";
	}
	if (options.isPartial && state.phase) return lines(() => [], context.outputPad);
	if (options.isPartial) {
		return lines(
			() => [`  ${theme.fg("dim", "⎿")}  ${theme.fg("muted", "Searching Synthetic…")}`],
			context.outputPad,
		);
	}
	if (state.phase === "aborted") return lines(() => [], context.outputPad);
	if (state.phase === "error") {
		const status = details?.["status"];
		const http =
			typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
				? `HTTP ${status}`
				: "HTTP error";
		const reason = {
			auth: "credentials missing",
			http,
			network: "network failed",
			timeout: "request timed out",
			parse: "invalid response",
		} as const;
		const code = details?.["code"];
		const message =
			typeof code === "string" && Object.hasOwn(reason, code)
				? reason[code as keyof typeof reason]
				: "search failed";
		return lines(
			() => [
				`  ${theme.fg("dim", "⎿")}  ${theme.fg("error", message)}`,
				`     ${theme.fg("muted", "Retry or run /login synthetic")}`,
			],
			context.outputPad,
		);
	}
	if (
		!options.expanded ||
		!details ||
		(details["kind"] !== undefined && details["kind"] !== "success")
	)
		return lines(() => [], context.outputPad);
	const entries = Array.isArray(details["results"])
		? details["results"].slice(0, MAX_PREVIEW_RESULTS)
		: [];
	const rows: string[] = [];
	for (const entry of entries) {
		const item = record(entry);
		if (typeof item?.["title"] !== "string" || typeof item["url"] !== "string") continue;
		rows.push(previewText(item["title"], 160), previewText(item["url"], 320));
	}
	const hidden = Math.max(0, (state.count ?? entries.length) - entries.length);
	const path =
		typeof details["fullOutputPath"] === "string"
			? previewText(details["fullOutputPath"], 4096)
			: undefined;
	let cachedWidth = -1;
	let cachedRows: string[] = [];
	return lines((width) => {
		if (cachedWidth === width) return cachedRows;
		const shown: string[] = [];
		let omitted = false;
		for (const row of rows) {
			const wrapped = wrapTextWithAnsi(row, Math.max(1, width - 5));
			if (shown.length + wrapped.length > MAX_EXPANDED_LINES) {
				omitted = true;
				break;
			}
			shown.push(...wrapped);
		}
		if (omitted) shown.push("… more results omitted");
		if (hidden > 0) shown.push(`… ${hidden} more results`);
		if (state.truncated) shown.push("Model output truncated");
		if (path) {
			const room = Math.max(0, width - 5 - visibleWidth("Full text: "));
			const value =
				visibleWidth(path) > room && room > 1
					? `…${sliceByColumn(path, visibleWidth(path) - room + 1, room - 1, true)}`
					: truncateToWidth(path, room, "…");
			shown.push(`Full text: ${value}`);
		}
		cachedWidth = width;
		cachedRows = shown.map(
			(row, index) =>
				`${index === 0 ? `  ${theme.fg("dim", "⎿")}  ` : "     "}${theme.fg("muted", row)}`,
		);
		return cachedRows;
	}, context.outputPad);
}
