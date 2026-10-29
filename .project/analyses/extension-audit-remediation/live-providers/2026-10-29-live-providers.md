---
version: 3
id: "extension-audit-remediation-live-providers"
title: "Live provider streaming acceptance"
description: "Isolated Pi-Bolt streaming, physical routing identity, service errors and redacted evidence"
type: "analysis"
created: "2026-10-29T19:37:36+01:00"
updated: "2026-10-29T19:56:51+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "analysis"
  id: "extension-audit-remediation-live-providers"
  title: "Live provider streaming acceptance"
  description: "Isolated Pi-Bolt streaming, physical routing identity, service errors and redacted evidence"
  status: "published"
  revision: 3
  created_at: "2026-10-29T19:37:36+01:00"
  updated_at: "2026-10-29T19:56:51+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "live QA"
      changes: ["record redacted live requests, responses, outcomes and boundaries"]
      updated_at: "2026-10-29T19:37:36+01:00"
    - revision: 2
      reason: "final verification"
      changes: ["record capture assertions, secret scan and later source revision"]
      updated_at: "2026-10-29T19:39:29+01:00"
    - revision: 3
      reason: "final registered free OpenCode probe"
      changes: ["add one bounded group-routed free model result and top-level artifact metadata"]
      updated_at: "2026-10-29T19:56:51+01:00"
---

# Live provider streaming acceptance

status: "qa-complete"
confidence: "high"
outcome: "partial" — the tested registered free OpenCode routes received upstream HTTP 429, Codex generation has no Pi credential, and OpenRouter classification is outside this extension's surface.

## Summary

Five provider paths produced a real HTTP 200 stream ending in `OK`. Synthetic also succeeded through an extension-configured virtual group and retained the physical Synthetic identity. Direct and group-routed OpenCode `big-pickle`, and a final single group-routed registered `deepseek-v4.1-flash-free` request, returned the provider's HTTP 429 free-usage-limit error. Both group errors retained physical OpenCode identity. The upstream service/environment blocked these observed attempts; other registered free routes were not tested. An OpenAI-Codex Pi login is absent, although a separate, unexpired legacy credential exists for quota access. No classifier API is exposed by the extension's OpenRouter family.

## Reproduction and environment

- Pi-Bolt `1.0.7`, Pi `1.4.0`, Bun `1.4.3`, Linux x64, JIT off. All times are Europe/Zurich.
- Main provider runs and Synthetic group ran against `7af968b542cc087318fd55cc9780661868ec18c2`. The OpenCode group run occurred after concurrent commits at `bf4bda8e362670aa27dea87af71fbb456e54ef2d`; the intervening source changes were UI and quota migration, not OpenCode routing. Commit times and capture mtimes were inspected. Initial setup saw `b8ffd00eafe83d26a97285b1890b8a5ddb5ab481`. At 19:39 the concurrently updated HEAD was `b8b364702d14c2cf22d58663bf7ea226a376c1b6`; its later `src/index.ts` and automatic-selection changes have not been live-tested in this QA.
- Pi was launched with `-ne -nc -ns -np --no-themes --no-mcp --offline --no-session --mode json`, explicit `-e captures/observe.ts -e src/index.ts -e captures/group.ts`, `--thinking off`, a short prompt, and either `--no-tools` or an inert, property-bearing `qa_noop` tool for OpenCode. `--offline` suppressed background startup/quota refresh; the recorded inference and preflight requests were real network calls. Quota and token-count endpoints were not separately tested.
- One 0700 scratch root contained isolated HOME/XDG directories, a private 0600 copy of the configured Pi `auth.json`, and a copy of `models-store.json`. The real settings, auth file and project `.pi` directory were not written. User `models.json` was not copied: the selected Claude/OpenAI entries have only `contextWindow` overrides; it contains no OpenCode or OpenAI-Codex provider/key. No login, credential creation/revocation, quota reset or OpenRouter generation was attempted.
- The observer captured the actual `fetch` request and response, raw stream events, final messages and subprocess output in memory, applying `src/core/redact/index.ts` with credential strings before writing. Private project/session identifiers were additionally omitted. An exact-string scan of the initial 20 JSON/JSONL capture files against all in-memory auth strings of length >= 8 and credential-like environment values found zero matches. A final scan of all 27 report, probe and evidence files after the additional OpenCode probe likewise found zero matches. These scans are not a proof against unknown secrets.
- A 32-token cap was applied to existing request max-token fields; for the second OpenAI run the observer explicitly added `max_output_tokens: 32`. The first OpenAI request had no hard output cap because that field was absent; it returned five output tokens. The current observer corrects this harness mistake. xAI accepted a requested maximum of 32 but reported 35 output tokens, including 34 reasoning tokens; `off` became `low` on its wire request. Antigravity selected its `low` wire level with thinking budget 0. Other capped requests recorded a maximum of 32.
- Approved physical model IDs were selected from `.project/references/models.md`. On 2026-10-29, `https://models.dev/api.json` returned 200 and listed the selected Claude, OpenAI, xAI and OpenCode models; its Synthetic `syn:small:text` and OpenRouter classifier entries were absent. Synthetic availability was observed in the extension catalog and live stream, not inferred from models.dev.

