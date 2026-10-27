/**
 * Scratch probe 3: does the ChatGPT account id header change the access-enforcement
 * verdict for Pi's `openai` ChatGPT-direct token? Account id is read from the user's
 * pi-quotas Codex credential and never logged.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OUT = process.env.PROBE_OUT ?? "/tmp/pi-openai-probe/probe3.log";
mkdirSync(dirname(OUT), { recursive: true });

function log(kind: string, value: unknown): void {
	appendFileSync(OUT, `${JSON.stringify({ kind, value })}\n`);
}

function codexAccountId(): string | undefined {
	try {
		const raw: unknown = JSON.parse(readFileSync("/home/furbyhaxx/.pi/agent/quotas-codex-auth.json", "utf8"));
		const id = (raw as { accountId?: unknown }).accountId;
		return typeof id === "string" && id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	}
}

const URLS = [
	"https://chatgpt.com/backend-api/wham/usage",
	"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
	"https://chatgpt.com/backend-api/wham/profiles/me",
];

export default function probe(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const result = await ctx.modelRegistry.getProviderAuth("openai");
		const token = result?.auth.apiKey;
		const accountId = codexAccountId();
		log("start", { hasToken: Boolean(token), hasAccountId: Boolean(accountId) });
		if (!token) return;
		for (const url of URLS) {
			for (const withAccount of accountId ? [false, true] : [false]) {
				const headers: Record<string, string> = {
					Accept: "application/json",
					"User-Agent": "codex_cli_rs/0.60.0",
					originator: "codex_cli_rs",
					Authorization: `Bearer ${token}`,
				};
				if (withAccount && accountId) headers["ChatGPT-Account-Id"] = accountId;
				const response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
				const body = await response.text().catch(() => "");
				log("probe", {
					url,
					withAccount,
					status: response.status,
					ideErrorCode: response.headers.get("x-openai-ide-error-code"),
					bodyHead: body.replaceAll(/\b[A-Za-z0-9_-]{32,}\b/g, "<token>").slice(0, 400),
				});
			}
		}
		log("done", {});
	});
}
