---
document:
  type: "research"
  id: "RES-anthropic-messages-5a"
  title: "Anthropic Messages protocol and API-key provider facts"
  description: "Development artifact: Anthropic Messages protocol and API-key provider facts."
  status: "published"
  revision: 2
  created_at: "2026-10-26T14:09:47+01:00"
  created_by: "Furby Haxx"
  updated_at: "2026-10-27T10:00:06+01:00"
  updated_by: "pi"
  source: "nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/research/anthropic-messages-5a/report.md"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["document creation"]
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/research/anthropic-messages-5a/report.md"]
---

# Anthropic Messages protocol and API-key provider facts

**Checked:** 2026-10-26. Current public API facts below use Anthropic API version `2026-10-21`; current official SDK snapshots checked were TypeScript SDK v1.3.0 (`cb5fba419808`) and Python SDK v2.3.0 (`202db72c87d7`), both last updated 2026-10-23. The comparison target is the local Pi reference file at the upstream revision named in the brief (`66c2fa3d`): `.references/pi/packages/ai/src/api/anthropic-messages.ts`.

## TL;DR

- Direct Messages is `POST https://api.anthropic.com/v1/messages`; `anthropic-version: 2026-10-21` and `content-type: application/json` are required. API keys work as `Authorization: Bearer …` or the still-supported legacy `x-api-key` header. [1][2][3][20]
- The latest API version rejects `temperature`, `top_p`, and `top_k` for every model. Pi still conditionally sends `temperature`; this is a direct incompatibility with the version recommended for a new Rust HTTP client. [3] Pi: L1251-L1256.
- The official SSE contract has six named message/block event kinds plus `ping` and in-band `error`; unknown future event types must be handled gracefully. Current SDK types also include citation and compaction deltas and server/MCP/tool result content blocks. Pi drops citation deltas and most new block kinds. [6][27][28] Pi: L395-L401, L546-L550, L730-L840.
- Current stop reasons are `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`, `model_context_window_exceeded`, and `compaction` (the latter comes from documented compaction betas). Pi has no mapping for the last two and throws; it also recognizes an undocumented `sensitive` value. [7][8][27][28] Pi: L1664-L1688.
- `eager_input_streaming` is now a public per-tool field and needs no beta header. Fine-grained streaming's `fine-grained-tool-streaming-2025-05-14` remains a legacy beta. Adaptive thinking interleaves without the old interleaved-thinking beta. [10][12][13] Pi emits both legacy behavior and the current field depending on compatibility flags. [29] Pi: L198-L203, L1580-L1584, L1656.
- Structured outputs and `strict: true` are GA without a beta header. Public docs publish limits and the generic grammar error, but not the exact 400 strings Pi substring-matches. [14][15] Pi: L670-L682.
- The curated API model IDs `claude-opus-5-5`, `claude-fable-5-1`, `claude-sonnet-5-5`, and `claude-haiku-5-5` match official model IDs shown in current docs. The `claude/` prefix is Nukular's namespace, not an Anthropic model ID. [9][11][19] Model reference: `.project/references/models.md` L44-L47.

## 1. Endpoint, authentication headers, errors, and HTTP status

**Verified facts.** The endpoint is `POST /v1/messages` at `https://api.anthropic.com`. Requests need `anthropic-version` and JSON `content-type`. The current recommended version as of this check is `2026-10-21`. The direct API accepts a Console API key in `Authorization: Bearer <key>`; `x-api-key` remains supported as the legacy alternative. Official SDK setup uses `ANTHROPIC_API_KEY`. A key not scoped to a workspace also requires `anthropic-workspace-id`. [1][2][3][20]

A regular error response is JSON with top-level `type: "error"`, an `error` object containing `type` and `message`, and `request_id`; some errors also include `error.details`. Documented HTTP/type pairs include 400 `invalid_request_error`, 401 `authentication_error`, 402 `billing_error`, 403 `permission_error`, 404 `not_found_error`, 409 `conflict_error`, 413 `request_too_large`, 429 `rate_limit_error`, 500 `api_error`, 504 `timeout_error`, and 529 `overloaded_error`. The set of error types can grow. [4]

A 429 can mean a rate limit, acceleration limit, or spend cap. A tier spend-cap 429 has no `retry-after` and continues to fail until access resumes. A configured spend limit can instead yield 400 `invalid_request_error`. A 529 means temporary API overload. For 429 responses that include `retry-after`, wait that many seconds; more generally retry transient failures with bounded exponential backoff and honor `retry-after` when present. [4][5]