Exact commands, run from the repository root (the scratch path was created with `mktemp -d /tmp/pi-auth-live-XXXXXXXX` and mode 0700):

```sh
QA_TMP=/tmp/pi-auth-live-Ljbge7ek bun .project/analyses/extension-audit-remediation/live-providers/captures/setup.mjs
QA_TMP=/tmp/pi-auth-live-Ljbge7ek timeout --kill-after=4s 120s bun .project/analyses/extension-audit-remediation/live-providers/captures/run.ts
QA_TMP=/tmp/pi-auth-live-Ljbge7ek QA_ONLY=synthetic-group,openai,opencode-alternate QA_RUN_SUFFIX=-bounded timeout --kill-after=4s 120s bun .project/analyses/extension-audit-remediation/live-providers/captures/run.ts
QA_TMP=/tmp/pi-auth-live-Ljbge7ek QA_ONLY=opencode-group QA_RUN_SUFFIX=-bounded timeout --kill-after=4s 120s bun .project/analyses/extension-audit-remediation/live-providers/captures/run.ts
```

The first command group used the initial observer and runner. The runner was subsequently corrected to use nested settings and to add the missing OpenAI cap; it now also defines the later individual probes. The initial Synthetic `group_selection` was false because the harness wrote dotted settings keys, so that first run was a direct Synthetic request, not a product failure. The corrected isolated setting registered the group successfully. Use a fresh `QA_TMP`, new `QA_RUN_SUFFIX`, and the desired `QA_ONLY` filter for a repeat; each selected row causes real requests. The runner separately bounded each child with `timeout --kill-after=3s 100s` and captured its output before writing.

A subsequent read-only `bun -e` assertion over the redacted JSONL files returned `PASS: 5 successful redacted streams, Synthetic virtual identity, 2 truthful OpenCode 429s, bounded OpenAI request`. It asserted nonempty captured SSE response bodies, HTTP statuses, `OK` text, stop reasons, group and physical identities, upstream error type, and the OpenAI request cap.

## Final registered OpenCode probe

On 2026-10-29 at 19:56, the checked-out SHA was `e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60`; runtime was Pi-Bolt 1.0.7 / Pi 1.4.0 / Bun 1.4.3 on Linux x64 with JIT off. The isolated Pi-Bolt `--list-models` output, intersected with `.project/references/models.md`, listed `opencode/deepseek-v4.1-flash-free` and six other approved free generation IDs. The selected ID was also present in the live `models.dev/api.json` response. The actual session's model registry independently confirmed the selected physical model, and the selected virtual group routed to it. There was no custom-ID fallback or model-not-found warning.

The one final probe was run with a new 0700 scratch directory and privately copied 0600 auth and model-store files:

```sh
QA_TMP=/tmp/pi-auth-live-DjYHDMhd bun .project/analyses/extension-audit-remediation/live-providers/captures/setup.mjs
QA_TMP=/tmp/pi-auth-live-DjYHDMhd QA_ONLY=opencode-registered-final QA_RUN_SUFFIX=-20261029-final timeout --kill-after=4s 120s bun .project/analyses/extension-audit-remediation/live-providers/captures/run.ts
```

