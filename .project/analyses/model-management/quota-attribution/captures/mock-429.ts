import { appendFileSync } from "node:fs";
const path = "/tmp/pi-quota-attribution.FHUVNJtA/mock-429.jsonl";
const log = (event) => appendFileSync(path, `${JSON.stringify(event)}\n`);
const ids = ["mock-openai", "mock-anthropic"];
export default function (pi) {
  for (const [index, id] of ids.entries()) {
    pi.registerProvider(id, {
      baseUrl: process.env.PROBE_MOCK_URL,
      apiKey: "dummy",
      api: index === 0 ? "openai-completions" : "anthropic-messages",
      models: [{ id: "m", name: "m", input: ["text"], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 100 }],
    });
  }
  let n = 0;
  pi.registerVirtualModel({ provider: "mock-group", id: "g", name: "mock", route(request, ctx) { const provider = ids[n++ % 2]; log({ hook: "route", provider }); return { model: ctx.modelRegistry.find(provider, "m"), thinkingLevel: "off" }; } });
  for (const hook of ["before_provider_headers", "before_provider_request", "after_provider_response"]) pi.on(hook, (event) => log({ hook, status: event.status ?? null, headerKeys: event.headers ? Object.keys(event.headers).sort() : [] }));
  pi.on("message_end", (event) => { if (event.message.role === "assistant") log({ hook: "message_end", provider: event.message.provider, api: event.message.api, stopReason: event.message.stopReason }); });
}
