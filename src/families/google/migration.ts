/** Fill-only migration of the absorbed fork's google OAuth slot through an injected Pi store. */
import { readCredential } from "../../core/auth/index.ts";
import type { SlotStore } from "../../core/auth/store.ts";

/** Non-secret result for one-time migration feedback. */
export type ForkLoginMigration = "migrated" | "skipped-existing" | "no-fork-slot" | "not-oauth";

/** Lock-free precheck, so sessions without a fork login never take the auth.json lock. */
export function forkLoginPending(read: typeof readCredential = readCredential): boolean {
	return read("antigravity") === undefined && read("google")?.type === "oauth";
}

/** Copy the fork login without changing google or replacing a concurrent antigravity login. */
export async function migrateForkLogin(store: SlotStore): Promise<ForkLoginMigration> {
	if ((await store.read("antigravity")) !== undefined) return "skipped-existing";
	const credential = await store.read("google");
	if (credential === undefined) return "no-fork-slot";
	if (credential.type !== "oauth") return "not-oauth";

	let outcome: ForkLoginMigration = "skipped-existing";
	// Read the source before modify: file-backed stores may lock the entire auth file.
	await store.modify("antigravity", async (current) => {
		if (current !== undefined) return undefined;
		outcome = "migrated";
		const separator = credential.refresh.indexOf("|");
		return {
			type: "oauth",
			access: credential.access,
			refresh: separator < 0 ? credential.refresh : credential.refresh.slice(0, separator),
			expires: credential.expires,
		};
	});
	return outcome;
}
