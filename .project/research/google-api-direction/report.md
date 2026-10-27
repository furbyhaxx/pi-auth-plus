---
document:
  type: "research"
  id: "RESEARCH-GOOGLE-API-DIRECTION"
  title: "Google Gemini API direction: Interactions versus GenerateContent"
  description: "Development artifact: Google Gemini API direction: Interactions versus GenerateContent."
  status: "draft"
  revision: 3
  created_at: "2026-10-25T21:40:29+01:00"
  created_by: "Furby Haxx"
  updated_at: "2026-10-27T10:00:06+01:00"
  updated_by: "pi"
  source: "nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/research/google-api-direction/report.md"
  changelog:
    - revision: 2
      reason: "Record explicit user scope and distinguish client-facing proxy protocols"
      changes: ["Require both dialects under the clarified routing policy", "Separate future Antigravity preference from unverified endpoint support", "Retain dated official-source research without implying new live verification"]
    - revision: 1
      reason: "initial official-source research"
      changes: ["identified the likely new API and compared its status, state, protocol, and streaming scope"]
    - revision: 3
      reason: "imported into pi-auth-plus"
      changes: ["copied from nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/research/google-api-direction/report.md"]
---

# Google Gemini API direction: Interactions versus GenerateContent

## Project decision — 2026-10-26

The user clarified that GenerateContent is a required supported dialect for proxies exposing the legacy wire API and for explicit legacy selection on direct Google or, where supported, Antigravity. Interactions remains the intended default for direct Google and the preferred future Antigravity default, subject to actual endpoint/auth support. This supersedes the earlier optional-assessment wording. Both protocols remain separate; no automatic fallback is approved. See plan 0005 (nukular-ai `.project/plans/0005-provider-expansion/plan.md`) revision 2 and SPEC D-85.

Client-facing routing needs per-endpoint evidence. The inspected `.references/pi/packages/ai/scripts/generate-models.ts:2246-2280` maps OpenCode `@ai-sdk/google` routes to the legacy Google dialect. In contrast, `.references/pi/packages/ai/src/providers/openrouter.ts:65-86` registers Completions and Anthropic Messages; it does not establish a GenerateContent endpoint. An upstream provider using GenerateContent behind a proxy does not imply that callers use that wire API. Antigravity Interactions support remains **UNVERIFIED**; no endpoint probe was made. These are local reference observations on 2026-10-26, not live availability claims or refreshed web findings.

## Original official-source findings — 2026-10-25

- **Verified name and status:** Google calls the newer interface the **Gemini Interactions API**. Its docs say it became generally available in June 2026, recommend it for new projects, and describe `generateContent` as legacy but fully supported [1][2].
- **Intent inference:** “The new API, not the legacy generate content API” closely matches Google's own wording, so the likely roadmap target is Interactions. This identifies the best fit; it cannot establish the user's intended meaning with certainty.
- Interactions exposes an `Interaction` resource and typed execution steps; it supports server-managed history through `previous_interaction_id` and also stateless use. `GenerateContent` expects the caller to provide the conversation history on each request (SDK chat helpers retain it client-side) [2][5][6].
- Both support server-sent-event streaming, but the event contracts differ: Interactions streams typed interaction/step events; `streamGenerateContent` streams `GenerateContentResponse` chunks [4][6].
- The original feature-gap rationale included Batch API, explicit caching, and Python automatic function calling [1]. The subsequent user decision above independently requires GenerateContent for proxy compatibility and explicit legacy selection.

## Findings

### What “new API” most likely means

Google's official Interactions documentation explicitly recommends the Interactions API for all new projects, calls `generateContent` legacy, says it remains fully supported, and states that new models, capabilities, tools, and agentic features will launch on Interactions [1]. The migration guide independently recommends Interactions for new development while saying `generateContent` remains fully supported [2]. The wording in the brief therefore maps directly to the **Gemini Interactions API**; this is an inference about user intent, not a verified statement of that intent.

Google also has a **Gemini Live API**, but it is a different kind of interface: a stateful WebSocket connection for low-latency, continuous real-time audio, image, and text interactions. Treat “new API” as Live only if the intended scope is real-time voice/video duplex sessions, rather than ordinary generation calls [7].

