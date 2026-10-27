/** Owns endpoint refresh scheduling and host-shared quota state for one session. */
import { type Backoff, backoffFor, HostCache } from "../core/cache/index.ts";
import type { AppSettings } from "../core/config/catalog.ts";
import { type FetchFn, ProviderHttpError } from "../core/http/index.ts";
import type { ProviderEntry, Registry } from "../core/registry/index.ts";
import { recordDrainageHistory } from "./drainage.ts";
import { effectiveSnapshot } from "./merge.ts";
import { type ResetRequester, unsupportedResetMessage } from "./resets.ts";
import { enabledQuotaProviders } from "./settings.ts";
import { parseQuotaState, type QuotaState } from "./state.ts";
import type {
	ProviderQuotaSnapshot,
	QuotaAuth,
	QuotaFetchContext,
	QuotaResets,
	QuotaSource,
	ResetCreditList,
	ResetOutcome,
} from "./types.ts";

export interface QuotaEngineOptions {
	readonly registry: Registry;
	readonly cachePath: string;
	readonly settings: () => AppSettings;
	readonly now: () => number;
	readonly fetch: FetchFn;
	readonly authFor: (providerId: string) => Promise<QuotaAuth | undefined>;
}

export interface QuotaView {
	readonly provider: ProviderEntry;
	readonly snapshot: ProviderQuotaSnapshot | undefined;
	readonly backoff: Backoff | undefined;
	readonly refreshing: boolean;
	readonly fetchedAt: number | undefined;
}

export interface RefreshOptions {
	readonly force?: boolean;
	readonly minAgeMs?: number;
}

const BACKOFF_POLICY = {
	defaultMs: 30_000,
	rateLimitMs: 60_000,
	maxMs: 900_000,
	rateLimitStatuses: [403, 429],
};

export class QuotaEngine {
	readonly cache: HostCache<QuotaState>;
	private readonly options: QuotaEngineOptions;
	private readonly refreshing = new Map<string, Promise<void>>();
	private readonly listeners = new Set<() => void>();
	private readonly resetListeners = new Set<
		(outcome: ResetOutcome, requester: ResetRequester) => void
	>();
	private controller = new AbortController();
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(options: QuotaEngineOptions) {
		this.options = options;
		this.cache = new HostCache({
			path: options.cachePath,
			parse: (raw) => parseQuotaState(raw, options.now()),
			parserVersion: (id) => options.registry.byId(id)?.provider.quota?.parserVersion ?? 0,
			now: options.now,
			rateLimitStatuses: BACKOFF_POLICY.rateLimitStatuses,
		});
		this.cache.onChange(() => this.notify());
	}

	/** Enabled providers and their effective quota state; no disk or network work. */
	view(): QuotaView[] {
		return this.providers().map((provider) => {
			const entry = this.cache.get(provider.id);
			return {
				provider,
				snapshot: entry ? effectiveSnapshot(entry.value) : undefined,
				backoff: this.cache.backoff(provider.id),
				refreshing: this.refreshing.has(provider.id),
				// A headers-only entry has fetchedAt 0: no endpoint fetch has happened yet.
				fetchedAt: entry?.fetchedAt || undefined,
			};
		});
	}

	/** Observes cache merges, refresh activity and failures. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Whether an enabled Pi provider exposes on-demand resets. */
	resetSupport(id: string): boolean {
		return this.providers().some((provider) => provider.id === id && provider.quota?.resets);
	}

	/** Lists credits without consuming or refreshing quotas. */
	async listResets(id: string): Promise<ResetCreditList> {
		const resets = this.resetSource(id);
		return resets.list(this.context(id, this.controller.signal));
	}

	/** Consumes once, then refreshes even when the provider reports no spend or throws. */
	async consumeReset(
		id: string,
		creditId: string,
		requester: ResetRequester = "command",
	): Promise<ResetOutcome> {
		const resets = this.resetSource(id);
		const signal = this.controller.signal;
		try {
			const outcome = await resets.consume(this.context(id, signal), creditId);
			if (!signal.aborted && outcome.code === "reset") {
				for (const listener of this.resetListeners) listener(outcome, requester);
			}
			return outcome;
		} finally {
			try {
				try {
					await this.refreshing.get(id);
				} finally {
					if (!signal.aborted) await this.refresh(id, { force: true });
				}
			} catch {
				// Refresh storage failures must not hide a spend verdict or invite a consume retry.
				this.notify();
			}
		}
	}

	/** Observes only confirmed provider verdicts that spent a credit. */
	onResetConsumed(
		listener: (outcome: ResetOutcome, requester: ResetRequester) => void,
	): () => void {
		this.resetListeners.add(listener);
		return () => this.resetListeners.delete(listener);
	}

	private resetSource(id: string): QuotaResets {
		if (this.controller.signal.aborted)
			throw new Error("Quota engine is stopped. Start a session before requesting resets.");
		if (!this.options.registry.byId(id)?.provider.quota) {
			const known = this.options.registry
				.providers()
				.filter(({ provider }) => provider.quota)
				.map(({ provider }) => provider.id);
			throw new Error(`Unknown provider "${id}". Known: ${known.join(", ")}`);
		}
		const provider = this.providers().find((provider) => provider.id === id);
		if (!provider)
			throw new Error(`Quota provider "${id}" is disabled. Enable it in quotas.providers.`);
		if (!provider.quota?.resets)
			throw new Error(
				unsupportedResetMessage(
					id,
					this.providers()
						.filter((provider) => provider.quota?.resets)
						.map((provider) => provider.id),
				),
			);
		return provider.quota.resets;
	}

