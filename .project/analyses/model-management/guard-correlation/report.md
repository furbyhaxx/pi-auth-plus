---
version: 1
id: "model-groups-guard-correlation"
title: "Pi 1.4 model-group request attribution"
description: "Physical request correlation, stream wrapping, ownership effects, and event evidence"
type: "analysis"
created: "2026-10-28T11:53:36+01:00"
updated: "2026-10-28T11:53:36+01:00"
createdBy: "analyst"
updatedBy: "analyst"
document:
  type: "analysis"
  id: "model-groups-guard-correlation"
  title: "Pi 1.4 model-group request attribution"
  description: "Physical request correlation, stream wrapping, ownership effects, and event evidence"
  status: "published"
  revision: 1
  created_at: "2026-10-28T11:53:36+01:00"
  updated_at: "2026-10-28T11:53:36+01:00"
  created_by: "analyst"
  updated_by: "analyst"
  changelog:
    - revision: 1
      reason: "Investigation"
      changes: ["Trace Pi 1.4 seams and test concurrent request correlation and provider ownership"]
---

# Pi 1.4 model-group request attribution

status: "root-caused"
confidence: "high"

## Summary

Pi keeps `ctx.model` at the virtual selection; request hooks omit the physical provider and a request identity. The existing OpenCode payload guard misses routed OpenCode requests, and Synthetic's shared payload slot misses routed prompt rescaling. Two simultaneous calls can share both the signal and model ID. Route-local `AsyncLocalStorage.enterWith` did not fix the agent path and contaminated a separate physical call.

A provider-stream wrapper can hold the physical model, payload and result in one request-local closure; the mock confirmed retries, compaction and overlapping helpers. The tested registration mechanisms have parity-breaking ownership effects, so this proof is **not** a safe drop-in fix for the builtin OpenCode provider. Do not silently enable unsafe group routing. Preserve the builtin provider or expose the limitation until a composable seam is available.

## Reproduction

Environment: local Pi-Bolt `1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`, Bun `1.4.3`; the checkout's pinned `@earendil-works/pi-coding-agent`, `pi-agent-core` and `pi-ai` are 1.4.0. Local source paths below are relative to the repository; `core` means `node_modules/@earendil-works/pi-coding-agent/dist/core/`, and `ai` means `node_modules/@earendil-works/pi-ai/dist/`.

The isolated RPC runs used only an ephemeral loopback SSE server and dummy auth. HOME, agent dir and XDG dirs were separate scratch directories; no real credentials, providers or user configuration were accessed. Three mock physical providers, including `opencode`, `synthetic` and an unrelated `impostor`, deliberately share model ID `hf:acme/test`. The mock first returns a 429 on OpenCode; Pi automatically retries on Synthetic. Each run then dispatches an impostor turn, a Synthetic turn and manual compaction. Five helper requests overlap, four through the group and one directly through the physical `stream` API; all use the same signal and session ID. Synthetic tokenization is a deterministic **character-count stub**, not a real tokenizer or a live-provider measurement.

Modes: `legacy5` loads the actual current family hooks; `wrapped5` installs a deliberately experimental native-provider snapshot wrapper; `named5` installs a named OpenCode `streamSimple` override that calls Pi's native OpenAI-completions adapter; `als6` enters an AsyncLocalStorage store in `route`; `raw5` records unmodified event objects. The captured scripts and unmodified output are in [captures/](captures/); `raw5.events.jsonl` contains the full event envelopes, including the complete mock payloads. All 19 saved files were byte-compared with their scratch originals.

Exact executed commands, after creating the scratch directory and writing the captured scripts into it:

