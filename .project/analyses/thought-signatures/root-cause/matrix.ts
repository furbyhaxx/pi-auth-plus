import { strict as assert } from "node:assert";
import { normalizeContext } from "@earendil-works/pi-ai";
import { convertMessages as nativeConvert } from "../../../../node_modules/@earendil-works/pi-ai/dist/api/google-shared.js";
import { convertMessages as customConvert } from "../../../../src/families/google/convert.ts";
import { streamAntigravityResponse } from "../../../../src/families/google/stream.ts";
import guard, { isPlausibleSignature, sanitizePayload } from "/mnt/shared/.agents/pi/extensions/gemini-reasoning-guard.ts";

const DUMMY = "skip_thought_signature_validator";
const SIGNED = "Z2VudWluZS1zaWduYXR1cmU=";
const model: any = { id: "gemini-3-test", name: "fixture", api: "google-generative-ai", provider: "antigravity", baseUrl: "http://127.0.0.1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000 };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function transcript(signature: string, otherModel = false) {
  return normalizeContext({ messages: [
    { role: "user", content: "test", timestamp: 1 },
    { role: "assistant", provider: model.provider, model: otherModel ? "other-model" : model.id, api: model.api, usage, timestamp: 1, stopReason: "toolUse", content: [
      { type: "toolCall", id: "one", name: "one", arguments: {}, thoughtSignature: signature },
      { type: "toolCall", id: "two", name: "two", arguments: {} },
    ] },
    { role: "toolResult", toolCallId: "one", toolName: "one", content: [{ type: "text", text: "one" }], isError: false, timestamp: 1 },
    { role: "toolResult", toolCallId: "two", toolName: "two", content: [{ type: "text", text: "two" }], isError: false, timestamp: 1 },
  ] });
}
for (const [label, signature, other] of [["genuine-same-model", SIGNED, false], ["dummy-same-model", DUMMY, false], ["genuine-cross-model", SIGNED, true]] as const) {
  const a = customConvert(model, transcript(signature, other) as any);
  const b = nativeConvert(model, transcript(signature, other) as any);
  assert.deepEqual(a, b);
  const part = a.find((c: any) => c.role === "model")?.parts[0];
  assert.equal(part?.thoughtSignature, label === "genuine-same-model" ? SIGNED : undefined);
  assert.equal(a.find((c: any) => c.role === "model")?.parts[1]?.thoughtSignature, undefined);
  console.log(JSON.stringify({ case: label, contents: a }));
}
const chunk = { response: { candidates: [{ content: { parts: [
  { functionCall: { id: "one", name: "one", args: {} } }, { thoughtSignature: SIGNED },
] }, finishReason: "STOP" }] } };
const result = await streamAntigravityResponse(model, new Response(`data: ${JSON.stringify(chunk)}\n\n`)).result();
assert.equal((result.content[0] as any).thoughtSignature, undefined);
console.log(JSON.stringify({ case: "synthetic-standalone-signature-after-tool-call", streamInput: chunk.response.candidates[0].content.parts, normalizedOutput: result.content }));

const direct = { model: model.id, contents: [{ role: "model", parts: [{ functionCall: { name: "one", args: {} }, thoughtSignature: DUMMY }] }] };
const nested = { model: model.id, request: { contents: direct.contents } };
const sanitized = sanitizePayload(direct, false);
assert.equal((sanitized?.payload.contents?.[0]?.parts?.[0] as any).thoughtSignature, undefined);
assert.equal(sanitizePayload(nested, true), undefined);
const handlers = new Map<string, (event: any, context?: any) => any>();
const entries: any[] = [];
guard({ on: (name: string, fn: any) => handlers.set(name, fn), appendEntry: (...args: any[]) => entries.push(args), registerCommand: () => {} } as any);
handlers.get("message_end")?.({ message: { role: "assistant", provider: "unrelated-provider", stopReason: "error", errorMessage: "INVALID_ARGUMENT: unrelated invalid function arguments" } });
const continuation = handlers.get("agent_before_settle")?.({ context: { canContinue: false } });
assert.equal(entries.length, 1);
assert.equal(continuation.continue, true);
console.log(JSON.stringify({ case: "loaded-global-guard-interaction", isDummyPlausible: isPlausibleSignature(DUMMY), directAfterGuard: sanitized?.payload, antigravityNestedModified: sanitizePayload(nested, true) !== undefined, unrelatedErrorEntries: entries, unrelatedErrorContinuation: continuation }));

const old = { role: "user", parts: [{ text: "earlier" }] };
const previous = { role: "model", parts: [{ functionCall: { name: "old", args: {} } }] };
const current = { role: "user", parts: [{ text: "current" }] };
const signedStep = { role: "model", parts: [{ functionCall: { name: "a", args: {} }, thoughtSignature: SIGNED }, { functionCall: { name: "b", args: {} } }] };
const response = { role: "user", parts: [{ functionResponse: { name: "a", response: { output: "done" } } }] };
const missingStep = { role: "model", parts: [{ functionCall: { name: "c", args: {} } }, { functionCall: { name: "d", args: {} } }] };
const before = [old, previous, response, current, signedStep, response, missingStep, response];
const after: any[] = JSON.parse(JSON.stringify(before));
const start = after.findLastIndex((c: any) => c.role === "user" && c.parts.some((p: any) => p.text || p.inlineData));
for (const content of after.slice(start + 1)) {
  if (content.role !== "model") continue;
  const first = content.parts.find((part: any) => part.functionCall);
  if (first && !first.thoughtSignature) first.thoughtSignature = DUMMY;
}
assert.equal(after[1].parts[0].thoughtSignature, undefined);
assert.equal(after[4].parts[0].thoughtSignature, SIGNED);
assert.equal(after[4].parts[1].thoughtSignature, undefined);
assert.equal(after[6].parts[0].thoughtSignature, DUMMY);
assert.equal(after[6].parts[1].thoughtSignature, undefined);
console.log(JSON.stringify({ case: "synthetic-current-turn-eligibility", before, after }));