	private context(id: string, signal: AbortSignal): QuotaFetchContext {
		return {
			auth: () => {
				const resolve = this.options.registry.byId(id)?.provider.quota?.auth;
				return resolve ? resolve(this.options.authFor, signal) : this.options.authFor(id);
			},
			fetch: this.options.fetch,
			signal,
			now: this.options.now,
		};
	}

	/** Stores the first enabled parser's claim without refreshing endpoint freshness. */
	async ingestHeaders(headers: Record<string, string>, hint?: string): Promise<string | undefined> {
		const signal = this.controller.signal;
		if (signal.aborted) return undefined;
		const normalized = Object.fromEntries(
			Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
		);
		const providers = this.providers();
		const hintedId = hint ? this.options.registry.resolve(hint)?.provider.id : undefined;
		const hinted = providers.find((provider) => provider.id === hintedId);
		const ordered = hinted
			? [hinted, ...providers.filter((provider) => provider !== hinted)]
			: providers;
		const now = this.options.now();
		for (const provider of ordered) {
			const parser = provider.quota?.headers;
			if (!parser) continue;
			let snapshot: ProviderQuotaSnapshot | undefined;
			try {
				snapshot = parser(normalized, now);
			} catch {
				// Malformed responses must not interrupt Pi or prevent another parser's claim.
				continue;
			}
			if (!snapshot) continue;
			try {
				const changed = await this.cache.patch(provider.id, (current) => {
					if (signal.aborted) return undefined;
					return {
						...current,
						headers: { snapshot, observedAt: now },
						drainage: recordDrainageHistory(current?.drainage ?? [], snapshot, now),
					};
				});
				return changed ? provider.id : undefined;
			} catch {
				// Cache failures on the response hook must not reject into Pi's event loop.
				return undefined;
			}
		}
		return undefined;
	}

	/** Refreshes an enabled provider, deduplicating calls within this engine. */
	refresh(id: string, options: RefreshOptions = {}): Promise<void> {
		const pending = this.refreshing.get(id);
		if (pending) return pending;
		const source = this.providers().find((provider) => provider.id === id)?.quota;
		if (!source || this.controller.signal.aborted) return Promise.resolve();
		const signal = this.controller.signal;
		const run = this.runRefresh(id, source, options, signal).finally(() => {
			if (this.refreshing.get(id) !== run) return;
			this.refreshing.delete(id);
			this.notify();
		});
		this.refreshing.set(id, run);
		this.notify();
		return run;
	}

	/** Syncs other sessions' writes before checking local freshness, without idle locks. */
	async tick(): Promise<void> {
		const signal = this.controller.signal;
		if (signal.aborted) return;
		await this.cache.sync();
		if (signal.aborted) return;
		await Promise.all(
			this.providers().flatMap((provider) => {
				const entry = this.cache.get(provider.id);
				if (!provider.quota || this.cache.backoff(provider.id) || this.refreshing.has(provider.id))
					return [];
				if (entry && this.options.now() - entry.fetchedAt < this.minAge(provider.quota)) return [];
				return [this.refresh(provider.id)];
			}),
		);
	}

	/** Starts a new session's sync, initial refresh and unreferenced poll timer. */
	async start(): Promise<void> {
		this.stop();
		this.controller = new AbortController();
		const signal = this.controller.signal;
		await this.cache.sync();
		if (signal.aborted) return;
		// Fire and forget: Pi awaits session_start, and endpoints can take seconds.
		for (const provider of this.providers())
			void this.refresh(provider.id).catch(() => this.notify());
		this.timer = setInterval(() => {
			void this.tick().catch(() => this.notify());
		}, 5_000);
		this.timer.unref();
	}

	/** Cancels session-owned work; late source results cannot update the cache. */
	stop(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
		this.controller.abort();
		this.refreshing.clear();
		this.notify();
	}

	private providers(): ProviderEntry[] {
		return enabledQuotaProviders(this.options.registry, this.options.settings());
	}

	private minAge(source: QuotaSource, requested?: number): number {
		return Math.max(
			requested ?? this.options.settings().get("quotas.refreshIntervalSec") * 1000,
			source.minPollMs ?? 0,
		);
	}

	private async runRefresh(
		id: string,
		source: QuotaSource,
		options: RefreshOptions,
		signal: AbortSignal,
	): Promise<void> {
		const acquired = await this.cache.tryAcquire(id, {
			minAgeMs: this.minAge(source, options.minAgeMs),
			...(options.force === undefined ? {} : { force: options.force }),
		});
		if (!acquired || signal.aborted) return;
		try {
			const snapshot = await source.fetch(this.context(id, signal));
			if (signal.aborted) return;
			// Headers observed while this fetch was in flight are newer than its snapshot; keep them.
			await this.cache.putWith(id, (current) => ({
				snapshot,
				...(current?.headers && current.headers.observedAt > snapshot.fetchedAt
					? { headers: current.headers }
					: {}),
				drainage: recordDrainageHistory(current?.drainage ?? [], snapshot, this.options.now()),
			}));
		} catch (error) {
			if (signal.aborted) return;
			await this.cache.fail(id, {
				backoffMs:
					error instanceof ProviderHttpError
						? backoffFor(
								{
									status: error.status,
									...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
								},
								BACKOFF_POLICY,
							)
						: 30_000,
				...(error instanceof ProviderHttpError ? { status: error.status } : {}),
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
