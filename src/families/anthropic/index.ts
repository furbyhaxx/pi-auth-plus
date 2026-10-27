/** Anthropic registers `claude`: Claude Pro/Max OAuth or an API key, shaped like Claude Code. */
import type { PathEnv } from "../../core/paths/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { claudeAuth } from "./oauth.ts";
import { claudeProvider, PROVIDER } from "./provider.ts";
import { claudeQuota } from "./quota.ts";
import { probeInstalledClaude, ReportedVersion, type VersionProbe } from "./version.ts";

export function createAnthropicFamily(
	env: PathEnv = process.env,
	probe: VersionProbe = probeInstalledClaude,
): FamilyAdapter {
	return {
		id: "anthropic",
		label: "Anthropic",
		providers: [
			{
				id: PROVIDER,
				label: "Claude",
				aliases: ["cl", "cc"],
				quota: claudeQuota,
				ambient: () =>
					env["ANTHROPIC_API_KEY"] ? { source: "ANTHROPIC_API_KEY", limited: false } : undefined,
			},
		],
		register: (pi, host) => {
			// The probe spawns `claude --version`, so it waits for the first OAuth request.
			const version = new ReportedVersion(env, probe);
			pi.registerProvider(
				claudeProvider({
					auth: claudeAuth(),
					version: () => version.get(),
					rules: () => host.settings().get("claude.replacePatterns"),
					env,
				}),
			);
			const override = version.override;
			if (override.kind !== "outdated" && override.kind !== "invalid") return;
			let warned = false;
			pi.on("session_start", (_event, ctx) => {
				if (warned) return;
				warned = true;
				ctx.ui.notify(override.warning, "warning");
			});
		},
	};
}
