---
version: 1
id: "analysis-virtual-routing"
title: "Pi 1.4.0 virtual model session routing and failover"
description: "Live and local evidence for state, retry, fork and direct-call behavior of virtual model groups"
type: "analysis"
created: "2026-10-28T10:59:18+01:00"
updated: "2026-10-28T11:01:28+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "analysis"
  id: "analysis-virtual-routing"
  title: "Pi 1.4.0 virtual model session routing and failover"
  description: "Live and local evidence for state, retry, fork and direct-call behavior of virtual model groups"
  status: "published"
  revision: 1
  created_at: "2026-10-28T10:59:18+01:00"
  updated_at: "2026-10-28T11:01:28+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "probe results"
      changes: ["Live and isolated probe evidence for M4 model management"]
---

# Pi 1.4.0 virtual model session routing and failover

status: "qa-complete"
confidence: "high"

## Summary

A virtual GROUP can store the selected physical target in Pi's branch state and preserve it across tool continuations, later user turns, restart, fork and clone. Pi saves returned state before dispatch, so it records attempts, not necessarily successful choices. Pi calls the router again for a subset of failures: it retried an ordinary 429 and the tested transient errors, and the probe routed the retry from A to B. It did **not** retry the simulated 401, 429 quota-exhaustion, or 429 OpenCode free-tier-limit messages. Supporting those failures needs extension-owned recovery beyond `route()`; a bounded `agent_before_settle` probe recovered a simulated quota error.

For direct side calls Pi does not provide or persist route state, although the extension router can inspect the current branch explicitly. `ctx.modelRegistry.complete()` on a virtual model did not route in Pi 1.4.0; `streamSimple(...).result()` did.

## Environment and scope

- `pi-bolt --version`: `1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`. Pi's local installed 1.4.0 docs and source are the primary references. The short source names below resolve under `devlap05:/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-coding-agent@1.4.0@@@1/dist/core/`; the retry classifier is `devlap05:/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-ai@1.4.0@@@1/dist/utils/retry.js`. Installed Pi docs are under `devlap05:/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/`.
- The probe ran from a `mktemp -d` directory with `env -i`, isolated `HOME`, `PI_CODING_AGENT_DIR`, XDG directories, and isolated sessions; no real credentials or user auth file were copied. `--no-extensions` was used with only the explicit probe and, for the live scenario, this checkout's `src/index.ts`.
- Live free targets were A `opencode/big-pickle`, B `opencode/glm-5.3-flash-free`. `--list-models opencode` listed both with the package loaded. The live models.dev provider catalog listed zero input/output cost for both. This is not a recommendation of either model.
- To supply the OpenCode CLI environment block under virtual selection, the temporary probe explicitly invokes the existing package's `applyCliEnv` for those two physical model IDs. The package's present hook guards on `ctx.model.provider === opencode`, but the selected `ctx.model` is `probe-group/g`; see `src/families/opencode/index.ts:85-89`. The success shown here therefore includes that probe workaround. Whether Zen rejects this exact payload without it was not separately tested.
- Controlled error cases used an ephemeral loopback HTTP/1.1 OpenAI-compatible SSE server, a literal dummy API key, models `dummy/a` and `dummy/b`, and real Pi provider transport. The dummy server sent the exact status/body and SSE fixtures in the reproduced `run.py` below. No claims about all provider implementations follow from these local cases.
- Test settings set agent retries to one attempt with 20 ms delay, provider retries to zero; `retry-off` disabled agent retries. Pi defaults are 3 agent retries and 2 s base delay per the installed `docs/settings.md:139-145`. All 25 stderr files examined were empty. Driver `PASS` means RPC accepted and settled; `verify.py` separately asserts the behaviors from captured logs.
- The observed live sequence includes a naturally occurring failure; rerunning the live request may succeed on A, fail differently, or change its tool behavior. The local scenarios are controlled. The probe was revised between scenarios to add logs and extra cases; earlier route records lack `branchState` and `messageErrors`. No earlier data was edited.

## Test matrix

| Question | Observation and evidence |
|---|---|
| Multi-turn and tool | Live reasons in order: `user` on A, `retry` on B after A returned `Stream ended without finish_reason`, `continuation` on B after B called `bash`, then `user` on B. The bash tool returned `probe-ok`. Incoming state went null → A → B → B. See raw `live.routes` and `live.initial RPC`. |
| Restart / resume | A new process opened the exact saved `--session` without specifying `--model`; `get_state` reported `probe-group/g` and its next `user` route received state B and `previous` B. B returned `resumed-ok`. |
| Fork / clone | Local sequence: initial A; `SWITCH-B` changes state to B; RPC `fork` at the second user message replays from before that message and restores inherited A; a subsequent RPC `clone` also inherits A. The branch observed A, B, A, A. Forks inherit only state on their ancestry, not later state on a sibling branch. This also means a fork predating the first state entry has no sticky choice. |
| Ordinary 429 and 5xx | Local A's ordinary 429, 500, and 503 each emitted `auto_retry_start`, passed state A and the failed A message to `route(reason: retry)`, selected B, and completed on B. A 501 also retried **when the body contained `server_error`**, but a 501 body with `not_implemented` did not. Status class alone is not the classifier. |
| 401 and quota | Local 401, 429 `insufficient_quota` / `Quota exceeded`, and 429 `FreeUsageLimitError` each stopped with one route call, no retry and no B request. An ordinary 429 also stopped when agent retries were disabled. The negative quota patterns take precedence over the 429 pattern. |
| Failed state on resume | After local 401, reopening that session restored state A. A fresh user prompt invoked `reason: user`, `failed: null`, and selected A again. The prior error assistant was visible in `request.messages`, while the second provider request omitted that failed assistant; see `401-next`. |
| Partial stream | Local A sent an SSE text chunk `PARTIAL` then reset the socket. RPC had already delivered that text delta. Pi retried and `failed.message.content` contained `PARTIAL`; it exposed `ECONNRESET`, omitted the failed assistant from the next model projection, and B emitted `B OK`. A UI/client may therefore have already shown partial text before the replacement attempt. No partial tool-execution case was tested. |
| Retry metadata | In `retry-prev`, previous was B while failed was A; retry messages omitted the failed response and `failed.message` contained stop reason, text error, model/provider, thinking level, usage and content. The observed assistant object had no standalone HTTP-status property; status appeared inside `errorMessage`. `after_provider_response` fired on local B's 200 but not on local A's 429, including the terminal quota 429. This is a transport-specific observation. |
| Extension quota recovery | Local `quota-recover`: `agent_before_settle` inspected the A failure, appended a branch-local marker and a `context_edit` omitting the failed assistant, and returned `continue: true`. The next route was `user`, **not retry**, with `failed: null`; it read the marker, chose B, stored B and completed. The next user prompt stayed B. This is a minimal proof, not a complete production policy. |
| Direct / side calls | `streamSimple` invoked `reason: direct` with `state` absent, routed to A and ignored returned state; the following normal turn still used B. `direct4` also observed B via `ctx.sessionManager.getBranch()` explicitly, despite absent request state. `complete` returned `Virtual model probe-group/g must be routed before streaming` without calling the router. |

## Mechanics and constraints

1. `agent-session.js:434-475` constructs `reason` from `_failedResponse` and the projected conversation, looks up the branch's state, invokes the router and appends a new `pi.virtual-model-state` entry **before** sending the request when the returned state is a different object. Returning the incoming object or `undefined` retains the existing state; returning a fresh equal object still appends. State is keyed by virtual provider and model ID (`virtual-models.js:49-59`), not globally by session.
2. `model-runtime.js:736-759` provides the latest successful physical `previous` and separately supplies the failed physical model and full assistant message when Pi schedules retry. A failed routing operation has no failed physical model. It validates the target as an authenticated physical model and clamps thinking.
3. `agent-session.js:1530-1561,3038-3044,3088-3122` only schedules a retry if enabled, under budget and classified retryable. `pi-ai@1.4.0/dist/utils/retry.js:4-40,202-208` first excludes long-lived quota/billing patterns and otherwise matches transient error **text**, including selected status codes and network phrases. Context overflow is a separate compaction/retry path; it was not triggered in this experiment.
4. Failed retry attempts remain in raw session history but Pi appends `context_edit` omissions for model projection (`agent-session.js:843-869,3109-3110`). `agent_before_settle` can append a context edit and request a continuation when the resulting context permits it (`agent-session.js:615-637,1565-1585`).
5. Direct `streamSimple` calls resolve with only reason, thinking level and signal (`model-runtime.js:497-515`). The route result's state is discarded. `complete` instead calls API-specific `stream`, which does not take the virtual-resolution path (`model-runtime.js:485-495`); the virtual provider's unrouted stream produces the observed error (`virtual-models.js:86-90`).
6. In the supplied contract, `after_provider_response` contains status/headers but no provider ID (`extensions/types.d.ts:706-710`). The OpenAI-compatible local probe additionally showed the hook does not fire for its 429 response, so it cannot be the sole failure signal. Treat provider error texts and hook behavior as adapter-specific, not a uniform structured contract.

