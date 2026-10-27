---
document:
  type: "analysis"
  id: "anthropic-messages-pi-reference-inventory"
  title: "anthropic-messages contract inventory at pi 66c2fa3d"
  description: "Per-row source locations, behavior summaries, revision delta and offline/live test provenance in the pi reference clone for the anthropic-messages dialect implementation (plan 0005, contract rows 1-12)."
  status: "published"
  revision: 3
  created_at: "2026-10-26T13:58:00+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "pi"
  updated_by: "pi"
  source: "nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/plans/0005-provider-expansion/contract/reference-map-pi-anthropic.md"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["document creation"]
      updated_at: "2026-10-26T13:58:00+01:00"
    - revision: 2
      reason: "frontmatter migration"
      changes: ["migrate flat frontmatter to the document block"]
    - revision: 3
      reason: "imported into pi-auth-plus"
      changes: ["copied from nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/plans/0005-provider-expansion/contract/reference-map-pi-anthropic.md"]
---

# anthropic-messages contract inventory at pi `66c2fa3d`

Reference: `.references/pi` at detached `66c2fa3d` (previous revision compared against: `e28e708`).
All paths below are relative to `.references/pi/` unless absolute. Line numbers are from the new revision.

## How the delta was computed, and its one limitation

`.references/pi` is a **shallow** clone (`git rev-parse --is-shallow-repository` -> `true`, `git rev-list --count HEAD` -> `1`). Consequences:

- `git cat-file -t e28e708` -> `commit`, and `git diff e28e708 HEAD -- <path>` works: both trees are present as objects.
- `git log e28e708..HEAD` walks nothing useful (prints only `66c2fa3d`). **Individual commits between the two revisions cannot be attributed.** The deltas below are tree-to-tree diffs only, which is sufficient for behavior comparison but gives no commit messages or PR numbers.

Files that matter for this inventory, with their sizes at the new revision:

| File | Lines | In `packages/ai/src` diff e28e708->HEAD |
|---|---|---|
| `packages/ai/src/api/anthropic-messages.ts` | 1690 | yes, 142 lines changed |
| `packages/ai/src/providers/compat-schema.ts` | 664 | yes, +20 (SystemOne only; Anthropic schema untouched) |
| `packages/ai/src/api/transform-messages.ts` | 256 | no |
| `packages/ai/src/api/constrained-sampling.ts` | 418 | yes, grammar-tool only (no Anthropic impact) |
| `packages/ai/src/utils/transcript.ts` | 267 | yes, transport refactor (Anthropic not using it) |
| `packages/ai/src/utils/streaming-json.ts` | new | yes, new file |
| `packages/ai/src/utils/identity.ts` | new | yes, new file |
| `packages/ai/src/utils/pi-user-agent.ts` | deleted | removed |

Three offline fixture patterns are used by nearly every anthropic test, and all are directly portable to Rust as captured wire bytes:

1. **Payload capture** - pass `onPayload` that records the params and throws; the request never leaves the process (`anthropic-mid-conversation-effort.test.ts:64-84`).
2. **Injected client** - `options.client` = a stub whose `beta.messages.create().asResponse()` returns a hand-built `Response` containing SSE text (`anthropic-sse-parsing.test.ts:13-89`).
3. **Local HTTP server** - `node:http` server on `127.0.0.1:0` records headers+body and answers with an empty SSE stream (`anthropic-eager-tool-input-compat.test.ts:56-103`).

---

## Row 1 - Compat registration

**Source.** `packages/ai/src/providers/compat-schema.ts:416-501` (`AnthropicMessagesCompatSchema`, `additionalProperties: true`), registered in `CompatSchemasByApi` at `:620-630` under key `"anthropic-messages"` (`:625`); exported interface at `:658`.

| Field | Lines | Type | Default |
|---|---|---|---|
| `supportsEagerToolInputStreaming` | 418-424 | `Type.Boolean` | `true` |
| `supportsLongCacheRetention` | 425-428 | `optionalCompatBoolean` | `true` |
| `sendSessionAffinityHeaders` | 429-432 | `optionalCompatBoolean` | none in schema; runtime `isOpenRouter` |
| `sessionAffinityFormat` | 433-438 | `Type.Optional(Type.Literal("openrouter"))` | `"openrouter"` when `isOpenRouter`, else unset |
| `supportsCacheControlOnTools` | 439-445 | `Type.Boolean` | `true` |
| `supportsTemperature` | 446-452 | `Type.Boolean` | `true` |
| `forceAdaptiveThinking` | 453-459 | `Type.Boolean` | `false` |
| `allowEmptySignature` | 460-465 | `Type.Boolean` | `false` |
| `supportsStrictTools` | 466-472 | `Type.Boolean` | `false` |
| `supportsMidConvoEffort` | 473-479 | `Type.Boolean` | `false` |
| `supportsMidConvoSystemMessages` | 480-484 | `optionalCompatBoolean` | `false` |
| `supportsMidConvoToolChanges` | 485-491 | `Type.Boolean` | `false` |
| `allowedFallbackModels` | 492-498 | `Type.Array(AnthropicAllowedFallbackModelSchema)`, `maxItems: 3` | absent |

`AnthropicAllowedFallbackModelSchema` at `:171-178`: `{ provider: string(minLength 1), model: string(minLength 1), cost: ModelCostSchema }`.

Two schema details worth deciding explicitly for the Rust port:

- The Anthropic schema **narrows** `sessionAffinityFormat` to the single literal `"openrouter"`, while the API-agnostic superset (`SessionAffinityFormatSchema`, `:8-10`) allows `openai | openai-nosession | openrouter`. A Rust `SessionAffinityFormat` exposing all three variants for this dialect accepts values pi rejects here.
- Provider-level compat (`ProviderCompatSchema`, `:637-640`) merges every API schema plus overrides (`:540-572`, `mergeCompatProperties` `:591-617`). The merge **throws** when a duplicated property lacks an explicit override. The provider superset carries `supportsMidConvoEffort`, `supportsMidConvoSystemMessages`, `sessionAffinityFormat`, `supportsLongCacheRetention`, `sendSessionAffinityHeaders`, `supportsStrictMode` with generic descriptions and no API-specific defaults.