**Pi comparison.** Pi calls `client.beta.messages.create()` and passes the resolved key to SDK client construction; this file does not manually form the URL or set `anthropic-version`, relying on SDK defaults. Its authentication resolver accepts an API key or selected auth headers. This is consistent when implemented with the official SDK, but a direct Rust client must explicitly send the required current API version, JSON content type, and one supported auth header. [29] Pi: L316-L336, L645-L660, L1010-L1108.

Pi sets SDK `maxRetries: 0` and calls its own retry wrapper; that is a retry policy choice, not an Anthropic protocol requirement. [29] Pi: L645-L662. **Agrees** on endpoint/auth role; **not directly comparable** on version-header emission because this source delegates it to the SDK.

## 2. SSE events and payloads

**Verified facts.** Anthropic streams named SSE events in this sequence: `message_start`; zero or more content-block triplets (`content_block_start`, zero or more `content_block_delta`, `content_block_stop`); one or more `message_delta`; and `message_stop`. Any number of `ping` events may appear between them. An in-band `error` can occur after the HTTP response has already returned 200; its `data` contains a JSON error object, for example `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`. [6]

Core payload shapes are:

- `message_start`: `{type, message}`; `message` has the response identity/model, initially empty `content`, initial `usage`, and may have `input_transformations` when the relevant beta is enabled.
- `content_block_start`: `{type, index, content_block}`. `index` is the position in final `content`.
- `content_block_delta`: `{type, index, delta}`. Current SDK delta variants are `text_delta {text}`, `input_json_delta {partial_json}`, `thinking_delta {thinking, estimated_tokens}`, `signature_delta {signature}`, `citations_delta {citation}`, and `compaction_delta {content, encrypted_content}` (the latter two compaction fields are nullable). The SDK types `estimated_tokens` as nullable and says it is populated under `thinking-token-count-2026-05-13`; its public feature documentation/status was **UNVERIFIED** in this check. In the on-demand compaction flow, the signed block is delivered whole, without deltas. [6][27][28]
- `content_block_stop`: `{type, index}`.
- `message_delta`: `{type, delta, usage}`. `delta` includes `stop_reason`, `stop_sequence`, and in current SDK wire types `stop_details` (and optional container information). Usage counts are cumulative. Its `server_tool_use` object currently has `web_search_requests` and `web_fetch_requests`; `output_tokens_details.thinking_tokens` may also occur. The **per-TTL** cache object (`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`) is on the message/initial usage shape; it is not in the official current `message_delta.usage` type. [6][16][27][28]
- `message_stop`: `{type:"message_stop"}`. `ping` data is `{type:"ping"}`. [6]

Current TypeScript SDK v1.3.0's `content_block_start.content_block` union includes: `text`, `thinking`, `redacted_thinking`, `tool_use`, `server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`, `advisor_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`, `tool_search_tool_result`, `mcp_tool_use`, `mcp_tool_result`, `container_upload`, `compaction`, `fallback`, and `mcp_tool_listing`. This is the current SDK's exact generated union, not a promise that Anthropic will never add another variant. `server_tool_use` has an `srvtoolu_…` ID, tool name, input and optional caller. Text blocks can carry citations; `redacted_thinking` carries opaque `data`. The API streaming docs describe block-level server/tool content and the SDK has the current exhaustive union. [6][27][28]

The `citations_delta` payload is `{type:"citations_delta", citation}`; the citation union carries a location type and its location-specific fields, including character/page/block positions, or web/search-result location data. `thinking_delta` carries incremental thinking text and can carry the optional estimated token hint; `compaction_delta` carries nullable text and opaque encrypted metadata. `input_json_delta.partial_json` is a fragment string, not complete JSON; fine-grained streaming can emit incomplete or invalid JSON, so only parse after accumulation and block close. A thinking block's signature arrives as a final `signature_delta` immediately before its block stop. [6][13][27][28]

Anthropic explicitly says new SSE event types may be added and clients should handle unknown event types gracefully. The API versioning policy also permits additional enum values. [3][6]

**Pi comparison.** Pi accepts the six core message/block SSE names, catches `error`, and silently skips other SSE event names; this is forward compatible for unknown named events. It does not emit a user-visible ping event. [29] Pi: L395-L401, L546-L550. Its event handler handles text, tool-input JSON, thinking and signature deltas only; it does not handle `citations_delta` or `compaction_delta`. Its content-block handler handles text/thinking/redacted-thinking/tool-use plus a special `fallback`, but drops the other official current server/MCP/tool blocks. [29] Pi: L730-L840.

