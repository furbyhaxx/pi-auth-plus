import { appendFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/compat";
import { createOpencodeFamily } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/families/opencode/index.ts";
import { applyCliEnv, applyCliIdentity, envBlock } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/families/opencode/identity.ts";
import { createSyntheticFamily } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/families/synthetic/index.ts";
import { correctSyntheticRequestUsage } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/families/synthetic/usage.ts";

const dir = "/tmp/pi-guard-correlation.k1ejpwE7";
const mode = process.env.PROBE_MODE;
const log = (event) => appendFileSync(`${dir}/${mode}.trace.jsonl`, `${JSON.stringify(event)}\n`);
const raw = (event) => { if (mode.startsWith("raw")) appendFileSync(`${dir}/${mode}.events.jsonl`, `${JSON.stringify(event)}\n`); };
const getId = (model) => model && ({ provider: model.provider, id: model.id, api: model.api });
const tokenizers = { load: async () => {}, peek: () => ({ count: (text) => text.length }) };
const modelDefinition = { id: "hf:acme/test", name: "probe", input: ["text"], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024, headers: { "x-probe-model": "model-kept" } };
const message = (text) => ({ role: "user", content: text, timestamp: Date.now() });
const textOf = (messages) => JSON.stringify(messages);
let injected = false;
let routeSeq = 0;
const als = new AsyncLocalStorage();

function wrap(base, kind, model, context, options = {}) {
  log({ hook: "wrapper_enter", kind, physical: getId(model), hasParentPayload: !!options.onPayload });
  let payload;
  const localOptions = {
    ...options,
    headers: model.provider === "opencode" ? { ...options.headers, "x-opencode-client": "pi" } : options.headers,
    onPayload: async (input, actual) => {
      const transformed = (await options.onPayload?.(input, actual)) ?? input;
      payload = transformed;
      if (model.provider === "opencode") applyCliEnv(transformed, envBlock("/probe", "linux"));
      log({ hook: "wrapper_onPayload", physical: getId(model), callbackModel: getId(actual), hasParentCallback: !!options.onPayload, model: transformed?.model, tag: textOf(transformed?.messages ?? []).includes("SLOW") ? "SLOW" : textOf(transformed?.messages ?? []).includes("FAST") ? "FAST" : "other" });
      return transformed;
    },
    onResponse: async (response, actual) => {
      log({ hook: "wrapper_onResponse", physical: getId(model), callbackModel: getId(actual), status: response.status, hasParentCallback: !!options.onResponse });
      await options.onResponse?.(response, actual);
    },
  };
  if (model.provider === "opencode") applyCliIdentity(localOptions.headers, "ses_probe");
  const input = base[kind](model, context, localOptions);
  if (model.provider !== "synthetic") return input;
  const out = new AssistantMessageEventStream();
  (async () => {
    for await (const event of input) {
      if (event.type === "done") {
        const corrected = correctSyntheticRequestUsage(event.message, payload, tokenizers) ?? event.message;
        log({ hook: "wrapper_done", model: getId(model), input: corrected.usage.input, total: corrected.usage.totalTokens, tag: textOf(payload?.messages ?? []).includes("SLOW") ? "SLOW" : textOf(payload?.messages ?? []).includes("FAST") ? "FAST" : "other" });
        out.push({ ...event, message: corrected });
      } else out.push(event);
    }
    out.end();
  })().catch((error) => { log({ hook: "wrapper_error", message: String(error) }); out.end(); });
  return out;
}

export default function(pi) {
  for (const [provider, api] of [["opencode", "openai-completions"], ["synthetic", "anthropic-messages"], ["impostor", "openai-completions"]]) {
    pi.registerProvider(provider, { baseUrl: `${process.env.PROBE_MOCK_URL}/${provider}`, apiKey: "dummy", api, models: [{ ...modelDefinition, ...(provider === "opencode" ? { reasoning: true, compat: { supportsReasoningEffort: true, thinkingFormat: "openai" } } : {}) }], ...(provider === "impostor" ? { headers: { "x-opencode-client": "other-app" } } : {}) });
  }
  if (mode.startsWith("named")) pi.registerProvider("opencode", { api: "openai-completions", streamSimple: (model, context, options) => streamSimpleOpenAICompletions(model, context, options) });
  if (mode.startsWith("legacy")) createOpencodeFamily({}).register(pi);
  createSyntheticFamily({}, fetch, Date.now, undefined, tokenizers).register(pi, { settings: () => ({ get: () => false }) });
  pi.registerVirtualModel({ provider: "probe-group", id: "g", name: "Probe", contextWindow: 100000, maxTokens: 1024,
    route(request, ctx) {
      const text = textOf(request.messages.findLast((m) => m.role === "user") ?? request.messages);
      const provider = request.reason === "retry" ? "synthetic" : text.includes("IMPOSTOR") ? "impostor" : text.includes("OPENCODE") ? "opencode" : (request.reason === "direct" || text.includes("FORCE_SYNTHETIC")) ? "synthetic" : "opencode";
      const model = ctx.modelRegistry.find(provider, "hf:acme/test");
      if (mode.startsWith("als")) als.enterWith({ provider, route: ++routeSeq });
      log({ hook: "route", als: als.getStore() ?? null, reason: request.reason, target: getId(model), ctx: getId(ctx.model), requestKeys: Object.keys(request).sort(), sameContextSignal: request.signal === ctx.signal });
      return { model, thinkingLevel: "off" };
    }
  });
  pi.on("session_start", (_event, ctx) => {
    if (!mode.startsWith("wrapped")) return;
    for (const provider of ["opencode", "synthetic"]) {
      const base = ctx.modelRegistry.getProvider(provider);
      log({ hook: "pre_register", provider, named: !!ctx.modelRegistry.getRegisteredProviderConfig(provider), hasRefresh: !!base.refreshModels, modelCount: base.getModels().length });
      pi.registerProvider({ ...base, stream: (m,c,o) => wrap(base,"stream",m,c,o), streamSimple: (m,c,o) => wrap(base,"streamSimple",m,c,o) });
      log({ hook: "post_register", provider, named: !!ctx.modelRegistry.getRegisteredProviderConfig(provider), native: !!ctx.modelRegistry.getRegisteredNativeProvider(provider), modelCount: ctx.modelRegistry.getProvider(provider).getModels().length });
    }
  });
  pi.on("before_provider_headers", async (event, ctx) => {
    raw(event);
    log({ hook: event.type, als: als.getStore() ?? null, keys: Object.keys(event).sort(), ctx: getId(ctx.model), headerKeys: Object.keys(event.headers).sort(), client: event.headers["x-opencode-client"] ?? null, session: !!event.headers["x-opencode-session"] });
    if (injected) return;
    injected = true;
    const calls = ["SLOW synthetic with a much longer input", "FAST synthetic", "IMPOSTOR duplicate-model", "OPENCODE physical API", "OPENCODE virtual side"];
    const results = await Promise.all(calls.map(async tag => {
      const context = { systemPrompt: "Probe system", messages: [message(tag)] };
      const options = {
        signal: ctx.signal, sessionId: "shared-session", maxTokens: 64, ...(tag.includes("API") ? { reasoningEffort: "high" } : {}),
        onPayload: (payload, model) => { log({ hook: "helper_onPayload", als: als.getStore() ?? null, tag, physical: getId(model), payloadModel: payload?.model }); return payload; },
        onResponse: (response, model) => log({ hook: "helper_onResponse", tag, physical: getId(model), status: response.status }),
      };
      const stream = tag.includes("API") ? ctx.modelRegistry.stream(ctx.modelRegistry.find("opencode", "hf:acme/test"), context, options) : ctx.modelRegistry.streamSimple(ctx.model, context, options);
      const result = await stream.result();
      log({ hook: "helper_done", tag, provider: result.provider, id: result.model, input: result.usage.input, stop: result.stopReason });
      return result;
    }));
    log({ hook: "helpers_finished", count: results.length });
  });
  pi.on("before_provider_request", (event, ctx) => { raw(event); log({ hook: event.type, als: als.getStore() ?? null, keys: Object.keys(event).sort(), ctx: getId(ctx.model), payloadModel: event.payload?.model, payloadKeys: Object.keys(event.payload ?? {}).sort() }); });
  pi.on("after_provider_response", (event, ctx) => { raw(event); log({ hook: event.type, keys: Object.keys(event).sort(), ctx: getId(ctx.model), status: event.status }); });
  pi.on("provider_stream_event", (event, ctx) => { if (event.data?.type === "message_start") { raw(event); log({ hook: event.type, keys: Object.keys(event).sort(), ctx: getId(ctx.model), physical: { provider: event.provider, id: event.model, api: event.api }, dataType: event.data.type }); } });
  pi.on("message_end", (event,ctx) => { const {message} = event; if (message.role === "assistant") { raw(event); log({ hook: "message_end_observer", ctx: getId(ctx.model), physical: {provider:message.provider,id:message.model,api:message.api}, input: message.usage.input, cacheWrite: message.usage.cacheWrite, total: message.usage.totalTokens, stop: message.stopReason }); } });
}
