/** Anthropic registers `claude`: Claude Pro/Max OAuth or an API key, shaped like Claude Code. */
import type { TextRule } from "../../core/config/fields.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import type { TokenCounter } from "../../tokens/types.ts";
import { claudeTokenCounter } from "./count.ts";
import { claudeAuth } from "./oauth.ts";
import { claudeProvider, PROVIDER } from "./provider.ts";
import { claudeQuota } from "./quota.ts";
import { probeInstalledClaude, ReportedVersion, type VersionProbe } from "./version.ts";

export function createAnthropicFamily(
	env: PathEnv = process.env,
	probe: VersionProbe = probeInstalledClaude,
): FamilyAdapter {
	// Constructing the version does not probe; the first OAuth request does.
	const version = new ReportedVersion(env, probe);
	const counters = new Map<string, TokenCounter>();
	let rules: () => readonly TextRule[] = () => [];
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
		providerRegistrations: (host) => {
			rules = () => host.settings().get("claude.replacePatterns");
			return [
				{
					provider: claudeProvider({
						auth: claudeAuth(),
						version: () => version.get(),
						rules: () => rules(),
						env,
					}),
				},
			];
		},
		tokens: (model, deps) => {
			if (model.provider !== PROVIDER) return undefined;
			let counter = counters.get(model.id);
			if (!counter) {
				counter = claudeTokenCounter(model, deps, {
					version: () => version.get(),
					rules: () => rules(),
					env,
				});
				counters.set(model.id, counter);
			}
			return counter;
		},
		register: (pi) => {
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
