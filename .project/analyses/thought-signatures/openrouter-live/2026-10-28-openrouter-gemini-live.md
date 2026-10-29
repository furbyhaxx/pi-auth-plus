---
document:
  type: "analysis"
  id: "thought-signatures-openrouter-live"
  title: "OpenRouter Gemini thought-signature live QA"
  description: "Isolated live tool-loop validation of signed, missing, and dummy thought signatures."
  status: "published"
  revision: 1
  created_at: "2026-10-28T15:30:29+01:00"
  updated_at: "2026-10-28T15:30:29+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "Initial live QA"
      changes:
        - "Recorded signed, unsigned, and manually repaired OpenRouter Gemini requests."
version: 1
id: "thought-signatures-openrouter-live"
title: "OpenRouter Gemini thought-signature live QA"
description: "Isolated live tool-loop validation of signed, missing, and dummy thought signatures."
type: "analysis"
created: "2026-10-28T15:30:29+01:00"
updated: "2026-10-28T15:30:29+01:00"
createdBy: "pi"
updatedBy: "pi"
---

# OpenRouter Gemini thought-signature live QA

status: "qa-complete"  
confidence: "high" for the observed client-to-OpenRouter traffic; the gateway-to-Google request and automatic live recovery remain unobserved.

## Summary

Outcome: **partial**. The signed control and all three deliberately unsigned continuations returned HTTP 200 and finished with one tool execution. The unsigned requests did not produce the requested missing-signature 400, so bounded recovery was never activated live. A separate manual invocation of the production repair transform sent its dummy representation and received HTTP 200; this is not evidence that the gateway forwarded or validated the dummy. No product defect was established.

## Environment and method