**Runtime resolution.** `packages/ai/src/api/anthropic-messages.ts:223-237` `getAnthropicCompat()` re-applies the defaults listed above. It deliberately **does not** resolve `forceAdaptiveThinking`, `supportsMidConvoEffort`, or `allowedFallbackModels`; those are read straight from `model.compat` at their use sites (`:1027`, `:1141`, `:1145`, `:1211`, `:1266`, `:1283`, `:1321-1324`). There is no validation layer: a wrong-typed compat value reaches the use site and fails there, or is silently falsy.

**vs. e28e708.** Unchanged. The only `compat-schema.ts` delta is `SystemOneCompatSchema` (`:524-538`), two new `CompatSchemasByApi` entries, and the `SystemOneCompat` interface.

**Tests (offline, pure metadata).**
- `packages/ai/test/compat-schema.test.ts:15` "preserves property types in the provider superset", `:22` "preserves API-specific defaults", `:33` "does not assign API-specific defaults to the provider superset".
- `packages/ai/test/providers.test.ts:102` asserts `getBuiltinModel("anthropic","claude-haiku-4-5").compat?.supportsStrictTools === true`.

---

## Row 2 - Streaming and retention

**Source.**
- `supportsEagerToolInputStreaming`: schema `compat-schema.ts:418-424`; default `anthropic-messages.ts:226`; consumed at `:1183` -> `convertTools` `:1622-1662`, emitted per tool as `eager_input_streaming: true` at `:1657`; legacy beta when false at `:1580-1582` (`shouldUseFineGrainedToolStreamingBeta` = "current tools exist AND eager streaming is off") feeding `:1138` with constant `:198` `fine-grained-tool-streaming-2025-05-14`.
- `supportsLongCacheRetention`: schema `:425-428`; default `:227`; used only for TTL selection at `:91` - `ttl = retention === "long" && supportsLongCacheRetention ? "1h" : undefined`.
- Retention resolution `:73-81` `resolveCacheRetention()`: explicit option wins, else env `PI_CACHE_RETENTION === "long"`, else `"short"`. `"none"` returns before `cacheControl` is built (`:85-88`).

**vs. e28e708.** No behavioral change in this path; only the header merge moved (see row 3).

**Tests.**
- `anthropic-eager-tool-input-compat.test.ts:107` "sends per-tool eager_input_streaming by default", `:114` "uses the legacy fine-grained tool streaming beta when eager tool input streaming is disabled", `:121` "does not send the legacy fine-grained tool streaming beta when there are no tools" - **offline** (local HTTP server).
- `cache-retention.test.ts:99` "should add ttl for non-api.anthropic.com baseUrl by default", `:138` "should omit ttl when supportsLongCacheRetention is false", `:167` "should omit cache_control when cacheRetention is none", `:191` "should add cache_control to string user messages", `:217` "should set 1h cache TTL when cacheRetention is long" - **offline but not hermetic**: `:99` starts a request against `https://my-proxy.example.com/v1` and swallows the failure after capturing the payload (one outbound DNS attempt per run).
- **Live:** `anthropic-eager-tool-input-e2e.test.ts:127/136/146`, `anthropic-long-cache-retention-e2e.test.ts:111/122` (both gated on per-model API keys), `cache-retention.test.ts:53` and `:77` (`skipIf(!process.env.ANTHROPIC_API_KEY)`), `anthropic-opus-4-8-smoke.test.ts:24-25`.

---

## Row 3 - Affinity and tool caching

**Source.**
- Defaults `anthropic-messages.ts:224` (`isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai")`), `:228-229`.
- Header emission `:1066-1077` in `createClient()`: only when the cache session id is present **and** `sendSessionAffinityHeaders`; header name is `x-session-id` for `"openrouter"`, else `x-session-affinity`.
- Cache suppression `:627` `const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;` -> affinity headers disappear with `None`, matching SPEC 16.3.
- Header precedence `:1072-1079`: `mergeHeaders(getIdentityHeaders(model, identity), {accept, anthropic-dangerous-direct-browser-access}, sessionAffinityHeaders, model.headers, optionsHeaders)` - later wins, so explicit caller headers override generated affinity.
- `supportsCacheControlOnTools`: `:230`, gate `:1259`, applied to **only the last tool** `:1659`.

**vs. e28e708.** `mergeClientHeaders()` (which injected `getPiUserAgent()` into every header set) was deleted and replaced by `mergeHeaders(getIdentityHeaders(model, identity), ...)`; the identity layer is new (`packages/ai/src/utils/identity.ts:141-143`: `{"User-Agent": formatUserAgent(identity), ...attribution}`). `pi-user-agent.ts` is gone. Affinity logic itself is unchanged.

**Tests (offline, local HTTP server - the only Anthropic-dialect affinity coverage).**
- `fireworks-models.test.ts:336` "sends x-session-affinity header for Fireworks models", `:346` "omits x-session-affinity header for native Anthropic models", `:355` "omits x-session-affinity header when cacheRetention is none", `:366` "sends only x-session-id for OpenRouter models", `:375` "omits OpenRouter session headers when cacheRetention is none", `:385` "allows OpenRouter session headers to be disabled", `:394` "omits cache_control on tools for Fireworks models", `:403` "omits eager_input_streaming on tools for Fireworks models", `:413` "sends cache_control on tools for native Anthropic models", `:423` "sends eager_input_streaming on tools for native Anthropic models".
- Metadata only: `fireworks-models.test.ts:189` "sets Fireworks-specific compat for session affinity and unsupported tool fields".
- Header precedence / user agent: `anthropic-auth-token.test.ts:202` "uses pi's User-Agent by default for Anthropic Messages requests", `:209` "lets explicit headers override the default Anthropic Messages User-Agent" - **offline** because the whole `@anthropic-ai/sdk` module is `vi.mock`ed (`:15-57`).

---

## Row 4 - Thinking and sampling