Pi also reads `event.usage.cache_creation` from `message_delta` via an unchecked cast, including `ephemeral_1h_input_tokens`. The current official SDK `BetaMessageDeltaUsage` type does **not** declare `cache_creation`; that breakdown is in the response/message usage type. The cast therefore relies on an undocumented proxy/runtime extension. Pi stores total cache writes and the 1h count, not a first-class 5m count. [16][27][28][29] Pi: L724-L725, L862-L871; SDK TS L6119-L6238, L2910-L2942; Python `beta_message_delta_usage.py` L14-L89 and `beta_usage.py` L14-L81.

## 3. Stop reasons

**Verified facts.** The public stop-reason guide lists seven ordinary values: `end_turn` (natural completion), `max_tokens` (output cap), `stop_sequence` (configured stop sequence), `tool_use` (client tool call; run it and return results), `pause_turn` (server-tool loop paused; send the assistant content back to continue), `refusal` (declined response; inspect `stop_details`), and `model_context_window_exceeded` (context limit; treat as truncated). [7]

`compaction` is also a current official value for the compaction betas: threshold compaction can pause after writing its summary, and on-demand compaction returns the compaction block alone with `stop_reason: "compaction"`. Relevant headers differ: `compact-2026-01-12` for threshold compaction; `compact-2026-09-04` for on-demand compaction. [8] Current SDK `BetaStopReason` also types `compaction`, so the current combined list is those eight values. [27][28]

**Pi comparison.** Pi maps the six common values except `model_context_window_exceeded` and `compaction`; its default branch throws `Unhandled stop reason`. It maps `pause_turn` to a generic stop, though its output retains `rawStopReason`, and treats `refusal` as an internal error even though the public API returns a successful response. It additionally handles `sensitive`, which is not in the current Anthropic SDK stop-reason union or public stop-reason guide; its official Anthropic status is **UNVERIFIED**. [29] Pi: L1664-L1688. Since stop-reason enum values may grow, the throwing default is not forward compatible. [3]

## 4. Extended/adaptive thinking, effort, signatures, and sampling parameters

**Verified facts.** Manual extended thinking is `thinking: {type:"enabled", budget_tokens:N}`; the budget is at least 1,024 and less than `max_tokens` (except the documented manual interleaving case). It is deprecated on Claude 4.6 models and rejected by Claude 4.7+; Claude 4.5 and earlier models that support thinking use the manual mode. Adaptive thinking is `thinking: {type:"adaptive"}` and is available on newer models; API Model capabilities expose the supported thinking types per model. `thinking: {type:"disabled"}` and `between_tools` are also model-specific, not universal switches. [9][10][19]

`output_config.effort` is the location of effort. Top-level effort is GA and needs no beta; accepted levels are `low`, `medium`, `high`, `xhigh`, and `max`, with support varying by model. The Models API exposes per-level capability flags. Per-message effort changes use a `role:"system"` message with `output_config.effort` and require `mid-conversation-output-config-2026-07-01`; support is limited to documented models. [11][19]

Model support is model-specific. The current thinking table says adaptive is accepted by Opus/Sonnet/Haiku 5.5, Fable/Mythos 5 and 5.1, Opus/Sonnet 5, Opus 4.7/4.8, Opus/Sonnet 4.6, and Mythos Preview. Opus 4.8/4.7/4.6 and Sonnet 4.6 default to thinking off but accept adaptive; the newer 5.x families generally default to adaptive. Manual `enabled` remains for Mythos Preview, deprecated Opus/Sonnet 4.6, and the listed 4.5 Opus/Sonnet/Haiku models; 4.7+ reject it. For the curated IDs specifically: Opus 5.5, Fable 5.1 and Sonnet 5.5 reject `disabled`; Sonnet 5.5 accepts `between_tools`; Haiku 5.5 accepts `disabled` at `high` effort or below. Effort availability and `xhigh`/`max` are model-specific; query each model's `capabilities.effort` and `capabilities.thinking.types` rather than hardcoding a global matrix. [9][10][11][19]

Adaptive thinking interleaves around tool calls automatically; no interleaved beta header is needed for it. The legacy `interleaved-thinking-2025-05-14` remains effective for manual thinking on older eligible models, is deprecated for manual Sonnet 4.6, and has no manual-mode effect on Opus 4.6. [9][10]