## Recommended GROUP design

- Persist a stable identity such as physical provider + model ID and any bounded failure bookkeeping in the virtual model's returned branch state. Choose once on first eligible `user` request, reuse it for subsequent user and continuation requests, and return the incoming object unchanged when nothing changed. Resolve the model and credential availability again each dispatch. A persisted choice may have failed because state is written before the provider call.
- For Pi-triggered retry, use `failed.model` and the failed assistant's `errorMessage` to classify supported retryable failures, choose another eligible member, and return the new state. Handle the distinction between `previous` and `failed`. Bound attempts and exclusions, avoid cycling, honor cancellation, and give an actionable error if no candidate can be used. The host's retry budget/backoff and enabled setting still apply. Provider error text can contain sensitive content: keep raw errors out of persistent router state and redact before any logging.
- For quota/401 or other terminal messages, `route(reason: retry)` alone cannot deliver automatic failover. Use a guarded session-boundary recovery that detects an eligible failure, appends durable branch-local recovery bookkeeping, omits the failed attempt and paired projected tool results when needed, and requests a continuation only when safe. The proof above covers one plain quota failure, not a general recovery implementation. Alternatively require user action. Do not silently override the user's retry preference without a product decision.
- Define direct-call policy separately: default Pi state is absent and returned state is ignored. If direct work truly needs session affinity, explicitly consult the appropriate session branch and verify that the direct request belongs to that session; otherwise route it statelessly. Prefer `streamSimple(...).result()` for virtual direct calls in Pi 1.4.0.
- Expect switching models to invalidate prompt-cache locality and potentially model-specific thinking signatures; ensure the destination accepts projected context, images and tool schemas. Do not treat `ctx.model` as the dispatched physical model in provider hooks. In particular, fix the existing OpenCode payload identification before relying on virtual selection for anonymous Zen traffic.
- Protect the contract with integration tests for user/tool/resume/fork, transient vs excluded quota 429, disabled/exhausted retries, credential failure, partial-stream error, direct calls and a bounded terminal-error recovery path.

## Reproduction

The full probe and server/driver source is embedded below. Save `probe.ts`, `run.py`, and `verify.py` into a fresh temporary directory, replace `/tmp/pi-virtual-routing.HmHLKYme` in the commands below with that directory, and run them. The source references this checkout's `src/index.ts` and OpenCode identity helper; adapt the two absolute paths if the checkout moves. Each Python driver creates an isolated agent directory and session directory and terminates its server/process. `verify.py` asserts the captured live sequence as well as local cases, so a changed upstream live response can make its live assertions fail even when local semantics still hold.

Actual experiment commands (the fixed scratch path was created with `mktemp -d /tmp/pi-virtual-routing.XXXXXXXX`; live and the first loop overlapped):
```sh
timeout 70s python3 /tmp/pi-virtual-routing.HmHLKYme/run.py 429
timeout 170s python3 /tmp/pi-virtual-routing.HmHLKYme/run.py live
for mode in branch direct 401 429 quota free-limit 500 501 503 midstream; do printf '\n--- %s ---\n' "$mode"; timeout 65s python3 /tmp/pi-virtual-routing.HmHLKYme/run.py "$mode" || exit "$?"; done
timeout 65s python3 /tmp/pi-virtual-routing.HmHLKYme/run.py direct2
for mode in direct3 retry-off 401-repeat quota-recover; do printf '\n--- %s ---\n' "$mode"; timeout 65s python3 /tmp/pi-virtual-routing.HmHLKYme/run.py "$mode" || exit "$?"; done
timeout 65s python3 /tmp/pi-virtual-routing.HmHLKYme/run.py 501-plain
for mode in retry-prev 401-next; do printf '\n--- %s ---\n' "$mode"; timeout 65s python3 /tmp/pi-virtual-routing.HmHLKYme/run.py "$mode" || exit "$?"; done
for mode in direct4 event-429 event-quota; do printf '\n--- %s ---\n' "$mode"; timeout 65s python3 /tmp/pi-virtual-routing.HmHLKYme/run.py "$mode" || exit "$?"; done
python3 /tmp/pi-virtual-routing.HmHLKYme/verify.py
```

The 429 scenario was run twice; its route and HTTP logs contain both runs, while its RPC log contains the second. The extra `direct`, `direct2` and `401-repeat` exploratory cases are superseded by `direct3/direct4` and `401-next` and are not included in the raw excerpt.

The catalog checks used the same isolated `HOME` and XDG cache:
```sh
env -i PATH="$PATH" HOME=/tmp/pi-virtual-routing.HmHLKYme PI_CODING_AGENT_DIR=/tmp/pi-virtual-routing.HmHLKYme/agent XDG_CONFIG_HOME=/tmp/pi-virtual-routing.HmHLKYme/config XDG_CACHE_HOME=/tmp/pi-virtual-routing.HmHLKYme/cache XDG_STATE_HOME=/tmp/pi-virtual-routing.HmHLKYme/state XDG_DATA_HOME=/tmp/pi-virtual-routing.HmHLKYme/data PI_TELEMETRY=0 pi-bolt --no-extensions --no-context-files --no-approve --offline -e /mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts --list-models opencode
env -i PATH="$PATH" HOME=/tmp/pi-virtual-routing.HmHLKYme XDG_CACHE_HOME=/tmp/pi-virtual-routing.HmHLKYme/cache timeout 25s /home/furbyhaxx/.pi/agent/skills/models-dev/scripts/models.dev --compact-json provider opencode | jq -c '.results[0].models | map(select(.provider_model_id == "big-pickle" or .provider_model_id == "glm-5.3-flash-free")) | map({provider_model_id, cost: .model.cost})'
```
Selected listing rows and unmodified catalog output:
```text
opencode  big-pickle                   200K     32K      yes       no
opencode  glm-5.3-flash-free           200K     32K      yes       yes
[{"provider_model_id":"big-pickle","cost":{"input":0,"output":0,"cache_read":0,"cache_write":0}},{"provider_model_id":"glm-5.3-flash-free","cost":{"input":0,"output":0,"cache_read":0}}]
```

Verification command output:
```text
PASS live user, retry, tool continuation, second user, resumed user
PASS live sticky selection persists across tool, turn and resume
PASS live bash tool actually executed
PASS resume selected virtual model
PASS resume physically answered
PASS fork restores ancestor and clone inherits it
PASS fork and clone RPC accepted
PASS direct routing neither reads nor overwrites branch state
PASS direct complete fails but streamSimple succeeds
PASS direct callback can explicitly inspect branch state
PASS OpenAI error response bypasses response hook
PASS 401 is terminal
PASS quota is terminal
PASS free-limit is terminal
PASS retry-off is terminal
PASS 501-plain is terminal
PASS 429 retries A to B
PASS 500 retries A to B
PASS 501 retries A to B
PASS 503 retries A to B
PASS retry carries distinct failed and previous model
PASS failed state survives resume and failure remains in router messages
PASS midstream reset retries with partial content
PASS boundary recovers excluded quota and sticks to B
PASS boundary records context edit
All assertions passed
```

The report's fixture-integrity check confirmed all 3 embedded source files and all 19 raw route/HTTP blocks matched their captured files, with no mismatches. Its first run falsely flagged the 19 log blocks because the checker compared regex captures without a final newline to files with one; the corrected comparison passed.

## Raw evidence

The router and loopback-server records below are complete raw JSONL for the named cases. All route timestamps are Europe/Zurich local time. RPC excerpts are **unmodified selected records**: inputs, fork/clone/state responses, assistant message ends, retries, state/context entries, tool events, settlement and mid-stream text deltas. The driver prefixes input commands with `INPUT `; output records are raw JSONL. Their machine timestamps are Pi's original UTC/Unix values. Ordinary streaming deltas, prompt/system records and other noisy RPC events are omitted, so this is not a complete RPC transcript. Model responses and synthetic local errors contain no credentials.

### live: route

