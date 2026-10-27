/** Owns session-scoped quota queries, refreshes and transition broadcasts on core/bus. */
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { publish, serve } from "../core/bus/index.ts";
import type { AppSettings } from "../core/config/catalog.ts";
import type { Registry } from "../core/registry/index.ts";
import { getDrainageMetrics } from "./drainage.ts";
import type { QuotaEngine } from "./engine.ts";
import { buildQuotaReport, type QuotaReport, type ReportProvider } from "./report.ts";
import { enabledQuotaProviders } from "./settings.ts";

/** Read cached quotas, optionally refreshing entries older than the requested age. */
export interface QuotaQueryRequest {
	readonly providers?: string[] | undefined;
	readonly maxAgeSec?: number | undefined;
}

/** Refresh selected providers, optionally bypassing freshness and backoff. */
export interface QuotaRefreshRequest {
	readonly providers?: string[] | undefined;
	readonly force?: boolean | undefined;
}

/** Advertises enabled Pi providers and the channels supported by this service. */
export interface QuotaReadyPayload {
	readonly v: 1;
	readonly providers: readonly { readonly id: string; readonly aliases: readonly string[] }[];
	readonly capabilities: readonly ("query" | "refresh" | "snapshot" | "event")[];
}

/** One changed provider's current report row. */
export interface QuotaSnapshotPayload {
	readonly v: 1;
	readonly provider: ReportProvider;
}

/** Emitted only when a provider enters an actionable failure state. */
export type QuotaEventPayload =
	| { v: 1; kind: "auth-required"; provider: string; message?: string | undefined }
	| { v: 1; kind: "rate-limited"; provider: string; status: number };

/** Nonce correlation is supplied by the core/bus envelope. */
export type QuotaReply =
	| { v: 1; ok: true; report: QuotaReport }
	| { v: 1; ok: false; error: string };

