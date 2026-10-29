import { strict as assert } from "node:assert";
import { runAgentLoop, runAgentLoopContinue } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { stream as googleStream } from "../../../../node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js";
import { stream as openaiStream } from "../../../../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";
import { antigravityProvider } from "../../../../src/families/google/provider.ts";

// These are deterministic synthetic values; no real credentials or provider traffic are used.
const DUMMY = "skip_thought_signature_validator";
const SIGNATURE = "Z2VudWluZS1zaWduYXR1cmU=";
const ERROR = "Function call is missing a thought_signature in functionCall parts";
const details = [{ type: "reasoning.encrypted", format: "google-gemini-v1", id: "fixture", data: SIGNATURE }];
const json = (x: unknown) => JSON.parse(JSON.stringify(x));
const sse = (x: unknown) => `data: ${JSON.stringify(x)}\n\n`;

interface Scenario {
  provider: "antigravity" | "google" | "opencode" | "openrouter";
  incoming: "missing" | "native-signed" | "compat-extra" | "compat-detail";
  transport?: "google-generative-ai" | "openai-completions";
  unrelated?: boolean;
}

async function run(s: Scenario) {
  const requests: unknown[] = [];
  const hookPayloads: unknown[] = [];
  const responseStatuses: number[] = [];
  const events: unknown[] = [];
  let toolRuns = 0;
  const native = s.provider === "antigravity" || s.provider === "google" || s.transport === "google-generative-ai";
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const body: any = await req.json();
      requests.push(json(body));
      const contents = s.provider === "antigravity" ? body.request.contents : body.contents;
      const prior = native
        ? contents.flatMap((c: any) => c.role === "model" ? c.parts.filter((p: any) => p.functionCall) : [])
        : body.messages.flatMap((m: any) => m.role === "assistant" ? m.tool_calls ?? [] : []);
      if (!prior.length) {
        if (native) {
          const part = { functionCall: { id: "call_1", name: "count", args: { value: 1 } },
            ...(s.incoming === "native-signed" ? { thoughtSignature: SIGNATURE } : {}) };
          const chunk = { candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] };
          return new Response(sse(s.provider === "antigravity" ? { response: chunk } : chunk), { headers: { "content-type": "text/event-stream" } });
        }
        const delta = {
          role: "assistant",
          ...(s.incoming === "compat-detail" ? { reasoning_details: details } : {}),
          tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "count", arguments: "{\"value\":1}" },
            ...(s.incoming === "compat-extra" ? { extra_content: { google: { thought_signature: SIGNATURE } } } : {}) }],
        };
        return new Response(sse({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] }) +
          sse({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      const replay = native ? prior[0].thoughtSignature : prior[0].extra_content?.google?.thought_signature;
      const hasDetails = !native && body.messages.some((m: any) => m.reasoning_details?.some((d: any) => d.data === SIGNATURE));
      if (s.unrelated || (!replay && !hasDetails)) {
        return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: s.unrelated ? "Unrelated invalid function arguments" : ERROR } }, { status: 400 });
      }
      if (native) {
        const chunk = { candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP" }] };
        return new Response(sse(s.provider === "antigravity" ? { response: chunk } : chunk), { headers: { "content-type": "text/event-stream" } });
      }
      return new Response(sse({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "done" }, finish_reason: "stop" }] }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  });
  try {
    const model: any = { id: "gemini-3-test", name: "fixture", api: native ? "google-generative-ai" : "openai-completions", provider: s.provider,
      baseUrl: `http://127.0.0.1:${server.port}`, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
      thinkingLevelMap: { low: "gemini-3-test-low|MODEL_TEST|level:LOW" } };
    const fakeProvider = antigravityProvider({ auth: {} as any, project: { resolve: async () => "fixture-project" },
      fetch: (_input: any, init: any) => fetch(`http://127.0.0.1:${server.port}/v1internal:streamGenerateContent?alt=sse`, init) });
    let repairPayload = false;
    const onPayload = (payload: any) => {
      hookPayloads.push(json(payload));
      if (!repairPayload) return payload;
      const copy = json(payload);
      if (native) {
        const contents = s.provider === "antigravity" ? copy.request.contents : copy.contents;
        for (const content of contents) {
          if (content.role !== "model") continue;
          const first = content.parts.find((part: any) => part.functionCall);
          if (first && !first.thoughtSignature) first.thoughtSignature = DUMMY;
        }
      } else {
        for (const message of copy.messages) {
          if (message.role !== "assistant" || !message.tool_calls?.length) continue;
          const first = message.tool_calls[0];
          if (!first.extra_content?.google?.thought_signature) {
            first.extra_content = { ...(first.extra_content ?? {}), google: { ...(first.extra_content?.google ?? {}), thought_signature: DUMMY } };
          }
        }
      }
      return copy;
    };
    const options: any = { apiKey: "fixture", maxRetries: 0, headers: s.provider === "antigravity" ? { Authorization: "Bearer fixture" } : {},
      onPayload, onResponse: (r: any) => responseStatuses.push(r.status) };
    const config: any = { model, ...options, convertToLlm: (messages: any[]) => messages,
      finishTurn: (turn: any) => turn.message.stopReason === "error" ? { action: "continue" } : undefined };
    const tool: any = { name: "count", label: "count", description: "Counts executions", parameters: Type.Object({ value: Type.Number() }),
      execute: async () => { toolRuns++; return { content: [{ type: "text", text: "finished once" }], details: {} }; } };
    const source = (m: any, ctx: any, opts: any) => s.provider === "antigravity" ? fakeProvider.streamSimple(m, ctx, opts)
      : native ? googleStream(m, ctx, opts) : openaiStream(m, ctx, opts);
    const emit = (event: any) => { if (event.type === "turn_end" || event.type === "tool_execution_end") events.push({ type: event.type, ...(event.message ? { stopReason: event.message.stopReason, errorMessage: event.message.errorMessage } : {}) }); };
    const start = await runAgentLoop([{ role: "user", content: "Run count once", timestamp: 1 }], { messages: [], tools: [tool] }, config, emit, undefined, source);
    const original = start.find((m: any) => m.role === "assistant" && m.stopReason === "toolUse");
    const failure = start.at(-1) as any;
    assert.equal(toolRuns, 1);
    if (s.incoming === "native-signed" || s.incoming === "compat-detail") {
      assert.equal(failure.stopReason, "stop");
      assert.equal(requests.length, 2);
    } else {
      assert.equal(failure.stopReason, "error");
      assert.equal(requests.length, 2, "finishTurn continue must not override an error hard exit");
      if (!s.unrelated) {
        assert.match(failure.errorMessage, /missing a thought_signature/);
        const transcript = start.filter((m: any) => !(m.role === "assistant" && m.stopReason === "error"));
        const edited = transcript.map((m: any) => m.role !== "assistant" ? m : { ...m, content: m.content.map((c: any) => c.type === "toolCall" ? { ...c, thoughtSignature: DUMMY } : c) });
        const generic = await runAgentLoopContinue({ messages: edited, tools: [tool] }, config, emit, undefined, source);
        assert.equal((generic.at(-1) as any).stopReason, "error", "raw transcript dummy must not survive these adapters");
        repairPayload = true;
        const fixed = await runAgentLoopContinue({ messages: transcript, tools: [tool] }, config, emit, undefined, source);
        assert.equal((fixed.at(-1) as any).stopReason, "stop");
        assert.equal(toolRuns, 1, "resume must not execute prior tools again");
      }
    }
    const selection = (body: any) => native
      ? (s.provider === "antigravity" ? body.request.contents : body.contents).filter((c: any) => c.role === "model")
      : body.messages.filter((m: any) => m.role === "assistant");
    return { scenario: s, toolRuns, assistantContent: original?.content, statusesObservedByOnResponse: responseStatuses,
      events, hookShapes: hookPayloads.map((x: any) => Object.keys(x).sort()), replayPayloads: requests.slice(1).map(selection) };
  } finally { server.stop(true); }
}

for (const scenario of [
  { provider: "antigravity", incoming: "missing" },
  { provider: "antigravity", incoming: "native-signed" },
  { provider: "google", incoming: "missing" },
  { provider: "google", incoming: "native-signed" },
  { provider: "opencode", incoming: "missing", transport: "google-generative-ai" },
  { provider: "opencode", incoming: "native-signed", transport: "google-generative-ai" },
  { provider: "opencode", incoming: "compat-extra", transport: "openai-completions" },
  { provider: "openrouter", incoming: "compat-extra" },
  { provider: "openrouter", incoming: "compat-detail" },
  { provider: "antigravity", incoming: "missing", unrelated: true },
] as Scenario[]) {
  console.log(JSON.stringify(await run(scenario)));
}