Thinking `signature` values and redacted-thinking `data` are opaque. Replay thinking and redacted-thinking blocks unchanged and in their original order; do not drop or edit blocks from the latest assistant turn. On preserved-thinking models, the API also binds blocks to the preceding system prompt, tools and messages. A prefix mismatch can be a 400 unless the `thinking-binding-controls-2026-08-01` beta is used with `block_binding.prefix_mismatch_behavior: "drop_block"`; pass redacted blocks back unchanged too. [1][10][25]

As of API version `2026-10-21`, `temperature`, `top_p`, and `top_k` are removed from Messages requests and any of them causes 400 on every model. Thus thinking-related sampling restrictions are moot for a client using the recommended current API version: do not send these fields at all. [3]

**Pi comparison.** Pi implements both thinking forms and sends `block_binding` under the thinking-binding beta. It defaults its thinking display to `summarized`, while new model families default to `omitted`; this is a deliberate behavior difference, not a protocol mismatch. Pi's generic disabled-thinking path can send `type:"disabled"`; Anthropic rejects that for Opus 5.5, Fable 5.1 and Sonnet 5.5, all in Nukular's curated list. [9][10][25] Pi: L196-L203, L247-L277, L1274-L1305.

Pi sends `temperature` when the caller sets it and compatibility flags allow it. That is incompatible with API version `2026-10-21`; top_p/top_k are not sent in this adapter. Pi's per-message effort beta and `block_binding` are official features, but `output_config.effort` alone is GA. [3][11][29] Pi: L1251-L1256, L1280-L1288, L1572-L1576, L1138-L1152.

## 5. Beta headers and undocumented Pi behavior

Anthropic says to use the exact per-feature beta name; multiple values are comma separated. Unsupported or inaccessible beta names return 400. There is no single exhaustive beta-name list on the API beta overview; the feature docs specify names. [12] The table below covers every relevant feature asked about and every name Pi derives in `getBetaFeatures`.

| Header / field | Public status as of 2026-10-26 | Pi behavior |
|---|---|---|
| `fine-grained-tool-streaming-2025-05-14` | Real legacy beta. The preferred current interface is per-tool `eager_input_streaming: true`; it enables fine-grained streaming for tools with the field unset. [13] | Derived only when tools exist and compatibility says eager input streaming is unsupported. By default Pi sets `eager_input_streaming: true` on every user tool, which is public and needs no beta. Pi's toggle is broader than selecting eager mode per tool. Pi L198, L226-L228, L1138, L1580-L1584, L1656. |
| `interleaved-thinking-2025-05-14` | Real legacy beta for manual extended thinking on supported older models; adaptive thinking already interleaves. [9][10] | Added for reasoning models when thinking is enabled and not flagged adaptive. This can still send the header on models where it is deprecated/ignored. Pi L199, L1140-L1145. |
| `server-side-fallback-2026-07-01` | Real beta. Supports `fallbacks:"default"` or up to three named models. It retries refusals, not rate limits/overloads. [24] | Derived when model metadata carries allowed fallbacks and sends the named list. Public behavior agrees, but the list must meet API limits and model compatibility. Pi L200, L1147, L1324-L1326. |
| `mid-conversation-output-config-2026-07-01` | Real beta for per-message effort; top-level `output_config.effort` is GA. [11] | Derived for compatibility-enabled models and writes system messages with per-turn effort. Pi L201, L1148-L1149, L1203, L1572-L1576. |
| `thinking-binding-controls-2026-08-01` | Real beta; enables `input_transformations` and `thinking.block_binding`. [25] | Derived together with the per-message effort feature; uses `drop_block`. Pi L202, L1148-L1149, L1280-L1284. |
| `inline-tools-2026-09-15` | Real beta for mid-conversation tool additions/removals by value, as well as reference changes. [23] | Derived for native tool changes and emits `tool_addition` / `tool_removal`. Pi L203, L1151, L1198-L1199, L1260-L1265, L1380-L1410. |
| `context-management-2025-06-27` | Real beta for `context_management.edits` (clear old tool uses/thinking). [22] | Not derived or used in this file. |
| `compact-2026-01-12`, `compact-2026-09-04` | Real betas for threshold and on-demand compaction respectively; distinct public request shapes. [8] | Not derived or used in this file. |
| `tool_search_tool_regex_20251119`, `tool_search_tool_bm25_20251119`; `defer_loading` | Public tool definitions and deferred loading; the tool-search guide does not require an `anthropic-beta` header. [21] | Pi has no tool-search tool in this adapter, but it inserts a synthetic deferred placeholder for cache stability. The placeholder is a normal deferred tool object; the claim that the model can never discover/activate it is Pi-internal and not guaranteed by the public docs. Pi L206-L218, L1198-L1199, L1260-L1265, L1380-L1410. |
| `mid-conversation-tool-changes-2026-07-01` | Still documented for reference-only tool changes; newer `inline-tools-2026-09-15` adds by-value definitions. [23] | Pi uses the newer inline-tools header, not this older header. |
| `thinking-display-updates-2026-08-18` | Public beta for `thinking.display:"updates"`. [10] | Pi exposes only `summarized` and `omitted`; does not derive this beta. Pi L194-L196, L279. |
| `thinking-token-count-2026-05-13` | The official TypeScript SDK's `BetaThinkingDelta` comment says `estimated_tokens` is present when this beta is set. **UNVERIFIED as a public feature/header:** no matching public feature page was found in the official docs fetched for this report. [27] | Pi neither derives this header nor consumes `estimated_tokens`; it ignores the optional field. Pi L773-L840. |
| `structured-outputs-2025-11-13` (legacy `output_format`) | Public migration page says the old `output_format` parameter requires this beta; current `output_config.format` is GA and requires none. [14] | Pi does not emit either response schema parameter/header in this adapter. The official TS beta `messages.parse()` helper instead appends `structured-outputs-2025-12-15`; that helper-specific string differs from the public legacy-field migration value and is not needed for raw `output_config.format`. **The docs do not explain this difference.** TS SDK v1.3.0 `messages.ts` L182-L193. |
| `claude-code-20250219`, `oauth-2025-04-20` | **UNVERIFIED as public API beta names.** Public API authentication documents API keys, Workload Identity Federation and App Attest, not Claude Code subscription OAuth. [20] | Pi adds both for a token it recognizes as OAuth and uses Claude Code identity headers. This is Pi/Claude Code integration behavior, not an established public API-key-provider contract. Pi L1006-L1008, L1044-L1064, L1137-L1138. |

