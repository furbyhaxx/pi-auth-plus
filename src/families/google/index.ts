/** Google registers `antigravity`: the agy CLI's Cloud Code PA backend over Google OAuth. */
import { authFileStore } from "../../core/auth/store.ts";
import type { FetchFn } from "../../core/http/index.ts";
import type { FamilyAdapter } from "../../core/registry/index.ts";
import { estimateCounter, tokenizerCounter } from "../../tokens/estimate/index.ts";
import type { TokenCounter } from "../../tokens/types.ts";
import { PROVIDER } from "./catalog.ts";
import { forkLoginPending, migrateForkLogin } from "./migration.ts";
import { antigravityAuth } from "./oauth.ts";
import { antigravityProject } from "./project.ts";
import { antigravityProvider } from "./provider.ts";
import { antigravityQuota } from "./quota.ts";
import { cliHeaders } from "./transport.ts";

export function createGoogleFamily(fetchFn: FetchFn = fetch): FamilyAdapter {
	const project = antigravityProject({ fetch: fetchFn, headers: () => cliHeaders() });
	const counters = new Map<string, TokenCounter>();
	return {
		id: "google",
		label: "Google",
		providers: [
			{ id: PROVIDER, label: "Antigravity", aliases: ["agy", "ag"], quota: antigravityQuota() },
		],
		tokens: (model, deps) => {
			if (model.provider !== PROVIDER) return undefined;
			const cached = counters.get(model.id);
			if (cached) return cached;
			// Chars per token from .project/analyses/tokens/usage-audit/report.md; Claude-on-Google
			// prose reuses the Anthropic route's ratio, gpt-oss prose is the default.
			let counter: TokenCounter;
			if (model.id.includes("claude")) {
				counter = estimateCounter("antigravity-claude", {
					prose: 2.73,
					json: 2.08,
				});
			} else if (model.id.includes("gpt-oss")) {
				counter = tokenizerCounter(
					"openai/gpt-oss-120b",
					deps.tokenizers,
					estimateCounter("antigravity-gpt-oss", {
						prose: 4,
						json: 2.75,
					}),
				);
			} else {
				counter = estimateCounter("antigravity-gemini", {
					prose: 4.07,
					json: 2.88,
				});
			}
			counters.set(model.id, counter);
			return counter;
		},
		providerRegistrations: () => [
			{
				provider: antigravityProvider({
					auth: antigravityAuth({ fetch: fetchFn }),
					project,
					fetch: fetchFn,
				}),
			},
		],
		register: (pi) => {
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
