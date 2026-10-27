/** Owns host-shared JSON caches: newest-wins entries, refresh leases, failure backoff. */
import { stat } from "node:fs/promises";
import { atomicWriteFile, readJsonFile } from "../fs/index.ts";
import { withFileLock } from "./lock.ts";

export interface CacheEntry<T> {
	readonly value: T;
	readonly fetchedAt: number;
	readonly updatedAt: number;
	/** Bumped by a parser change; older entries from older sessions are ignored. */
	readonly parserVersion: number;
}

export interface Backoff {
	readonly until: number;
	readonly status?: number;
	readonly error?: string;
}

export interface HostCacheOptions<T> {
	readonly path: string;
	/** Validates a stored value at the read boundary. */
	readonly parse: (raw: unknown) => T | undefined;
	readonly parserVersion: (key: string) => number;
	readonly now?: () => number;
	/** How long a refresh lease blocks other sessions. */
	readonly leaseMs?: number;
	readonly rateLimitStatuses?: readonly number[];
}

export interface AcquireOptions {
	/** Skip the refresh when the entry is younger than this. */
	readonly minAgeMs: number;
	/** Ignore freshness, leases and non-rate-limit backoff (a user-requested refresh). */
	readonly force?: boolean;
}

export type CacheListener<T> = (key: string, entry: CacheEntry<T>) => void;

export const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RATE_LIMIT_STATUSES: readonly number[] = [429];

interface DiskPayload {
	readonly version: 1;
	readonly entries: Record<string, CacheEntry<unknown>>;
	readonly leases: Record<string, number>;
	readonly backoff: Record<string, Backoff>;
}

export class HostCache<T> {
	private readonly options: HostCacheOptions<T>;
	private readonly now: () => number;
	private readonly entries = new Map<string, CacheEntry<T>>();
	private readonly leases = new Map<string, number>();
	private readonly backoffs = new Map<string, Backoff>();
	private readonly listeners = new Set<CacheListener<T>>();
	private lastMtimeMs = -1;
	private writeChain: Promise<void> = Promise.resolve();

	constructor(options: HostCacheOptions<T>) {
		this.options = options;
		this.now = options.now ?? Date.now;
	}

	get(key: string): CacheEntry<T> | undefined {
		return this.entries.get(key);
	}

	all(): ReadonlyMap<string, CacheEntry<T>> {
		return this.entries;
	}

	backoff(key: string): Backoff | undefined {
		const backoff = this.backoffs.get(key);
		return backoff && backoff.until > this.now() ? backoff : undefined;
	}