The official documentation does not document `x-session-affinity` or OpenRouter's `x-session-id` as Anthropic beta features or API headers; see item 10. Pi's own configurable beta-header override can of course send arbitrary names, but that does not make them valid Anthropic features. [12][29] Pi: L1111-L1126.

## 6. Strict tools and structured outputs

**Verified facts.** `strict: true` is a tool-definition field and structured response formats use `output_config.format: {type:"json_schema", schema:…}`. Both structured outputs and strict tool use are GA on their documented supported models; neither needs a beta header. Current model-specific support is discoverable through `capabilities.structured_outputs`. [14][15][19]

The supported subset includes basic JSON types, scalar `enum`, `const`, `anyOf` and restricted `allOf`, local `$ref`/definitions, `default`, `required`, `additionalProperties:false`, selected string formats, and `minItems` values 0 or 1. Recursive schemas, external `$ref`, complex enum values, numeric constraints, string length constraints, array limits other than the permitted `minItems`, and `additionalProperties` other than false are unsupported. Unsupported schema features cause 400 with details. [14]

Current published limits are 20 strict tools, 24 optional parameters total, and 16 union-typed parameters across all strict schemas in a request. If internal grammar-size limits are exceeded, public docs give the exact generic 400 message `Schema is too complex for compilation.` For the explicit count limits, docs say the API returns a 400 describing which limit was exceeded but do not publish exact strings. [14]

**Pi comparison.** Pi adds `strict:true` to tool definitions when compatibility/sampling says it is supported, but this API function does not populate `output_config.format`. It retries a preferred strict-tool request as non-strict only when error strings contain `The compiled grammar is too large`, `Too many strict tools (`, or `Schemas contains too many parameters with union types (`. Those exact substrings are not the current public documented messages; matching them is **UNVERIFIED** against current Anthropic error output and can miss the documented generic grammar message. [29] Pi: L670-L682, L1589-L1659. The selected compatibility layer should use documented feature support/limits and not assume unpublished error text.

## 7. Prompt caching

**Verified facts.** Caching is GA. Explicit `cache_control` can be attached to cacheable blocks in `tools`, `system`, and `messages`; a tool breakpoint on the last tool caches preceding tool definitions. Automatic caching uses a top-level `cache_control`. A request can contain at most four breakpoints total, including an automatic breakpoint. `type:"ephemeral"` defaults to 5 minutes; `ttl:"1h"` is currently supported at additional cost and is not a beta. Usage includes `cache_creation_input_tokens`, `cache_read_input_tokens`, and `cache_creation` with `ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`; the aggregate write value equals the two breakdown values. [16][1][27][28]