```sh
timeout 55s bun /tmp/pi-guard-correlation.k1ejpwE7/run.mjs legacy5 > /tmp/pi-guard-correlation.k1ejpwE7/legacy5.stdout.jsonl
timeout 55s bun /tmp/pi-guard-correlation.k1ejpwE7/run.mjs wrapped5 > /tmp/pi-guard-correlation.k1ejpwE7/wrapped5.stdout.jsonl
timeout 55s bun /tmp/pi-guard-correlation.k1ejpwE7/run.mjs named5 > /tmp/pi-guard-correlation.k1ejpwE7/named5.stdout.jsonl
timeout 55s bun /tmp/pi-guard-correlation.k1ejpwE7/run.mjs als6 > /tmp/pi-guard-correlation.k1ejpwE7/als6.stdout.jsonl
timeout 55s bun /tmp/pi-guard-correlation.k1ejpwE7/run.mjs raw5 > /tmp/pi-guard-correlation.k1ejpwE7/raw5.stdout.jsonl
bun /tmp/pi-guard-correlation.k1ejpwE7/verify.mjs
```

Each run exited 0 with 11 requests, 3 settled turns, successful compaction, one automatic retry and zero stderr bytes. Verifier output:

```text
PASS retry, compaction, 11 loopback requests and clean exit in all five modes
PASS legacy virtual + direct OpenCode miss env; current header hook spoofs impostor; wrapper scopes identity
PASS overlapping same-id helpers retain their own prompt counts (FAST=26, SLOW=51)
PASS compaction has no parent payload callback; local wrapper corrects direct usage
PASS native registration discards named model header; named streamSimple override drops stream effort
PASS route-enterWith absent in main hooks and misattributes a parallel physical helper
PASS captured event envelopes omit physical identity until provider_stream_event/message_end
```

To reproduce after scratch cleanup from the repository root, first run:

```sh
d=/tmp/pi-guard-correlation.k1ejpwE7
test ! -e "$d" || { printf 'Scratch path already exists; stop.\n' >&2; exit 1; }
mkdir -p "$d"
cp .project/analyses/model-management/guard-correlation/captures/{probe.ts,run.mjs,verify.mjs} "$d"/
```

Then execute the commands above. The scripts intentionally refer to this checkout and that fixed scratch path. They are test instrumentation, not implementation code.

## Root cause and event contracts

1. `core/agent-session.js:455-484` dispatches the returned physical model but preserves the selected virtual model in agent state. `core/extensions/runner.js:613-645` reads `ctx.model` from session state. `core/model-runtime.js:736-759` resolves the route's provider and ID back to the physical catalog entry; custom properties returned on a cloned route model are not carried through. The router's `signal`, `model`, state, previous and failure are not a unique request ID (`core/virtual-models.d.ts:33-68`).
2. `src/families/opencode/index.ts:85-90` requires `ctx.model.provider` and its ID to match, so its `<env>` transform does not run for the virtual selection. The separate header handler at lines 80-82 does **not** use `ctx.model`; `src/families/opencode/identity.ts:65-71` accepts any `x-opencode-client` or `x-opencode-session` header. The mock showed the real handler changing an unrelated provider's deliberately configured `x-opencode-client: other-app` to `cli` and adding the OpenCode user agent/session. Direct registry helpers do not run that session hook at all.
3. `src/families/synthetic/index.ts:68-86` keeps one session-wide payload, clears it on every request and admits it only for a selected Synthetic model. Its tokenizer preload also checks the selected model at lines 69-75 and 91-92. A virtual selection therefore prevents both prompt capture and proactive physical-model preload. `usage.ts:37-48` **does** still deduplicate a matching Synthetic assistant's cache-write usage at `message_end`, but cannot rescale without the request payload and a loaded tokenizer. Helpers and compaction have no matching session `message_end` at all. The shared slot is also unsafe for interleaved physical requests.
4. `core/sdk.js:193-249` strips the `model` argument from the underlying payload/response callbacks while building extension events. `core/extensions/types.d.ts:693-717` defines these envelopes. In `raw5`, exact serialized examples were:

