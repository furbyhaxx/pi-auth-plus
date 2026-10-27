/** Shapes Claude OAuth request bodies, headers and endpoint URLs without transport I/O. */
import type { TextRule } from "../../core/config/fields.ts";
import type { PathEnv } from "../../core/paths/index.ts";
import { billingBlock } from "./billing.ts";
import { withClaudeCodeIdentity } from "./sanitize.ts";
import { wireToolName } from "./tool-names.ts";
import { userAgent } from "./version.ts";

const REQUIRED_BETAS = ["oauth-2025-04-20", "interleaved-thinking-2025-05-14"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shapeToolDefinition(tool: Record<string, unknown>): void {
	if (typeof tool["name"] !== "string" || !tool["name"]) return;
	if (tool["name"] === "__pi_deferred_placeholder__") {
		const cacheControl = tool["cache_control"];
		for (const key of Object.keys(tool)) delete tool[key];
		tool["name"] = "DeferredToolPlaceholder";
		tool["description"] =
			"Reserved placeholder that keeps deferred tool loading active; never call this tool.";
		tool["input_schema"] = { type: "object", properties: {} };
		tool["defer_loading"] = true;
		if (cacheControl !== undefined) tool["cache_control"] = cacheControl;
		return;
	}
	tool["name"] = wireToolName(tool["name"]);
}

function prefixContent(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) prefixContent(item);
		return;
	}
	if (!isRecord(value)) return;
	if (value["type"] === "tool_reference" && typeof value["tool_name"] === "string") {
		value["tool_name"] = wireToolName(value["tool_name"]);
	}
	if (value["type"] === "tool_use" && typeof value["name"] === "string" && value["name"]) {
		value["name"] = wireToolName(value["name"]);
	}
	if (value["type"] === "tool_addition" && isRecord(value["tool"])) {
		const tool = value["tool"];
		if (tool["type"] === "tool_definition" && isRecord(tool["definition"]))
			shapeToolDefinition(tool["definition"]);
	}
	if (value["type"] === "tool_removal" && isRecord(value["tool"])) {
		const tool = value["tool"];
		if (tool["type"] === "tool_reference" && typeof tool["name"] === "string")
			tool["name"] = wireToolName(tool["name"]);
	}
	if (value["content"] !== undefined) prefixContent(value["content"]);
}

/** Adds billing and identity blocks and rewrites tool names; invalid JSON passes through. */
export function shapeBody(body: string, version: string, rules: readonly TextRule[]): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return body;
	}
	if (!isRecord(parsed)) return body;
	const system = withClaudeCodeIdentity(parsed["system"], rules);
	const billing = billingBlock(parsed["messages"], version);
	if (billing !== undefined) system.unshift({ type: "text", text: billing });
	parsed["system"] = system;
	const tools = parsed["tools"];
	if (Array.isArray(tools)) {
		for (const tool of tools) {
			if (isRecord(tool)) shapeToolDefinition(tool);
		}
	}
	const choice = parsed["tool_choice"];
	if (isRecord(choice) && choice["type"] === "tool" && typeof choice["name"] === "string") {
		choice["name"] = wireToolName(choice["name"]);
	}
	prefixContent(parsed["messages"]);
	return JSON.stringify(parsed);
}

/** Merges Request headers with init headers, with init taking precedence per header. */
export function mergeRequestHeaders(input: string | URL | Request, init?: RequestInit): Headers {
	const headers = new Headers(input instanceof Request ? input.headers : undefined);
	new Headers(init?.headers).forEach((value, key) => {
		headers.set(key, value);
	});
	return headers;
}

/** Returns OAuth headers; the version must match the version supplied to shapeBody. */
export function shapeHeaders(headers: Headers, token: string, version: string): Headers {
	const shaped = new Headers(headers);
	const incoming = (headers.get("anthropic-beta") ?? "")
		.split(",")
		.map((beta) => beta.trim())
		.filter(Boolean);
	shaped.set("authorization", `Bearer ${token}`);
	shaped.set("anthropic-beta", [...new Set([...REQUIRED_BETAS, ...incoming])].join(","));
	shaped.set("user-agent", userAgent(version));
	shaped.set("x-app", "cli");
	shaped.delete("x-api-key");
	return shaped;
}

function baseUrl(env: PathEnv): URL | undefined {
	const raw = env["ANTHROPIC_BASE_URL"]?.trim();
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password)
			return url;
	} catch {
		return undefined;
	}
	return undefined;
}

/** Replaces only the origin and opts messages requests into beta unless already specified. */
export function shapeUrl(input: string | URL | Request, env: PathEnv): string | URL | Request {
	let url: URL;
	try {
		url = new URL(input instanceof Request ? input.url : input.toString());
	} catch {
		return input;
	}
	const original = url.href;
	const base = baseUrl(env);
	if (base !== undefined) {
		url.protocol = base.protocol;
		url.host = base.host;
	}
	if (url.pathname === "/v1/messages" && !url.searchParams.has("beta")) {
		url.searchParams.set("beta", "true");
	}
	if (url.href === original) return input;
	return input instanceof Request ? new Request(url.toString(), input) : url;
}

/** TLS opt-out is scoped to an explicitly configured custom endpoint. */
export function insecureTls(env: PathEnv): boolean {
	if (!env["ANTHROPIC_BASE_URL"]?.trim()) return false;
	const value = env["ANTHROPIC_INSECURE"]?.trim();
	return value === "1" || value === "true";
}