```jsonl
{"ts":"2026-10-28 10:52:59.233 Europe/Zurich","mode":"live","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"opencode/big-pickle","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:00.489 Europe/Zurich","mode":"live","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"opencode/glm-5.3-flash-free","previous":null,"failed":{"model":"opencode/big-pickle","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","responseId","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"Stream ended without finish_reason","content":[]},"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:01.070 Europe/Zurich","mode":"live","reason":"continuation","stateIn":{"target":1},"stateOut":{"target":1},"sameObject":true,"target":"opencode/glm-5.3-flash-free","previous":"opencode/glm-5.3-flash-free","failed":null,"messageRoles":["system","user","assistant","toolResult"]}
{"ts":"2026-10-28 10:53:01.854 Europe/Zurich","mode":"live","reason":"user","stateIn":{"target":1},"stateOut":{"target":1},"sameObject":true,"target":"opencode/glm-5.3-flash-free","previous":"opencode/glm-5.3-flash-free","failed":null,"messageRoles":["system","user","assistant","toolResult","assistant","user"]}
{"ts":"2026-10-28 10:53:02.437 Europe/Zurich","mode":"live","reason":"user","stateIn":{"target":1},"stateOut":{"target":1},"sameObject":true,"target":"opencode/glm-5.3-flash-free","previous":"opencode/glm-5.3-flash-free","failed":null,"messageRoles":["system","user","assistant","toolResult","assistant","user","assistant","user"]}
```

### branch: route and HTTP

```jsonl
{"ts":"2026-10-28 10:53:09.985 Europe/Zurich","mode":"branch","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:09.991 Europe/Zurich","mode":"branch","reason":"user","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":"dummy/a","failed":null,"messageRoles":["system","user","assistant","user"]}
{"ts":"2026-10-28 10:53:10.039 Europe/Zurich","mode":"branch","reason":"user","stateIn":{"target":0},"stateOut":{"target":0},"sameObject":true,"target":"dummy/a","previous":"dummy/a","failed":null,"messageRoles":["system","user","assistant","user"]}
{"ts":"2026-10-28 10:53:10.087 Europe/Zurich","mode":"branch","reason":"user","stateIn":{"target":0},"stateOut":{"target":0},"sameObject":true,"target":"dummy/a","previous":"dummy/a","failed":null,"messageRoles":["system","user","assistant","user","assistant","user"]}
{"mode":"branch","path":"/v1/chat/completions","model":"a","status":200,"message_roles":["system","user"]}
{"mode":"branch","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user","assistant","user"]}
{"mode":"branch","path":"/v1/chat/completions","model":"a","status":200,"message_roles":["system","user","assistant","user"]}
{"mode":"branch","path":"/v1/chat/completions","model":"a","status":200,"message_roles":["system","user","assistant","user","assistant","user"]}
```

### direct3: route and HTTP

```jsonl
{"ts":"2026-10-28 10:55:08.440 Europe/Zurich","mode":"direct3","reason":"user","stateIn":null,"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:55:08.446 Europe/Zurich","mode":"direct3","method":"complete","directResponse":{"provider":"probe-group","model":"g","stopReason":"error","errorMessage":"Virtual model probe-group/g must be routed before streaming"}}
{"ts":"2026-10-28 10:55:08.446 Europe/Zurich","mode":"direct3","reason":"direct","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["user"]}
{"ts":"2026-10-28 10:55:08.488 Europe/Zurich","mode":"direct3","method":"streamSimple","directResponse":{"provider":"dummy","model":"a","stopReason":"stop","errorMessage":null}}
{"ts":"2026-10-28 10:55:08.489 Europe/Zurich","mode":"direct3","reason":"user","stateIn":{"target":1},"stateOut":{"target":1},"sameObject":true,"target":"dummy/b","previous":"dummy/b","failed":null,"messageRoles":["system","user","assistant","user"]}
{"mode":"direct3","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
{"mode":"direct3","path":"/v1/chat/completions","model":"a","status":200,"message_roles":["user"]}
{"mode":"direct3","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user","assistant","user"]}
```

### direct4: route and HTTP

```jsonl
{"ts":"2026-10-28 10:58:48.030 Europe/Zurich","mode":"direct4","reason":"user","stateIn":null,"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":null,"messageRoles":["system","user"],"branchState":null,"messageErrors":[]}
{"ts":"2026-10-28 10:58:48.035 Europe/Zurich","mode":"direct4","method":"complete","directResponse":{"provider":"probe-group","model":"g","stopReason":"error","errorMessage":"Virtual model probe-group/g must be routed before streaming"}}
{"ts":"2026-10-28 10:58:48.035 Europe/Zurich","mode":"direct4","reason":"direct","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["user"],"branchState":{"target":1},"messageErrors":[]}
{"ts":"2026-10-28 10:58:48.078 Europe/Zurich","mode":"direct4","method":"streamSimple","directResponse":{"provider":"dummy","model":"a","stopReason":"stop","errorMessage":null}}
{"ts":"2026-10-28 10:58:48.079 Europe/Zurich","mode":"direct4","reason":"user","stateIn":{"target":1},"stateOut":{"target":1},"sameObject":true,"target":"dummy/b","previous":"dummy/b","failed":null,"messageRoles":["system","user","assistant","user"],"branchState":{"target":1},"messageErrors":[]}
{"mode":"direct4","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
{"mode":"direct4","path":"/v1/chat/completions","model":"a","status":200,"message_roles":["user"]}
{"mode":"direct4","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user","assistant","user"]}
```

### 401: route and HTTP

```jsonl
{"ts":"2026-10-28 10:53:11.140 Europe/Zurich","mode":"401","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"mode":"401","path":"/v1/chat/completions","model":"a","status":401,"message_roles":["system","user"]}
```

### 401-next: route and HTTP

```jsonl
{"ts":"2026-10-28 10:57:15.386 Europe/Zurich","mode":"401-next","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"],"messageErrors":[]}
{"ts":"2026-10-28 10:57:15.424 Europe/Zurich","mode":"401-next","reason":"user","stateIn":{"target":0},"stateOut":{"target":0},"sameObject":true,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user","assistant","user"],"messageErrors":[{"model":"a","errorMessage":"401: {\"message\":\"Invalid API key\",\"type\":\"invalid_request_error\",\"code\":\"invalid_api_key\"}"}]}
{"mode":"401-next","path":"/v1/chat/completions","model":"a","status":401,"message_roles":["system","user"]}
{"mode":"401-next","path":"/v1/chat/completions","model":"a","status":401,"message_roles":["system","user","user"]}
```

### 429: route and HTTP

```jsonl
{"ts":"2026-10-28 10:52:36.436 Europe/Zurich","mode":"429","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:52:36.461 Europe/Zurich","mode":"429","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":{"model":"dummy/a","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}","content":[]},"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:11.716 Europe/Zurich","mode":"429","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:11.741 Europe/Zurich","mode":"429","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":{"model":"dummy/a","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}","content":[]},"messageRoles":["system","user"]}
{"mode":"429","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user"]}
{"mode":"429","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
{"mode":"429","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user"]}
{"mode":"429","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
```

### quota: route and HTTP

```jsonl
{"ts":"2026-10-28 10:53:12.295 Europe/Zurich","mode":"quota","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"mode":"quota","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user"]}
```

### free-limit: route and HTTP

```jsonl
{"ts":"2026-10-28 10:53:12.880 Europe/Zurich","mode":"free-limit","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"mode":"free-limit","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user"]}
```

### retry-off: route and HTTP

```jsonl
{"ts":"2026-10-28 10:55:09.025 Europe/Zurich","mode":"retry-off","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"mode":"retry-off","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user"]}
```

### 500: route and HTTP

```jsonl
{"ts":"2026-10-28 10:53:13.459 Europe/Zurich","mode":"500","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:13.483 Europe/Zurich","mode":"500","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":{"model":"dummy/a","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"500: {\"message\":\"Internal server error\",\"type\":\"server_error\",\"code\":\"server_error\"}","content":[]},"messageRoles":["system","user"]}
{"mode":"500","path":"/v1/chat/completions","model":"a","status":500,"message_roles":["system","user"]}
{"mode":"500","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
```

### 501: route and HTTP

```jsonl
{"ts":"2026-10-28 10:53:14.037 Europe/Zurich","mode":"501","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:14.062 Europe/Zurich","mode":"501","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":{"model":"dummy/a","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"501: {\"message\":\"Unimplemented\",\"type\":\"server_error\",\"code\":\"server_error\"}","content":[]},"messageRoles":["system","user"]}
{"mode":"501","path":"/v1/chat/completions","model":"a","status":501,"message_roles":["system","user"]}
{"mode":"501","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
```

### 501-plain: route and HTTP

```jsonl
{"ts":"2026-10-28 10:55:46.713 Europe/Zurich","mode":"501-plain","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"mode":"501-plain","path":"/v1/chat/completions","model":"a","status":501,"message_roles":["system","user"]}
```

### 503: route and HTTP

