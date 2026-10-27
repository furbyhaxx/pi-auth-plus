/** Synthetic registers an Anthropic Messages endpoint using Pi's native transport and login. */
import type { FetchFn } from "../../core/http/index.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { BASE_URL, bundledModels, PROVIDER, refreshCatalog } from "./catalog.ts";

/** Creates the family without fetching; Pi controls the catalog refresh lifecycle. */
export function createSyntheticFamily(
	env: PathEnv = process.env,
	fetchFn: FetchFn = fetch,
	now: () => number = Date.now,
): FamilyAdapter {
	return {
		id: PROVIDER,
		label: "Synthetic",
		providers: [
			{
				id: PROVIDER,
				label: "Synthetic",
				aliases: [],
				ambient: () =>
					env["SYNTHETIC_API_KEY"] ? { source: "SYNTHETIC_API_KEY", limited: false } : undefined,
			},
		],
		register: (pi) => {
			pi.registerProvider(PROVIDER, {
				name: "Synthetic",
				baseUrl: BASE_URL,
				api: "anthropic-messages",
				apiKey: "$SYNTHETIC_API_KEY",
				models: bundledModels(),
				refreshModels: (ctx) => refreshCatalog(ctx, fetchFn, now),
			});
		},
	};
}
