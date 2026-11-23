/** Resolves quota credentials through Pi's model registry, so OAuth refresh stays Pi's. */

import { readCredential } from "../core/auth/index.ts";
import { missingEnvironmentAuth } from "../core/auth/missing.ts";
import { type ProviderAuthRegistry, providerAuthView } from "../core/host/registry.ts";
import type { QuotaAuth } from "./types.ts";

/** Uses Pi's refreshed auth, including header-only bearers, plus stored OAuth extras. */
export async function quotaAuthFor(
	id: string,
	modelRegistry: ProviderAuthRegistry | undefined,
): Promise<QuotaAuth | undefined> {
	let resolved: Awaited<ReturnType<typeof providerAuthView>>;
	try {
		resolved = await providerAuthView(modelRegistry, id);
	} catch (error) {
		if (missingEnvironmentAuth(error, id)) return undefined;
		throw error;
	}
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