```jsonl
{"ts":"2026-10-28 10:53:14.616 Europe/Zurich","mode":"503","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:14.640 Europe/Zurich","mode":"503","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":{"model":"dummy/a","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"503: {\"message\":\"Service unavailable\",\"type\":\"server_error\",\"code\":\"server_error\"}","content":[]},"messageRoles":["system","user"]}
{"mode":"503","path":"/v1/chat/completions","model":"a","status":503,"message_roles":["system","user"]}
{"mode":"503","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
```

### midstream: route and HTTP

```jsonl
{"ts":"2026-10-28 10:53:15.193 Europe/Zurich","mode":"midstream","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:53:15.219 Europe/Zurich","mode":"midstream","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":{"model":"dummy/a","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","responseId","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()","content":[{"type":"text","text":"PARTIAL"}]},"messageRoles":["system","user"]}
{"mode":"midstream","path":"/v1/chat/completions","model":"a","status":200,"message_roles":["system","user"]}
{"mode":"midstream","model":"a","action":"partial-chunk-then-socket-reset"}
{"mode":"midstream","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
```

### retry-prev: route and HTTP

```jsonl
{"ts":"2026-10-28 10:57:14.805 Europe/Zurich","mode":"retry-prev","reason":"user","stateIn":null,"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":null,"messageRoles":["system","user"],"messageErrors":[]}
{"ts":"2026-10-28 10:57:14.810 Europe/Zurich","mode":"retry-prev","reason":"user","stateIn":{"target":1},"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":"dummy/b","failed":null,"messageRoles":["system","user","assistant","user"],"messageErrors":[]}
{"ts":"2026-10-28 10:57:14.873 Europe/Zurich","mode":"retry-prev","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":"dummy/b","failed":{"model":"dummy/a","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}","content":[]},"messageRoles":["system","user","assistant","user"],"messageErrors":[]}
{"mode":"retry-prev","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
{"mode":"retry-prev","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user","assistant","user"]}
{"mode":"retry-prev","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user","assistant","user"]}
```

### quota-recover: route and HTTP

```jsonl
{"ts":"2026-10-28 10:55:10.233 Europe/Zurich","mode":"quota-recover","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:55:10.237 Europe/Zurich","mode":"quota-recover","boundary":"agent_before_settle","failedEntryId":"833f41f4","errorMessage":"429: {\"message\":\"Quota exceeded\",\"type\":\"insufficient_quota\",\"code\":\"insufficient_quota\"}"}
{"ts":"2026-10-28 10:55:10.238 Europe/Zurich","mode":"quota-recover","reason":"user","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":null,"messageRoles":["system","user"]}
{"ts":"2026-10-28 10:55:10.282 Europe/Zurich","mode":"quota-recover","reason":"user","stateIn":{"target":1},"stateOut":{"target":1},"sameObject":true,"target":"dummy/b","previous":"dummy/b","failed":null,"messageRoles":["system","user","assistant","user"]}
{"mode":"quota-recover","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user"]}
{"mode":"quota-recover","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
{"mode":"quota-recover","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user","assistant","user"]}
```

### event-429: route and HTTP

```jsonl
{"ts":"2026-10-28 10:58:48.607 Europe/Zurich","mode":"event-429","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"],"branchState":null,"messageErrors":[]}
{"ts":"2026-10-28 10:58:48.631 Europe/Zurich","mode":"event-429","reason":"retry","stateIn":{"target":0},"stateOut":{"target":1},"sameObject":false,"target":"dummy/b","previous":null,"failed":{"model":"dummy/a","thinkingLevel":"off","messageKeys":["role","content","api","provider","model","usage","stopReason","timestamp","errorMessage","durationMs","thinkingLevel"],"stopReason":"error","errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}","content":[]},"messageRoles":["system","user"],"branchState":{"target":0},"messageErrors":[]}
{"ts":"2026-10-28 10:58:48.633 Europe/Zurich","mode":"event-429","hook":"after_provider_response","status":200,"sessionModel":"probe-group/g"}
{"mode":"event-429","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user"]}
{"mode":"event-429","path":"/v1/chat/completions","model":"b","status":200,"message_roles":["system","user"]}
```

### event-quota: route and HTTP

```jsonl
{"ts":"2026-10-28 10:58:49.183 Europe/Zurich","mode":"event-quota","reason":"user","stateIn":null,"stateOut":{"target":0},"sameObject":false,"target":"dummy/a","previous":null,"failed":null,"messageRoles":["system","user"],"branchState":null,"messageErrors":[]}
{"mode":"event-quota","path":"/v1/chat/completions","model":"a","status":429,"message_roles":["system","user"]}
```

## Selected raw RPC records

### live.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Use the bash tool to run the command printf probe-ok, then say only the result.","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"c72a68a8","parentId":"acaaddcc","timestamp":"2026-10-28T09:52:59.233Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"opencode","model":"big-pickle","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181179234,"responseId":"mai-api-ca3d81ca-93be-4e88-94f1-ace700385f7e","errorMessage":"Stream ended without finish_reason","durationMs":1234,"thinkingLevel":"off"}}
{"type":"auto_retry_start","attempt":1,"maxAttempts":1,"delayMs":20,"errorMessage":"Stream ended without finish_reason"}
{"type":"entry_appended","entry":{"type":"context_edit","id":"aab203d3","parentId":"c928d198","timestamp":"2026-10-28T09:53:00.469Z","targetId":"c928d198","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"fd02bd0e","parentId":"aab203d3","timestamp":"2026-10-28T09:53:00.489Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"toolCall","id":"15ffac0d-52af-4123-b85d-2b7656b47ab1","name":"bash","arguments":{"command":"printf probe-ok","timeout":10}}],"api":"openai-completions","provider":"opencode","model":"glm-5.3-flash-free","usage":{"input":2028,"output":19,"cacheRead":0,"cacheWrite":0,"reasoning":0,"totalTokens":2047,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0,"totalFromProvider":false}},"stopReason":"toolUse","timestamp":1793181180490,"responseId":"chatcmpl-1VcEyEWIQYerPzl6RP6GecIbOhvFH","rawStopReason":"tool_calls","durationMs":577,"thinkingLevel":"low"}}
{"type":"auto_retry_end","success":true,"attempt":1}
{"type":"tool_execution_start","toolCallId":"15ffac0d-52af-4123-b85d-2b7656b47ab1","toolName":"bash","args":{"command":"printf probe-ok","timeout":10}}
{"type":"tool_execution_end","toolCallId":"15ffac0d-52af-4123-b85d-2b7656b47ab1","toolName":"bash","result":{"content":[{"type":"text","text":"probe-ok"}],"structuredContent":{"output":"probe-ok","truncated":false,"exit_code":0,"wall_time_seconds":0}},"isError":false,"durationMs":2}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"probe-ok"}],"api":"openai-completions","provider":"opencode","model":"glm-5.3-flash-free","usage":{"input":261,"output":4,"cacheRead":1792,"cacheWrite":0,"reasoning":0,"totalTokens":2057,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0,"totalFromProvider":false}},"stopReason":"stop","timestamp":1793181181070,"responseId":"chatcmpl-qCs5RD6ZizVv04rmhJWigJyBC2CIB","rawStopReason":"stop","durationMs":782,"thinkingLevel":"low"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"prompt","message":"Reply with exactly next-turn-ok.","id":"2"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"next-turn-ok"}],"api":"openai-completions","provider":"opencode","model":"glm-5.3-flash-free","usage":{"input":146,"output":5,"cacheRead":1920,"cacheWrite":0,"reasoning":0,"totalTokens":2071,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0,"totalFromProvider":false}},"stopReason":"stop","timestamp":1793181181854,"responseId":"chatcmpl-hKX0vVFdplqNcNHCFEMxpzIUGKnHA","rawStopReason":"stop","durationMs":492,"thinkingLevel":"low"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"get_state","id":"3"}
{"id":"3","type":"response","command":"get_state","success":true,"data":{"model":{"id":"g","name":"Group probe","api":"pi-virtual","provider":"probe-group","baseUrl":"","reasoning":false,"thinkingLevelMap":{"off":"off","minimal":null,"low":null,"medium":null,"high":null,"xhigh":null,"max":null},"input":["text","image"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":100000,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionFile":"/tmp/pi-virtual-routing.HmHLKYme/sessions-live/2026-10-28T09-52-59-165Z_01a181ed-5d1d-70db-95f1-3429a27f61b4.jsonl","sessionId":"01a181ed-5d1d-70db-95f1-3429a27f61b4","autoCompactionEnabled":true,"messageCount":7,"pendingMessageCount":0}}
```

### live.resumed RPC

```jsonl
INPUT {"type":"get_state","id":"1"}
{"id":"1","type":"response","command":"get_state","success":true,"data":{"model":{"id":"g","name":"Group probe","api":"pi-virtual","provider":"probe-group","baseUrl":"","reasoning":false,"thinkingLevelMap":{"off":"off","minimal":null,"low":null,"medium":null,"high":null,"xhigh":null,"max":null},"input":["text","image"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":100000,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionFile":"/tmp/pi-virtual-routing.HmHLKYme/sessions-live/2026-10-28T09-52-59-165Z_01a181ed-5d1d-70db-95f1-3429a27f61b4.jsonl","sessionId":"01a181ed-5d1d-70db-95f1-3429a27f61b4","autoCompactionEnabled":true,"messageCount":7,"pendingMessageCount":0}}
INPUT {"type":"prompt","message":"Reply with exactly resumed-ok.","id":"2"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"resumed-ok"}],"api":"openai-completions","provider":"opencode","model":"glm-5.3-flash-free","usage":{"input":2083,"output":5,"cacheRead":0,"cacheWrite":0,"reasoning":0,"totalTokens":2088,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0,"totalFromProvider":false}},"stopReason":"stop","timestamp":1793181182438,"responseId":"chatcmpl-8b702179e7e8be103d4eb74f8a73e797","rawStopReason":"stop","durationMs":4174,"thinkingLevel":"low"}}
{"type":"agent_settled","aborted":false}
```

### branch.initial RPC

```jsonl
INPUT {"type":"prompt","message":"First","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"e4f7814a","parentId":"362c0126","timestamp":"2026-10-28T09:53:09.985Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"A OK"}],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181189986,"responseId":"probe","rawStopReason":"stop","durationMs":3,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"prompt","message":"SWITCH-B","id":"2"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"197ceda6","parentId":"c25d90dd","timestamp":"2026-10-28T09:53:09.991Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181189991,"responseId":"probe","rawStopReason":"stop","durationMs":42,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"get_fork_messages","id":"3"}
{"id":"3","type":"response","command":"get_fork_messages","success":true,"data":{"messages":[{"entryId":"362c0126","text":"First"},{"entryId":"c25d90dd","text":"SWITCH-B"}]}}
INPUT {"type":"fork","entryId":"c25d90dd","id":"4"}
{"id":"4","type":"response","command":"fork","success":true,"data":{"text":"SWITCH-B","cancelled":false}}
INPUT {"type":"prompt","message":"Branch from first state","id":"5"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"A OK"}],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181190039,"responseId":"probe","rawStopReason":"stop","durationMs":43,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"clone","id":"6"}
{"id":"6","type":"response","command":"clone","success":true,"data":{"cancelled":false}}
INPUT {"type":"prompt","message":"Clone from branch","id":"7"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"A OK"}],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181190088,"responseId":"probe","rawStopReason":"stop","durationMs":42,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### direct3.initial RPC