```json
{"type":"before_provider_headers","headers":{"x-opencode-session":"01a18222-f483-71ca-b69a-777080c74409","x-probe-model":"model-kept"}}
{"type":"after_provider_response","status":200,"headers":{"cache-control":"no-cache","connection":"keep-alive","content-type":"text/event-stream","date":"Wed, 28 Oct 2026 10:51:32 GMT","keep-alive":"timeout=5","transfer-encoding":"chunked"}}
{"data":{"type":"message_start","message":{"id":"msg_mock","type":"message","role":"assistant","model":"hf:acme/test","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0,"cache_creation_input_tokens":10,"cache_read_input_tokens":0}}},"type":"provider_stream_event","provider":"synthetic","api":"anthropic-messages","model":"hf:acme/test"}
```

The exact `before_provider_request` objects, including all system text, tools and messages, are `captures/raw5.events.jsonl:2,5,10,14`; their event envelope is only `{type, payload}` and each payload's `model` is the same ID. The stream event supplies physical identity **after** the request and response; it has no correlation ID, is adapter-dependent, and is unavailable for the direct helpers here. `message_end` includes a physical assistant but cannot safely recover its payload after interleaving. `onPayload(payload, model)` and `onResponse(response, model)` at the provider interface do receive the physical model (`ai/types.d.ts:69-73,112-119`), unlike the session events.

For this Pi path, `before_provider_headers` actually ran before `before_provider_request`, as both the trace and `core/model-runtime.js:461-479` show. The opposite ordering asserted in the comment at `src/families/opencode/index.ts:83` is wrong. Ordering does not create a correlation identifier; it also does not cover callbacks that are absent.

5. Default compaction resolves the group as a `direct` route (`core/agent-session.js:248-256,2206-2209`) and calls the stream function with fresh summary options (`core/compaction/compaction.js:463-487`). In the mock its two summary requests emitted `before_provider_headers` but no `before_provider_request`, `after_provider_response` or session `message_end`; the wrapper's own `onPayload`/`onResponse` were present despite `hasParentCallback: false`. This is why adding provider identity only to the existing session event is insufficient for the required coverage.

## Experiments and limits

### Concurrent correlation and side effects

`captures/legacy5.trace.jsonl` shows the user route and four direct routes all observed the same context signal. Synthetic and impostor payloads report the same model ID. The fast Synthetic helper completed before the slow one, though both were in flight. A generic session/model/signal slot cannot distinguish them.

`captures/als6.trace.jsonl:1-2,7,23` shows the additional async-local test. The main OpenCode route entered `{provider:"opencode",route:1}`, but both main header and payload hooks observed `als:null`. Worse, the directly dispatched OpenCode API helper observed `{provider:"impostor",route:4}` from an unrelated earlier route. This rules out **this** `enterWith` technique for the required paths; it is not a claim about every possible async-local implementation.

### Request-local stream seam

In `wrapped5`, each invocation captured its own `model` and final transformed payload. It forwarded the previous `onPayload`/`onResponse`, checked `model.provider` before adding OpenCode identity and `<env>`, and replaced Synthetic's terminal `done.message` with `correctSyntheticRequestUsage`. The fast and slow helper results were respectively 26 and 51 mock units, in reverse completion order; the impostor kept its own `other-app` client and received no OpenCode user agent. Both direct `stream` and virtual `streamSimple` OpenCode helpers received the mocked CLI identity and `<env>`; the physical `stream` retained `reasoning_effort: high`.

The retry succeeded on Synthetic and its assistant showed scaled mock usage. Manual compaction's aggregate changed from legacy `{input:20, output:10, cacheWrite:20, totalTokens:50}` to wrapped `{input:2319, output:10, cacheWrite:0, totalTokens:2329}` across its two summary requests. Values depend on the stub and prompt, and demonstrate correlation only. The wrapper test already had the tokenizer available; a production implementation must arrange nonblocking preload for the routed physical model and preserve unknown/provider usage while it is unavailable.

This scratch wrapper is a **proof**, not a robust implementation: its exception/end path can leave `.result()` unresolved, it does not establish full abort/error/partial-event parity, and the registration broke configured headers as below. Do not copy it into production.

### Registration and builtin ownership

