/** OpenCode family: patches Pi's builtin `opencode` (Zen) and `opencode-go` providers. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AmbientCredential } from "../../core/auth/index.ts";
import { readJsonFile } from "../../core/fs/index.ts";
import { modelsPath, type PathEnv } from "../../core/paths/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { applyCliEnv, applyCliIdentity, envBlock, IdSource } from "./identity.ts";
import { opencodePhysicalHooks } from "./physical.ts";

export const ZEN_PROVIDER = "opencode";
export const GO_PROVIDER = "opencode-go";
/** Pi's builtin opencode providers read this variable. */
export const ENV_KEY = "OPENCODE_API_KEY";
/** Zen's anonymous bearer, the value the CLI itself sends without an account. */
export const ANONYMOUS_KEY = "public";

const ANONYMOUS: AmbientCredential = { source: "anonymous", limited: true };

/**
 * The credential Pi uses for a provider when `auth.json` has none. Pi resolves a stored
 * credential first, then an extension or models.json `apiKey`, then the environment. Zen falls
 * back to the anonymous key, registered only when nothing else exists so it shadows no key;
 * a later `/login` still wins, because stored credentials outrank every configured key.
 */
export function ambientFor(
	env: PathEnv,
	models: unknown,
	providerId: string,
): AmbientCredential | undefined {
	if (configuredKey(models, providerId) !== undefined)
		return { source: "models.json", limited: false };
	if (env[ENV_KEY]) return { source: ENV_KEY, limited: false };
	return providerId === ZEN_PROVIDER ? ANONYMOUS : undefined;
}

function configuredKey(models: unknown, providerId: string): unknown {
	if (typeof models !== "object" || models === null) return undefined;
	const providers = (models as { providers?: unknown }).providers;
	if (typeof providers !== "object" || providers === null) return undefined;
	const provider = (providers as Record<string, unknown>)[providerId];
	if (typeof provider !== "object" || provider === null) return undefined;
	return (provider as { apiKey?: unknown }).apiKey;
}

export function createOpencodeFamily(
	env: PathEnv = process.env,
	now: () => number = Date.now,
): FamilyAdapter {
	let models: unknown;
	const ids = new IdSource();
	let sessionId = ids.session(now());
	return {
		id: "opencode",
		label: "OpenCode",
		providers: [
			{
				id: ZEN_PROVIDER,
				label: "OpenCode Zen",
				aliases: ["zen"],
				ambient: () => ambientFor(env, models, ZEN_PROVIDER),
			},
			{
				id: GO_PROVIDER,
				label: "OpenCode Go",
				aliases: ["go"],
				ambient: () => ambientFor(env, models, GO_PROVIDER),
			},
		],
		prepareProviders: async () => {
			const read = await readJsonFile(modelsPath(env));
			models = read.kind === "ok" ? read.value : undefined;
		},
		providerRegistrations: () =>
			ambientFor(env, models, ZEN_PROVIDER) === ANONYMOUS
				? [{ name: ZEN_PROVIDER, config: { apiKey: ANONYMOUS_KEY } }]
				: [],
		physical: (model, host) => opencodePhysicalHooks(model, host.cwd, sessionId),
		register: (pi: ExtensionAPI, host) => {
			pi.on("session_start", () => {
				sessionId = ids.session(now());
			});
			pi.on("before_provider_headers", (event, ctx) => {
				if (host.physicalHooksAvailable?.()) return;
				const provider = ctx?.model?.provider;
				if (provider && provider !== ZEN_PROVIDER && provider !== GO_PROVIDER) return;
				applyCliIdentity(event.headers, sessionId);
			});
			// Without physical hooks, the session model is the best available provider hint.
			pi.on("before_provider_request", (event, ctx) => {
				if (host.physicalHooksAvailable?.()) return;
				const model = ctx.model;
				if (!model || (model.provider !== ZEN_PROVIDER && model.provider !== GO_PROVIDER)) return;
				const payload = event.payload as { model?: unknown } | null;
				if (payload?.model !== model.id) return;
				return applyCliEnv(payload, envBlock(ctx.cwd, process.platform)) ? payload : undefined;
			});
		},
	};
}
