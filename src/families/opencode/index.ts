/** OpenCode family: patches Pi's builtin `opencode` (Zen) and `opencode-go` providers. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readJsonFile } from "../../core/fs/index.ts";
import { modelsPath, type PathEnv } from "../../core/paths/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { applyCliIdentity, IdSource } from "./identity.ts";

export const ZEN_PROVIDER = "opencode";
export const GO_PROVIDER = "opencode-go";
/** Pi's builtin opencode providers read this variable. */
export const ENV_KEY = "OPENCODE_API_KEY";
/** Zen's anonymous bearer, the value the CLI itself sends without an account. */
export const ANONYMOUS_KEY = "public";

/**
 * Whether Zen needs the anonymous key so its free models are usable. Pi resolves a stored
 * credential first, then an extension or models.json `apiKey`, then the environment: a key
 * registered here would shadow the last two, so it is registered only when neither exists.
 * A later `/login` still wins, because stored credentials outrank every configured key.
 */
export function needsAnonymousKey(env: PathEnv, models: unknown): boolean {
	if (env[ENV_KEY]) return false;
	return configuredKey(models, ZEN_PROVIDER) === undefined;
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
	return {
		id: "opencode",
		label: "OpenCode",
		providers: [
			{ id: ZEN_PROVIDER, label: "OpenCode Zen", aliases: ["zen"] },
			{ id: GO_PROVIDER, label: "OpenCode Go", aliases: ["go"] },
		],
		register: async (pi: ExtensionAPI) => {
			const models = await readJsonFile(modelsPath(env));
			if (needsAnonymousKey(env, models.kind === "ok" ? models.value : undefined)) {
				pi.registerProvider(ZEN_PROVIDER, { apiKey: ANONYMOUS_KEY });
			}

			const ids = new IdSource();
			let sessionId = ids.session(now());
			pi.on("session_start", () => {
				sessionId = ids.session(now());
			});
			pi.on("before_provider_headers", (event) => {
				applyCliIdentity(event.headers, sessionId, ids.request(now()));
			});
		},
	};
}