Test-isolated Pi settings disabled agent and provider retries and cache warming. The observer additionally refused a second inference request, an unregistered group target, a different wire model, an absent/over-32 token cap, or a missing property-bearing inert tool. None of those guards fired. Exactly one request was sent to `https://opencode.ai/inference/openai/v1/chat/completions`, with model `deepseek-v4.1-flash-free`, `max_tokens: 32`, OpenCode CLI user-agent and client header, session and affinity headers, an `<env>` system block, and the inert `qa_noop` tool. The provider returned HTTP 429 `FreeUsageLimitError`; the group session's assistant error named physical `opencode/deepseek-v4.1-flash-free`, with empty text and 0/0 usage. No second request was sent. The Pi process exited 0 while its assistant result had `stopReason: error`. A read-only assertion over the redacted evidence returned `PASS: single registered group request, 32-token cap, identity, tool and truthful 429`.

Evidence: `captures/opencode-registered-final-20261029-final.jsonl` and `captures/opencode-registered-final-20261029-final-process.json`. The configured OpenCode slot and `OPENCODE_API_KEY` were absent; the extension's anonymous fallback was used. This is an observed upstream free-tier service rejection, not evidence that every registered free model is unavailable, that an account credential exists, or that a provider/signing regression caused it.

## Test matrix

All final assistant results below are actual `message_end` observations. Counts are provider/Pi-reported usage, not independent token counts. The captures directory contains the redacted HTTP request, response, stream/turn events and process output for each label.

| Route and configured model | Actual endpoint and status | Result | Usage: input / output | Evidence |
|---|---|---|---|---|
| `claude/claude-haiku-5-5` | `https://api.anthropic.com/v1/messages?beta=true`, 200; `/api/hello`, 200 | `OK`, physical `claude`, stop | 92 / 4 | `captures/claude.jsonl` |
| `antigravity/claude-sonnet-5-5` | `https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`, 200; `...:streamGenerateContent?alt=sse`, 200 | `OK`, physical `antigravity`, stop; wire level was `claude-sonnet-5-5-low` | 72 / 4 | `captures/antigravity.jsonl` |
| `synthetic/syn:small:text` | `https://api.synthetic.new/anthropic/v1/messages?beta=true`, 200 | `OK`, physical `synthetic`, stop; direct run | 53 / 3 | `captures/synthetic-group.jsonl` |
| `group/live-qa` -> `synthetic/syn:small:text` | same Synthetic endpoint, 200 | `OK`; selected group, stream event and final assistant identify physical `synthetic/syn:small:text` | 56 / 3 | `captures/synthetic-group-bounded.jsonl` |
| `openai/gpt-6-luna` | `https://api.openai.com/v1/responses`, 200 | `OK`, physical `openai`, stop; bounded repeat | 44 / 5 | `captures/openai-bounded.jsonl` |
| `xai/grok-4.7` | `https://api.x.ai/v1/responses`, 200 | `OK`, physical `xai`, stop; response also reported 1,152 cache-read and 34 reasoning tokens | 130 / 35 | `captures/xai.jsonl` |
| `opencode/big-pickle` | `https://opencode.ai/inference/openai/v1/chat/completions`, 429 | `FreeUsageLimitError`, empty text, physical `opencode`, error; 1/1 direct attempts | 0 / 0 | `captures/opencode-free.jsonl` |
| `group/live-qa` -> `opencode/big-pickle` | same OpenCode endpoint, 429 | same service error; selected group, final assistant names physical `opencode/big-pickle`; 1/1 group attempts | 0 / 0 | `captures/opencode-group-bounded.jsonl` |
| `group/live-qa` -> `opencode/deepseek-v4.1-flash-free` | same OpenCode endpoint, 429 | registered physical model confirmed in actual session; one request, same upstream `FreeUsageLimitError`, no custom fallback | 0 / 0 | `captures/opencode-registered-final-20261029-final.jsonl` |
| `opencode/cat-jam-free` | same OpenCode endpoint, 400 four times | Pi warned the model was not in its provider registry and used a custom ID; server reported `Upstream request failed: Model is unavailable.` This does not prove a registered-model route. | 0 / 0 | `captures/opencode-alternate-bounded.jsonl`, `captures/opencode-alternate-bounded-process.json` |
| `openai-codex` | No inference request | Pi credential slot missing at `/home/furbyhaxx/.pi/agent/auth.json`; no configured `models.json` key or relevant environment credential. The separate `/home/furbyhaxx/.pi/agent/quotas-codex-auth.json` exists, has OAuth type and nonempty unexpired access, and is a quota fallback rather than a Pi generation slot (`src/families/openai/auth.ts:19-41`). No login or slot synthesis was attempted. | n/a | Credential presence/type inspection only |
| OpenRouter classifier | No inference request | Configured API-key slot exists. `src/families/openrouter/index.ts:1-11` registers quota reporting only; the source tree exposes no System One/classifier endpoint. General generation was not attempted. | n/a | Source inspection |