On 2026-10-28, Bun 1.4.3 on Linux 7.2.9-2-cachyos used Pi SDK dependencies 1.4.0 and repository HEAD `64806fe485f4990f08f7acb98c8f7e7dcc05d509`. The first-party [OpenRouter model catalog](https://openrouter.ai/api/v1/models) and [endpoint catalog](https://openrouter.ai/api/v1/models/google/gemini-4-argon/endpoints) returned HTTP 200 and listed `google/gemini-4-argon`, tool calling, and Google AI Studio and Vertex routes. The selected generation model also appears in `.project/references/models.md`. The filtered catalog response is [catalog.json](catalog.json).

The [probe](probe.ts) reads the configured OpenRouter API key into process memory, registers `registerCompatibleThoughtSignatures`, `compatiblePhysicalHooks`, and `registerThoughtSignatureRecovery`, and installs their physical hooks in an isolated Pi SDK session. It uses a new temporary working and agent directory, in-memory settings and session storage, no user extensions or conversation, and one non-side-effectful `count` tool. The prompt asks for exactly one call with `value: 1`, followed by `DONE`. Each scenario was run once; there were five sessions and ten live chat-completions POSTs.

In the forced scenarios only, a request-local hook removes the real `google-gemini-v1` `reasoning.encrypted` detail and any `extra_content.google.thought_signature` from the assistant tool-call history before the recovery hook snapshots the outgoing payload. The normal scenario is unmodified. The `forced-dummy` scenario additionally calls the real `repairThoughtSignaturePayload` directly before sending the continuation. That manual operation demonstrates the representation independently of an error-triggered retry.

Evidence files are allowlisted summaries of the actual outgoing request and streamed response events, not raw HTTP dumps. They omit headers, credential values, real signature values, system content, and conversation text; `matchesStream: true` is an equality check performed in memory. HTTP statuses were observed on the actual OpenRouter response, including streaming responses. Tool counts and final outcomes come from the session, not from model claims.

## Test matrix

| Scenario | Actual HTTP statuses | Tool executions | Final | Result |
|---|---|---:|---|---|
| Signed control, default route | 200, 200 | 1 | `stop`, `DONE` | Real encrypted detail on the tool call matched the streamed signature; no repair or context edit. [Evidence](evidence-normal-1.json) |
| Missing signature, default route | 200, 200 | 1 | `stop`, `DONE` | One encrypted detail removed; no 400 or recovery. [Evidence](evidence-forced-1.json) |
| Missing signature, Google AI Studio only | 200, 200 | 1 | `stop`, `DONE` | One encrypted detail removed; stream identified `Google AI Studio`; no 400 or recovery. [Evidence](evidence-forced-studio.json) |
| Missing signature, Google Vertex only | 200, 200 | 1 | `stop`, `DONE` | One encrypted detail removed; stream identified `Google`; no 400 or recovery. [Evidence](evidence-forced-vertex.json) |
| Manually repaired missing signature, default route | 200, 200 | 1 | `stop`, `DONE` | Sent `tool_calls[0].extra_content.google.thought_signature = "skip_thought_signature_validator"`; stream identified `Google AI Studio`. [Evidence](evidence-dummy-1.json) |

The three unsigned continuations contained neither the `reasoning_details` encrypted signature nor an `extra_content` Google signature in the captured assistant tool-call summaries. In all five sessions, physical hooks installed successfully, extension error lists were empty, and the context-edit count was zero. The 200 responses and successful final streams establish that OpenRouter accepted these client requests. They do not reveal whether the gateway removed, substituted, or forwarded any thought signature to Google.

## Reproduction and verification

From the repository root, with a configured OpenRouter Pi API-key slot and live billing authorization:

```sh
timeout 110s bun .project/analyses/thought-signatures/openrouter-live/probe.ts normal normal-1
timeout 110s bun .project/analyses/thought-signatures/openrouter-live/probe.ts forced forced-1
timeout 110s bun .project/analyses/thought-signatures/openrouter-live/probe.ts forced forced-studio google-ai-studio
timeout 110s bun .project/analyses/thought-signatures/openrouter-live/probe.ts forced forced-vertex google-vertex
timeout 110s bun .project/analyses/thought-signatures/openrouter-live/probe.ts forced-dummy dummy-1
```

All five commands exited 0 with the matrix results above. Evidence creation uses exclusive file creation; choose new labels to repeat the live runs without overwriting the captures.

```sh
bun test --isolate tests/families/google/signature-recovery.test.ts
```

Result: **13 pass, 0 fail, 128 assertions**. This isolated test includes synthetic HTTP 400 recovery, one retry, and a single tool execution. It does not establish the corresponding OpenRouter behavior live.

```sh
bun .project/analyses/thought-signatures/openrouter-live/validate.ts
```

Result: **PASS: 5 live cases; status sequences, signature preservation/omission/dummy, provider routes, tool counts and credential absence verified.** The validator checks that none of these artifacts contains the configured key, without printing or transforming the key.

## Defects and remaining gaps

No confirmed product defect. The live acceptance test for automatic recovery is **unverified**: the three unsigned continuations yielded zero missing-signature 400s, so `isMissingSignatureError` and the error settlement/continuation path in `src/families/google/signature-recovery.ts:121-130,188-257` were not exercised by an actual OpenRouter error. No automatic retry or recovery-generated dummy was sent in these runs. The direct transform in `src/families/google/thought-repair.ts:103-135` was instead tested manually, and the gateway accepted that request; forwarding or interpreting the dummy remains unverified.

Obtain a reproducible real OpenRouter route and tool-loop combination that returns the exact missing-signature 400, or gateway-side request evidence, before claiming a successful live bounded recovery or dummy forwarding. Do not infer the gateway's upstream behavior merely from its 200 responses.

## User-state note and cleanup

No source, test, configuration, or authentication file was edited; the configured auth file was read only. Probe scratch directories were removed and no probe processes remain.

The documentation-fetch tool unexpectedly refreshed two pre-existing user cache entries during the lookup, outside the requested no-user-state boundary: `/home/furbyhaxx/.cache/pi-searxng/fetch/47ecce490c3c4e433867.txt` and `/home/furbyhaxx/.cache/pi-searxng/fetch/d2d7b1a5ee8fec8e6b2e.txt`. Their modification times became 2026-10-28 15:27:40 +01:00. The original cache contents were not captured, so the entries were not altered again or restored.