**Pi comparison.** Pi uses explicit breakpoints on system text, the last eligible message block and the last tool; `cacheRetention:"long"` selects `1h` if compat allows it. This matches official placement/TTL behavior in ordinary requests. [29] Pi: L73-L97, L1228-L1244, L1259-L1270, L1529-L1555, L1659. Caveats: its `message_delta.usage.cache_creation` read is an undocumented cast (item 2); and the implementation's maximum possible markers should remain within the official four-breakpoint cap if multiple cacheable segments are added. The latter is a guardrail, not an observed current overrun.

## 8. Image input and documents/PDF

**Verified facts.** Images may use a base64 source (`media_type` exactly `image/jpeg`, `image/png`, `image/gif`, or `image/webp`), a URL source, or a Files API `file_id`. Current direct API guidance sets a 10 MB base64 image limit, 8,000×8,000 maximum source dimensions, and 32 MB maximum total Messages request size. A request with more than 20 image blocks imposes a 2,000-pixel-per-dimension limit; the API allows 100 images for 200k-context models and 600 on other models, although the request-byte cap often binds first. High-resolution models have their own downsampling tier; ordinary models are also downsampled. [1][2][17]

PDFs use `document` blocks with base64, URL, or file ID. The complete request is limited to 32 MB; page limit is 600, or 100 when the context window is below 1M tokens. [18]

**Pi comparison.** Pi emits only base64 image blocks for JPEG/PNG/GIF/WebP and flattens text/image content; it does not pass through URL/File image sources or document/PDF blocks in this adapter. It therefore agrees for its supported image subset, but the broader official input union is absent. [29] Pi: L138-L181. PDF/document support is noted here only; no implementation recommendation is implied.

## 9. Models API, authentication, and model IDs

**Verified facts.** `GET /v1/models` supports `after_id`, `before_id`, and `limit` (default 20, min 1, max 1000), and returns `has_more`, `first_id`, and `last_id`. It now exposes `capabilities` (nullable), including model support for image/PDF input, structured outputs, server tools, context-management strategies, thinking modes, and each effort level, as well as `max_input_tokens` and `max_tokens`. It also includes ID, display name, lifecycle, release/deprecation/retirement metadata and model line. [19]

Models API requests use the same direct API auth modes and require the API-version header. `Authorization: Bearer <API key>` is shown in the current endpoint example; `x-api-key` remains accepted. A bearer token from public Workload Identity Federation is also valid. This is not a public Claude subscription-login/OAuth flow: WIF exchanges a cloud/OIDC identity for a short-lived Claude API token; App Attest is another documented token path. [2][3][20]

**Curated IDs.** The four Anthropic raw API IDs used by the curated Nukular list—`claude-opus-5-5`, `claude-fable-5-1`, `claude-sonnet-5-5`, `claude-haiku-5-5`—are all present in official current API docs as IDs (in API examples, model compatibility or supported-model metadata). Thus they are consistent. Nukular's `claude/` prefix is its provider/model notation; send the suffix as the Anthropic API `model`. [9][11][19] `.project/references/models.md` L44-L47.