**Source.**
- `supportsTemperature`: `:231`; single gate `:1248-1257` - temperature is sent only when `options.temperature !== undefined && !options.thinkingEnabled && model.compat?.supportsMidConvoEffort !== true && compat.supportsTemperature`.
- `forceAdaptiveThinking`: `:453-459` in schema; read at `:1027` (`streamSimple` chooses native effort), `:1141` (suppresses the interleaved-thinking beta), `:1283` (adaptive branch).
- `allowEmptySignature`: `:232`; replay rule in `convertMessages` at `:1462-1487`: an empty/whitespace thinking signature becomes `{type:"thinking", thinking, signature:""}` when allowed, otherwise the thinking text is downgraded to a plain `{type:"text"}` block.
- Thinking modes in `buildParams` `:1275-1296`: `disabled` (`:1275-1278`, only reachable when `thinkingLevelMap.off !== null`, see `:1197`), managed-effort adaptive + `block_binding` (`:1279-1290`), `forceAdaptiveThinking` adaptive + optional native `output_config.effort` (`:1282-1287`), else budget thinking with `budget_tokens: options.thinkingBudgetTokens || 1024` (`:1290-1295`).
- Simple mapping `mapThinkingLevelToEffort` `:936-954` (`thinkingLevelMap` first, then minimal/low->low, medium->medium, high and default->high). Budget path `:993-1002`: `adjustMaxTokensForThinking` -> `clampMaxTokensToContext` -> `thinkingBudgetTokens = min(budget, max(0, maxTokens - 1024))`.
- Option surface `AnthropicOptions` `:239-299`: `thinkingEnabled`, `thinkingBudgetTokens`, `effort` ("low"|"medium"|"high"|"xhigh"|"max"), `thinkingDisplay` ("summarized"|"omitted"), `interleavedThinking`, `toolChoice`, `client`.

**vs. e28e708.** No change in any of these blocks.

**Tests (all offline, payload capture with `onPayload`).**
- `anthropic-temperature-compat.test.ts:68` "omits temperature for Claude Opus 4.7", `:74` (Opus 4.8), `:80` "omits default temperature for Claude Opus 4.7", `:86` "keeps temperature for Claude Opus 4.6", `:92` "keeps temperature for Claude Sonnet 4.6", `:98` "omits temperature for custom models with supportsTemperature disabled".
- `anthropic-force-adaptive-thinking.test.ts:71` "sends legacy thinking payload for custom model ids by default", `:78` "sends adaptive thinking payload when compat.forceAdaptiveThinking is true", `:85` "uses adaptive thinking with native xhigh effort for Claude Fable 5", `:92` "allows built-in adaptive models to opt out with compat.forceAdaptiveThinking false", `:103` "preserves thinking.type=disabled when reasoning is off regardless of override".
- `anthropic-empty-thinking-signature-compat.test.ts:82` "converts empty-signature thinking to text by default", `:88` "preserves empty thinking text when the signature is present", `:94` "preserves empty-signature thinking when allowEmptySignature is enabled", `:101` "allows empty thinking signatures for every Vercel AI Gateway model" (catalog assertion), `:108` `it.each` "preserves unsigned thinking for Fireworks %s" over 4 model ids.
- `anthropic-thinking-disable.test.ts:113` "sends thinking.type=disabled for budget-based reasoning models when thinking is off", `:120` (adaptive models), `:127` (Claude Opus 4.8), `:134` "omits thinking.type=disabled for Claude Fable 5 when thinking is off", `:141` (Opus 4.8 adaptive when enabled), `:148` (Sonnet 5), `:155` "maps xhigh reasoning to effort=xhigh for Claude Opus 4.8". `:163-164` is **live**.
- Metadata only: `anthropic-adaptive-thinking-models.test.ts:29`.

---

## Row 5 - Strict tools and the HTTP 400 Prefer downgrade

**Source.**
- Compat `supportsStrictTools` `:466-472`, default `:233`, fed into `convertTools` at `:1183`.
- Strict resolution `:1629-1641`: `resolveJsonSchemaStrictSampling(tool, supportsStrictTools, isAnthropicStrictUnsupportedKeyword)`; when the fallback flag is set, a `prefer` tool is forced non-strict before resolution.
- Anthropic keyword/format rejection `:1589-1620`: unsupported keywords `minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, maxItems, uniqueItems, minContains, maxContains, minProperties, maxProperties` with `minItems` allowed only for `0`/`1`, and `format` allowed only for `date-time, time, date, duration, email, hostname, uri, ipv4, ipv6, uuid`.
- Schema assembly `:1643-1661`: legacy `{type:"object", properties, required}` always; `strict === true` additionally spreads the projected schema (so `additionalProperties:false`, all-required, formerly-optional made nullable) and sets `strict: true`. Non-strict tools get only the legacy keys.
- **One-shot downgrade** `:645-696`: `for(;;)` -> `buildParams` (`:651`) -> `retryProviderRequest` (`:659`) -> on error, the gate at `:669-683` requires: not aborted, not already downgraded, `hasPreferredStrictTools`, `Anthropic.APIError`, `status === 400`, `type === "invalid_request_error"`, and the message containing one of `"The compiled grammar is too large"`, `"Too many strict tools ("`, `"Schemas contains too many parameters with union types ("`. Then `disablePreferredStrictTools = true` (`:685`) and a diagnostic `type: "anthropic_strict_tools_fallback"`, `details.reason: "strict_tool_limits_exceeded"` (`:686-692`).
- `hasPreferredStrictTools` is computed by re-inspecting the converted definitions against the source tools (`:1177-1196`) - only true for `strict === "prefer"` tools that actually became strict.
- `Require` is structurally excluded: `resolveJsonSchemaStrictSampling` throws for `require` instead of downgrading (`constrained-sampling.ts:240-264`), so those tools never set `hasPreferredStrictTools`.

**vs. e28e708.** Identical code (the 142-line diff does not touch this region).

