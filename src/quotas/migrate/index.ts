/** Carries pi-quotas settings and drainage history over once pi-quotas is no longer loaded. */
import { join } from "node:path";
import type { AppSettings } from "../../core/config/catalog.ts";
import { agentDir } from "../../core/paths/index.ts";
import type { Registry } from "../../core/registry/index.ts";
import type { QuotaEngine } from "../engine.ts";
import { migratePiQuotasHistory } from "./history.ts";
import { migratePiQuotasSettings } from "./settings.ts";

/** What a session should tell the user; empty arrays mean nothing to say. */
export interface CarryOverNotes {
	readonly info: readonly string[];
	readonly warnings: readonly string[];
}

/** Runs both carry-overs; failures become warnings so quotas still start. */
export async function carryOverPiQuotas(options: {
	readonly settings: AppSettings;
	readonly registry: Registry;
	readonly engine: Pick<QuotaEngine, "cache">;
	readonly cwd: string;
	readonly projectTrusted: boolean;
	readonly dir?: string;
	readonly signal?: AbortSignal;
}): Promise<CarryOverNotes> {
	const dir = options.dir ?? agentDir();
	const info: string[] = [];
	const warnings: string[] = [];
	if (options.signal?.aborted) return { info, warnings };
	const settings = await migratePiQuotasSettings({
		settings: options.settings,
		registry: options.registry,
		sources: {
			user: join(dir, "quotas.json"),
			...(options.projectTrusted ? { project: join(options.cwd, ".pi", "quotas.json") } : {}),
		},
	});
	if (options.signal?.aborted) return { info, warnings };
	if (settings.migrated.length > 0) {
		const keys = settings.migrated.map(({ scope, key }) => `${key} (${scope})`).join(", ");
		info.push(`Carried pi-quotas settings into auth-plus.json: ${keys}`);
	}
	if (settings.unknownProviders.length > 0) {
		const names = settings.unknownProviders.map(({ name }) => name).join(", ");
		warnings.push(`Skipped unknown pi-quotas providers: ${names}`);
	}
	for (const problem of settings.problems)
		warnings.push(`${problem.path}${problem.key ? ` ${problem.key}` : ""}: ${problem.reason}`);
	try {
		const history = await migratePiQuotasHistory({
			cache: options.engine.cache,
			registry: options.registry,
			sourcePath: join(dir, "cache", "quotas-cache.json"),
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		if (options.signal?.aborted) return { info, warnings };
		if (history.error) warnings.push(history.error);
		if (history.unknownProviders.length > 0)
			warnings.push(`Skipped pi-quotas history for: ${history.unknownProviders.join(", ")}`);
	} catch (error) {
		if (options.signal?.aborted) return { info, warnings };
		warnings.push(
			`Cannot carry over pi-quotas history: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return { info, warnings };
}