```jsonl
INPUT {"type":"prompt","message":"SWITCH-B","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"b5cca28c","parentId":"fe16ab51","timestamp":"2026-10-28T09:55:08.440Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181308442,"responseId":"probe","rawStopReason":"stop","durationMs":3,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"prompt","message":"/probe-direct","id":"2"}
INPUT {"type":"prompt","message":"After direct","id":"3"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181308489,"responseId":"probe","rawStopReason":"stop","durationMs":42,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### direct4.initial RPC

```jsonl
INPUT {"type":"prompt","message":"SWITCH-B","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"147594b1","parentId":"3eee583b","timestamp":"2026-10-28T09:58:48.030Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181528032,"responseId":"probe","rawStopReason":"stop","durationMs":2,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"prompt","message":"/probe-direct","id":"2"}
INPUT {"type":"prompt","message":"After direct","id":"3"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181528079,"responseId":"probe","rawStopReason":"stop","durationMs":42,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### 401.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"8a6be491","parentId":"6cbfdf88","timestamp":"2026-10-28T09:53:11.140Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181191141,"errorMessage":"401: {\"message\":\"Invalid API key\",\"type\":\"invalid_request_error\",\"code\":\"invalid_api_key\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### 401-next.initial RPC

```jsonl
INPUT {"type":"prompt","message":"First","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"a32b84a3","parentId":"ca545a0c","timestamp":"2026-10-28T09:57:15.386Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181435387,"errorMessage":"401: {\"message\":\"Invalid API key\",\"type\":\"invalid_request_error\",\"code\":\"invalid_api_key\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"get_state","id":"2"}
{"id":"2","type":"response","command":"get_state","success":true,"data":{"model":{"id":"g","name":"Group probe","api":"pi-virtual","provider":"probe-group","baseUrl":"","reasoning":false,"thinkingLevelMap":{"off":"off","minimal":null,"low":null,"medium":null,"high":null,"xhigh":null,"max":null},"input":["text","image"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":100000,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionFile":"/tmp/pi-virtual-routing.HmHLKYme/sessions-401-next/2026-10-28T09-57-15-365Z_01a181f1-45e5-7210-86cd-910de3c3ff65.jsonl","sessionId":"01a181f1-45e5-7210-86cd-910de3c3ff65","autoCompactionEnabled":true,"messageCount":3,"pendingMessageCount":0}}
```

### 401-next.resumed RPC

```jsonl
INPUT {"type":"prompt","message":"After error","id":"1"}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181435425,"errorMessage":"401: {\"message\":\"Invalid API key\",\"type\":\"invalid_request_error\",\"code\":\"invalid_api_key\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### 429.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"a4dc6feb","parentId":"6e8ab89d","timestamp":"2026-10-28T09:53:11.716Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181191718,"errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}","durationMs":3,"thinkingLevel":"off"}}
{"type":"auto_retry_start","attempt":1,"maxAttempts":1,"delayMs":20,"errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}"}
{"type":"entry_appended","entry":{"type":"context_edit","id":"f7fc120f","parentId":"a3408d8a","timestamp":"2026-10-28T09:53:11.721Z","targetId":"a3408d8a","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"94a298e4","parentId":"f7fc120f","timestamp":"2026-10-28T09:53:11.741Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181191742,"responseId":"probe","rawStopReason":"stop","durationMs":43,"thinkingLevel":"off"}}
{"type":"auto_retry_end","success":true,"attempt":1}
{"type":"agent_settled","aborted":false}
```

### quota.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"9cc3f77d","parentId":"8bcc1096","timestamp":"2026-10-28T09:53:12.295Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181192297,"errorMessage":"429: {\"message\":\"Quota exceeded\",\"type\":\"insufficient_quota\",\"code\":\"insufficient_quota\"}","durationMs":3,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### free-limit.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"d691a042","parentId":"b4f2c1b4","timestamp":"2026-10-28T09:53:12.880Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181192881,"errorMessage":"429: {\"message\":\"FreeUsageLimitError\",\"type\":\"FreeUsageLimitError\",\"code\":\"FreeUsageLimitError\"}","durationMs":3,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### retry-off.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"56d35966","parentId":"d21ff76b","timestamp":"2026-10-28T09:55:09.026Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181309027,"errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### 500.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"a98f586a","parentId":"aef5c141","timestamp":"2026-10-28T09:53:13.459Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181193460,"errorMessage":"500: {\"message\":\"Internal server error\",\"type\":\"server_error\",\"code\":\"server_error\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"auto_retry_start","attempt":1,"maxAttempts":1,"delayMs":20,"errorMessage":"500: {\"message\":\"Internal server error\",\"type\":\"server_error\",\"code\":\"server_error\"}"}
{"type":"entry_appended","entry":{"type":"context_edit","id":"5742d8c2","parentId":"08df1876","timestamp":"2026-10-28T09:53:13.463Z","targetId":"08df1876","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"9e47f118","parentId":"5742d8c2","timestamp":"2026-10-28T09:53:13.484Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181193484,"responseId":"probe","rawStopReason":"stop","durationMs":43,"thinkingLevel":"off"}}
{"type":"auto_retry_end","success":true,"attempt":1}
{"type":"agent_settled","aborted":false}
```

### 501.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"5688dedf","parentId":"4790968a","timestamp":"2026-10-28T09:53:14.037Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181194039,"errorMessage":"501: {\"message\":\"Unimplemented\",\"type\":\"server_error\",\"code\":\"server_error\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"auto_retry_start","attempt":1,"maxAttempts":1,"delayMs":20,"errorMessage":"501: {\"message\":\"Unimplemented\",\"type\":\"server_error\",\"code\":\"server_error\"}"}
{"type":"entry_appended","entry":{"type":"context_edit","id":"a22914db","parentId":"024599a9","timestamp":"2026-10-28T09:53:14.042Z","targetId":"024599a9","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"e73ecbf9","parentId":"a22914db","timestamp":"2026-10-28T09:53:14.062Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181194063,"responseId":"probe","rawStopReason":"stop","durationMs":42,"thinkingLevel":"off"}}
{"type":"auto_retry_end","success":true,"attempt":1}
{"type":"agent_settled","aborted":false}
```

### 501-plain.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"4a88c239","parentId":"2b7bb64d","timestamp":"2026-10-28T09:55:46.713Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181346715,"errorMessage":"501: {\"message\":\"Unimplemented\",\"type\":\"invalid_request_error\",\"code\":\"not_implemented\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### 503.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"21fb79d7","parentId":"bd768f2f","timestamp":"2026-10-28T09:53:14.616Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181194617,"errorMessage":"503: {\"message\":\"Service unavailable\",\"type\":\"server_error\",\"code\":\"server_error\"}","durationMs":3,"thinkingLevel":"off"}}
{"type":"auto_retry_start","attempt":1,"maxAttempts":1,"delayMs":20,"errorMessage":"503: {\"message\":\"Service unavailable\",\"type\":\"server_error\",\"code\":\"server_error\"}"}
{"type":"entry_appended","entry":{"type":"context_edit","id":"724d9acf","parentId":"21efc569","timestamp":"2026-10-28T09:53:14.620Z","targetId":"21efc569","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"e69af4c7","parentId":"724d9acf","timestamp":"2026-10-28T09:53:14.640Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181194641,"responseId":"probe","rawStopReason":"stop","durationMs":42,"thinkingLevel":"off"}}
{"type":"auto_retry_end","success":true,"attempt":1}
{"type":"agent_settled","aborted":false}
```

### midstream.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"a153133b","parentId":"f31c87e3","timestamp":"2026-10-28T09:53:15.193Z"}}
{"type":"message_update","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"PARTIAL"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"PARTIAL"}],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181195195,"responseId":"probe","errorMessage":"ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()","durationMs":3,"thinkingLevel":"off"}}
{"type":"auto_retry_start","attempt":1,"maxAttempts":1,"delayMs":20,"errorMessage":"ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"}
{"type":"entry_appended","entry":{"type":"context_edit","id":"335f3fd9","parentId":"6ead7e0e","timestamp":"2026-10-28T09:53:15.198Z","targetId":"6ead7e0e","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"a200f4fb","parentId":"335f3fd9","timestamp":"2026-10-28T09:53:15.219Z"}}
{"type":"message_update","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"B OK"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181195219,"responseId":"probe","rawStopReason":"stop","durationMs":2,"thinkingLevel":"off"}}
{"type":"auto_retry_end","success":true,"attempt":1}
{"type":"agent_settled","aborted":false}
```

### retry-prev.initial RPC

```jsonl
INPUT {"type":"prompt","message":"SWITCH-B","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"4badcb2c","parentId":"32fa46d5","timestamp":"2026-10-28T09:57:14.805Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181434807,"responseId":"probe","rawStopReason":"stop","durationMs":2,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"prompt","message":"SWITCH-A","id":"2"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"6b6d3f45","parentId":"6285435f","timestamp":"2026-10-28T09:57:14.810Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181434810,"errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}","durationMs":42,"thinkingLevel":"off"}}
{"type":"auto_retry_start","attempt":1,"maxAttempts":1,"delayMs":20,"errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}"}
{"type":"entry_appended","entry":{"type":"context_edit","id":"f3c8df73","parentId":"1c65072e","timestamp":"2026-10-28T09:57:14.853Z","targetId":"1c65072e","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"b985085f","parentId":"f3c8df73","timestamp":"2026-10-28T09:57:14.874Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181434874,"responseId":"probe","rawStopReason":"stop","durationMs":42,"thinkingLevel":"off"}}
{"type":"auto_retry_end","success":true,"attempt":1}
{"type":"agent_settled","aborted":false}
```

### quota-recover.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"ce8e391b","parentId":"4175a067","timestamp":"2026-10-28T09:55:10.233Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181310234,"errorMessage":"429: {\"message\":\"Quota exceeded\",\"type\":\"insufficient_quota\",\"code\":\"insufficient_quota\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"entry_appended","entry":{"type":"context_edit","id":"10974d33","parentId":"833f41f4","timestamp":"2026-10-28T09:55:10.238Z","targetId":"833f41f4","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"probe.failover","data":{"failedEntryId":"833f41f4","target":1},"id":"cf47e8bf","parentId":"10974d33","timestamp":"2026-10-28T09:55:10.238Z"}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"06e6a53a","parentId":"cf47e8bf","timestamp":"2026-10-28T09:55:10.238Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181310238,"responseId":"probe","rawStopReason":"stop","durationMs":43,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
INPUT {"type":"prompt","message":"After recover","id":"2"}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181310283,"responseId":"probe","rawStopReason":"stop","durationMs":43,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

### event-429.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"18949733","parentId":"8e2b2d67","timestamp":"2026-10-28T09:58:48.607Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181528608,"errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"auto_retry_start","attempt":1,"maxAttempts":1,"delayMs":20,"errorMessage":"429: {\"message\":\"Rate limit exceeded\",\"type\":\"rate_limit_error\",\"code\":\"rate_limit_exceeded\"}"}
{"type":"entry_appended","entry":{"type":"context_edit","id":"baa2aa2c","parentId":"c392193d","timestamp":"2026-10-28T09:58:48.611Z","targetId":"c392193d","replacement":null}}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":1}},"id":"52740dce","parentId":"baa2aa2c","timestamp":"2026-10-28T09:58:48.631Z"}}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"B OK"}],"api":"openai-completions","provider":"dummy","model":"b","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1793181528632,"responseId":"probe","rawStopReason":"stop","durationMs":42,"thinkingLevel":"off"}}
{"type":"auto_retry_end","success":true,"attempt":1}
{"type":"agent_settled","aborted":false}
```

### event-quota.initial RPC

```jsonl
INPUT {"type":"prompt","message":"Simple probe","id":"1"}
{"type":"entry_appended","entry":{"type":"custom","customType":"pi.virtual-model-state","data":{"provider":"probe-group","modelId":"g","state":{"target":0}},"id":"49ce1e16","parentId":"3d201c8c","timestamp":"2026-10-28T09:58:49.183Z"}}
{"type":"message_end","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"dummy","model":"a","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"error","timestamp":1793181529184,"errorMessage":"429: {\"message\":\"Quota exceeded\",\"type\":\"insufficient_quota\",\"code\":\"insufficient_quota\"}","durationMs":2,"thinkingLevel":"off"}}
{"type":"agent_settled","aborted":false}
```

## Reproduction fixtures

### probe.ts

```typescript
import { appendFileSync } from "node:fs";
import { applyCliEnv, envBlock } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/families/opencode/identity.ts";