**Tests (offline, custom `fetch` in stream options - `anthropic-strict-tool-fallback.test.ts:59-64`).**
- `:69` `it.each` over the three real provider messages - "retries %s with original non-strict schemas and preserves required tools": asserts two payloads, `diagnostics[0].type === "anthropic_strict_tools_fallback"`, only `prefer` downgraded while `require` stays `strict: true`, the trailing tool keeps `cache_control {type:"ephemeral", ttl:"1h"}`, `onPayload` runs twice and `onResponse` once, `stream: true` forced both times, and the stored transcript is byte-identical afterwards.
- `:128` "downgrades inline additions and same-name redefinitions without downgrading require".
- `:165` `it.each` ["required", "ordinary", "locally unsupported prefer"] "does not retry a %s tool set"; `:180` `it.each` ["unrelated 400", "wrong error type", "wrong HTTP status"] "does not downgrade on %s"; `:191` "surfaces a second rejection rather than retrying again"; `:206` "does not downgrade a hook exception, even if it looks like the provider rejection"; `:224` "honors cancellation before the fallback attempt"; `:238` "does not retry an SSE error after response headers"; `:251` "does not disable strict sampling on later requests"; `:261` "preserves prefer through pi-messages so the gateway's Anthropic adapter can fall back".
- `anthropic-strict-tool-schema.test.ts:71` "only sends the full input schema for strict JSON-schema tools", `:102` "sends prefer tools non-strict when they use keywords Anthropic strict mode rejects" - offline, payload capture.

---

## Row 6 - Effort and fallback metadata

**Source.**
- `supportsMidConvoEffort` `:473-479`; not in `getAnthropicCompat` - read as `model.compat?.supportsMidConvoEffort === true` at `:1211` (gate for `effortMessages`) and `:1148` (beta). `effortMessages` also requires `!thinkingDisabled` (`:1198-1200`).
- Effort markers: `activeEffort = options?.effort ?? "high"` (`:1212`); `insertThinkingLevelMessages` `:1564-1577` inserts `{role:"system", content:[], output_config:{effort}}` before each assistant that carries a replayed `providerThinkingLevel`, then one final marker with the active effort. Historical levels are collected during conversion into `ConvertedAnthropicMessages.assistantLevels` (`:1346-1349`, populated `:1489-1499`) only for same-provider `anthropic-messages` assistants with a valid `providerThinkingLevel`. `isAnthropicEffort` `:1560-1562`.
- `providerThinkingLevel` is returned from `buildParams` (`:1329`) and stamped on the reply (`:652-654`) so the next request can replay it.
- Managed-effort thinking payload `:1279-1290`: `thinking = {type:"adaptive", display: options.thinkingDisplay ?? "summarized", block_binding:{prefix_mismatch_behavior:"drop_block"}}` plus **top-level fixed** `params.output_config = {effort: "low"}`.
- `allowedFallbackModels` `:492-498`. Beta gate `:219-221` (`length > 0`) and `:1145` (`server-side-fallback-2026-07-01`, `:200`). Wire field `:1321-1324`: `params.fallbacks = allowedFallbackModels.map(f => ({model: f.model}))` - model id only, no provider.
- Fallback response attribution `:711-718`: if `message.model !== model.id`, look up the matching `allowedFallbackModels` entry and re-price with its `cost`; `responseModel` is recorded (`:711`). A mid-output `fallback` content block after content has begun is a hard error (`:731-736`).
- Beta constants `:198-203`; `getBetaFeatures` `:1111-1152`.

**vs. e28e708 - the three real behavior changes in the whole dialect, both in this row and row 3.**

1. **`output_config.effort` for managed-effort models changed `"high"` -> `"low"`** (`:1285-1289`). New comment: effort markers set the level for every reply, the top-level effort is part of the cached prompt so it stays fixed, and `"low"` is used because organizations can cap effort and reject requests containing any level above the cap. SPEC 16.3 does not describe this value or the reasoning.
2. **OpenRouter reported cost applied on `message_delta`** when `isOpenRouterModel(model)` (`:884-890`), via `packages/ai/src/utils/openrouter-cost.ts`.
3. **Client identity plumbing** (`options?.identity` -> `getIdentityHeaders`) - see row 3.

**Tests (offline, payload capture).**
- `anthropic-mid-conversation-effort.test.ts:92` "reconstructs an exact historical marker prefix and appends the current marker" (also asserts top-level `output_config: {effort:"low"}` on both requests), `:121` `it.each` over `low|medium|high|xhigh|max` "preserves native effort %s", `:128` "defaults omitted effort to high and still enables drop_block", `:139` "does not invent markers for legacy or other-provider assistants", `:151` "sends plain disabled thinking without effort when off is supported", `:175` "keeps adaptive thinking when off is unsupported", `:186` "leaves unsupported models on top-level effort", `:196` "sends the effort and binding beta headers", `:231` "generates exact model and transport gates", `:246` "supports off only on managed models that accept disabled thinking".
- `anthropic-sse-parsing.test.ts:205` "uses a returned fallback model for cost attribution", `:235` "fails safely when Anthropic falls back after output begins", `:307` "omits the interleaved-thinking beta when thinking is disabled", `:329` "passes managed beta features to injected clients" - offline, injected client.
- `anthropic-auth-token.test.ts:219` "preserves explicit Anthropic beta header replacement", `:228` "preserves explicit Anthropic beta header suppression" - offline.
- Metadata derivation lives in `packages/ai/scripts/generate-models.ts`: verified mid-convo-effort providers `:597-605`, allowed fallback table `:848-880`, `forceAdaptiveThinking`/`supportsTemperature` derivation `:1145-1150`. **Live:** `anthropic-thinking-binding-e2e.test.ts:34-35`.

---

## Row 7 - Native tool history

**Source.**
- Eligibility and request shape in `buildParams` `:1167-1272`: `initialTools = initialSystemMessage?.toolsAdded ?? []` (`:1195`); `nativeToolChanges = compat.supportsMidConvoSystemMessages && compat.supportsMidConvoToolChanges && initialTools.length > 0` (`:1196-1197`). The same flag also enables the inline-tools beta (`:1151`).
- `DEFERRED_TOOL_PLACEHOLDER` `:205-217`: `name: "__pi_deferred_placeholder__"`, `description: "Reserved placeholder. Never available. Never call this."`, `input_schema: {type:"object", properties:{}, required:[]}`, `defer_loading: true`. Comment (`:205-211`) explains why: Anthropic adds hidden prompt scaffolding for mid-conversation tool changes; declaring the placeholder from the first request keeps that scaffolding inside the cached prefix (measured full cache miss without it).
- Tools field `:1259-1272`: with native changes -> `[...convertToolDefinitions(initialTools, toolCacheControl), DEFERRED_TOOL_PLACEHOLDER]` (breakpoint on the last *initial* tool, placeholder after it); otherwise -> `convertToolDefinitions(getCurrentTools(context.messages), toolCacheControl)`, omitted entirely when empty.
- `tool_addition` / `tool_removal` emission `:1378-1400` inside the system-message branch: text update first, then removals (`{type:"tool_removal", tool:{type:"tool_reference", name}}`), then additions (`{type:"tool_addition", tool:{type:"tool_definition", definition}}`); a same-name redefinition skips the removal (`:1386-1389`).
- Transcript projection: `:589` `resolveTranscript(context, getAnthropicCompat(model).supportsMidConvoSystemMessages)` -> `utils/transcript.ts:118-121` (`collapseSystemMessages` when unsupported). `getCurrentTools` `transcript.ts:58-71`, `getInitialSystemMessage` `:47-51`, `renderSystemMessageUpdate` `utils/text.ts:28-42`.

