/** Owns the shared pi-quotas Codex credential file; never seeds from other auth files. */
import { join, resolve } from "node:path";
import { withFileLock } from "../../../core/cache/lock.ts";
import { atomicWriteFile, type JsonRead, readJsonFile } from "../../../core/fs/index.ts";
import { agentDir } from "../../../core/paths/index.ts";
import { CodexAuthError, type CodexCredential, record, text } from "./types.ts";

/** Resolves the shared legacy credential location. */
export function getCodexAuthPath(): string {
	return join(agentDir(), "quotas-codex-auth.json");
}

export function credentialPath(path?: string): string {
	return resolve(path ?? getCodexAuthPath());
}

/** Loads a validated credential; malformed or unreadable files are reported and ignored. */
export async function loadCodexCredential(
	path = getCodexAuthPath(),
	onError: (error: CodexAuthError) => void = (error) => console.warn(error.message),
): Promise<CodexCredential | undefined> {
	let result: JsonRead;
	try {
		result = await readJsonFile(path);
	} catch {
		onError(new CodexAuthError("cannot read credential file", path));
		return undefined;
	}
	if (result.kind === "missing") return undefined;
	const value = record(result.kind === "ok" ? result.value : undefined);
	const access = text(value["access"]);
	const refresh = text(value["refresh"]);
	const expires = value["expires"];
	if (
		value["type"] !== "oauth" ||
		!access ||
		!refresh ||
		typeof expires !== "number" ||
		!Number.isFinite(expires) ||
		["accountId", "email", "planType"].some(
			(key) => value[key] !== undefined && typeof value[key] !== "string",
		)
	) {
		onError(new CodexAuthError("invalid credential file", path));
		return undefined;
	}
	return {
		type: "oauth",
		access,
		refresh,
		expires,
		...(text(value["accountId"]) ? { accountId: text(value["accountId"]) } : {}),
		...(text(value["email"]) ? { email: text(value["email"]) } : {}),
		...(text(value["planType"]) ? { planType: text(value["planType"]) } : {}),
	};
}

export async function writeCredential(path: string, credential: CodexCredential): Promise<void> {
	try {
		await atomicWriteFile(path, `${JSON.stringify(credential, null, 2)}\n`, {
			mode: 0o600,
			dirMode: 0o700,
		});
	} catch {
		throw new CodexAuthError("cannot write credential file", path);
	}
}

export async function lockedCredential<T>(path: string, action: () => Promise<T>): Promise<T> {
	try {
		// Unlike cache writes, refresh-token rotation must never run unlocked after a wait deadline.
		return await withFileLock(path, action, {
			waitMs: Number.POSITIVE_INFINITY,
			staleMs: 60_000,
			dirMode: 0o700,
		});
	} catch (error) {
		if (error instanceof CodexAuthError) throw error;
		throw new CodexAuthError("locked credential operation failed", path);
	}
}