const mode = process.env.PROBE_MODE;
const log = (x) => appendFileSync(process.env.PROBE_LOG, JSON.stringify(x) + "\n");
const clock = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Zurich" }) + "." + String(new Date().getMilliseconds()).padStart(3, "0") + " Europe/Zurich";

export default function (pi) {
  if (mode !== "live") {
    pi.registerProvider("dummy", {
      baseUrl: "http://127.0.0.1:" + process.env.PROBE_PORT + "/v1",
      apiKey: "probe-non-secret",
      api: "openai-completions",
      models: ["a", "b"].map((id) => ({
        id, name: id, reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000, maxTokens: 1024,
      })),
    });
  } else {
    // The package's current payload hook sees the virtual selection, so supply the same
    // OpenCode environment block for the two explicitly named physical targets.
    pi.on("before_provider_request", (event, ctx) => {
      if (ctx.model?.provider === "probe-group" && ["big-pickle", "glm-5.3-flash-free"].includes(event.payload?.model)) {
        if (applyCliEnv(event.payload, envBlock(ctx.cwd, process.platform))) return event.payload;
      }
    });
  }
  const ids = mode === "live"
    ? [["opencode", "big-pickle"], ["opencode", "glm-5.3-flash-free"]]
    : [["dummy", "a"], ["dummy", "b"]];
  if (mode.startsWith("event-")) {
    pi.on("after_provider_response", (event, ctx) => log({ ts: clock(), mode, hook: "after_provider_response", status: event.status, sessionModel: ctx.model?.provider + "/" + ctx.model?.id }));
  }
  if (mode === "quota-recover") {
    pi.on("agent_before_settle", (event) => {
      const last = event.context.contextEntries.findLast((entry) => entry.messages.some((m) => m.role === "assistant"));
      const message = last?.messages.find((m) => m.role === "assistant");
      if (event.outcome !== "error" || message?.model !== "a" || !message.errorMessage?.includes("insufficient_quota")) return;
      log({ ts: clock(), mode, boundary: "agent_before_settle", failedEntryId: last.sourceEntry.id, errorMessage: message.errorMessage });
      return { entries: [
        { type: "context_edit", targetId: last.sourceEntry.id, replacement: null },
        { type: "custom", customType: "probe.failover", data: { failedEntryId: last.sourceEntry.id, target: 1 } },
      ], continue: true };
    });
  }
  pi.registerVirtualModel({
    provider: "probe-group", id: "g", name: "Group probe",
    thinkingLevels: ["off"], contextWindow: 100000, maxTokens: 1024,
    route(request, ctx) {
      const before = request.state ?? null;
      let target = request.state?.target ?? 0;
      const latestUser = request.messages.filter((m) => m.role === "user").at(-1);
      if (["branch", "direct3", "direct4", "retry-prev"].includes(mode) && request.reason === "user" && JSON.stringify(latestUser?.content).includes("SWITCH-B")) target = 1;
      if (mode === "retry-prev" && request.reason === "user" && JSON.stringify(latestUser?.content).includes("SWITCH-A")) target = 0;
      if (mode === "quota-recover" && ctx.sessionManager.getBranch().some((e) => e.type === "custom" && e.customType === "probe.failover")) target = 1;
      if (request.reason === "retry" && request.failed && request.failed.model.id === ids[0][1]) target = 1;
      const next = !request.state || request.state.target !== target ? { target } : request.state;
      const model = ctx.modelRegistry.find(...ids[target]);
      if (!model) throw new Error("Probe target missing: " + ids[target].join("/"));
      const failed = request.failed && {
        model: request.failed.model.provider + "/" + request.failed.model.id,
        thinkingLevel: request.failed.thinkingLevel ?? null,
        messageKeys: Object.keys(request.failed.message),
        stopReason: request.failed.message.stopReason,
        errorMessage: request.failed.message.errorMessage ?? null,
        content: request.failed.message.content,
      };
      log({
        ts: clock(), mode, reason: request.reason, stateIn: before, stateOut: next,
        sameObject: request.state === next, target: ids[target].join("/"),
        previous: request.previous ? request.previous.model.provider + "/" + request.previous.model.id : null,
        failed: failed ?? null, messageRoles: request.messages.map(m => m.role),
        branchState: ctx.sessionManager.getBranch().findLast(e => e.type === "custom" && e.customType === "pi.virtual-model-state" && e.data?.provider === "probe-group" && e.data?.modelId === "g")?.data?.state ?? null,
        messageErrors: request.messages.filter(m => m.role === "assistant" && m.stopReason === "error").map(m => ({ model: m.model, errorMessage: m.errorMessage })),
      });
      return { model, thinkingLevel: "off", state: next };
    },
  });
  pi.registerCommand("probe-direct", {
    description: "Probe a direct call",
    handler: async (_args, ctx) => {
      const model = ctx.modelRegistry.find("probe-group", "g");
      const context = { messages: [{ role: "user", content: [{ type: "text", text: "Direct probe" }], timestamp: Date.now() }] };
      const complete = await ctx.modelRegistry.complete(model, context);
      log({ ts: clock(), mode, method: "complete", directResponse: { provider: complete.provider, model: complete.model, stopReason: complete.stopReason, errorMessage: complete.errorMessage ?? null } });
      const simple = await ctx.modelRegistry.streamSimple(model, context).result();
      log({ ts: clock(), mode, method: "streamSimple", directResponse: { provider: simple.provider, model: simple.model, stopReason: simple.stopReason, errorMessage: simple.errorMessage ?? null } });
    },
  });
}
```

### run.py

```python
import json, os, sys, subprocess, time, selectors, socket, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MODE = sys.argv[1]
PROBE = os.path.join(ROOT, "probe.ts")
LOG = os.path.join(ROOT, MODE + ".routes.jsonl")
HTTP_LOG = os.path.join(ROOT, MODE + ".http.jsonl")
settings = {"retry":{"enabled": MODE != "retry-off","maxRetries":1,"baseDelayMs":20,"provider":{"maxRetries":0}}}
os.makedirs(ROOT + "/agent", exist_ok=True)
with open(ROOT + "/agent/settings.json", "w") as f: json.dump(settings, f)