**vs. e28e708.** The dialect file logic is unchanged. `transcript.ts` was refactored (new `TranscriptToolSupport` `"none"|"additions"|"changes"` `:230`, `resolveTranscriptTools` `:252-267`, `findLastNonAdditiveToolChange` `:205-228`) but **`anthropic-messages.ts` does not call `resolveTranscriptTools`** - it still uses `resolveTranscript` + `getInitialSystemMessage` + `getCurrentTools`, so Anthropic behavior is unchanged by that refactor (it belongs to the OpenAI/Kimi transports).

**Tests (offline, payload capture).**
- `transcript-tool-changes.test.ts:152` "sends Anthropic updates and tool changes in native system messages", `:197` "redefines an Anthropic tool by value under the same name", `:232` "sends the current Anthropic tool list without an initial tool", `:248` "holds an Anthropic update past an assistant message that converts to no blocks", `:291` "folds Anthropic updates into the system prompt without native support", `:314` "requires both Anthropic capabilities for native tool changes".
- `system-message-replay.test.ts:44-127` covers the helper layer (`getToolStateChanges`, `renderSystemMessageUpdate`, legacy prompt normalization) with no dialect.
- No test asserts the placeholder by name except indirectly; `transcript-tool-changes.test.ts:152` is the case that pins the fixed tool list shape.

---

## Row 8 - Instructions and results

**Source.**
- Queued system updates `:1361-1374`: `pendingSystemMessages[]` + `flushPendingSystemMessages()` (`:1371-1374`). Flushed before an **emitted** assistant message (`:1496-1497`, after the `blocks.length === 0 -> continue` check at `:1495`) and once at the end (`:1527`). Consequence: an update placed before a user message lands after it on the wire, and an update never lands before a user message because it was held past an assistant message that converted to no blocks (`#11091`).
- Tool results `:1499-1523`: consecutive `toolResult` messages are collected into one user message; each error result's images are replaced by placeholder text and re-emitted after **all** result blocks, prefixed with a caption.
- `packages/ai/src/api/transform-messages.ts:14` `ERROR_TOOL_IMAGE_PLACEHOLDER = "(image attached after the tool results)"`; `:31-40` `splitErrorToolResultImages()` (only for `isError`, only when images exist; caption `Images from the error result of tool call {id} ({name}):`); `:42-60` collapses consecutive image runs into one placeholder.

**vs. e28e708 - one change.** `flushPendingSystemMessages()` moved from the top of the assistant branch to after the empty-block `continue` (diff hunks `@@ -1429,7 +1429,6` and `@@ -1484,6 +1483,7`), fixing the case where an update landed before a user message because the intervening assistant message converted to no blocks. SPEC 16.3's "Queue native system updates until just before the next assistant message" covers the intent but not the empty-message subtlety.

**Tests (offline, payload capture).**
- `anthropic-error-tool-result-images.test.ts:69` "moves the images after the tool results of the turn" (pins the exact wire shape; base64 image helper at `:65`), `:120` "keeps error tool results without images unchanged".
- `transcript-tool-changes.test.ts:248` "holds an Anthropic update past an assistant message that converts to no blocks" (the `#11091` regression), `:291` "folds Anthropic updates into the system prompt without native support".
- Live only: `image-tool-result.test.ts:265-276` (Anthropic block, gated on `ANTHROPIC_API_KEY`).

---

## Row 9 - Cache breakpoints and beta headers

**Source.**
- TTL selection `:83-96`: `retention === "long" && supportsLongCacheRetention ? "1h" : undefined`, marker `{type:"ephemeral", ...(ttl && {ttl})}`. `"none"` yields no marker at all.
- Breakpoint 1 - system prompt `:1224-1246`: every system block gets `cache_control` (single block, or the Claude Code identity block + the real prompt in OAuth mode).
- Breakpoint 2 - tools `:1659`, only `index === tools.length - 1`; suppressed entirely when `supportsCacheControlOnTools` is false (`:1259`). With native tool changes the breakpoint is on the last **initial** tool and the placeholder follows it without a marker (`:1260-1265`).
- Breakpoint 3 - last message `:1529-1555`: only if the final converted message is `user` or `system`, and only onto a last block of type `text | image | tool_result | tool_addition | tool_removal`; a string-content message is converted into a `[{type:"text", cache_control}]` array.
- Beta derivation `getBetaFeatures` `:1111-1152`, constants `:198-203`:

| Beta | Condition |
|---|---|
| `claude-code-20250219`, `oauth-2025-04-20` | OAuth branch only (`:1137`) - not ported |
| `fine-grained-tool-streaming-2025-05-14` | current tools exist AND `!supportsEagerToolInputStreaming` (`:1138`) |
| `interleaved-thinking-2025-05-14` | `model.reasoning && thinkingEnabled === true && (interleavedThinking ?? true) && forceAdaptiveThinking !== true` (`:1139-1144`) |
| `server-side-fallback-2026-07-01` | `allowedFallbackModels.length > 0` (`:1145`) |
| `mid-conversation-output-config-2026-07-01`, `thinking-binding-controls-2026-08-01` | `supportsMidConvoEffort === true` (`:1146-1148`) |
| `inline-tools-2026-09-15` | `nativeToolChanges` (`:1151`) |

  Result is deduplicated (`:1152`) and omitted from the request when empty (`:1217`).
