/**
 * Scratch probe: which quota sources accept Pi's `openai` ChatGPT-direct credential,
 * and what an inference response carries. Read-only GETs, no token values logged.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OUT = process.env.PROBE_OUT ?? "/tmp/pi-openai-probe/probe.log";
mkdirSync(dirname(OUT), { recursive: true });

function log(kind: string, value: unknown): void {
	appendFileSync(OUT, `${JSON.stringify({ kind, value })}\n`);
}

function jwtParts(token: string): { segments: number; claims?: Record<string, unknown> } {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return { segments: parts.length };
	try {
		const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		return {
			segments: 3,
			claims: typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>) : {},
		};
	} catch {
		return { segments: parts.length };
	}
}

function keys(value: unknown): string[] {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.keys(value as Record<string, unknown>).sort()
		: [];
}

function sanitize(value: string): string {
	return value
		.replaceAll(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "<email>")
		.replaceAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
		.replaceAll(/\b[A-Za-z0-9_-]{40,}\b/g, "<long-token>");
}

interface Probe {
	label: string;
	url: string;
	headers: Record<string, string>;
}

function probes(token: string): Probe[] {
	const bearer = `Bearer ${token}`;
	const codexUa = { "User-Agent": "codex_cli_rs/0.60.0", originator: "codex_cli_rs", Accept: "application/json" };
	return [
		{ label: "wham/usage codex-headers", url: "https://chatgpt.com/backend-api/wham/usage", headers: { ...codexUa, Authorization: bearer } },
		{ label: "wham/usage minimal", url: "https://chatgpt.com/backend-api/wham/usage", headers: { Accept: "application/json", Authorization: bearer } },
		{ label: "wham/usage pi-ua", url: "https://chatgpt.com/backend-api/wham/usage", headers: { Accept: "application/json", "User-Agent": "pi/1.4.0 (linux; bun; x64)", Authorization: bearer } },
		{ label: "wham/rate-limit-reset-credits", url: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits", headers: { ...codexUa, Authorization: bearer } },
		{ label: "wham/accounts/check", url: "https://chatgpt.com/backend-api/wham/accounts/check", headers: { ...codexUa, Authorization: bearer } },
		{ label: "wham/profiles/me", url: "https://chatgpt.com/backend-api/wham/profiles/me", headers: { ...codexUa, Authorization: bearer } },
		{ label: "backend-api/me", url: "https://chatgpt.com/backend-api/me", headers: { ...codexUa, Authorization: bearer } },
		{ label: "backend-api/codex/usage", url: "https://chatgpt.com/backend-api/codex/usage", headers: { ...codexUa, Authorization: bearer } },
		{ label: "api.codex/usage", url: "https://api.openai.com/api/codex/usage", headers: { ...codexUa, Authorization: bearer } },
		{ label: "api/v1/me", url: "https://api.openai.com/v1/me", headers: { Accept: "application/json", Authorization: bearer } },
		{ label: "api/v1/models", url: "https://api.openai.com/v1/models", headers: { Accept: "application/json", Authorization: bearer } },
		{ label: "api/v1/usage", url: "https://api.openai.com/v1/usage", headers: { Accept: "application/json", Authorization: bearer } },
		{ label: "api/v1/org-usage", url: "https://api.openai.com/v1/organization/usage/completions", headers: { Accept: "application/json", Authorization: bearer } },
		{ label: "api/v1/rate_limits", url: "https://api.openai.com/v1/rate_limits", headers: { Accept: "application/json", Authorization: bearer } },
		{ label: "api/v1/credit_grants", url: "https://api.openai.com/v1/dashboard/billing/credit_grants", headers: { Accept: "application/json", Authorization: bearer } },
	];
}

async function runProbes(token: string): Promise<void> {
	for (const probe of probes(token)) {
		const started = Date.now();
		try {
			const response = await fetch(probe.url, {
				method: "GET",
				headers: probe.headers,
				signal: AbortSignal.timeout(15_000),
			});
			const body = await response.text().catch(() => "");
			const headerNames = [...response.headers.keys()].sort();
			const interesting: Record<string, string> = {};
			for (const [name, value] of response.headers) {
				if (/rate|limit|codex|plan|account|retry|authorization|ide-error|error-json|internal-caller/i.test(name) && !/cookie/i.test(name)) {
					interesting[name] = sanitize(value).slice(0, 200);
				}
			}
			log("probe", {
				label: probe.label,
				url: probe.url,
				sent: Object.keys(probe.headers).sort(),
				status: response.status,
				contentType: response.headers.get("content-type"),
				ms: Date.now() - started,
				headerNames,
				interesting,
				body: sanitize(body).slice(0, 700),
			});
		} catch (error) {
			log("probe_error", { label: probe.label, url: probe.url, error: error instanceof Error ? error.message : String(error) });
		}
	}
}

const seenStreamTypes = new Set<string>();

export default function probe(pi: ExtensionAPI): void {
	const inject = process.env.PROBE_INJECT === "1";
	const sessionId = crypto.randomUUID();
	pi.on("before_provider_headers", (event, ctx) => {
		if (inject) {
			event.headers.originator = "codex_cli_rs";
			event.headers.session_id = sessionId;
			event.headers["x-client-request-id"] = sessionId;
			event.headers["OpenAI-Beta"] = "responses=experimental";
		}
	});
	pi.on("session_start", async (_event, ctx) => {
		log("session_start", { model: ctx.model?.id ?? null, authed: await ctx.modelRegistry.getProviderAuth("openai").then((r) => r !== undefined).catch(() => false) });
		for (const id of ["openai", "openai-codex"]) {
			try {
				const result = await ctx.modelRegistry.getProviderAuth(id);
				const token = result?.auth.apiKey;
				const parts = token ? jwtParts(token) : undefined;
				const authClaim = parts?.claims?.["https://api.openai.com/auth"];
				log("auth", {
					id,
					present: result !== undefined,
					source: result?.source,
					hasApiKey: typeof token === "string",
					tokenPrefix: token ? token.slice(0, 3) : undefined,
					tokenLength: token?.length,
					headerNames: keys(result?.auth.headers),
					baseUrl: result?.auth.baseUrl ?? null,
					jwtSegments: parts?.segments,
					jwtClaimKeys: keys(parts?.claims),
					authClaimKeys: keys(authClaim),
					hasChatgptAccountId: typeof (authClaim as Record<string, unknown> | undefined)?.["chatgpt_account_id"] === "string",
					scopeClaim: typeof parts?.claims?.["scope"] === "string" ? String(parts?.claims?.["scope"]).split(/\s+/).sort() : null,
				});
				if (id === "openai" && token) await runProbes(token);
			} catch (error) {
				log("auth_error", { id, error: error instanceof Error ? error.message : String(error) });
			}
		}
		log("probes_done", {});
	});

	pi.on("before_provider_headers", (event, ctx) => {
		const headers: Record<string, string> = {};
		for (const [name, value] of Object.entries(event.headers)) {
			const text = value === null ? "<deleted>" : String(value);
			headers[name] = /^(user-agent|originator|accept|content-type|openai-beta|session_id|session-id|x-client-request-id|chatgpt-account-id)$/i.test(name)
				? text.slice(0, 140)
				: `<len ${text.length}>`;
		}
		log("request_headers", { model: ctx.model?.id ?? null, headers });
	});

	pi.on("after_provider_response", (event, ctx) => {
		const values: Record<string, string> = {};
		for (const [name, value] of Object.entries(event.headers)) {
			if (/set-cookie|authorization/i.test(name)) {
				values[name] = "<redacted>";
				continue;
			}
			values[name] = sanitize(String(value)).slice(0, 240);
		}
		log("response_headers", { model: ctx.model?.id ?? null, status: event.status, headerNames: Object.keys(event.headers).sort(), values });
	});

	pi.on("provider_stream_event", (event) => {
		const data = event.data as { type?: unknown } | null;
		const type = typeof data?.type === "string" ? data.type : "unknown";
		if (seenStreamTypes.has(type)) return;
		seenStreamTypes.add(type);
		log("stream_event_type", { provider: event.provider, api: event.api, model: event.model, type, data });
	});
}
