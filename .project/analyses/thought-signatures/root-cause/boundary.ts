import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const ERROR = "Function call is missing a thought_signature in functionCall parts";
const DUMMY = "skip_thought_signature_validator";
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

async function test(kind: "repair" | "unrelated" | "wrong-status" | "always-fails") {
  const scratch = mkdtempSync(join(tmpdir(), "pi-signature-repro-"));
  let toolRuns = 0;
  const calls: any[] = [];
  const events: any[] = [];
  let failureEntryId: string | undefined;
  let repaired = false;
  let arm = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body: any = await req.json();
    const modelParts = body.contents.filter((c: any) => c.role === "model").flatMap((c: any) => c.parts);
    const functionCall = modelParts.find((p: any) => p.functionCall);
    calls.push({ roles: body.contents.map((c: any) => c.role), modelParts });
    if (!functionCall) return new Response(frame({ candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "call_1", name: "count", args: { value: 1 } } }] }, finishReason: "STOP" }] }), { headers: { "content-type": "text/event-stream" } });
    if (kind !== "repair" || functionCall.thoughtSignature !== DUMMY) {
      const status = kind === "wrong-status" ? 403 : 400;
      return Response.json({ error: { code: status, status: "INVALID_ARGUMENT", message: kind === "unrelated" ? "Unrelated invalid arguments" : ERROR } }, { status });
    }
    return new Response(frame({ candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP" }] }), { headers: { "content-type": "text/event-stream" } });
  }});
  let session: any;
  try {
    const settings = SettingsManager.inMemory();
    const runtime = await ModelRuntime.create({ authPath: join(scratch, "auth.json"), modelsPath: null, modelsStorePath: join(scratch, "models-store.json"), refreshOnCreate: false });
    await runtime.setRuntimeApiKey("google", "fixture");
    const model: any = { id: "gemini-3-test", name: "fixture", api: "google-generative-ai", provider: "google", baseUrl: `http://127.0.0.1:${server.port}`, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000 };
    const loader = new DefaultResourceLoader({ cwd: scratch, agentDir: scratch, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [(pi: any) => {
        pi.on("before_provider_request", (event: any) => {
          if (!arm) return;
          const payload = { ...event.payload, contents: event.payload.contents.map((c: any) => ({ ...c, parts: c.parts.map((p: any) => ({ ...p })) })) };
          for (const content of payload.contents) {
            if (content.role !== "model") continue;
            const part = content.parts.find((p: any) => p.functionCall);
            if (part && !part.thoughtSignature) part.thoughtSignature = DUMMY;
          }
          arm = false;
          return payload;
        });
        pi.on("turn_end", (event: any) => {
          events.push({ event: "turn_end", outcome: event.outcome, stopReason: event.message.stopReason, canContinue: event.context.canContinue });
          if (!repaired && event.message.stopReason === "error" && event.message.errorMessage?.includes('"code":400') && event.message.errorMessage?.includes(ERROR)) failureEntryId = event.messageEntryId;
        });
        pi.on("agent_before_settle", (event: any) => {
          events.push({ event: "agent_before_settle", outcome: event.outcome, canContinue: event.context.canContinue });
          if (!failureEntryId || repaired) return;
          repaired = true;
          arm = true;
          return { entries: [{ type: "context_edit", targetId: failureEntryId, replacement: null }], continue: true };
        });
      }] });
    await loader.reload();
    const tool: any = { name: "count", label: "count", description: "Counts executions", parameters: Type.Object({ value: Type.Number() }),
      execute: async () => { toolRuns++; return { content: [{ type: "text", text: "finished once" }], details: {} }; } };
    ({ session } = await createAgentSession({ cwd: scratch, agentDir: scratch, model, modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(scratch), customTools: [tool], tools: ["count"] }));
    await session.bindExtensions({ mode: "print", onError: (err: any) => events.push({ event: "extension_error", error: err.error }) });
    await session.prompt("Run count once", { expandPromptTemplates: false });
    await session.waitForIdle();
    assert.equal(toolRuns, 1);
    assert.equal(calls.length, kind === "unrelated" || kind === "wrong-status" ? 2 : 3);
    assert.deepEqual(events.filter((e) => e.event === "extension_error"), []);
    assert.equal(repaired, kind === "repair" || kind === "always-fails");
    const final = session.messages.filter((m: any) => m.role === "assistant").at(-1);
    assert.equal(final.stopReason, kind === "repair" ? "stop" : "error");
    console.log(JSON.stringify({ kind, calls, toolRuns, events, repaired, finalStop: final.stopReason, sessionRoles: session.messages.map((m: any) => m.role), contextEdits: session.sessionManager.getBranch().filter((e: any) => e.type === "context_edit").length }));
  } finally { session?.dispose(); server.stop(true); rmSync(scratch, { recursive: true, force: true }); }
}
for (const kind of ["repair", "unrelated", "wrong-status", "always-fails"] as const) await test(kind);