**Other official-document example/catalog IDs surfaced here (not recommendations):** `claude-sonnet-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5-20251101`, `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `claude-fable-5`, `claude-mythos-5-1`, `claude-mythos-5`, and `claude-mythos-preview`. These appear in examples, feature-support lists or compatibility tables; this list does not recommend adoption. [9][10][11][14][19][24]

**Pi comparison.** The adapter sends `model.id` through to the API. Its provider-key branch accepts regular key auth; Pi's special `sk-ant-oat` branch is separate and should not be treated as part of this API-key-provider contract. [29] Pi: L1006-L1008, L1010-L1108, L1215-L1218.

## 10. Session affinity

**Verified fact.** The current official API reference, API overview/authentication, response-header and rate-limit docs provide no documented `x-session-affinity` header, no documented affinity semantics, and no official persistence guarantee for a client-supplied affinity ID. I did not find a public Anthropic contract for this header. Since the configured web-search service timed out, this conclusion is limited to the inspected official documentation; any undocumented/internal use is **UNVERIFIED**. [1][2][5][12]

**Pi comparison.** Pi can send `x-session-affinity` for a custom compatibility model and sends `x-session-id` in its OpenRouter compatibility mode. By default the affinity option is enabled only when it detects OpenRouter. This is proxy/provider-specific behavior and must not be advertised as Anthropic API behavior. [29] Pi: L223-L233, L1065-L1075.

## 11. Tool choice, tool-result adjacency, and images in error results

**Verified facts.** `tool_choice` supports `auto`, `any`, `tool` with a name, and `none`. `disable_parallel_tool_use` is accepted on `auto`, `any`, and `tool`: it limits `auto` to at most one tool call and makes `any`/`tool` exactly one. Forced `any`/named-tool choice is not supported on Claude Opus 5.5, Sonnet 5.5, Fable 5.1, or Mythos 5.1; `auto` and `none` remain available. Manual extended thinking also disallows forced tool choice. [26][27]

For client tool use, the assistant emits `tool_use`; the next message must be a `user` message with corresponding `tool_result` block(s), with no intervening messages. Tool-result blocks must come first in that user content array; any text follows them. `is_error:true` signals tool execution failure. A successful tool result may contain text and image blocks. [26][1]

**UNVERIFIED: images inside `is_error:true` results.** The current public API reference types `is_error` as optional and separately allows `tool_result.content` to contain image blocks; it does not state a conditional prohibition on images when `is_error` is true. Whether the live API currently rejects that combination is not established by public docs or these SDK types. [1][27]

**Pi comparison.** Pi maps the four tool-choice forms, serializes tool results as `user` content and groups consecutive results. Its public option type does not expose `disable_parallel_tool_use` (it has only the string choices and `{type:"tool", name}`), so the standard API cannot request the documented parallel-call restriction without a lower-level payload override. Pi explicitly moves images out of error results (adding a caption) because its code comments say Anthropic rejects non-text error results. That workaround is not corroborated by the public schema, so retain it as an **UNVERIFIED runtime constraint**, not a documented protocol rule. Pi: L292-L293, L1312-L1321, L1337-L1344, L1365-L1368, L1503-L1518. Its compatibility layer does not itself prevent forced-tool requests on models where official docs say they return 400.

## Risks, caveats, and open questions

- The SearXNG `web_search` endpoint timed out during this run. The findings use directly fetched official documentation URLs and checked official SDK source. In particular, the absence of an official session-affinity header reference is a scoped documentation finding, not proof that no internal service ever uses one.
- SDK raw event types are versioned generated snapshots. The API's versioning policy explicitly permits additional enum values and stream event types; the Rust dialect should preserve/ignore unknown events and values where possible rather than fail on a closed union. [3][6]
- Current API docs still show many examples with `anthropic-version: 2023-06-01`; the official current versioning/migration pages recommend `2026-10-21`. The latter is the version used for the current-behavior findings here. [2][3]
- Pi-specific Claude Code OAuth headers, fallback error-substring matching, the placeholder's "never visible" claim, and the error-result-image rejection are not verified public Anthropic contracts.

## Sources

[1] Messages API — https://platform.claude.com/docs/en/api/messages/create (accessed 2026-10-26; current Messages reference).

[2] API overview — https://platform.claude.com/docs/en/api/overview (accessed 2026-10-26; current direct API headers/auth/pagination).

[3] API versioning — https://platform.claude.com/docs/en/api/versioning (accessed 2026-10-26; latest `2026-10-21`).

[4] Claude API errors — https://platform.claude.com/docs/en/api/errors (accessed 2026-10-26; current status/error shapes).

[5] Rate limits — https://platform.claude.com/docs/en/api/rate-limits (accessed 2026-10-26; current Retry-After and spend-cap behavior).

[6] Streaming messages — https://platform.claude.com/docs/en/build-with-claude/streaming (accessed 2026-10-26; current SSE contract and forward compatibility).

[7] Stop reasons and fallback — https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons (accessed 2026-10-26; standard stop-reason meanings).

[8] Compaction at a token threshold — https://platform.claude.com/docs/en/build-with-claude/compaction-threshold and Compaction on demand — https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand (accessed 2026-10-26; `compaction` stop reason and beta headers).

[9] Extended thinking — https://platform.claude.com/docs/en/build-with-claude/extended-thinking (accessed 2026-10-26; manual budget rules and interleaved legacy behavior).

[10] Thinking — https://platform.claude.com/docs/en/build-with-claude/thinking (accessed 2026-10-26; model thinking modes, display, signatures and streaming).

[11] Effort — https://platform.claude.com/docs/en/build-with-claude/effort (accessed 2026-10-26; GA effort and per-message beta).

[12] Beta headers — https://platform.claude.com/docs/en/api/beta-headers (accessed 2026-10-26; beta header behavior and validation).

[13] Fine-grained tool streaming — https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming (accessed 2026-10-26; `eager_input_streaming` field and legacy beta).

[14] Structured outputs — https://platform.claude.com/docs/en/build-with-claude/structured-outputs (accessed 2026-10-26; GA JSON schema, subset, complexity limits and legacy header).

[15] Strict tool use — https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use (accessed 2026-10-26; `strict:true` contract).

[16] Prompt caching — https://platform.claude.com/docs/en/build-with-claude/prompt-caching (accessed 2026-10-26; placement, four breakpoints, TTL and usage).

[17] Vision — https://platform.claude.com/docs/en/build-with-claude/vision (accessed 2026-10-26; image formats, sources and limits).

[18] PDF support — https://platform.claude.com/docs/en/build-with-claude/pdf-support (accessed 2026-10-26; document source/page/request limits).

[19] Models API — https://platform.claude.com/docs/en/api/models/list (accessed 2026-10-26; pagination and current capability fields).

[20] Authentication — https://platform.claude.com/docs/en/manage-claude/authentication (accessed 2026-10-26; API key, WIF, App Attest and legacy x-api-key).

[21] Tool search tool — https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool (accessed 2026-10-26; variants and `defer_loading`).

[22] Context editing — https://platform.claude.com/docs/en/build-with-claude/context-editing (accessed 2026-10-26; context-management beta).

[23] Mid-conversation system messages and tool changes — https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages (accessed 2026-10-26; `inline-tools` and `tool_addition`).

[24] Refusals and fallback — https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback (accessed 2026-10-26; server-side refusal fallback).

[25] Preserved thinking — https://platform.claude.com/docs/en/build-with-claude/preserved-thinking (accessed 2026-10-26; signature replay, prefix binding and thinking-binding beta).

[26] Handle tool calls — https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls (accessed 2026-10-26; adjacency and `is_error`).

[27] Official Anthropic TypeScript SDK, `src/resources/beta/messages/messages.ts` — https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808/src/resources/beta/messages/messages.ts (v1.3.0, latest commit 2026-10-23; raw event union L6311-L6445, usage L6119-L6238, cache types L2910-L2942, citations delta L3281-L3292, compaction delta L3758-L3766, server-tool usage L6877-L6907, stop reasons L6965-L6974, thinking delta L7344-L7365, strict/tool/cache types L7488-L7560 and L7696-L7748, parse beta header L182-L193).

[28] Official Anthropic Python SDK, `src/anthropic/types/beta/` — [raw event union](https://github.com/anthropics/anthropic-sdk-python/blob/202db72c87d7/src/anthropic/types/beta/beta_raw_message_stream_event.py#L14-L24), [block-delta union](https://github.com/anthropics/anthropic-sdk-python/blob/202db72c87d7/src/anthropic/types/beta/beta_raw_content_block_delta.py#L1-L19), [block-start union](https://github.com/anthropics/anthropic-sdk-python/blob/202db72c87d7/src/anthropic/types/beta/beta_raw_content_block_start_event.py#L1-L56), [message-delta event](https://github.com/anthropics/anthropic-sdk-python/blob/202db72c87d7/src/anthropic/types/beta/beta_raw_message_delta_event.py#L1-L90), [message-delta usage](https://github.com/anthropics/anthropic-sdk-python/blob/202db72c87d7/src/anthropic/types/beta/beta_message_delta_usage.py#L14-L89), [stop-reason literal](https://github.com/anthropics/anthropic-sdk-python/blob/202db72c87d7/src/anthropic/types/beta/beta_stop_reason.py#L1-L11), [tool params](https://github.com/anthropics/anthropic-sdk-python/blob/202db72c87d7/src/anthropic/types/beta/beta_tool_param.py#L13-L75), and [message usage](https://github.com/anthropics/anthropic-sdk-python/blob/202db72c87d7/src/anthropic/types/beta/beta_usage.py#L14-L81) (v2.3.0, latest commit 2026-10-23).

[29] Pi reference implementation named in the brief — `.references/pi/packages/ai/src/api/anthropic-messages.ts` at upstream revision `66c2fa3d` (local source comparison; cited inline by path and line).
