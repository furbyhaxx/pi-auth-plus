/** Carries pi-quotas settings into unset auth-plus file keys without changing the legacy files. */
import { dirname, resolve } from "node:path";
import { type AppSettings, SETTINGS } from "../../core/config/catalog.ts";
import type { FieldValue, SettingsProblem } from "../../core/config/index.ts";
import { readJsonFile } from "../../core/fs/index.ts";
import { runOnce } from "../../core/migrations/index.ts";
import { projectSettingsPath, userSettingsPath } from "../../core/paths/index.ts";
import type { Registry } from "../../core/registry/index.ts";

type FileScope = "user" | "project";
type QuotaKey = Extract<keyof typeof SETTINGS, `quotas.${string}`>;

/** Completed writes and actionable skips from this invocation, separated by file scope. */
export interface MigrationReport {
	readonly migrated: readonly { readonly scope: FileScope; readonly key: QuotaKey }[];
	readonly unknownProviders: readonly { readonly scope: FileScope; readonly name: string }[];
	readonly problems: readonly (SettingsProblem & { readonly scope: FileScope })[];
}

/** Source paths are explicit; callers omit project until its settings scope is trusted. */
export interface SettingsMigrationOptions {
	readonly settings: AppSettings;
	readonly registry: Registry;
	readonly sources: { readonly user?: string; readonly project?: string };
}

const KEYS = [
	"refreshIntervalSec",
	"refreshOnRequest",
	"enabledProviders",
	"linePlacement",
	"percentDisplay",
	"compactWidthCols",
	"alwaysShortIds",
	"creditHealthyUsd",
	"creditCriticalUsd",
	"lineTemplate",
] as const;

/** Fills only source keys present on disk, recording each successfully processed scope once. */
export async function migratePiQuotasSettings({
	settings,
	registry,
	sources,
}: SettingsMigrationOptions): Promise<MigrationReport> {
	const migrated: { scope: FileScope; key: QuotaKey }[] = [];
	const unknownProviders: { scope: FileScope; name: string }[] = [];
	const problems: (SettingsProblem & { scope: FileScope })[] = [];
	for (const scope of ["user", "project"] as const) {
		const supplied = sources[scope];
		if (supplied === undefined) continue;
		const source = resolve(supplied);
		const target =
			scope === "user" ? userSettingsPath() : projectSettingsPath(dirname(dirname(source)));
		try {
			await runOnce(`pi-quotas-settings:${source}`, async () => {
				const legacy = await readJsonFile(source);
				if (legacy.kind === "missing") return true;
				if (legacy.kind === "malformed" || !isObject(legacy.value)) {
					problems.push({
						scope,
						path: source,
						reason: "Cannot migrate pi-quotas settings: fix the source JSON object and retry",
					});
					return false;
				}
				const current = await readJsonFile(target);
				if (current.kind === "malformed" || (current.kind === "ok" && !isObject(current.value))) {
					problems.push({
						scope,
						path: target,
						reason: "Cannot migrate pi-quotas settings: fix the target JSON object and retry",
					});
					return false;
				}
				const quotas =
					current.kind === "ok" && isObject(current.value) ? current.value["quotas"] : undefined;
				const changes: Record<string, FieldValue> = {};
				const filled: QuotaKey[] = [];
				for (const name of KEYS) {
					if (!Object.hasOwn(legacy.value, name)) continue;
					const leaf = name === "enabledProviders" ? "providers" : name;
					if (isObject(quotas) && Object.hasOwn(quotas, leaf)) continue;
					const key = `quotas.${leaf}` as const;
					let raw = legacy.value[name];
					if (name === "enabledProviders") {
						const names = SETTINGS["quotas.providers"].parse(raw);
						if (names !== undefined) {
							const ids = new Set<string>();
							for (const token of names) {
								const resolved = registry.resolve(token);
								if (resolved) ids.add(resolved.provider.id);
								else unknownProviders.push({ scope, name: token });
							}
							// pi-quotas treats a list with no recognized ids as every source.
							raw = [...ids];
						}
					}
					const parsed = SETTINGS[key].parse(raw);
					if (parsed === undefined) {
						problems.push({
							scope,
							path: source,
							key: name,
							reason: `Invalid value for ${key}; skipped, edit auth-plus.json to set it`,
						});
						continue;
					}
					changes[key] = parsed;
					filled.push(key);
				}
				if (filled.length > 0) {
					await settings.save(scope, changes);
					for (const key of filled) migrated.push({ scope, key });
				}
				return true;
			});
		} catch (error) {
			problems.push({
				scope,
				path: source,
				reason: `Cannot carry over pi-quotas settings: ${error instanceof Error ? error.message : String(error)}; fix file access and retry`,
			});
		}
	}
	return { migrated, unknownProviders, problems };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