### Protocol, state, and streaming

| Dimension | Interactions API | GenerateContent |
|---|---|---|
| HTTP API shape | `POST /v1/interactions` is documented in the stable v1 reference; the docs also show `/v1beta/interactions` [1][3]. | `POST /v1beta/models/{model}:generateContent`; the streaming method is `:streamGenerateContent` [5][6]. |
| Request/response model | `input` produces an `Interaction` record with status and an ordered `steps` timeline, suitable for model output, thoughts, and tool activity [1][3]. | `contents` produces `GenerateContentResponse` candidates. For multi-turn requests, the caller sends the history in `contents`; SDK chat helpers maintain that history client-side and still call GenerateContent [5][6]. |
| Conversation state | Stored by default; continue with `previous_interaction_id`. Stateless operation is available, but disabling storage (`store=false`) prevents later continuation by that ID [1][3]. | No server-side conversation resource/ID in the documented flow; send the full history each turn. SDK chat is a helper, not a separate server-side conversation API [5][6]. |
| Streaming | SSE (`stream: true`) with named events such as `interaction.created`, `step.start`, `step.delta`, `step.stop`, and `interaction.completed`; deltas are typed and can represent text, tools, images, or thought summaries [4]. | SSE via `:streamGenerateContent?alt=sse`; the SDK yields incremental `GenerateContentResponse` chunks [5][6]. |

### Documented maturity and scope

Google's Interactions page says “Generally Available” as of June 2026 and recommends it for new projects [1]. The versioned API reference separately labels `/v1beta` as beta while pointing to a stable v1 reference; the stable reference documents `POST /v1/interactions` [3]. These are different API-version paths, so the beta label on the beta reference should not be read as evidence that no stable Interactions API exists.

Google says `GenerateContent` remains fully supported, while calling it legacy. The official Interactions docs list three features still available through GenerateContent but not yet Interactions: Batch API, Python automatic function calling, and explicit caching [1]. This supports retaining both API paths in roadmap scope without treating them as equal strategic direction.

## Risks, caveats and open questions

- The original research inferred Interactions from the phrase used. The subsequent approved roadmap and user clarification above now govern scope; Google Live/WebSocket is not implied.
- The official docs show `/v1`, `/v1beta`, and `/v1beta2` Interactions paths; use of `/v1` is documented, but the migration guide uses `/v1beta2` while other guide examples use `/v1beta` [1][2][3][4]. Pin and verify the version at implementation time.
- “Fully supported” is Google's documented status for GenerateContent; the inspected sources do not provide a specific retirement date [1][2].

## Recommendation

Interpret the requested Google direction as **Gemini Interactions API**: prioritize it as the current general-generation interface, and retain GenerateContent as a supported legacy path for its feature coverage and any required compatibility. Do not substitute Gemini Live unless the intended product behavior is a persistent, real-time WebSocket session.

## Sources

[1] Google AI for Developers, “Interactions API” — <https://ai.google.dev/gemini-api/docs/interactions> (accessed 2026-10-25; states GA as of June 2026 and recommends new projects).
[2] Google AI for Developers, “Migrate to the Interactions API” — <https://ai.google.dev/gemini-api/docs/migrate-to-interactions> (accessed 2026-10-25; current migration guidance).
[3] Google AI for Developers, “Interactions API v1 reference” — <https://ai.google.dev/api/interactions-api-v1> (accessed 2026-10-25; stable v1 resource and endpoint definitions).
[4] Google AI for Developers, “Streaming interactions” — <https://ai.google.dev/gemini-api/docs/streaming> (accessed 2026-10-25; SSE events and step-delta semantics).
[5] Google AI for Developers, “Gemini API reference: generateContent” — <https://ai.google.dev/api/generate-content> (accessed 2026-10-25; GenerateContent request and response API).
[6] Google AI for Developers, “Generate content with the Gemini API” — <https://ai.google.dev/gemini-api/docs/generate-content/text-generation> (accessed 2026-10-25; GenerateContent streaming and SDK chat behavior).
[7] Google AI for Developers, “Gemini Live API” — <https://ai.google.dev/gemini-api/docs/live> (accessed 2026-10-25; real-time WebSocket scope).