- Caller override/removal `:1118-1130`: scans `model.headers` then `options?.headers` for a case-insensitive `anthropic-beta`; **`null` returns `[]`** (suppresses every derived beta); a non-null value is split on `,`, trimmed, empty-filtered, deduped and **replaces** the derived list. Later source wins, so request headers beat model headers.

**vs. e28e708.** Unchanged (only line shifts from the imports).

**Tests.**
- `anthropic-auth-token.test.ts:219` "preserves explicit Anthropic beta header replacement", `:228` "preserves explicit Anthropic beta header suppression" - offline, SDK mocked.
- `anthropic-mid-conversation-effort.test.ts:196` "sends the effort and binding beta headers" - offline.
- `anthropic-sse-parsing.test.ts:307`, `:329` - offline.
- `cache-retention.test.ts:99/138/167/191/217`, `fireworks-models.test.ts:394/413`, `anthropic-strict-tool-fallback.test.ts:118` (1h TTL survives on the last tool) - offline.

---

## Row 10 - Stream decoding, terminal mapping, accounting

**Source.**
- SSE framing `:383-533`: `ServerSentEvent`/`SseDecoderState` (`:383-393`), event allowlist `:395-402` (`message_start`, `message_delta`, `message_stop`, `content_block_start`, `content_block_delta`, `content_block_stop`), `flushSseEvent` `:404-418`, `decodeSseLine` `:420-444` (comment lines skipped, `event:`/`data:` only, one leading space stripped, multi-line `data` joined with `\n`), `nextLineBreakIndex`/`consumeLine` `:446-473` (CRLF and LF), `iterateSseMessages` `:475-532` (abort check per read, trailing flush).
- `iterateAnthropicEvents` `:534-573`: `event: error` -> throw with the raw data as message; events outside the allowlist are silently skipped (the "ignore unknown SSE events" behavior); `message_start` seen but no `message_stop` at EOF -> `"Anthropic stream ended before message_stop"`; JSON parse failure -> error carrying `data=` and `raw=` (repair via `parseJsonWithRepair`).
- Event handling `:702-899`: `message_start` `:706-729` (`responseId`, `input_transformations`, `responseModel`, fallback pricing, initial usage incl. `cacheWrite1h`), `content_block_start` `:730-772` (a `fallback` block is an error when content already exists `:731-736`; text/thinking/redacted_thinking/tool_use), `content_block_delta` `:773-810`, `content_block_stop` `:811-839`, `message_delta` `:840-890`.
- Terminal mapping `:843-849` + `mapStopReason` `:1664-1690`: `end_turn`->`stop`, `max_tokens`->`length`, `tool_use`->`toolUse`, `refusal`->`error` with `stop_details.explanation` fallback `"The model refused to complete the request"`, `pause_turn`->`stop`, `stop_sequence`->`stop`, `sensitive`->`error` "Provider stopped with: sensitive", anything else **throws** `Unhandled stop reason: ...`. `output.rawStopReason` is recorded separately (`:844`).
- Terminal guards `:894-900`: aborted -> throw; `stopReason === "pending"` -> `"Anthropic stream ended without a stop reason"`; `aborted|error` -> throw `errorMessage`.
- Accounting `:851-890`: null-preserving merge of `input/output/cacheRead/cacheWrite` from `message_delta` (proxies omit `input_tokens` there), `cache_creation.ephemeral_1h_input_tokens` read from the delta too (Vercel gateway), `output_tokens_details.thinking_tokens -> usage.reasoning`, `totalTokens` recomputed from components (`:880-881`), `calculateCost` per update, plus OpenRouter billed cost (`:884-890`).
- Diagnostics: `input_transformations` summarized into a diagnostic at `:904-916`.
- Content-block bookkeeping `:698-701`: a `Map<anthropicIndex, {contentIndex, arguments?}>` kept **outside** the content blocks so partials never carry pi-internal fields; tool arguments accumulate through `ToolCallArgumentsStream` (`utils/streaming-json.ts:452-500`) and finalize with `finish()` at `:830`, which records `argumentsError` on malformed JSON.

**vs. e28e708 - structural change in the streaming core.** Old code attached `index` and `partialJson` to the content blocks, used `blocks.findIndex(...)` per delta, called `parseStreamingJson` per delta, and cleaned up `index`/`partialJson` both in `content_block_stop` and in the catch block. New code has no scratch fields, O(1) index lookup, snapshot-stable partials and a single `finish()` parse. Also new: OpenRouter cost application. This is the largest delta in the file and the one most likely to be missed if the SPEC's "pi behavior" description of partials is taken literally.

**Tests.**
- `anthropic-sse-parsing.test.ts` (all **offline**, injected fake client): `:113` "forwards parsed provider stream events in order", `:143` "uses the total reported by OpenRouter's Anthropic Messages endpoint", `:178` "keeps signed thinking replayable when a proxy relabels the model", `:205` "uses a returned fallback model for cost attribution", `:235` "fails safely when Anthropic falls back after output begins", `:282` "forces streaming after an onPayload replacement", `:307` "omits the interleaved-thinking beta when thinking is disabled", `:329` "passes managed beta features to injected clients", `:353` "uses the serving model input transformations from the final stream event", `:394` "repairs malformed SSE JSON and malformed streamed tool JSON", `:481` "preserves content from content_block_start events", `:579` "preserves refusal stop details from message_delta", `:638` "preserves sensitive stop reasons with a descriptive error message", `:688` "treats message_delta without usage as a no-op for usage accumulation", `:716` "ignores unknown SSE events after message_stop".
- `anthropic-cache-write-1h-cost.test.ts:62` "prices the 1h portion at 2x input and the rest at the 5m rate", `:78` "prices 1h cache writes reported only in message_delta", `:112` "falls back to the 5m rate when no breakdown is reported" - **offline** (fake client).
- New shared coverage of the rewritten argument accumulator: `streaming-json.test.ts` (848 lines, new file) and `streaming-tool-arguments.test.ts` (420 lines, new file) - offline, dialect-neutral.
- `anthropic-strict-tool-fallback.test.ts:238` - offline.

---

## Row 11 - Inputs and schema

