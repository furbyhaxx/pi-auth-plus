/** Pi entrypoint: awaits family registration and wires commands, flags and events. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { credentialStatus, readCredential } from "./core/auth/index.ts";
import { type AppSettings, SETTINGS } from "./core/config/catalog.ts";
import { SettingsStore } from "./core/config/index.ts";
import { conflictMessage, detectConflicts } from "./core/conflicts/index.ts";
import { projectSettingsPath, userSettingsPath } from "./core/paths/index.ts";
import { Registry } from "./core/registry/index.ts";
import { FAMILIES } from "./families/index.ts";
import { registerAuthCommands } from "./ui/commands/index.ts";

const NO_EXTENSIONS = process.argv.some((arg) => arg === "--no-extensions" || arg === "-ne");

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