	onChange(listener: CacheListener<T>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Merge what other sessions wrote; returns whether any entry changed. */
	async sync(force = false): Promise<boolean> {
		const mtime = await stat(this.options.path).then(
			(s) => s.mtimeMs,
			() => undefined,
		);
		if (mtime === undefined || (!force && mtime === this.lastMtimeMs)) return false;
		const read = await readJsonFile(this.options.path);
		this.lastMtimeMs = mtime;
		return read.kind === "ok" ? this.merge(read.value) : false;
	}

	/** True when this session should fetch `key`; it then holds a lease other sessions respect. */
	async tryAcquire(key: string, options: AcquireOptions): Promise<boolean> {
		return this.mutate(() => {
			const now = this.now();
			const backoff = this.backoff(key);
			const rateLimitStatuses = this.options.rateLimitStatuses ?? DEFAULT_RATE_LIMIT_STATUSES;
			if (
				backoff &&
				(!options.force ||
					(backoff.status !== undefined && rateLimitStatuses.includes(backoff.status)))
			)
				return false;
			if (!options.force) {
				if ((this.leases.get(key) ?? 0) > now) return false;
				const entry = this.entries.get(key);
				if (entry && now - entry.fetchedAt < options.minAgeMs) return false;
			}
			this.leases.set(key, now + (this.options.leaseMs ?? DEFAULT_LEASE_MS));
			return true;
		});
	}

	/** Store a fresh value; releases the lease and clears backoff. */
	async put(key: string, value: T): Promise<void> {
		await this.putWith(key, () => value);
	}

	/** Like `put`, but derives the value from the entry current under the file lock. */
	async putWith(key: string, change: (current: T | undefined) => T): Promise<void> {
		const entry = await this.mutate(() => {
			const now = this.now();
			const next: CacheEntry<T> = {
				value: change(this.entries.get(key)?.value),
				fetchedAt: now,
				updatedAt: now,
				parserVersion: this.options.parserVersion(key),
			};
			this.entries.set(key, next);
			this.leases.delete(key);
			this.backoffs.delete(key);
			return next;
		});
		this.notify(key, entry);
	}

	/** Change a value without refreshing endpoint freshness, releasing a lease or clearing backoff. */
	async patch(key: string, change: (current: T | undefined) => T | undefined): Promise<boolean> {
		const entry = await this.mutate(() => {
			const current = this.entries.get(key);
			const value = change(current?.value);
			if (value === undefined) return undefined;
			const patched: CacheEntry<T> = {
				value,
				fetchedAt: current?.fetchedAt ?? 0,
				updatedAt: this.now(),
				parserVersion: current?.parserVersion ?? this.options.parserVersion(key),
			};
			this.entries.set(key, patched);
			return patched;
		});
		if (entry === undefined) return false;
		this.notify(key, entry);
		return true;
	}

	/** Record a failed fetch; the stored value stays, the key backs off for `backoffMs`. */
	async fail(
		key: string,
		failure: { readonly backoffMs: number; readonly status?: number; readonly error?: string },
	): Promise<void> {
		await this.mutate(() => {
			this.leases.delete(key);
			this.backoffs.set(key, {
				until: this.now() + failure.backoffMs,
				...(failure.status === undefined ? {} : { status: failure.status }),
				...(failure.error === undefined ? {} : { error: failure.error }),
			});
		});
	}

	/** Read-merge-write under the file lock, serialized within this process. */
	private mutate<R>(change: () => R): Promise<R> {
		const op = this.writeChain.then(() =>
			withFileLock(this.options.path, async () => {
				await this.sync(true);
				const result = change();
				await atomicWriteFile(this.options.path, JSON.stringify(this.payload()), {
					mode: 0o600,
					dirMode: 0o700,
				});
				this.lastMtimeMs = await stat(this.options.path).then(
					(s) => s.mtimeMs,
					() => -1,
				);
				return result;
			}),
		);
		this.writeChain = op.then(
			() => undefined,
			() => undefined,
		);
		return op;
	}

	private merge(raw: unknown): boolean {
		if (!isRecord(raw) || raw["version"] !== 1) return false;
		let changed = false;
		for (const [key, value] of Object.entries(asRecord(raw["entries"]))) {
			const incoming = this.parseEntry(key, value);
			if (incoming === undefined) continue;
			const existing = this.entries.get(key);
			// On equal timestamps the file wins unless it holds this entry as written: local entries only change in mutate.
			if (
				existing &&
				(existing.updatedAt > incoming.updatedAt ||
					(existing.updatedAt === incoming.updatedAt &&
						JSON.stringify(existing) === JSON.stringify(value)))
			)
				continue;
			this.entries.set(key, incoming);
			this.notify(key, incoming);
			changed = true;
		}
		for (const [key, until] of Object.entries(asRecord(raw["leases"]))) {
			if (typeof until === "number")
				this.leases.set(key, Math.max(this.leases.get(key) ?? 0, until));
		}
		for (const [key, value] of Object.entries(asRecord(raw["backoff"]))) {
			const backoff = parseBackoff(value);
			if (backoff && backoff.until >= (this.backoffs.get(key)?.until ?? 0)) {
				this.backoffs.set(key, backoff);
			}
		}
		return changed;
	}

	private parseEntry(key: string, raw: unknown): CacheEntry<T> | undefined {
		if (!isRecord(raw)) return undefined;
		const { fetchedAt, parserVersion } = raw;
		if (typeof fetchedAt !== "number" || typeof parserVersion !== "number") return undefined;
		const updatedAt = raw["updatedAt"] === undefined ? fetchedAt : raw["updatedAt"];
		if (typeof updatedAt !== "number") return undefined;
		if (parserVersion < this.options.parserVersion(key)) return undefined;
		const value = this.options.parse(raw["value"]);
		return value === undefined ? undefined : { value, fetchedAt, updatedAt, parserVersion };
	}

	private payload(): DiskPayload {
		const now = this.now();
		return {
			version: 1,
			entries: Object.fromEntries(this.entries),
			leases: Object.fromEntries([...this.leases].filter(([, until]) => until > now)),
			backoff: Object.fromEntries([...this.backoffs].filter(([, b]) => b.until > now)),
		};
	}

	private notify(key: string, entry: CacheEntry<T>): void {
		for (const listener of this.listeners) listener(key, entry);
	}
}

/** Honors Retry-After for rate-limit statuses (default 429), capped at `maxMs`. */
export function backoffFor(
	failure: { readonly status?: number; readonly retryAfterMs?: number },
	policy: {
		readonly defaultMs: number;
		readonly rateLimitMs: number;
		readonly maxMs: number;
		readonly rateLimitStatuses?: readonly number[];
	},
): number {
	const rateLimitStatuses = policy.rateLimitStatuses ?? DEFAULT_RATE_LIMIT_STATUSES;
	if (failure.status === undefined || !rateLimitStatuses.includes(failure.status))
		return policy.defaultMs;
	const hinted = failure.retryAfterMs;
	return Math.min(hinted !== undefined && hinted > 0 ? hinted : policy.rateLimitMs, policy.maxMs);
}

function parseBackoff(raw: unknown): Backoff | undefined {
	if (!isRecord(raw) || typeof raw["until"] !== "number") return undefined;
	const { status, error } = raw;
	return {
		until: raw["until"],
		...(typeof status === "number" ? { status } : {}),
		...(typeof error === "string" ? { error } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}