**Source.**
- Images `:138-149` `convertImageBlock()`: `{type:"image", source:{type:"base64", media_type: <passthrough cast>, data}}`. **No validation, no URL form**; the `media_type` cast accepts whatever `mimeType` the message carries (`image/jpeg|png|gif|webp` only by type assertion).
- Content shaping `:152-192` `convertContentBlocks()`: text-only -> single sanitized string joined with `\n`; with images -> block array with sanitized text blocks; if there is no text block it prepends `"(see attached image)"` (used for tool results).
- User-message blocks `:1403-1425`: text sanitized via `sanitizeSurrogates`, then `convertImageBlock`; empty text blocks dropped, whole message dropped when nothing remains.
- Structured output: **none on the wire**. `grep` for `output_format|structured_output|response_format` in `anthropic-messages.ts` returns zero hits. Schema enforcement exists only as strict tool schemas.
- Strict projection `constrained-sampling.ts:127-140` `makeStrictJsonSchema`, `:142-144` `getJsonSchemaToolParameters`, `:240-264` `resolveJsonSchemaStrictSampling` (throws for `require` when unsupported or unprojectable), Anthropic keyword/format filters `anthropic-messages.ts:1589-1620`.

**vs. e28e708.** `constrained-sampling.ts` changed only in the grammar-tool path (`appendGrammarToolInputJsonDelta` split into append/close helpers); the JSON-schema strict path is byte-identical, only `resolveJsonSchemaStrictSampling` moved from `:225` to `:240`. `makeStrictJsonSchema` stayed at `:127`.

**Tests (offline).**
- `anthropic-strict-tool-schema.test.ts:71`, `:102` (see row 5).
- `constrained-sampling.test.ts:92` "converts supported constraints and falls back when unsupported", `:131` "derives strict provider schemas without changing tool definitions", `:158` "falls back or rejects schemas that cannot be safely converted".
- Image wire shape: pinned incidentally by `anthropic-error-tool-result-images.test.ts:65` and `:69`. **No offline test asserts the plain user-image `source.media_type` encoding.** Live: `image-tool-result.test.ts:265-276`, `stream.test.ts:516`.

---

## Row 12 - Discovery (`/v1/models` pagination)

**Not implemented in pi for Anthropic.** Searched `packages/` for `v1/models`, `models.list`, `listModels`, `fetchModels`, `has_more`, `after_id`:

- The provider is static: `packages/ai/src/providers/anthropic.ts:78-90` registers `baseUrl`, auth (`apiKey` + OAuth), `models: Object.values(ANTHROPIC_MODELS)`, `api`. No `refreshModels` member, so `createModels().refresh()` never touches the network for it (`packages/ai/src/models.ts:196`, `:565-580`).
- Catalog data is generated offline from models.dev by `packages/ai/scripts/generate-models.ts` into `packages/ai/src/providers/data/anthropic.json` (imported by `providers/anthropic.models.ts:4`), which is **gitignored** per `.references/pi/AGENTS.md`; the committed `models.generated.ts` is only an index of those imports. The generated JSON files are present in this checkout (for example `providers/data/fireworks.json`), so per-model compat matrices for `anthropic-messages` models are inspectable locally even though they are not in git.
- The only runtime listing in pi is OpenRouter's `GET /models/user` (`packages/ai/src/providers/openrouter.ts:30`).
- `.references/pi-claude-auth` has no model listing either (`grep` for `v1/models|has_more|after_id` -> no hits).

**Consequence for 5A:** row 12 has **no pi provenance**. SPEC `0001-nukular-ai-architecture.md:834` requires `https://api.anthropic.com/v1/models`, credentialed, `has_more`/`after_id` cursor, with "authenticated behavior UNVERIFIED". Implementation must come from the Anthropic API reference plus a live capture, not from this clone.

---

## OAuth branches - locate, do not port

SPEC 16.3 already excludes these; at the new revision they are:

| Element | Lines |
|---|---|
| `claudeCodeVersion = "2.1.280"` | `:100` |
| `claudeCodeTools` canonical list (17 names) and lookup map | `:105-125` |
| `toClaudeCodeName` / `fromClaudeCodeName` | `:128-136` |
| `isOAuthToken(apiKey) = apiKey.includes("sk-ant-oat")` | `:1006-1008` |
| OAuth client branch (`authToken` bearer, `user-agent: claude-cli/<version>`, `x-app: cli`, no identity headers) | `:1044-1063` |
| `isOAuth` threading through stream/buildParams/convertMessages | `:605`, `:611`, `:640`, `:651`, `:1158`, `:1206`, `:1353` |
| OAuth betas `claude-code-20250219`, `oauth-2025-04-20` | `:1137` |
| Claude Code identity system prompt (`"You are Claude Code, Anthropic's official CLI for Claude."`) | `:1223-1237` |
| Outbound tool-name mapping in `tool_removal` / `tool_use` / tool definitions | `:1392`, `:1480`, `:1654` |
| Inbound tool-name restoration on `tool_use` | `:760-765` (+ `getCurrentTools` re-read at `:590`) |

Adjacent and equally non-portable: `PiAnthropic` SDK credential-chain suppression `:339-345`, workload identity federation `:353-378`, `:381`, `:1090-1097`, `github-copilot` branch `:1020-1041`.

pi's OAuth tests: `anthropic-oauth.test.ts` (**offline**: mocked fetch + local callback server, `:43-224`), `anthropic-auth-token.test.ts:114` "preserves ANTHROPIC_OAUTH_TOKEN as OAuth-shaped API auth", `:167` "preserves OAuth request shaping for ANTHROPIC_OAUTH_TOKEN" (offline), `anthropic-tool-name-normalization.test.ts` (**live**, `skipIf(!oauthToken)`, `:28/70/111/164`).

---

## SPEC line-reference drift (16.2/16.3 vs new revision)

SPEC `0001-nukular-ai-architecture.md` cites old-revision line numbers. Current targets:

