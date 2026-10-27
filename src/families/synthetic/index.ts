/** Synthetic registers an Anthropic Messages endpoint using Pi's native transport and login. */
import { tmpdir } from "node:os";
import type { FetchFn } from "../../core/http/index.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { BASE_URL, bundledModels, PROVIDER, refreshCatalog } from "./catalog.ts";
import { registerWebSearch } from "./web-search.ts";

/** Enables the web-search tool for one run, next to the `synthetic.webSearch` setting. */
export const WEB_SEARCH_FLAG = "synthetic-web-search";

/** Creates the family without fetching; Pi controls the catalog refresh lifecycle. */
export function createSyntheticFamily(
	env: PathEnv = process.env,
	fetchFn: FetchFn = fetch,
	now: () => number = Date.now,
	outputDir: () => string = tmpdir,
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
		register: (pi, host) => {
			pi.registerProvider(PROVIDER, {
				name: "Synthetic",
				baseUrl: BASE_URL,
				api: "anthropic-messages",
				apiKey: "$SYNTHETIC_API_KEY",
				models: bundledModels(),
				refreshModels: (ctx) => refreshCatalog(ctx, fetchFn, now),
			});
			pi.registerFlag(WEB_SEARCH_FLAG, {
				description: "Offer the Synthetic web search tool for this run",
				type: "boolean",
			});
			// The project layer of the setting needs the session's cwd and trust, so the tool
			// registers at session start rather than in the factory.
			let searchRegistered = false;
			pi.on("session_start", () => {
				if (searchRegistered) return;
				const enabled =
					pi.getFlag(WEB_SEARCH_FLAG) === true || host.settings().get("synthetic.webSearch");
				if (!enabled) return;
				registerWebSearch(pi, { fetch: fetchFn, outputDir });
				searchRegistered = true;
			});
		},
	};
}