## Defects and observations

### Major acceptance gap: tested OpenCode free routes rejected upstream

Reproduction: select the listed free `big-pickle` model directly or configure the isolated one-member virtual group, then send `Reply exactly OK. Do not use any tools.` Both requests returned HTTP 429 with the upstream `FreeUsageLimitError`; no assistant text was streamed. One additional registered, approved `deepseek-v4.1-flash-free` group request produced the same 429. The wire captured the expected OpenCode CLI user-agent, `x-opencode-client: cli`, session and affinity headers, `<env>` system block, 32-token limit, and a tool with properties. Thus the observed failure is not explained by missing required identity fields in those captured requests. The service's limit verdict is observed; whether it reflects anonymous-tier enforcement or some other upstream condition is unverified. The authorized free response requirement remains unmet for the tested routes; no claim is made about every other registered free route. Do not substitute a paid route.

### Separate observation, outside F01–F34: OpenCode error text omits its physical endpoint

For both direct and group requests, the assistant message carried physical `provider: opencode`, the actual physical model, `stopReason: error`, and status 429 inside `errorMessage`. The text contained the service's OpenCode Go subscription suggestion but not the actual inference endpoint. The project error contract requires provider, endpoint, status and recovery action; the endpoint was only recoverable from the separately captured HTTP request. In group mode the surrounding session identity was `group/live-qa`, so the physical assistant fields are important. This is a separate observation outside F01–F34; a regression has not been established. The process itself exited 0 despite an error result; whether Pi's print-mode exit code is contractually required to be nonzero is unverified.

### Other observations

- `cat-jam-free` was present in models.dev but not in the isolated Pi model registry at startup. Pi fell back to a custom ID and made four HTTP 400 attempts before reporting the server's model-unavailable message. No claim is made that this is a regression in the extension: catalog freshness and upstream retry ownership were not investigated.
- xAI's response reported 35 output tokens, exceeding the transmitted `max_output_tokens: 32`; the captured request also specified `reasoning.effort: low` despite `--thinking off`. This is an observed provider/runtime result, not a root-caused extension defect.
- The first OpenAI live request lacked a hard token cap because of the observer's initial implementation. Its actual response was five tokens; the repeated request explicitly capped output at 32 and succeeded. The first Synthetic group configuration was also a harness error, corrected before the successful group test.

## Recommended follow-ups

1. Repeat the free OpenCode route when the provider permits free usage or with an already-configured eligible credential. Keep the CLI identity checks and capture both direct and group cases; do not claim the 429 has an extension-side cause without further evidence.
2. Track the endpoint omission as a separate observation outside F01–F34. Do not change provider/signing error code without a proven regression and separately scoped work. Confirm ownership of Pi print-mode exit status separately.
3. If Codex generation is required, provide an existing Pi `openai-codex` login through the normal authorized workflow; the legacy quota file alone is not the Pi generation slot. If OpenRouter native classification is required, it needs a separately scoped supported adapter; this extension currently supplies quotas only.
4. Investigate the xAI response's over-budget output and forced low reasoning against the provider and Pi runtime if strict token budgets are a product requirement. This QA did not alter request semantics beyond the stated cap or determine whether the provider enforces that cap over reasoning tokens.

## Open questions / cleanup

No product source, tests, manifests or user configuration were edited. No login, refresh-key creation/revocation, paid OpenCode model, quota reset or OpenRouter general-generation call was made. Background quota refresh and token-count endpoints were intentionally outside this streaming-only QA. The scratch directory and owned child processes were cleaned up after evidence scanning.
