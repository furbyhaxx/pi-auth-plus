/** Registers the quota template as a pi-workbench statusline segment. */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { AppSettings } from "../../core/config/catalog.ts";
import type { Registry } from "../../core/registry/index.ts";
import type { QuotaEngine } from "../engine.ts";
import { createQuotaLineRenderer, limitQuotaRows, quotaLineConfig } from "./line.ts";

/** Segment id inside pi-workbench; its owner prefix is the extension name. */
export const QUOTA_SEGMENT_ID = "pi-auth-plus:quotas";
const OWNER = "pi-auth-plus";

/** The part of pi-workbench's statusline host contract this extension uses. */
interface StatuslineRenderContext {
	readonly width: number;
	readonly theme: Theme;
	readonly maxRows: number;
	readonly providersInUse?: readonly string[];
}

interface StatuslineContent {
	readonly lines: readonly string[];
	readonly zero?: boolean;
}

interface StatuslineSegment {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly category: string;
	render(ctx: StatuslineRenderContext): StatuslineContent;
}

interface StatuslineRegistration {
	update(segment: StatuslineSegment): boolean;
	dispose(): void;
}

interface StatuslineHost {
	readonly version: 1;
	readonly generation: string;
	register(owner: string, segment: StatuslineSegment): StatuslineRegistration | undefined;
}

/** Accept a `workbench:v1:statusline:ready` payload only if it can take a segment. */
function asStatuslineHost(value: unknown): StatuslineHost | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const host = value as Partial<StatuslineHost>;
	if (host.version !== 1 || typeof host.generation !== "string") return undefined;
	return typeof host.register === "function" ? (host as StatuslineHost) : undefined;
}

/** Session-scoped segment registration; safe to start before pi-workbench exists. */
export interface QuotaStatusline {
	start(): void;
	stop(): void;
	/** True while pi-workbench owns the quota row and the legacy footer rows must stay off. */
	owned(): boolean;
	/** Repaints the host after quota, template or placement changes. */
	invalidate(): void;
	/** Calls back whenever ownership starts or ends. */
	onOwnership(listener: () => void): () => void;
}

/** Creates the segment once per extension load; `start` binds it to a session. */
export function createQuotaStatusline(
	pi: Pick<ExtensionAPI, "events">,
	deps: {
		readonly engine: QuotaEngine;
		readonly registry: Registry;
		readonly settings: () => AppSettings;
		readonly now: () => number;
	},
): QuotaStatusline {
	const resolve = (token: string) => deps.registry.resolve(token)?.provider.id;
	const render = createQuotaLineRenderer(resolve);
	const listeners = new Set<() => void>();
	let host: StatuslineHost | undefined;
	let registration: StatuslineRegistration | undefined;
	let offReady: (() => void) | undefined;

	const segment: StatuslineSegment = {
		id: QUOTA_SEGMENT_ID,
		name: "Quotas",
		description: "Subscription windows and credits through the configured quota template.",
		category: "quotas",
		render(ctx): StatuslineContent {
			const lines = render(
				ctx.width,
				ctx.theme,
				deps.engine.view(),
				quotaLineConfig(deps.settings()),
				deps.now(),
				ctx.providersInUse,
			);
			const rows = limitQuotaRows(ctx.width, ctx.theme, lines, ctx.maxRows);
			return { lines: rows, zero: rows.length === 0 };
		},
	};

	function changed(): void {
		for (const listener of listeners) listener();
	}

	function bind(candidate: unknown): void {
		const next = asStatuslineHost(candidate);
		if (!next || (host === next && registration)) return;
		registration?.dispose();
		const bound = next.register(OWNER, segment);
		if (!bound) return;
		host = next;
		registration = bound;
		changed();
	}

	function invalidate(): void {
		pi.events.emit("workbench:v1:statusline:invalidate", {});
	}

	return {
		start() {
			this.stop();
			offReady = pi.events.on("workbench:v1:statusline:ready", bind);
			pi.events.emit("workbench:v1:statusline:query", (candidate: unknown) => bind(candidate));
		},
		stop() {
			offReady?.();
			offReady = undefined;
			registration?.dispose();
			registration = undefined;
			host = undefined;
			changed();
		},
		owned: () => registration !== undefined,
		invalidate,
		onOwnership(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
