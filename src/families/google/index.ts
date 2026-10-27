/** Google registers `antigravity`: the agy CLI's Cloud Code PA backend over Google OAuth. */
import { authFileStore } from "../../core/auth/store.ts";
import type { FetchFn } from "../../core/http/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { PROVIDER } from "./catalog.ts";
import { forkLoginPending, migrateForkLogin } from "./migration.ts";
import { antigravityAuth } from "./oauth.ts";
import { antigravityProject } from "./project.ts";
import { antigravityProvider } from "./provider.ts";
import { cliHeaders } from "./transport.ts";

export function createGoogleFamily(fetchFn: FetchFn = fetch): FamilyAdapter {
	return {
		id: "google",
		label: "Google",
		providers: [{ id: PROVIDER, label: "Antigravity", aliases: ["agy"] }],
		register: (pi) => {
			const project = antigravityProject({ fetch: fetchFn, headers: () => cliHeaders() });
			pi.registerProvider(
				antigravityProvider({ auth: antigravityAuth({ fetch: fetchFn }), project, fetch: fetchFn }),
			);
			let migrationChecked = false;
			pi.on("session_start", async (_event, ctx) => {
				// The CLI re-derives its project per run; a new session does the same.
				project.reset();
				if (migrationChecked) return;
				migrationChecked = true;
				if (!forkLoginPending()) return;
				try {
					if ((await migrateForkLogin(authFileStore())) === "migrated") {
						ctx.ui.notify("Antigravity: carried over the pi-antigravity-auth login.", "info");
					}
				} catch {
					ctx.ui.notify(
						"Antigravity: could not carry over the pi-antigravity-auth login; run /login antigravity.",
						"warning",
					);
				}
			});
		},
	};
}
