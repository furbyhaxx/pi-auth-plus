/** Owns in-process deduplication and locked, cross-session Codex token rotation. */
import { credentialPath, loadCodexCredential, lockedCredential, writeCredential } from "./store.ts";
import { exchange, profile } from "./tokens.ts";
import type { CodexCredential, CodexOptions } from "./types.ts";

/** Quota authentication without exposing the refresh token. */
export interface CodexToken {
	readonly token: string;
	readonly accountId: string | undefined;
	readonly planType?: string | undefined;
	readonly email?: string | undefined;
}

const inFlight = new Map<string, Promise<CodexCredential | undefined>>();

/** Loads and, when expiring within two minutes, refreshes under the shared file lock. */
export async function resolveCodexToken(
	options: CodexOptions = {},
): Promise<CodexToken | undefined> {
	options.signal?.throwIfAborted();
	const path = credentialPath(options.path);
	let credential = await loadCodexCredential(path, options.onError);
	if (!credential) return undefined;
	if (credential.expires <= (options.now ?? Date.now)() + 120_000) {
		let pending = inFlight.get(path);
		if (!pending) {
			const original = credential;
			pending = lockedCredential(path, async () => {
				options.signal?.throwIfAborted();
				const stored = await loadCodexCredential(path, options.onError);
				if (!stored) return undefined;
				if (
					stored.access !== original.access ||
					stored.expires > original.expires ||
					stored.expires > (options.now ?? Date.now)() + 120_000
				)
					return stored;
				const refreshed = await exchange(
					{ grant_type: "refresh_token", refresh_token: stored.refresh },
					options,
					stored,
				);
				options.signal?.throwIfAborted();
				await writeCredential(path, refreshed);
				return refreshed;
			});
			inFlight.set(path, pending);
		}
		try {
			credential = await pending;
		} finally {
			if (inFlight.get(path) === pending) inFlight.delete(path);
		}
	}
	options.signal?.throwIfAborted();
	if (!credential) return undefined;
	const hints = profile(credential.access);
	return {
		token: credential.access,
		accountId: credential.accountId ?? hints.accountId,
		...((credential.planType ?? hints.planType)
			? { planType: credential.planType ?? hints.planType }
			: {}),
		...((credential.email ?? hints.email) ? { email: credential.email ?? hints.email } : {}),
	};
}
