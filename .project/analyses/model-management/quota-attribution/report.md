---
version: 1
id: "quota-attribution"
title: "Virtual model quota attribution"
description: "Pi 1.4 physical provider identity at request and lifecycle hooks"
type: "analysis"
created: "2026-10-28T10:57:21+01:00"
updated: "2026-10-28T10:57:21+01:00"
createdBy: "analyst"
updatedBy: "analyst"
document:
  type: "analysis"
  id: "quota-attribution"
  title: "Virtual model quota attribution"
  description: "Pi 1.4 physical provider identity at request and lifecycle hooks"
  status: "published"
  revision: 1
  created_at: "2026-10-28T10:57:21+01:00"
  updated_at: "2026-10-28T10:57:21+01:00"
  created_by: "analyst"
  updated_by: "analyst"
  changelog:
    - revision: 1
      reason: "probe results"
      changes: ["Live and isolated probe evidence for M4 model management"]
---

# Quota attribution
status: "root-caused"; confidence: "high"

Pi 1.4.0: `core` = `~/.bun/install/cache/@earendil-works/pi-coding-agent@1.4.0@@@1/dist/core`.

|Hook|ctx.model|Event|
|---|---|---|
|before_provider_headers|virtual|headers|
|before_provider_request|virtual|payload; provider-dependent model id|
|after_provider_response|virtual|status, headers|
|message_end|virtual|message; assistant: physical provider/model/api/usage|
|turn_end|virtual|assistant message; entry ids|
|agent_end|virtual|messages, physical assistants|
|provider_stream_event|virtual|physical provider/model/api; after headers|

Routing failures may emit virtual assistants. Trace: `core/agent-session.js:459-484,903-945,1052-1053,2814`; `core/extensions/{loader.js:406-413,runner.js:613-645,types.d.ts:693-717,748,828-851}`; `core/model-runtime.js:736-759`; `core/sdk.js:224-249`.

RPC: five OpenCode/Synthetic requests succeeded. Concurrent routes shared session id/signal, corrupting last-route maps. Router inputs: model, thinkingLevel, reason, previous, failed, state, messages, signal; no request id. Direct calls ignore optional branch state (`core/virtual-models.d.ts:33-68`). Loopback 429s produced no response hook for OpenAI-completions or Anthropic-messages. Captures and commands: `captures/`.

Use assistant messages for usage/refresh, filtering virtual failures. Generic header attribution needs Pi to expose the physical model from `onResponse(response, model)` and handle error responses (`node_modules/@earendil-works/pi-ai/dist/types.d.ts:69-73,112`). Avoid last-route or stream-event correlation. Existing parsers claim by header shape; corruption is unproven (`src/quotas/engine.ts:179-204`). Synthetic's observed quota header is unparsed. Regression: interleaved routes and 429s.

**BLOCKERS:** Upstream response metadata/error hooks.
