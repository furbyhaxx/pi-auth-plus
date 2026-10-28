import { appendFileSync } from "node:fs";
import { BASE_URL, bundledModels } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/families/synthetic/catalog.ts";
import { applyCliEnv, applyCliIdentity, envBlock, IdSource } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/families/opencode/identity.ts";

const logPath = "/tmp/pi-quota-attribution.FHUVNJtA/probe.jsonl";
const sessionLabels = new Map();
const lastRoute = new Map();
let sequence = 0;
let userRoutes = 0;
let injected = false;
let loggedStream = false;
let directPromise;
let notifyDirectRoute;
const virtual = { provider: "probe-group", id: "g" };
const sid = (ctx) => {
  const value = ctx.sessionManager.getSessionId();
  if (!sessionLabels.has(value)) sessionLabels.set(value, sessionLabels.size + 1);
  return sessionLabels.get(value);
};
const identity = (model) => model ? { provider: model.provider, model: model.id ?? model.model, api: model.api } : null;
const lastState = (ctx) => {
  const branch = ctx.sessionManager.getBranch();
  return branch.findLast((entry) => entry.type === "custom" && entry.customType === "pi.virtual-model-state")?.data?.state ?? null;
};
const log = (hook, ctx, extra = {}) => appendFileSync(logPath, `${JSON.stringify({ seq: ++sequence, hook, session: sid(ctx), ctx: identity(ctx.model), lastRoute: lastRoute.get(sid(ctx)) ?? null, branchState: lastState(ctx), ...extra })}\n`);
const msg = (message) => message?.role === "assistant" ? { role: message.role, provider: message.provider, model: message.model, api: message.api, stopReason: message.stopReason, usage: message.usage } : { role: message?.role };

export default function (pi) {
  pi.registerProvider("opencode", { apiKey: "public" });
  pi.registerProvider("synthetic", { name: "Synthetic", baseUrl: BASE_URL, api: "anthropic-messages", apiKey: "$SYNTHETIC_API_KEY", models: bundledModels() });
  pi.registerVirtualModel({
    ...virtual,
    name: "Quota attribution probe",
    route(request, ctx) {
      const main = request.reason !== "direct";
      const provider = main ? (userRoutes++ % 2 === 0 ? "opencode" : "synthetic") : "synthetic";
      const id = provider === "opencode" ? "big-pickle" : "syn:small:text";
      const model = ctx.modelRegistry.find(provider, id);
      lastRoute.set(sid(ctx), provider);
      log("route", ctx, { requestKeys: Object.keys(request).sort(), reason: request.reason, requestModel: identity(request.model), target: identity(model), previous: identity(request.previous?.model), failed: identity(request.failed?.model), inputState: request.state ?? null, signalIsContextSignal: request.signal === ctx.signal });
      if (!model) throw new Error(`Missing target: ${provider}/${id}`);
      if (request.reason === "direct") notifyDirectRoute?.();
      return { model, thinkingLevel: "off", state: { lastProvider: provider } };
    },
  });
  const affinity = new IdSource().session(Date.now());
  pi.on("before_provider_headers", async (event, ctx) => {
    applyCliIdentity(event.headers, affinity);
    log(event.type, ctx, { eventKeys: Object.keys(event).sort(), headerKeys: Object.keys(event.headers).sort() });
    if (process.env.PROBE_INTERLEAVE === "1" && !injected) {
      injected = true;
      const controller = new AbortController();
      controller.abort();
      const result = await ctx.modelRegistry.streamSimple(ctx.model, { messages: [{ role: "user", content: "interleaved cancelled probe", timestamp: Date.now() }] }, { signal: controller.signal }).result();
      log("direct_result", ctx, { message: msg(result) });
    } else if (process.env.PROBE_INTERLEAVE === "2" && !injected) {
      injected = true;
      const ready = new Promise((resolve) => { notifyDirectRoute = resolve; });
      directPromise = ctx.modelRegistry.streamSimple(ctx.model, { messages: [{ role: "user", content: "Reply OK.", timestamp: Date.now() }] }, {
        signal: ctx.signal,
        maxTokens: 8,
        onResponse: (response, model) => log("direct_onResponse", ctx, { physical: identity(model), status: response.status, headerKeys: Object.keys(response.headers).sort() }),
      }).result();
      await ready;
      log("direct_started", ctx);
    }
  });
  pi.on("before_provider_request", (event, ctx) => {
    const payload = event.payload;
    const model = payload && typeof payload === "object" ? payload.model : undefined;
    if (model === "big-pickle") applyCliEnv(payload, envBlock(ctx.cwd, process.platform));
    log(event.type, ctx, { eventKeys: Object.keys(event).sort(), payloadKeys: payload && typeof payload === "object" ? Object.keys(payload).sort() : [], payloadModel: model ?? null });
  });
  pi.on("after_provider_response", (event, ctx) => {
    loggedStream = false;
    log(event.type, ctx, { eventKeys: Object.keys(event).sort(), status: event.status, headerKeys: Object.keys(event.headers).sort() });
  });
  pi.on("provider_stream_event", (event, ctx) => {
    if (loggedStream) return;
    loggedStream = true;
    log(event.type, ctx, { eventKeys: Object.keys(event).sort(), provider: event.provider, model: event.model, api: event.api });
  });
  pi.on("message_end", (event, ctx) => log(event.type, ctx, { eventKeys: Object.keys(event).sort(), message: msg(event.message) }));
  pi.on("turn_end", (event, ctx) => log(event.type, ctx, { eventKeys: Object.keys(event).sort(), message: msg(event.message), toolResults: event.toolResults.length }));
  pi.on("agent_end", async (event, ctx) => {
    log(event.type, ctx, { eventKeys: Object.keys(event).sort(), messages: event.messages.map(msg) });
    if (directPromise) log("direct_result", ctx, { message: msg(await directPromise) });
  });
}