def log_http(row):
    with open(HTTP_LOG, "a") as f: f.write(json.dumps(row, separators=(",",":")) + "\n")

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *args): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        model = body["model"]
        status = {"401":401, "401-repeat":401, "401-next":401, "429":429, "event-429":429, "retry-prev":429, "retry-off":429, "quota":429, "event-quota":429, "quota-recover":429, "free-limit":429, "500":500, "501":501, "501-plain":501, "503":503}.get(MODE, 200) if model == "a" else 200
        log_http({"mode": MODE, "path": self.path, "model": model, "status": status, "message_roles":[m.get("role") for m in body["messages"]]})
        if status != 200:
            msg, typ, code = {
                401: ("Invalid API key", "invalid_request_error", "invalid_api_key"),
                429: ("Rate limit exceeded", "rate_limit_error", "rate_limit_exceeded"),
                500: ("Internal server error", "server_error", "server_error"),
                501: ("Unimplemented", "server_error", "server_error"),
                503: ("Service unavailable", "server_error", "server_error"),
            }[status]
            if MODE in ("quota", "event-quota", "quota-recover"): msg, typ, code = ("Quota exceeded", "insufficient_quota", "insufficient_quota")
            if MODE == "free-limit": msg, typ, code = ("FreeUsageLimitError", "FreeUsageLimitError", "FreeUsageLimitError")
            if MODE == "501-plain": msg, typ, code = ("Unimplemented", "invalid_request_error", "not_implemented")
            raw = json.dumps({"error":{"message":msg, "type":typ, "code":code}}).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        def chunk(content):
            b = content.encode()
            self.wfile.write(("%x\r\n" % len(b)).encode() + b + b"\r\n")
            self.wfile.flush()
        def event(delta, finish=None):
            payload = {"id":"probe","object":"chat.completion.chunk","created":1,"model":model,"choices":[{"index":0,"delta":delta,"finish_reason":finish}]}
            return "data: " + json.dumps(payload, separators=(",",":")) + "\n\n"
        chunk(event({"role":"assistant","content":"PARTIAL" if MODE == "midstream" and model == "a" else model.upper() + " OK"}))
        if MODE == "midstream" and model == "a":
            log_http({"mode": MODE, "model": model, "action":"partial-chunk-then-socket-reset"})
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        chunk(event({}, "stop"))
        chunk("data: [DONE]\n\n")
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = True
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

env = {"PATH":os.environ["PATH"], "HOME":ROOT, "PI_CODING_AGENT_DIR":ROOT+"/agent",
       "XDG_CONFIG_HOME":ROOT+"/config", "XDG_CACHE_HOME":ROOT+"/cache",
       "XDG_STATE_HOME":ROOT+"/state", "XDG_DATA_HOME":ROOT+"/data",
       "PI_TELEMETRY":"0", "TZ":"Europe/Zurich", "PROBE_MODE":MODE,
       "PROBE_PORT":str(server.server_port), "PROBE_LOG":LOG}
ext = ["-e",PROBE]
if MODE == "live": ext += ["-e","/mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts"]
sessions = ROOT + "/sessions-" + MODE
os.makedirs(sessions, exist_ok=True)

class Rpc:
    def __init__(self, label, session=None):
        cmd = ["pi-bolt","--mode","rpc","--no-extensions","--no-mcp","--no-skills","--no-prompt-templates","--no-context-files","--no-approve","--offline","--session-dir",sessions] + ext
        cmd += ["--session",session] if session else ["--model","probe-group/g"]
        self.p = subprocess.Popen(cmd,cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0)
        self.sel = selectors.DefaultSelector()
        self.sel.register(self.p.stdout,selectors.EVENT_READ)
        self.buf = b""
        self.log = open(ROOT + "/" + MODE + "." + label + ".rpc.jsonl","w")
        self.errname = ROOT + "/" + MODE + "." + label + ".stderr"
        self.i = 0
    def send(self, obj):
        self.i += 1
        obj["id"] = str(self.i)
        self.log.write("INPUT " + json.dumps(obj,separators=(",",":")) + "\n"); self.log.flush()
        self.p.stdin.write((json.dumps(obj)+"\n").encode()); self.p.stdin.flush()
        return obj["id"]
    def wait(self, pred, timeout=55):
        deadline = time.monotonic()+timeout
        while time.monotonic()<deadline:
            while b"\n" in self.buf:
                line, self.buf = self.buf.split(b"\n",1)
                self.log.write(line.decode("utf-8","replace")+"\n"); self.log.flush()
                try: obj=json.loads(line)
                except ValueError: continue
                if pred(obj): return obj
            if not self.sel.select(max(0,deadline-time.monotonic())): break
            data=os.read(self.p.stdout.fileno(),65536)
            if not data: raise RuntimeError("Pi stdout closed: "+str(self.p.poll()))
            self.buf += data
        raise TimeoutError("RPC timed out")
    def request(self, typ, **kwargs):
        ident=self.send({"type":typ,**kwargs})
        result=self.wait(lambda x: x.get("type")=="response" and x.get("id")==ident)
        if not result.get("success"): raise RuntimeError(str(result))
        return result
    def prompt(self, msg):
        result=self.request("prompt",message=msg)
        if result.get("data",{}).get("disposition") != "handled":
            self.wait(lambda x:x.get("type")=="agent_settled")
        return result
    def close(self):
        if self.p.stdin: self.p.stdin.close()
        try: self.p.wait(timeout=5)
        except subprocess.TimeoutExpired: self.p.kill(); self.p.wait(timeout=5)
        with open(self.errname,"wb") as f: f.write(self.p.stderr.read())
        self.log.close()

