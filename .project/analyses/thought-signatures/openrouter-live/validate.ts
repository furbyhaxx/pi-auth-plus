import { strict as assert } from "node:assert";
import { join } from "node:path";

const names = ["normal-1", "forced-1", "forced-studio", "forced-vertex", "dummy-1"];
const cases = await Promise.all(names.map(async (name) => JSON.parse(await Bun.file(join(import.meta.dir, `evidence-${name}.json`)).text())));
for (const item of cases) {
  assert.equal(item.model, "google/gemini-4-argon");
  assert.deepEqual(item.requests.map((request: any) => request.status), [200, 200]);
  assert.equal(item.toolRuns, 1);
  assert.equal(item.final.stopReason, "stop");
  assert.equal(item.final.textIsDone, true);
  assert.equal(item.contextEdits, 0);
  assert.equal(item.physicalHooks, true);
  assert.deepEqual(item.extensionErrors, []);
}
const normal = cases[0].requests[1].body.messages.find((message: any) => message.role === "assistant");
assert.equal(normal.reasoning_details[0].type, "reasoning.encrypted");
assert.equal(normal.reasoning_details[0].format, "google-gemini-v1");
assert.equal(normal.reasoning_details[0].matchesStream, true);
for (const item of cases.slice(1, 4)) {
  assert.equal(item.stripped[0].removedEncrypted, 1);
  const assistant = item.requests[1].body.messages.find((message: any) => message.role === "assistant");
  assert.equal(assistant.reasoning_details, undefined);
  assert.equal(assistant.tool_calls[0].extra_content, undefined);
}
assert.deepEqual(cases[2].stream.providers, ["Google AI Studio"]);
assert.deepEqual(cases[3].stream.providers, ["Google"]);
const dummy = cases[4].requests[1].body.messages.find((message: any) => message.role === "assistant");
assert.equal(dummy.tool_calls[0].extra_content.google.thought_signature, "skip_thought_signature_validator");
const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? "", ".pi", "agent");
const key = (await Bun.file(join(agentDir, "auth.json")).json()).openrouter.key;
assert(typeof key === "string" && key.length > 0);
for (const name of [...names.map((n) => `evidence-${n}.json`), "catalog.json", "probe.ts", "validate.ts", "2026-10-28-openrouter-gemini-live.md"]) {
  assert.equal((await Bun.file(join(import.meta.dir, name)).text()).includes(key), false);
}
console.log("PASS: 5 live cases; status sequences, signature preservation/omission/dummy, provider routes, tool counts and credential absence verified.");
