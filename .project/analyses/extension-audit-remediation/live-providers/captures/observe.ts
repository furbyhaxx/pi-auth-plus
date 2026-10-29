import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { redactText, redactValue } from "../../../../../src/core/redact/index.ts";

const destination = process.env.QA_CAPTURE;
if (!destination) throw new Error("QA_CAPTURE is required");
const secrets: string[] = [];
function collect(value: unknown): void {
  if (typeof value === "string" && value.length >= 8) secrets.push(value);
  else if (Array.isArray(value)) for (const item of value) collect(item);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collect(item);
}
try { collect(JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, "auth.json"), "utf8"))); } catch {}
for (const [name, value] of Object.entries(process.env)) if (/(?:TOKEN|KEY|SECRET|PASSWORD|COOKIE)/i.test(name)) collect(value);
const identifiers = /^(?:project|projectId|cloudaiCompanionProject|user_id|userId|device_id|account_uuid|session_id|sessionId|request_id|requestId|trajectory_id|cascade_id|root_cascade_id|prompt_cache_key|x-claude-code-session-id|x-opencode-session|x-opencode-session-id|x-session-affinity)$/i;
function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, identifiers.test(key) ? "[omitted]" : mask(item)]));
}
function safe(value: unknown): unknown { return mask(redactValue(value, secrets)); }
function save(value: unknown): void { appendFileSync(destination!, `${JSON.stringify(safe(value))}\n`, {mode: 0o600}); }
function addPrivateFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) addPrivateFields(item); return; }
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:access_token|refresh_token|id_token|project|projectId|cloudaiCompanionProject)$/i.test(key)) collect(item);
    else addPrivateFields(item);
  }
}
function decodeBody(text: string): unknown {
  try { const parsed = JSON.parse(text); addPrivateFields(parsed); return parsed; } catch {}
  if (text.includes("data:")) return text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => {
    const payload = line.slice(5).trim();
    try { const parsed = JSON.parse(payload); addPrivateFields(parsed); return parsed; }
    catch { return redactText(payload, secrets); }
  });
  return redactText(text, secrets).slice(0, 30000);
}
const originalFetch = globalThis.fetch;
const pending = new Set<Promise<void>>();
let serial = 0;
let inferenceSent = false;
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const number = ++serial;
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (process.env.QA_SINGLE_REQUEST === "1" && url.hostname === "opencode.ai" && url.pathname.includes("/inference/")) {
    if (inferenceSent || Reflect.get(globalThis, "__qaRegisteredPhysical") !== true) {
      save({event:"qa_request_blocked",number,url:url.href,reason:inferenceSent?"one-request limit":"registered group target not verified"});
      throw new Error("QA prevented an unapproved inference request");
    }
    inferenceSent = true;
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const [key, value] of headers) if (/(?:authorization|token|secret|cookie|api[-_]?key)/i.test(key)) { collect(value); if (value.startsWith("Bearer ")) collect(value.slice(7)); }
  const body = typeof init?.body === "string" ? init.body : input instanceof Request && input.method !== "GET" && input.method !== "HEAD" ? await input.clone().text() : undefined;
  const parsedBody = body === undefined ? undefined : decodeBody(body);
  if (process.env.QA_SINGLE_REQUEST === "1" && url.hostname === "opencode.ai" && url.pathname.includes("/inference/")) {
    const payload = parsedBody as any;
    const cap = payload?.max_tokens ?? payload?.max_completion_tokens ?? payload?.max_output_tokens;
    const tool = payload?.tools?.find((item: any) => (item?.function?.name ?? item?.name) === "qa_noop");
    const properties = tool?.function?.parameters?.properties ?? tool?.input_schema?.properties;
    if (payload?.model !== process.env.QA_EXPECTED_MODEL || typeof cap !== "number" || cap > 32 || cap <= 0 || !properties || Object.keys(properties).length === 0) {
      save({event:"qa_request_blocked",number,url:url.href,reason:"model, cap or inert tool was not verified"});
      throw new Error("QA prevented an unapproved inference request");
    }
  }
  save({event:"http_request", number, url:url.href, method:init?.method ?? (input instanceof Request ? input.method : "GET"), headers:Object.fromEntries(headers), body:parsedBody});
  try {
    const response = await originalFetch(input, init);
    const job = (async () => {
      let responseBody: unknown;
      try { responseBody = decodeBody(await response.clone().text()); } catch (error) { responseBody = {captureError:String(error)}; }
      save({event:"http_response", number, url:url.href, status:response.status, headers:Object.fromEntries(response.headers), body:responseBody});
    })();
    pending.add(job); void job.finally(() => pending.delete(job));
    return response;
  } catch (error) { save({event:"http_error", number, url:url.href, error:String(error)}); throw error; }
}, {preconnect:originalFetch.preconnect});

export default function (pi: any): void {
  pi.registerTool({name:"qa_noop", label:"QA noop", description:"No side effects; only call if required.", parameters:Type.Object({value:Type.String()}), execute:async () => ({content:[{type:"text",text:"OK"}],details:{}})});
  pi.on("before_provider_request", (event: any, ctx: any) => {
    const body = event.payload;
    if (!body || typeof body !== "object") return;
    if (ctx.model?.provider === "openai" && !Object.hasOwn(body, "max_output_tokens")) body.max_output_tokens = 32;
    for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) if (typeof body[key] === "number") body[key] = Math.min(body[key], 32);
    if (body.generationConfig && typeof body.generationConfig.maxOutputTokens === "number") body.generationConfig.maxOutputTokens = Math.min(body.generationConfig.maxOutputTokens, 32);
    if (body.request?.generationConfig && typeof body.request.generationConfig.maxOutputTokens === "number") body.request.generationConfig.maxOutputTokens = Math.min(body.request.generationConfig.maxOutputTokens, 32);
    save({event:"before_provider_request",payload:body});
    return body;
  });
  let seen = false;
  pi.on("provider_stream_event", (event: any, ctx: any) => { if (!seen || event.data?.error) { seen = true; save({event:"provider_stream_event", provider:event.provider,model:event.model,api:event.api,ctx:{provider:ctx.model?.provider,id:ctx.model?.id},data:event.data}); } });
  pi.on("message_end", (event: any, ctx: any) => { if (event.message?.role === "assistant") save({event:"message_end",ctx:{provider:ctx.model?.provider,id:ctx.model?.id},message:event.message}); });
  pi.on("turn_end", (event: any) => save({event:"turn_end",outcome:event.outcome,message:event.message}));
  pi.on("agent_end", async () => { await Promise.allSettled([...pending]); save({event:"agent_end"}); });
  pi.on("session_shutdown", async () => { await Promise.allSettled([...pending]); save({event:"session_shutdown"}); });
}