| SPEC reference | Status | New location |
|---|---|---|
| `compat-schema.ts:416-502` | correct to 501 | `providers/compat-schema.ts:416-501` |
| `anthropic-messages.ts:194-199` (beta constants) | shifted +4 | `:198-203` |
| `anthropic-messages.ts:194-214` (constants + placeholder) | shifted +4 | `:198-217` |
| `:668-690` (strict 400 fallback) | shifted | `:669-696` (loop `:645-696`) |
| `:901-905` (terminal guards) | shifted | `:894-900` |
| `:1664-1688` (`mapStopReason`) | end shifted | `:1664-1690` |
| `:1116-1156` (`getBetaFeatures`) | shifted | `:1111-1152` |
| `:1177-1204` (eligibility/definitions) | shifted | `:1177-1206` (`nativeToolChanges` `:1196-1197`) |
| `:1264-1275` (tool list assembly) | shifted | `:1259-1272` |
| `:1253-1262` (temperature gate) | shifted | `:1248-1257` |
| `:1278-1309` (thinking payloads) | shifted | `:1275-1296` |
| `:1564-1577` (`insertThinkingLevelMessages`) | correct | `:1564-1577` |
| `:1364-1399`, `:1430-1432`, `:1527` (queue/flush) | shifted | `:1361-1400`, `:1495-1497`, `:1527` |
| `:1500-1524` (error-result images) | shifted | `:1499-1523` |
| `:69-92` (cache control) | shifted | `:73-96` |
| `:1242-1270`, `:1529-1555` (breakpoints) | partly | `:1224-1272`, `:1529-1555` |
| `:626-627` (cache session id) | shifted | `:627`, `:635` |
| `:1073-1077` (affinity headers) | shifted | `:1066-1079` |
| `:1014-1016`, `:1142`, `:1227-1240` (OAuth) | shifted | `:1006-1008`, `:1137`, `:1223-1237` |
| `constrained-sampling.ts:56-143, 220-249` | partly | `:127-144` (strict projection), `:240-264` (resolution) |
| `transform-messages.ts:14-39` (error images) | correct | `packages/ai/src/api/transform-messages.ts:14-40` |

---

## Test inventory: offline vs. live

**Offline (deterministic, portable as fixture provenance):** `compat-schema.test.ts`, `anthropic-eager-tool-input-compat.test.ts`, `anthropic-temperature-compat.test.ts`, `anthropic-force-adaptive-thinking.test.ts`, `anthropic-empty-thinking-signature-compat.test.ts`, `anthropic-thinking-disable.test.ts` (except `:163-164`), `anthropic-strict-tool-fallback.test.ts`, `anthropic-strict-tool-schema.test.ts`, `anthropic-mid-conversation-effort.test.ts`, `anthropic-sse-parsing.test.ts`, `anthropic-cache-write-1h-cost.test.ts`, `anthropic-error-tool-result-images.test.ts`, `anthropic-auth-token.test.ts`, `anthropic-federation.test.ts`, `anthropic-federation-sdk.test.ts`, `anthropic-oauth.test.ts`, `transcript-tool-changes.test.ts` (Anthropic cases), `system-message-replay.test.ts`, `streaming-json.test.ts`, `streaming-tool-arguments.test.ts`, `constrained-sampling.test.ts`, `fireworks-models.test.ts:335-430`.

**Live / e2e (need network and credentials, skipped without env):** `anthropic-eager-tool-input-e2e.test.ts`, `anthropic-long-cache-retention-e2e.test.ts`, `anthropic-thinking-binding-e2e.test.ts`, `anthropic-opus-4-8-smoke.test.ts`, `anthropic-thinking-disable.test.ts:163`, `anthropic-tool-name-normalization.test.ts` (needs an OAuth token), `cache-retention.test.ts:53/77`, `image-tool-result.test.ts` Anthropic block, `stream.test.ts:501-518`.

**Half-live:** `cache-retention.test.ts:99` and `:217` attempt `https://my-proxy.example.com/v1` and swallow the failure; the result does not depend on the network but the run touches DNS.

---

## Gaps and behaviors the SPEC does not mention

1. **`output_config.effort: "low"` for managed-effort models** (row 6, `:1285-1289`). New, unusual, absent from SPEC 16.3, which only says markers reconstruct historical plus active effort.
2. **Client identity headers** - new `ClientIdentity` layer (`utils/identity.ts`) replacing `getPiUserAgent`; the Anthropic dialect now sends `User-Agent: pi/<version> (<platform>; <runtime>/<version>; <arch>)` plus provider attribution, merged at the lowest precedence. SPEC 17 describes provider hooks but no client-identity option at request level.
3. **OpenRouter billed-cost passthrough** on the Anthropic dialect (`:884-890`). SPEC cost policy (D-26) covers list-price accounting; a runtime cost override read from the response body is not described.
4. **`input_transformations` diagnostics** (`:706-710`, `:842`, `:904-916`) and `responseId`/`responseModel` capture - SPEC 16.3 silent.
5. **Mid-output `fallback` content block is a hard error** (`:731-736`) while a pre-output fallback with a matching `allowedFallbackModels` entry is silently re-priced (`:711-718`). SPEC only says "no invented application failover".
6. **Snapshot-stable partials**: the rewrite removed `index`/`partialJson` from content blocks, so a Rust design that keeps scratch state on the accumulator block diverges from current pi. Covered by the two new shared test files.
7. **No validation of compat values anywhere in pi** (schema `additionalProperties: true`, no semantic checks). SPEC requires pre-auth rejection of unsupported non-default values - that is a nukular addition, not a port.
8. **`supportsMidConvoSystemMessages` / `supportsMidConvoToolChanges` are Anthropic compat fields in pi** but SPEC 16.2 hoists instruction flags into `InstructionCapabilities` (12.4). The dialect compat therefore exposes 11 of pi's 13 fields, with these two moving to the instruction-capability surface - a mapping decision the plan should state.
9. **No Anthropic-specific offline test for session affinity or `supportsCacheControlOnTools`**; both are covered only through `fireworks-models.test.ts:335-430`. Lift those cases rather than inventing new fixtures.
10. **Row 12 has no reference implementation in pi** and cannot be sourced from this clone.

## Not covered

- Per-model compat matrices (`providers/data/*.json`) were only spot-checked (Fireworks Anthropic entries); no exhaustive per-model inventory was produced. They are gitignored generated data.
- `pi-messages.test.ts:261` ("preserves prefer through pi-messages") was read by name only; its gateway adapter behavior was not traced.
- `anthropic-federation*.test.ts` and `anthropic-oauth.test.ts` were catalogued but not analyzed in detail (out of scope for the dialect rows).