rpc = None
try:
    rpc = Rpc("initial")
    if MODE == "live":
        rpc.prompt("Use the bash tool to run the command printf probe-ok, then say only the result.")
        rpc.prompt("Reply with exactly next-turn-ok.")
        state = rpc.request("get_state")["data"]
        print("session:",state["sessionFile"])
        rpc.close()
        rpc = Rpc("resumed",session=state["sessionFile"])
        state2=rpc.request("get_state")["data"]
        print("resumed selection:",state2.get("model",{}).get("provider"),state2.get("model",{}).get("id"))
        rpc.prompt("Reply with exactly resumed-ok.")
    elif MODE == "branch":
        rpc.prompt("First")
        rpc.prompt("SWITCH-B")
        forks=rpc.request("get_fork_messages")["data"]["messages"]
        print("fork messages:",json.dumps(forks))
        print("fork response:",json.dumps(rpc.request("fork",entryId=forks[1]["entryId"])))
        rpc.prompt("Branch from first state")
        print("clone response:",json.dumps(rpc.request("clone")))
        rpc.prompt("Clone from branch")
    elif MODE.startswith("direct"):
        rpc.prompt("SWITCH-B" if MODE in ("direct3", "direct4") else "First")
        rpc.prompt("/probe-direct")
        rpc.prompt("After direct")
    elif MODE == "retry-prev":
        rpc.prompt("SWITCH-B")
        rpc.prompt("SWITCH-A")
    elif MODE in ("401-repeat", "401-next"):
        rpc.prompt("First")
        state = rpc.request("get_state")["data"]
        rpc.close()
        rpc = Rpc("resumed",session=state["sessionFile"])
        rpc.prompt("After error")
    elif MODE == "quota-recover":
        rpc.prompt("Simple probe")
        rpc.prompt("After recover")
    else:
        rpc.prompt("Simple probe")
    print("PASS",MODE)
finally:
    if rpc: rpc.close()
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
```

### verify.py

```python
import json, os
ROOT = os.path.dirname(os.path.abspath(__file__))
def rows(mode, kind="routes"):
    with open(f"{ROOT}/{mode}.{kind}.jsonl") as f:
        return [json.loads(line) for line in f]
def rpc(mode, label="initial"):
    with open(f"{ROOT}/{mode}.{label}.rpc.jsonl") as f:
        return [json.loads(line) for line in f if not line.startswith("INPUT ")]
def routes(mode):
    return [r for r in rows(mode) if "reason" in r]
def reasons(mode):
    return [r["reason"] for r in routes(mode)]
def assistant(mode, label="initial"):
    return [r["message"] for r in rpc(mode, label) if r.get("type") == "message_end" and r["message"]["role"] == "assistant"]

def check(name, test):
    assert test, name
    print("PASS", name)

r=routes("live")
check("live user, retry, tool continuation, second user, resumed user", reasons("live") == ["user","retry","continuation","user","user"])
check("live sticky selection persists across tool, turn and resume", [x["stateIn"] for x in r] == [None,{"target":0},{"target":1},{"target":1},{"target":1}])
check("live bash tool actually executed", any(x.get("type")=="tool_execution_end" and x.get("toolName")=="bash" and x.get("isError") is False for x in rpc("live")))
check("resume selected virtual model", any(x.get("command")=="get_state" and x.get("data",{}).get("model",{}).get("id")=="g" and x.get("data",{}).get("model",{}).get("provider")=="probe-group" for x in rpc("live","resumed")))
check("resume physically answered", assistant("live","resumed")[-1]["model"]=="glm-5.3-flash-free" and assistant("live","resumed")[-1]["stopReason"]=="stop")
r=routes("branch")
check("fork restores ancestor and clone inherits it", [x["stateIn"] for x in r] == [None,{"target":0},{"target":0},{"target":0}] and [x["target"] for x in r] == ["dummy/a","dummy/b","dummy/a","dummy/a"])
check("fork and clone RPC accepted", all(any(x.get("command")==command and x.get("success") and not x.get("data",{}).get("cancelled") for x in rpc("branch")) for command in ("fork","clone")))
r=routes("direct3")
check("direct routing neither reads nor overwrites branch state", [x["stateIn"] for x in r] == [None,None,{"target":1}] and [x["target"] for x in r] == ["dummy/b","dummy/a","dummy/b"] and reasons("direct3")==["user","direct","user"])
check("direct complete fails but streamSimple succeeds", [x["directResponse"]["stopReason"] for x in rows("direct3") if "directResponse" in x] == ["error","stop"])
r=routes("direct4")
check("direct callback can explicitly inspect branch state", r[1]["reason"]=="direct" and r[1]["stateIn"] is None and r[1]["branchState"]=={"target":1})
check("OpenAI error response bypasses response hook", [x["status"] for x in rows("event-429") if x.get("hook")=="after_provider_response"]==[200] and not any(x.get("hook")=="after_provider_response" for x in rows("event-quota")))
for mode in ("401","quota","free-limit","retry-off","501-plain"):
    check(f"{mode} is terminal", reasons(mode)==["user"] and assistant(mode)[-1]["stopReason"]=="error" and not any(x.get("type")=="auto_retry_start" for x in rpc(mode)))
for mode in ("429","500","501","503"):
    r=routes(mode)[-2:]
    check(f"{mode} retries A to B", [x["reason"] for x in r]==["user","retry"] and r[-1]["stateIn"]=={"target":0} and r[-1]["failed"]["model"]=="dummy/a" and r[-1]["target"]=="dummy/b" and assistant(mode)[-1]["stopReason"]=="stop")
r=routes("retry-prev")
check("retry carries distinct failed and previous model", r[-1]["previous"]=="dummy/b" and r[-1]["failed"]["model"]=="dummy/a" and r[-1]["messageErrors"]==[])
r=routes("401-next")
check("failed state survives resume and failure remains in router messages", len(r)==2 and r[1]["stateIn"]=={"target":0} and r[1]["failed"] is None and r[1]["messageErrors"][0]["errorMessage"].startswith("401"))
r=routes("midstream")
check("midstream reset retries with partial content", reasons("midstream")==["user","retry"] and r[-1]["failed"]["content"]==[{"type":"text","text":"PARTIAL"}] and assistant("midstream")[-1]["content"]==[{"type":"text","text":"B OK"}])
r=routes("quota-recover")
check("boundary recovers excluded quota and sticks to B", reasons("quota-recover")==["user","user","user"] and [x["stateIn"] for x in r]==[None,{"target":0},{"target":1}] and [x["target"] for x in r]==["dummy/a","dummy/b","dummy/b"] and len(assistant("quota-recover"))==3)
check("boundary records context edit", any(x.get("type")=="entry_appended" and x.get("entry",{}).get("type")=="context_edit" for x in rpc("quota-recover")))
print("All assertions passed")
```

## Open questions / follow-ups

- A true quota-recovery implementation must define failover policy, attempt bounds, paired tool-result handling, visible partial-response behavior, provider-aware classification, and interaction with other extensions; the proof does not settle those product decisions.
- Compaction-triggered `reason: retry`, tree navigation (as distinct from RPC fork/clone), provider-specific quota formats and terminal-error mid-stream tool execution remain untested.
- Source-level OpenCode virtual-selection mismatch should be addressed separately; this task intentionally made no source changes.
- The user-requested flat YAML frontmatter here overrides the repository's `AGENTS.md` rule requiring a nested `document:` block. No source, config, lockfile or git state was changed.
