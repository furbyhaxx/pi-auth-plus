/** Owns session-scoped quota queries, refreshes and transition broadcasts on core/bus. */
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { publish, serve } from "../core/bus/index.ts";
import type { AppSettings } from "../core/config/catalog.ts";
import { redactText } from "../core/redact/index.ts";
import type { Registry } from "../core/registry/index.ts";
import type { QuotaEngine } from "./engine.ts";
import { engineReport, type QuotaReport, type ReportProvider } from "./report.ts";
import { pickResetCredit, type ResetRequester } from "./resets.ts";
import { enabledQuotaProviders } from "./settings.ts";
import type { ResetCredit, ResetCreditList, ResetOutcome } from "./types.ts";

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
	readonly capabilities: readonly (
		| "query"
		| "refresh"
		| "resets"
		| "reset"
		| "snapshot"
		| "event"
	)[];
}

/** One changed provider's current report row. */
export interface QuotaSnapshotPayload {
	readonly v: 1;
	readonly provider: ReportProvider;
}

/** Actionable failures and confirmed reset spends for session observers. */
export type QuotaEventPayload =
	| { v: 1; kind: "auth-required"; provider: string; message?: string | undefined }
	| { v: 1; kind: "rate-limited"; provider: string; status: number }
	| {
			v: 1;
			kind: "reset-consumed";
			provider: string;
			code: "reset";
			windowsReset: number;
			requester: ResetRequester;
	  };

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

/** Read-only credit listing request using a Pi provider id or alias. */
export interface QuotaResetsRequest {
	readonly provider: string;
}

/** Spending requires both this explicit gate and an in-session interactive approval. */
export interface QuotaResetRequest extends QuotaResetsRequest {
	readonly creditId?: string | undefined;
	readonly confirm: boolean;
}

/** Optional session-owned confirmation UI; absence always refuses a spend. */
export interface QuotaBusOptions {
	readonly confirmReset?: (
		providerId: string,
		credit: ResetCredit,
		requester: "bus",
	) => Promise<boolean>;
}

/** Nonce correlation is supplied by core/bus. */
export type QuotaResetReply =
	| { v: 1; ok: true; resets: ResetCreditList }
	| { v: 1; ok: true; outcome: ResetOutcome }
	| { v: 1; ok: false; error: string };

/** Drops malformed credit-list requests at the bus boundary. */
export function parseQuotaResets(raw: unknown): QuotaResetsRequest | undefined {
	if (!record(raw) || typeof raw["provider"] !== "string" || !raw["provider"].trim())
		return undefined;
	return { provider: raw["provider"] };
}

/** Missing confirmation remains a valid request so it receives an explicit refusal. */
export function parseQuotaReset(raw: unknown): QuotaResetRequest | undefined {
	const request = parseQuotaResets(raw);
	if (!request || !record(raw)) return undefined;
	const creditId = raw["creditId"];
	const confirm = raw["confirm"];
	if (
		(creditId !== undefined && typeof creditId !== "string") ||
		(confirm !== undefined && typeof confirm !== "boolean")
	)
		return undefined;
	return { ...request, creditId, confirm: confirm === true };
}

/** Registers the v1 quota service; disposal also suppresses replies already in flight. */
export function registerQuotaBus(
	events: EventBus,
	engine: QuotaEngine,
	registry: Registry,
	settings: () => AppSettings,
	now: () => number,
	options: QuotaBusOptions = {},
): () => void {
	let active = true;
	const bus: EventBus = {
		on: (channel, listener) => events.on(channel, listener),
		emit: (channel, payload) => {
			if (active) events.emit(channel, payload);
		},
	};
	const report = (ids?: readonly string[]) => engineReport(engine, settings(), now(), ids);
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
	const resetRequest = async (
		request: QuotaResetsRequest | QuotaResetRequest,
	): Promise<QuotaResetReply> => {
		try {
			if ("confirm" in request && !request.confirm)
				return { v: 1, ok: false, error: "A reset request needs confirm: true." };
			const id = registry.resolve(request.provider)?.provider.id ?? request.provider;
			const resets = await engine.listResets(id);
			if (!("confirm" in request)) return { v: 1, ok: true, resets };
			const credit = pickResetCredit(resets, request.creditId);
			if (!credit)
				return {
					v: 1,
					ok: false,
					error:
						request.creditId === undefined
							? "No reset credit available."
							: `Reset credit ${request.creditId} is not available.`,
				};
			if (
				!active ||
				!options.confirmReset ||
				!(await options.confirmReset(id, credit, "bus")) ||
				!active
			)
				return {
					v: 1,
					ok: false,
					error: "The user did not approve the reset, or no interactive UI is available.",
				};
			return { v: 1, ok: true, outcome: await engine.consumeReset(id, credit.id, "bus") };
		} catch (error) {
			return {
				v: 1,
				ok: false,
				error: redactText(error instanceof Error ? error.message : String(error)),
			};
		}
	};
	let previous = new Map(engine.view().map((view) => [view.provider.id, JSON.stringify(view)]));
	let states = new Map(report().providers.map((provider) => [provider.id, provider.state]));
	const off = [
		serve(bus, "quotas", "query", parseQuotaQuery, (request) => respond(request, false)),
		serve(bus, "quotas", "refresh", parseQuotaRefresh, (request) => respond(request, true)),
		serve(bus, "quotas", "resets", parseQuotaResets, resetRequest),
		serve(bus, "quotas", "reset", parseQuotaReset, resetRequest),
		engine.onResetConsumed((outcome, requester) => {
			publish(bus, "quotas", "event", {
				v: 1,
				kind: "reset-consumed",
				provider: outcome.provider,
				code: "reset",
				windowsReset: outcome.windowsReset,
				requester,
			} satisfies QuotaEventPayload);
		}),
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
		capabilities: ["query", "refresh", "resets", "reset", "snapshot", "event"],
	} satisfies QuotaReadyPayload);
	return () => {
		active = false;
		for (const unsubscribe of off) unsubscribe();
	};
}