The tested native route snapshots `ctx.modelRegistry.getProvider(id)` in `session_start` and calls `pi.registerProvider({...base, stream, streamSimple})`. Both dispatch methods delegate to the captured real provider; this avoids replacing its underlying protocol adapter. However `core/model-runtime.js:635-642` deletes that provider's named extension configuration on native registration. `getAuth` reads model-specific extension headers from that deleted configuration (`model-runtime.js:372-380`, `provider-composer.js:326-339,468-469`). The mock's `x-probe-model: model-kept` was present on both OpenCode and Synthetic before wrapping and absent on both after. `post_register` reported `named:false,native:true`. A later named registration deletes the native wrapper (`model-runtime.js:665-681`). Captured provider objects and registration timing also require catalog-refresh, authentication and multi-extension ownership checks; these are not established here.

Named `{api, streamSimple}` registration keeps the named config and only intercepts the matching API, but `core/provider-composer.js:376-391` routes **both** `stream` and `streamSimple` to the extension's `streamSimple`. The actual `named5` mock dropped the physical `stream` caller's `reasoningEffort: high`: the native and wrapped streams sent `reasoning_effort:"high"`, while the named override sent none. OpenCode and OpenCode Go support four chat APIs (`ai/providers/opencode.js:10-20`, `opencode-go.js:9-19`); a single named API override does not wrap them all. Directly calling a raw adapter can also bypass builtin provider decorators and future behavior. Therefore neither tested registration is a generally faithful, side-effect-free OpenCode decorator.

## Recommended fix and regression coverage

- **Synthetic:** Its provider is package-owned. Investigate a factory-registered native provider with both `stream` and `streamSimple` delegating to Pi's Anthropic transport while keeping request state in each invocation. `createProvider` supports both stream methods and dynamic models (`ai/models.d.ts:215-256`), but its fetch/publish semantics and auth/catalog/model-header behavior must be reconciled with the existing `refreshCatalog` before treating this as safe. Forward all options and callbacks and preserve final event/result, errors, partials and cancellation. Use the final payload after other transformations and apply physical-model tokenizer preload without blocking. This is a proposed seam, not a verified parity-preserving implementation.
- **OpenCode builtin:** No tested public Pi 1.4 session-hook-only mechanism gives collision-free attribution for all required paths while retaining provider ownership. A faithful host-level composable provider decorator around the actual registered provider, or equivalent upstream request-scoped metadata and completion hooks applied to agent, direct and compaction paths, would provide the required seam. The earlier builtin-registration analysis records that the user ruled out an upstream hook request; do not assume that option is authorized. If no local parity-preserving seam is accepted, explicitly fail closed or document/disable the affected group routing rather than guessing from IDs or leaking headers. Do not re-register a captured builtin provider as if that preserved configuration.
- Add integration regressions for: duplicate physical IDs with interleaved same-signal helpers; other providers carrying `x-opencode-*` headers; physical and virtual selections; transient retry switching providers; manual and automatic compaction; both registry `stream` and `streamSimple`; direct callers that provide and omit callbacks; transformed/replaced payloads; provider multi-attempt payload callbacks; 429/error/abort/partial-stream outcomes and `.result()`; tokenizer not loaded then loaded; model-specific headers and `models.json` overrides; auth, refresh and dynamic catalogs; all OpenCode APIs, Go, and other extensions registering the same ID. Assert OpenCode identity is absent from every non-OpenCode request and provider options/callbacks remain intact.

## Open questions / follow-ups

- A complete local wrapper that preserves OpenCode builtin provider ownership, other extensions, every auth/header layer and catalog refresh has **not** been demonstrated. Native registration clearing named model headers is an observed blocker to the naive approach.
- The mock exercises manual compaction and one automatic agent retry, not automatic overflow compaction, every adapter, a real Zen request, cancellation, or actual tokenizer availability. Earlier [virtual-routing](../virtual-routing/report.md) and [quota-attribution](../quota-attribution/report.md) reports contain additional independent evidence; this report does not supersede their scope or imply live-provider validation.
- `src/families/openai/index.ts:32-38` and `verbosity.ts:20-31` use the same selected-model/payload guard pattern. Its virtual-group behavior is inferred from source, not independently reproduced here.
