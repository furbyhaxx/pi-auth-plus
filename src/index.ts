/** Pi entrypoint: awaits family registration and wires commands, flags and events. */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { credentialStatus, readCredential } from "./core/auth/index.ts";
import { type AppSettings, SETTINGS } from "./core/config/catalog.ts";
import { SettingsStore } from "./core/config/index.ts";
import { conflictMessage, detectConflicts, loadsPackage } from "./core/conflicts/index.ts";
import { cacheDir, projectSettingsPath, userSettingsPath } from "./core/paths/index.ts";
import { Registry } from "./core/registry/index.ts";
import { FAMILIES } from "./families/index.ts";
import { registerQuotaBus } from "./quotas/bus.ts";
import { QuotaEngine } from "./quotas/engine.ts";
import type { QuotaAuth } from "./quotas/types.ts";
import { registerAuthCommands } from "./ui/commands/index.ts";

const NO_EXTENSIONS = process.argv.some((arg) => arg === "--no-extensions" || arg === "-ne");

/** Uses Pi's refreshed auth, including header-only bearers, plus stored OAuth extras. */
export async function quotaAuthFor(
	id: string,
	modelRegistry: Pick<ExtensionContext["modelRegistry"], "getProviderAuth"> | undefined,
): Promise<QuotaAuth | undefined> {
	const resolved = await modelRegistry?.getProviderAuth(id);
	const auth = resolved?.auth;
	const authorization = Object.entries(auth?.headers ?? {}).find(
		([name]) => name.toLowerCase() === "authorization",
	)?.[1];
	const token =
		auth?.apiKey ||
		(typeof authorization === "string"
			? /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim()
			: undefined);
	if (!token) return undefined;
	const stored = readCredential(id);
	return { token, extra: stored?.type === "oauth" ? stored.extra : {} };
}

export default async function piAuthPlus(pi: ExtensionAPI): Promise<void> {
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
	let stopQuotaBus: (() => void) | undefined;
	pi.on("session_start", async (_event, ctx) => {
		stopQuotaBus?.();
		stopQuotaBus = undefined;
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
		await quotas.start(ctx);
		stopQuotaBus = registerQuotaBus(pi.events, quotas, registry, () => settings, Date.now);
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
