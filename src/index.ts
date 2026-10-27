/** Pi entrypoint: awaits family registration and wires commands, flags and events. */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleQuotaCli, registerQuotaCliFlags } from "./cli/index.ts";
import { credentialStatus, readCredential } from "./core/auth/index.ts";
import { type AppSettings, SETTINGS } from "./core/config/catalog.ts";
import { SettingsStore } from "./core/config/index.ts";
import { conflictMessage, detectConflicts, loadsPackage } from "./core/conflicts/index.ts";
import { cacheDir, projectSettingsPath, userSettingsPath } from "./core/paths/index.ts";
import { Registry, registerFamilyProviders } from "./core/registry/index.ts";
import { FAMILIES } from "./families/index.ts";
import { quotaAuthFor } from "./quotas/auth.ts";
import { registerQuotaBus } from "./quotas/bus.ts";
import { QuotaEngine } from "./quotas/engine.ts";
import { createQuotaLine } from "./quotas/line/index.ts";
import { quotaLineConfig } from "./quotas/line/line.ts";
import { formatPlainTextSummary } from "./quotas/line/summary.ts";
import { engineReport } from "./quotas/report.ts";
import { registerAuthCommands } from "./ui/commands/index.ts";

const NO_EXTENSIONS = process.argv.some((arg) => arg === "--no-extensions" || arg === "-ne");

export default async function piAuthPlus(pi: ExtensionAPI): Promise<void> {
	registerQuotaCliFlags(pi);
	await handleQuotaCli(process.argv.slice(2));
	const registry = new Registry(FAMILIES);
	let settings: AppSettings = new SettingsStore(SETTINGS, { user: userSettingsPath() });
	// Registered before the families so their session_start handlers see this session's settings.
	pi.on("session_start", async (_event, ctx) => {
		const project = ctx.isProjectTrusted() ? projectSettingsPath(ctx.cwd) : undefined;
		settings = new SettingsStore(
			SETTINGS,
			project ? { user: userSettingsPath(), project } : { user: userSettingsPath() },
		);
		const problems = await settings.load();
		if (problems.length > 0) {
			const lines = problems.map((p) => `${p.path}${p.key ? ` ${p.key}` : ""}: ${p.reason}`);
			ctx.ui.notify(`pi-auth-plus settings:\n${lines.join("\n")}`, "warning");
		}
	});
	let quotaContext: ExtensionContext | undefined;
	let quotasEnabled = false;
	const quotas = new QuotaEngine({
		registry,
		cachePath: join(cacheDir(), "quotas.json"),
		settings: () => settings,
		now: Date.now,
		fetch,
		authFor: (id) => quotaAuthFor(id, quotaContext?.modelRegistry),
	});
	const quotaLine = createQuotaLine(pi, {
		engine: quotas,
		registry,
		settings: () => settings,
		now: Date.now,
	});
	let stopQuotaBus: (() => void) | undefined;
	pi.on("session_start", async (_event, ctx) => {
		stopQuotaBus?.();
		stopQuotaBus = undefined;
		quotaLine.stop();
		quotas.stop();
		quotaContext = ctx;
		const configured = NO_EXTENSIONS ? {} : pi.getSettings();
		const commandPaths = pi.getCommands().map((command) => command.sourceInfo.path);
		quotasEnabled = !loadsPackage(
			"pi-quotas",
			configured.packages ?? [],
			configured.extensions ?? [],
			commandPaths,
		);
		if (!quotasEnabled) return;
		await quotas.start();
		stopQuotaBus = registerQuotaBus(pi.events, quotas, registry, () => settings, Date.now);
		quotaLine.start(ctx);
	});
	const pendingIngests = new Set<Promise<unknown>>();
	pi.on("session_shutdown", async () => {
		// Print mode exits right after the turn; let header writes land, bounded.
		await Promise.race([
			Promise.allSettled(pendingIngests),
			new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
		]);
		quotasEnabled = false;
		quotaContext = undefined;
		stopQuotaBus?.();
		stopQuotaBus = undefined;
		quotaLine.stop();
		quotas.stop();
	});
	pi.on("after_provider_response", (event, ctx) => {
		if (!quotasEnabled) return;
		const ingest = quotas.ingestHeaders(event.headers, ctx.model?.provider);
		pendingIngests.add(ingest);
		void ingest.finally(() => pendingIngests.delete(ingest));
	});
	pi.on("agent_end", (_event, ctx) => {
		if (!quotasEnabled || !settings.get("quotas.refreshOnRequest")) return;
		quotaContext = ctx;
		const id = ctx.model?.provider;
		if (id && registry.byId(id)?.provider.quota) void quotas.refresh(id, { minAgeMs: 2000 });
	});
	const host = { settings: () => settings };
	await registerFamilyProviders(pi, registry, host);
	for (const family of registry.families) await family.register?.(pi, host);
	registerAuthCommands(pi, {
		registry,
		status: (providerId) => {
			const stored = credentialStatus(readCredential(providerId), Date.now());
			if (stored.state !== "missing") return stored;
			const ambient = registry.resolve(providerId)?.provider.ambient?.();
			return ambient ? { state: "ambient", ...ambient } : stored;
		},
		now: Date.now,
		quotas: () =>
			quotasEnabled
				? {
						report: () => engineReport(quotas, settings, Date.now()),
						refreshing: (id) =>
							quotas.view().some((view) => view.provider.id === id && view.refreshing),
						refresh: (id, force) => quotas.refresh(id, { force, minAgeMs: 0 }),
						onChange: (listener) => quotas.onChange(listener),
						lineConfig: () => quotaLineConfig(settings),
						linePlacement: () => settings.get("quotas.linePlacement"),
						setLinePlacement: async (next) => {
							await settings.save("user", { "quotas.linePlacement": next });
							quotaLine.settingsChanged();
						},
						now: Date.now,
						text: (provider) =>
							formatPlainTextSummary(
								quotas.view(),
								quotaLineConfig(settings),
								provider,
								Date.now(),
							),
					}
				: "pi-quotas is loaded and still owns quotas. Remove it from your Pi settings to use these.",
		settings: {
			store: () => settings,
			onSaved: () => quotaLine.settingsChanged(),
			preview: (source, width, theme) => quotaLine.preview(source, width, theme),
		},
	});

	let warned = false;
	pi.on("session_start", (_event, ctx) => {
		if (warned) return;
		warned = true;
		// With --no-extensions Pi skips configured packages; only explicit -e loads count then.
		const settings = NO_EXTENSIONS ? {} : pi.getSettings();
		const commandPaths = pi.getCommands().map((command) => command.sourceInfo.path);
		const conflicts = detectConflicts(
			settings.packages ?? [],
			settings.extensions ?? [],
			commandPaths,
		);
		if (conflicts.length > 0) ctx.ui.notify(conflictMessage(conflicts), "warning");
	});
}
