/** Resolves quota credentials through Pi's model registry, so OAuth refresh stays Pi's. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readCredential } from "../core/auth/index.ts";
import type { QuotaAuth } from "./types.ts";

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
