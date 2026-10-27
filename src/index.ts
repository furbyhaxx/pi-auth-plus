/** Pi entrypoint: awaits family registration and wires commands, flags and events. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { credentialStatus, readCredential } from "./core/auth/index.ts";
import { conflictMessage, detectConflicts } from "./core/conflicts/index.ts";
import { Registry } from "./core/registry/index.ts";
import { FAMILIES } from "./families/index.ts";
import { registerAuthCommands } from "./ui/commands/index.ts";

const NO_EXTENSIONS = process.argv.some((arg) => arg === "--no-extensions" || arg === "-ne");

export default async function piAuthPlus(pi: ExtensionAPI): Promise<void> {
	const registry = new Registry(FAMILIES);
	for (const family of registry.families) await family.register?.(pi);
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
