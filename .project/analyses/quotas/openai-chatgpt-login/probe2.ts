/**
 * Scratch probe 2: full /v1/models payload, the x-error-json header from the usage
 * rejection, and a status-only sweep of candidate usage paths. Read-only GETs.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OUT = process.env.PROBE_OUT ?? "/tmp/pi-openai-probe/probe2.log";
mkdirSync(dirname(OUT), { recursive: true });

function log(kind: string, value: unknown): void {
	appendFileSync(OUT, `${JSON.stringify({ kind, value })}\n`);
}

function keys(value: unknown): string[] {
	return typeof value === "object" && value !== null ? Object.keys(value as Record<string, unknown>).sort() : [];
}

const CANDIDATES = [
	"https://api.openai.com/v1/models",
	"https://api.openai.com/v1/codex/usage",
	"https://api.openai.com/v1/usage/limits",
	"https://api.openai.com/v1/subscription",
	"https://api.openai.com/v1/account/usage",
	"https://api.openai.com/v1/organization/rate_limits",
	"https://api.openai.com/v1/responses",
	"https://chatgpt.com/backend-api/usage",
	"https://chatgpt.com/backend-api/wham/usage",
];

function decode(value: string | null): string | null {
	if (!value) return null;
	for (const decoder of ["base64", "base64url"]) {
		try {
			const text = Buffer.from(value, decoder as BufferEncoding).toString("utf8");
			if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text)) return text.slice(0, 800);
		} catch {
			// not this encoding
		}
	}
	return null;
}

export default function probe(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const result = await ctx.modelRegistry.getProviderAuth("openai");
		const token = result?.auth.apiKey;
		if (!token) {
			log("no_token", {});
			return;
		}
		const bearer = { Accept: "application/json", Authorization: `Bearer ${token}` };
		for (const url of CANDIDATES) {
			try {
				const response = await fetch(url, { method: "GET", headers: bearer, signal: AbortSignal.timeout(15_000) });
				const body = await response.text().catch(() => "");
				const errorJson = response.headers.get("x-error-json");
				log("probe", {
					url,
					status: response.status,
					contentType: response.headers.get("content-type"),
					ideErrorCode: response.headers.get("x-openai-ide-error-code"),
					authorizationError: response.headers.get("x-openai-authorization-error"),
					internalCaller: response.headers.get("x-openai-internal-caller"),
					errorJsonLength: errorJson?.length ?? 0,
					errorJsonDecoded: decode(errorJson),
					headerNames: [...response.headers.keys()].sort(),
					bodyLength: body.length,
					bodyHead: body.slice(0, 400).replaceAll(/\b[A-Za-z0-9_-]{32,}\b/g, "<token>"),
				});
				if (url.endsWith("/v1/models") && response.ok) {
					const json: unknown = JSON.parse(body);
					const models = (json as { models?: unknown[] }).models ?? [];
					log("models", {
						topKeys: keys(json),
						count: models.length,
						firstKeys: keys(models[0]),
						slugs: models.map((m) => (m as { slug?: unknown }).slug),
						first: models[0],
					});
				}
			} catch (error) {
				log("probe_error", { url, error: error instanceof Error ? error.message : String(error) });
			}
		}
		log("done", {});
	});
}
