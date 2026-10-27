/** Carries pi-quotas observations into host quota state without importing endpoint freshness. */
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
}

/** A finished report can be recorded by runOnce; malformed sources remain retryable. */
export interface HistoryMigrationReport {
	readonly finished: boolean;
	readonly unknownProviders: readonly string[];
	readonly changedProviders: readonly string[];
	readonly error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runs the history carry-over once, reporting malformed sources without marking them finished. */
export async function migratePiQuotasHistory(
	options: HistoryMigrationOptions,
): Promise<HistoryMigrationReport> {
	const marker = options.markerPath ?? migrationsPath();
	// Replaying a source after a reversal can resurrect samples discarded by the first merge.
	return withFileLock(marker, async () => {
		let report: HistoryMigrationReport = {
			finished: true,
			unknownProviders: [],
			changedProviders: [],
		};
		await runOnce(
			"pi-quotas-history",
			async () => {
				report = await mergeHistory(options);
				return report.finished;
			},
			marker,
		);
		return report;
	});
}

async function mergeHistory(options: HistoryMigrationOptions): Promise<HistoryMigrationReport> {
	const read = await readJsonFile(options.sourcePath);
	const unknownProviders = new Set<string>();
	const changedProviders: string[] = [];
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
		const changed = await options.cache.patch(id, (current) => {
			const drainage = mergeDrainageHistory(current?.drainage ?? [], incoming, now);
			if (JSON.stringify(drainage) === JSON.stringify(current?.drainage ?? [])) return undefined;
			return { ...current, drainage };
		});
		if (changed) changedProviders.push(id);
	}
	return { finished: true, unknownProviders: [...unknownProviders].sort(), changedProviders };
}