function record(raw: unknown): raw is Record<string, unknown> {
	return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function providers(raw: unknown): string[] | undefined | null {
	if (raw === undefined) return undefined;
	return Array.isArray(raw) && raw.every((item) => typeof item === "string") ? raw : null;
}

/** Drops malformed query payloads at the bus boundary. */
export function parseQuotaQuery(raw: unknown): QuotaQueryRequest | undefined {
	if (!record(raw)) return undefined;
	const ids = providers(raw["providers"]);
	const age = raw["maxAgeSec"];
	if (
		ids === null ||
		(age !== undefined && (typeof age !== "number" || !Number.isFinite(age) || age < 0))
	)
		return undefined;
	return { providers: ids, maxAgeSec: age };
}

/** Drops malformed refresh payloads at the bus boundary. */
export function parseQuotaRefresh(raw: unknown): QuotaRefreshRequest | undefined {
	if (!record(raw)) return undefined;
	const ids = providers(raw["providers"]);
	const force = raw["force"];
	if (ids === null || (force !== undefined && typeof force !== "boolean")) return undefined;
	return { providers: ids, force };
}

/** Registers the v1 quota service; disposal also suppresses replies already in flight. */
export function registerQuotaBus(
	events: EventBus,
	engine: QuotaEngine,
	registry: Registry,
	settings: () => AppSettings,
	now: () => number,
): () => void {
	let active = true;
	const bus: EventBus = {
		on: (channel, listener) => events.on(channel, listener),
		emit: (channel, payload) => {
			if (active) events.emit(channel, payload);
		},
	};
	const report = (ids?: readonly string[]) => {
		const at = now();
		const metrics = (id: string, kind: "window" | "credits", key: string) =>
			getDrainageMetrics(
				engine.cache
					.get(id)
					?.value.drainage.find((entry) => entry.kind === kind && entry.id === key),
				at,
			);
		return buildQuotaReport(
			engine.view().filter((view) => ids === undefined || ids.includes(view.provider.id)),
			settings(),
			at,
			{
				getWindowDrainage: (id, key) => metrics(id, "window", key),
				getCreditDrainage: (id, key) => metrics(id, "credits", key),
			},
		);
	};
	const respond = async (
		request: QuotaQueryRequest | QuotaRefreshRequest,
		refresh: boolean,
	): Promise<QuotaReply> => {
		const enabled = enabledQuotaProviders(registry, settings());
		const known = registry
			.providers()
			.filter(({ provider }) => provider.quota)
			.map(({ provider }) => provider.id);
		const ids = new Set<string>();
		for (const name of request.providers ?? enabled.map((provider) => provider.id)) {
			const provider = registry.resolve(name)?.provider;
			if (!provider?.quota)
				return { v: 1, ok: false, error: `Unknown provider "${name}". Known: ${known.join(", ")}` };
			if (!enabled.some((entry) => entry.id === provider.id))
				return {
					v: 1,
					ok: false,
					error: `Quota provider "${provider.id}" is disabled. Enable it in quotas.providers.`,
				};
			ids.add(provider.id);
		}
		try {
			if (refresh) {
				const force = "force" in request ? (request.force ?? false) : false;
				await Promise.all([...ids].map((id) => engine.refresh(id, { force, minAgeMs: 0 })));
			} else if ("maxAgeSec" in request && request.maxAgeSec !== undefined) {
				const minAgeMs = Math.max(1000, request.maxAgeSec * 1000);
				await Promise.all(
					engine
						.view()
						.filter(
							(view) =>
								ids.has(view.provider.id) &&
								(view.fetchedAt === undefined || now() - view.fetchedAt >= minAgeMs),
						)
						.map((view) => engine.refresh(view.provider.id, { minAgeMs })),
				);
			}
			return { v: 1, ok: true, report: report([...ids]) };
		} catch (error) {
			return {
				v: 1,
				ok: false,
				error: `Quota ${refresh ? "refresh" : "query"} failed: ${error instanceof Error ? error.message : String(error)}. Retry the request.`,
			};
		}
	};
	let previous = new Map(engine.view().map((view) => [view.provider.id, JSON.stringify(view)]));
	let states = new Map(report().providers.map((provider) => [provider.id, provider.state]));
	const off = [
		serve(bus, "quotas", "query", parseQuotaQuery, (request) => respond(request, false)),
		serve(bus, "quotas", "refresh", parseQuotaRefresh, (request) => respond(request, true)),
		engine.onChange(() => {
			const views = engine.view();
			const next = new Map(views.map((view) => [view.provider.id, JSON.stringify(view)]));
			const current = report();
			for (const provider of current.providers) {
				if (previous.get(provider.id) === next.get(provider.id)) continue;
				publish(bus, "quotas", "snapshot", { v: 1, provider } satisfies QuotaSnapshotPayload);
				if (states.get(provider.id) !== provider.state) {
					const status = views.find((view) => view.provider.id === provider.id)?.backoff?.status;
					if (provider.state === "needs-auth")
						publish(bus, "quotas", "event", {
							v: 1,
							kind: "auth-required",
							provider: provider.id,
							message: provider.error,
						} satisfies QuotaEventPayload);
					else if (provider.state === "rate-limited" && status !== undefined)
						publish(bus, "quotas", "event", {
							v: 1,
							kind: "rate-limited",
							provider: provider.id,
							status,
						} satisfies QuotaEventPayload);
				}
			}
			previous = next;
			states = new Map(current.providers.map((provider) => [provider.id, provider.state]));
		}),
	];
	publish(bus, "quotas", "ready", {
		v: 1,
		providers: enabledQuotaProviders(registry, settings()).map((provider) => ({
			id: provider.id,
			aliases: provider.aliases,
		})),
		capabilities: ["query", "refresh", "snapshot", "event"],
	} satisfies QuotaReadyPayload);
	return () => {
		active = false;
		for (const unsubscribe of off) unsubscribe();
	};
}
