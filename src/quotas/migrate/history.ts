/** Carries pi-quotas observations into host quota state without importing endpoint freshness. */
import { randomBytes } from "node:crypto";
import { renameSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { HostCache } from "../../core/cache/index.ts";
import { withFileLock } from "../../core/cache/lock.ts";
import { readJsonFile } from "../../core/fs/index.ts";
import { migrationsPath, runOnce } from "../../core/migrations/index.ts";
import type { Registry } from "../../core/registry/index.ts";
import { type DrainageHistory, mergeDrainageHistory, parseDrainageHistory } from "../drainage.ts";
import type { QuotaState } from "../state.ts";

/** Dependencies and legacy source location for a history carry-over. */
export interface HistoryMigrationOptions {
	readonly cache: HostCache<QuotaState>;
	readonly registry: Registry;
	readonly sourcePath: string;
	readonly now?: () => number;
	readonly markerPath?: string;
	readonly signal?: AbortSignal;
}

/** A finished report records the migration; malformed sources remain retryable. */
export interface HistoryMigrationReport {
	readonly finished: boolean;
	readonly unknownProviders: readonly string[];
	readonly changedProviders: readonly string[];
	readonly error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HISTORY_KEY = "pi-quotas-history";
const PROVIDER_PROGRESS_PREFIX = `${HISTORY_KEY}:provider:`;

async function readMarkers(path: string): Promise<Record<string, string>> {
	const read = await readJsonFile(path);
	if (read.kind !== "ok" || typeof read.value !== "object" || read.value === null) return {};
	return Object.fromEntries(
		Object.entries(read.value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

async function publishMarkers(
	path: string,
	markers: Record<string, string>,
	signal?: AbortSignal,
): Promise<boolean> {
	if (signal?.aborted) return false;
	const temp = join(
		dirname(path),
		`.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
	);
	const handle = await open(temp, "wx", 0o644);
	let closed = false;
	let published = false;
	try {
		if (signal?.aborted) return false;
		await handle.writeFile(`${JSON.stringify(markers, null, "\t")}\n`, "utf8");
		if (signal?.aborted) return false;
		await handle.close();
		closed = true;
		if (signal?.aborted) return false;
		// Cancellation cannot interleave with the final check and atomic rename.
		renameSync(temp, path);
		published = true;
		return true;
	} finally {
		try {
			if (!closed) await handle.close();
		} finally {
			if (!published) await rm(temp, { force: true });
		}
	}
}

/** Runs the history carry-over once, reporting malformed sources without marking them finished. */
export async function migratePiQuotasHistory(
	options: HistoryMigrationOptions,
): Promise<HistoryMigrationReport> {
	const empty = (finished: boolean): HistoryMigrationReport => ({
		finished,
		unknownProviders: [],
		changedProviders: [],
	});
	const marker = options.markerPath ?? migrationsPath();
	if (options.signal?.aborted) return empty(false);
	return withFileLock(marker, async () => {
		if (options.signal?.aborted) return empty(false);
		const markers = await readMarkers(marker);
		if (options.signal?.aborted) return empty(false);
		if (markers[HISTORY_KEY] !== undefined) return empty(true);
		const report = await mergeHistory(options, marker);
		if (options.signal?.aborted) return { ...report, finished: false };
		if (!report.finished) return report;
		const latest = await readMarkers(marker);
		if (options.signal?.aborted) return { ...report, finished: false };
		for (const key of Object.keys(latest)) {
			if (key.startsWith(PROVIDER_PROGRESS_PREFIX)) delete latest[key];
		}
		latest[HISTORY_KEY] = new Date().toISOString();
		if (!(await publishMarkers(marker, latest, options.signal)))
			return { ...report, finished: false };
		return report;
	});
}

async function mergeHistory(
	options: HistoryMigrationOptions,
	marker: string,
): Promise<HistoryMigrationReport> {
	const read = await readJsonFile(options.sourcePath);
	const unknownProviders = new Set<string>();
	const changedProviders: string[] = [];
	const cancelled = (): HistoryMigrationReport => ({
		finished: false,
		unknownProviders: [...unknownProviders].sort(),
		changedProviders,
	});
	if (options.signal?.aborted) return cancelled();
	const malformed = (): HistoryMigrationReport => ({
		finished: false,
		unknownProviders: [...unknownProviders].sort(),
		changedProviders,
		error: `Cannot migrate pi-quotas history from ${options.sourcePath}: malformed cache. Repair the source JSON and restart to retry.`,
	});
	if (read.kind === "missing") return { finished: true, unknownProviders: [], changedProviders };
	if (read.kind === "malformed") return malformed();
	const raw = read.value;
	if (!isRecord(raw) || raw["version"] !== 1 || !Array.isArray(raw["history"])) return malformed();
	const now = (options.now ?? Date.now)();
	const grouped = new Map<string, DrainageHistory[]>();
	for (const entry of raw["history"]) {
		if (!isRecord(entry) || typeof entry["provider"] !== "string") return malformed();
		const resolved = options.registry.resolve(entry["provider"]);
		if (!resolved) {
			unknownProviders.add(entry["provider"]);
			continue;
		}
		const parsed = parseDrainageHistory([entry], now);
		if (parsed.length !== 1) return malformed();
		const id = resolved.provider.id;
		const history = grouped.get(id) ?? [];
		history.push(...parsed);
		grouped.set(id, history);
	}
	for (const [id, incoming] of grouped) {
		if (options.signal?.aborted) return cancelled();
		// A committed merge must not be replayed after a reversal discards older samples.
		await runOnce(
			`${PROVIDER_PROGRESS_PREFIX}${id}`,
			async () => {
				if (options.signal?.aborted) return false;
				const changed = await options.cache.patch(
					id,
					(current) => {
						const drainage = mergeDrainageHistory(current?.drainage ?? [], incoming, now);
						if (JSON.stringify(drainage) === JSON.stringify(current?.drainage ?? []))
							return undefined;
						return { ...current, drainage };
					},
					options.signal,
				);
				if (changed) changedProviders.push(id);
				return changed || !options.signal?.aborted;
			},
			marker,
		);
		if (options.signal?.aborted) return cancelled();
	}
	return { finished: true, unknownProviders: [...unknownProviders].sort(), changedProviders };
}
