---
document:
  type: "analysis"
  id: "thought-signatures-root-cause"
  title: "Google-family missing thought signatures"
  description: "Pi 1.4 serialization and bounded-retry investigation using loopback transports."
  status: "published"
  revision: 1
  created_at: "2026-10-28T11:43:03+01:00"
  updated_at: "2026-10-28T11:43:03+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "Initial investigation"
      changes:
        - "Reproduced missing signatures and tested the Pi settlement boundary."
version: 1
id: "thought-signatures-root-cause"
title: "Google-family missing thought signatures"
description: "Pi 1.4 serialization and bounded-retry investigation using loopback transports."
type: "analysis"
created: "2026-10-28T11:43:03+01:00"
updated: "2026-10-28T11:43:03+01:00"
createdBy: "pi"
updatedBy: "pi"
---

# Google-family missing thought signatures

status: "partially explained"  
confidence: "medium" for the reported live incident; high for the synthetic reproductions.

## Summary

Unsigned calls reach Google-family requests without repair. Pi's compatible adapter also loses synthetic `extra_content` signatures. The reported Antigravity failure's origin remains unobserved.

## Reproduction

From the repository root, with Bun 1.4.3 and Pi packages 1.4.0:

```sh
bun test --isolate tests/families/google/convert.test.ts tests/families/google/stream.test.ts tests/families/google/request.test.ts tests/families/google/errors.test.ts
timeout 45s bun .project/analyses/thought-signatures/root-cause/repro.ts
timeout 45s bun .project/analyses/thought-signatures/root-cause/matrix.ts
timeout 45s bun .project/analyses/thought-signatures/root-cause/boundary.ts
```

Tests: **38 pass, 0 fail**; scripts exit 0. Saved JSONL traces show payloads and errors. The loopback server rejected unsigned calls with HTTP 400; payload repair succeeded with **one tool execution**. Each scenario ran once. No live calls were made.

## Root cause

- Antigravity stores signatures on `toolCall.thoughtSignature` (`src/families/google/stream.ts:254-327`). Its converter drops non-base64 and cross-model signatures (`convert.ts:45-54,134-145`; `transform.ts:81-105`). Pi's Google converter does likewise (`node_modules/@earendil-works/pi-ai/dist/api/google-shared.js:109-120,230-237`). The raw dummy is filtered out. Bundled OpenCode Gemini uses this Google adapter.
- Pi stores OpenRouter `reasoning_details` in `thinkingSignature` and replays it; synthetic `tool_calls[].extra_content.google.thought_signature` disappears during normalization and replay (`openai-completions.js:296-325,416-450,981-1053`).
- Antigravity exposes HTTP 400 to `onResponse` (`provider.ts:129-139`); Google never fires it, and OpenAI fires only after response acquisition succeeds. Pi exits errors despite `turn_end` continuation (`pi-agent-core/dist/agent-loop.js:148-157`).

## Evidence and boundaries

`boundary-trace.jsonl`: `agent_before_settle` and a `context_edit` omitting the failed assistant resume from tool results without repeating execution. Unrelated 400, matching 403 and persistent 400 do not loop. `matrix-trace.jsonl`: a standalone signature after a tool call is lost in a synthetic stream; real ordering is unknown.

The separately installed `/mnt/shared/.agents/pi/extensions/gemini-reasoning-guard.ts:10,138-175,213-257`, when loaded, rejects the raw dummy on direct Google payloads and treats unrelated `INVALID_ARGUMENT` errors as signature failures. It ignores Antigravity's nested `request.contents`. Coordinate with this guard.

## Recommended fix

Match the specific missing-signature HTTP 400, model and request; fail closed when ambiguous. At `agent_before_settle`, exclude only the failed assistant and resume once from retained results, only when an eligible part can be repaired. At `before_provider_request`, patch only missing first calls in each current-turn step, retaining repairs for subsequent tool-loop requests. Preserve real signatures, later parallel calls, streamed `extra_content`, and OpenRouter `reasoning_details`. Handle each wire format separately; respect cancellation and bound retries. Add regression cases matching the traces.

## Live verification (2026-10-28)

Antigravity, real account, current code:

```text
{"requests":3,"statuses":[200,400,200],"signatures":["none","missing","dummy"],
 "toolRuns":1,"stripped":1,"finalStop":"stop","extensionErrors":[]}
```

One tool execution across the whole turn: the 400 was answered with a retry carrying
`skip_thought_signature_validator`, never with a second tool call. Captures in `captures/`:
the unsigned first request, the exact 400 (`Function call is missing a thought_signature ...`),
and the accepted retry. Harness: `/tmp/pi-authplus-live-PUzG6P/probe.ts` (reads the existing,
unexpired access token; no refresh).

Direct Google stays blocked: `403 PERMISSION_DENIED` on the stored OAuth token's scopes.
OpenCode Gemini stays blocked: `401 Missing API key` with the anonymous credential.

## Open questions / follow-ups

The real Antigravity response and incident transcript were unavailable. The loopback server assumes sentinel acceptance; Google documents `skip_thought_signature_validator`, but real Antigravity/OpenCode forwarding and OpenRouter's accepted dummy representation remain **unverified**. Google validates first calls per step in the current turn: https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures. OpenRouter documents `reasoning_details` replay: https://openrouter.ai/docs/use-cases/reasoning-tokens.
