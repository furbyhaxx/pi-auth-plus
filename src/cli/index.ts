/** Owns factory-time, read-only quota queries, using Pi's refreshing credential path. */
import { join } from "node:path";
import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { type AppSettings, SETTINGS } from "../core/config/catalog.ts";
import { SettingsStore } from "../core/config/index.ts";
import { cacheDir, userSettingsPath } from "../core/paths/index.ts";
import { redactText } from "../core/redact/index.ts";
import { Registry, registerFamilyProviders } from "../core/registry/index.ts";
import { FAMILIES } from "../families/index.ts";
import { quotaAuthFor } from "../quotas/auth.ts";
import { QuotaEngine } from "../quotas/engine.ts";
import { engineReport, type QuotaReport } from "../quotas/report.ts";
import { enabledQuotaProviders } from "../quotas/settings.ts";
import {
	parseQuotaCliArgs,
	QUOTAS_JSON_FLAG,
	QUOTAS_LIST_FLAG,
	type QuotaCliRequest,
} from "./args.ts";
import { EXIT_OK, EXIT_PARTIAL, EXIT_USAGE, wantsColor, writeFd } from "./io.ts";
import { renderQuotaDiagnostics, renderQuotaTable } from "./table.ts";

/** Registers boolean flags; positionals are read from argv before Pi starts a session. */
export function registerQuotaCliFlags(pi: ExtensionAPI): void {
	for (const [name, format] of [
		[QUOTAS_JSON_FLAG, "JSON"],
		[QUOTAS_LIST_FLAG, "a table"],
	] as const) {
		pi.registerFlag(name, {
			description: `Print quotas as ${format} and exit; optional provider; user settings only (project trust unknown)`,
			type: "boolean",
		});
	}
}

/** Injectable boundaries for a one-shot query without credentials, network or process exit. */
export interface QuotaCliDependencies {
	readonly registry: Registry;
	readonly settings: AppSettings;
	readonly engine: Pick<QuotaEngine, "refresh" | "stop"> & {
		readonly cache: Pick<QuotaEngine["cache"], "sync">;
	};
	readonly report: (ids: readonly string[]) => QuotaReport;
	readonly write: (fd: 1 | 2, text: string) => void;
	readonly color: boolean;
}

async function defaultDependencies(): Promise<QuotaCliDependencies> {
	const registry = new Registry(FAMILIES);
	const settings = new SettingsStore(SETTINGS, { user: userSettingsPath() });
	await settings.load();
	let modelRegistry: Promise<ModelRegistry> | undefined;
	const getModelRegistry = () => {
		modelRegistry ??= (async () => {
			const { ModelRuntime, ModelRegistry } = await import("@earendil-works/pi-coding-agent");
			const runtime = await ModelRuntime.create({
				refreshOnCreate: false,
				allowModelNetwork: false,
			});
			const models = new ModelRegistry(runtime);
			await registerFamilyProviders(models, registry, { settings: () => settings });
			return models;
		})();
		return modelRegistry;
	};
	const engine = new QuotaEngine({
		registry,
		settings: () => settings,
		cachePath: join(cacheDir(), "quotas.json"),
		now: Date.now,
		fetch,
		authFor: async (id) => quotaAuthFor(id, await getModelRegistry()),
	});
	return {
		registry,
		settings,
		engine,
		report: (ids) => engineReport(engine, settings, Date.now(), ids),
		write: writeFd,
		color: wantsColor(),
	};
}

/** Any incomplete provider state makes a one-shot query partial. */
export function reportHasProblems(report: QuotaReport): boolean {
	return report.providers.some((provider) => provider.state !== "ok");
}

/** Syncs the shared cache, refreshes old targets without starting a timer, and prints a report. */
export async function runQuotaCli(
	request: QuotaCliRequest,
	dependencies?: QuotaCliDependencies,
): Promise<number> {
	const deps = dependencies ?? (await defaultDependencies());
	const { registry, settings, engine, write } = deps;
	try {
		const known = registry
			.providers()
			.filter(({ provider }) => provider.quota)
			.map(({ provider }) => provider.id);
		const target =
			request.provider === undefined ? undefined : registry.resolve(request.provider)?.provider;
		if (request.provider !== undefined && !target?.quota) {
			write(2, `Unknown provider "${request.provider}". Known: ${known.join(", ")}\n`);
			return EXIT_USAGE;
		}
		const enabled = enabledQuotaProviders(registry, settings).map((provider) => provider.id);
		if (target && !enabled.includes(target.id)) {
			write(2, `Quota provider "${target.id}" is disabled. Enable it in quotas.providers.\n`);
			return EXIT_USAGE;
		}
		const targets = target ? [target.id] : enabled;
		await engine.cache.sync();
		await Promise.all(
			targets.map((id) =>
				engine.refresh(id, {
					minAgeMs: Math.max(1000, settings.get("quotas.refreshIntervalSec") * 1000),
				}),
			),
		);
		const report = deps.report(targets);
		if (request.json) write(1, `${JSON.stringify(report, null, 2)}\n`);
		else {
			write(1, renderQuotaTable(report, { color: deps.color }));
			const diagnostics = renderQuotaDiagnostics(report);
			if (diagnostics) write(2, diagnostics);
		}
		return reportHasProblems(report) ? EXIT_PARTIAL : EXIT_OK;
	} finally {
		engine.stop();
	}
}

/** Exits only for a quota request, before Pi starts its terminal or session. */
export async function handleQuotaCli(argv: readonly string[]): Promise<void> {
	const request = parseQuotaCliArgs(argv);
	if (!request) return;
	let code: number;
	try {
		code = await runQuotaCli(request);
	} catch (error) {
		writeFd(
			2,
			`Quota query failed: ${redactText(error instanceof Error ? error.message : String(error))}\n`,
		);
		code = EXIT_PARTIAL;
	}
	process.exit(code);
}
