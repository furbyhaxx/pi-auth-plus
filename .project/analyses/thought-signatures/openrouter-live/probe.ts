import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { compatiblePhysicalHooks, registerCompatibleThoughtSignatures } from "../../../../src/families/google/compatible-signatures.ts";
import { registerThoughtSignatureRecovery } from "../../../../src/families/google/signature-recovery.ts";
import { repairThoughtSignaturePayload } from "../../../../src/families/google/thought-repair.ts";
import { composePhysicalFactories, installPhysicalRequestHooks } from "../../../../src/models/runtime/physical.ts";

const modelId = "google/gemini-4-argon";
const dummy = "skip_thought_signature_validator";
const mode = process.argv[2];
const label = process.argv[3];
const route = process.argv[4];
if (!["normal", "forced", "forced-dummy"].includes(mode ?? "") || !/^[a-z0-9-]+$/.test(label ?? "") || (route && !["google-ai-studio", "google-vertex"].includes(route))) {
  console.error("Usage: bun probe.ts normal|forced|forced-dummy output-label [google-ai-studio|google-vertex]");
  process.exit(2);
}
const dest = join(import.meta.dir, `evidence-${label}.json`);
const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? "", ".pi", "agent");
let credential = "";
let scratch: string | undefined;
let session: any;
const originalFetch = globalThis.fetch;
const result: any = { mode, route: route ?? "default", model: modelId, catalog: null, requests: [], stream: { encryptedSignatures: 0, extraSignatures: 0, providers: [] }, stripped: [], turns: [], toolRuns: 0, extensionErrors: [], physicalHooks: false };
const streamSignatures: string[] = [];
const safe = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  if (credential && value.includes(credential)) return "[omitted: credential present]";
  return value.slice(0, 6000);
};
function summary(body: any) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return {
    model: body.model,
    stream: body.stream,
    ...(body.provider ? { provider: body.provider } : {}),
    toolNames: (body.tools ?? []).map((t: any) => t?.function?.name).filter((v: any) => typeof v === "string"),
    messages: messages.map((message: any) => ({
      role: message.role,
      ...(message.role === "user" ? { content: message.content === "Immediately call the count tool exactly once with value 1, then answer DONE. Do not perform any other action." ? message.content : "[omitted]" } : {}),
      ...(message.role === "tool" ? { tool_call_id_present: typeof message.tool_call_id === "string", content: message.content === "finished once" ? message.content : "[omitted]" } : {}),
      ...(Array.isArray(message.reasoning_details) ? { reasoning_details: message.reasoning_details.map((d: any) => ({ type: d?.type, format: d?.format, data: typeof d?.data === "string" ? "[redacted]" : undefined, matchesStream: typeof d?.data === "string" && streamSignatures.includes(d.data) })) } : {}),
      ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls.map((call: any) => {
        const sig = call?.extra_content?.google?.thought_signature;
        return { type: call.type, function: { name: call?.function?.name, arguments: call?.function?.arguments }, ...(typeof sig === "string" ? { extra_content: { google: { thought_signature: sig === dummy ? dummy : "[redacted]", matchesStream: streamSignatures.includes(sig) } } } : {}) };
      }) } : {}),
    })),
  };
}
function removeSignatures(payload: any) {
  if (!payload || !Array.isArray(payload.messages)) return undefined;
  const hasToolCall = payload.messages.some((m: any) => m?.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length);
  if (!hasToolCall) return undefined;
  let removedEncrypted = 0;
  let removedExtra = 0;
  const messages = payload.messages.map((message: any) => {
    if (message?.role !== "assistant") return message;
    let updated = { ...message };
    if (Array.isArray(updated.reasoning_details)) {
      updated.reasoning_details = updated.reasoning_details.filter((d: any) => {
        const remove = d?.type === "reasoning.encrypted" && d?.format === "google-gemini-v1" && typeof d?.data === "string" && d.data.length > 0;
        if (remove) removedEncrypted++;
        return !remove;
      });
      if (updated.reasoning_details.length === 0) delete updated.reasoning_details;
    }
    if (Array.isArray(updated.tool_calls)) updated.tool_calls = updated.tool_calls.map((call: any) => {
      const extra = call?.extra_content;
      const google = extra?.google;
      if (!google || typeof google.thought_signature !== "string") return call;
      removedExtra++;
      const { thought_signature: _omitted, ...restGoogle } = google;
      return { ...call, extra_content: { ...extra, google: restGoogle } };
    });
    return updated;
  });
  result.stripped.push({ removedEncrypted, removedExtra });
  return { ...payload, messages };
}
try {
  const stored = await Bun.file(join(agentDir, "auth.json")).json();
  credential = stored?.openrouter?.key;
  if (typeof credential !== "string" || !credential) throw new Error("OpenRouter API-key slot is unavailable");
  const catalogResponse = await originalFetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20000) });
  const catalog = await catalogResponse.json();
  const selected = Array.isArray(catalog?.data) ? catalog.data.find((entry: any) => entry.id === modelId) : undefined;
  result.catalog = { status: catalogResponse.status, modelFound: !!selected, supportsTools: selected?.supported_parameters?.includes("tools") === true, supportsToolChoice: selected?.supported_parameters?.includes("tool_choice") === true, reasoning: selected?.reasoning };
  if (!catalogResponse.ok || !selected || !result.catalog.supportsTools) throw new Error("Selected Gemini model is unavailable or has no tool support in the live catalog");
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).host !== "openrouter.ai" || !new URL(url).pathname.endsWith("/chat/completions")) return originalFetch(input, init);
    const raw = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
    let body: any;
    try { body = JSON.parse(raw); } catch { body = {}; }
    const record: any = { method: init?.method ?? (input instanceof Request ? input.method : "unknown"), path: new URL(url).pathname, body: summary(body) };
    result.requests.push(record);
    const signals = [AbortSignal.timeout(45000), ...(init?.signal ? [init.signal] : [])];
    let response: Response;
    try { response = await originalFetch(input, { ...init, signal: AbortSignal.any(signals) }); }
    catch (error: any) { record.networkError = error?.name ?? "unknown"; throw error; }
    record.status = response.status;
    record.contentType = response.headers.get("content-type");
    if (!response.ok) {
      try {
        const data: any = await response.clone().json();
        record.error = { code: data?.error?.code, message: safe(data?.error?.message), provider: safe(data?.error?.metadata?.provider_name), upstreamRaw: safe(data?.error?.metadata?.raw) };
      } catch { record.error = { parse: "non-JSON error response" }; }
    }
    return response;
  };
  scratch = mkdtempSync(join(tmpdir(), "pi-openrouter-signature-"));
  const settings = SettingsManager.inMemory();
  const runtime = await ModelRuntime.create({ authPath: join(scratch, "auth.json"), modelsPath: null, modelsStorePath: join(scratch, "models-store.json"), refreshOnCreate: false });
  await runtime.setRuntimeApiKey("openrouter", credential);
  const model: any = { id: modelId, name: selected.name, api: "openai-completions", provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: selected.context_length, maxTokens: 2048, ...(route ? { compat: { openRouterRouting: { only: [route], allow_fallbacks: false } } } : {}) };
  const loader = new DefaultResourceLoader({ cwd: scratch, agentDir: scratch, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [
    registerCompatibleThoughtSignatures,
    (pi: any) => {
      pi.on("provider_stream_event", (event: any) => {
        const provider = event?.data?.provider;
        if (typeof provider === "string" && !result.stream.providers.includes(provider)) result.stream.providers.push(provider);
        const delta = event?.data?.choices?.[0]?.delta;
        for (const detail of delta?.reasoning_details ?? []) {
          if (detail?.type === "reasoning.encrypted" && detail?.format === "google-gemini-v1" && typeof detail.data === "string") {
            result.stream.encryptedSignatures++;
            streamSignatures.push(detail.data);
          }
        }
        for (const call of delta?.tool_calls ?? []) {
          const signature = call?.extra_content?.google?.thought_signature;
          if (typeof signature === "string" && signature) { result.stream.extraSignatures++; streamSignatures.push(signature); }
        }
        if (event?.data?.error) result.stream.error = { code: event.data.error.code, message: safe(event.data.error.message) };
      });
      const recovery = registerThoughtSignatureRecovery(pi);
      const factories = [compatiblePhysicalHooks, ...(mode !== "normal" ? [() => ({ payload: removeSignatures })] : []), ...(mode === "forced-dummy" ? [() => ({ payload: (payload: unknown) => repairThoughtSignaturePayload(payload, { history: true })?.payload })] : []), recovery.factory];
      result.physicalHooks = installPhysicalRequestHooks({ runtime }, composePhysicalFactories(factories));
      recovery.setPhysicalHooksAvailable(result.physicalHooks);
      pi.on("turn_end", (event: any) => result.turns.push({ outcome: event.outcome, stopReason: event.message?.stopReason, errorMessage: safe(event.message?.errorMessage) }));
    },
  ] });
  await loader.reload();
  ({ session } = await createAgentSession({ cwd: scratch, agentDir: scratch, model, modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(scratch), thinkingLevel: "low", customTools: [{ name: "count", label: "count", description: "Count tool executions without side effects", parameters: Type.Object({ value: Type.Number() }), execute: async () => { result.toolRuns++; return { content: [{ type: "text", text: "finished once" }], details: {} }; } }], tools: ["count"] }));
  await session.bindExtensions({ mode: "print", onError: (error: any) => result.extensionErrors.push({ message: safe(error?.error) }) });
  await session.prompt("Immediately call the count tool exactly once with value 1, then answer DONE. Do not perform any other action.", { expandPromptTemplates: false });
  await session.waitForIdle();
  const final = session.messages.filter((m: any) => m.role === "assistant").at(-1);
  result.final = { stopReason: final?.stopReason, textIsDone: final?.content?.some((part: any) => part.type === "text" && part.text.trim() === "DONE") ?? false, errorMessage: safe(final?.errorMessage) };
  result.contextEdits = session.sessionManager.getBranch().filter((e: any) => e.type === "context_edit").length;
} catch (error: any) {
  result.harnessError = { name: error?.name ?? "unknown", message: safe(error?.message) };
} finally {
  session?.dispose();
  globalThis.fetch = originalFetch;
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(dest, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
