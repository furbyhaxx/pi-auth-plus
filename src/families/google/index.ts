/** Google registers `antigravity`: the agy CLI's Cloud Code PA backend over Google OAuth. */
import type { FetchFn } from "../../core/http/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { PROVIDER } from "./catalog.ts";
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
			// The CLI re-derives its project per run; a new session does the same.
			pi.on("session_start", () => project.reset());
		},
	};
}
