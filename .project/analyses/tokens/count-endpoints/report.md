---
document:
  type: "analysis"
  id: "tokens-count-endpoints"
  title: "Native token-count endpoints on the configured subscription logins"
  description: "Live probe of Anthropic count_tokens, Google v1internal:countTokens, xAI tokenize, OpenAI input_tokens and the Synthetic/Zen equivalents, with accuracy against the same payload's streamed usage, request recipes and a source precedence per family"
  status: "published"
  revision: 2
  created_at: "2026-10-27T18:53:01+01:00"
  updated_at: "2026-10-27T19:28:50+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["live probes for anthropic, google, xai, openai, synthetic, opencode; verdicts and precedence"]
    - revision: 2
      reason: "synthetic row corrected after a live re-probe"
      changes: ["synthetic count_tokens works; the earlier 500 was model-gated (5 of 14 always-on models), not shape or auth; the endpoint ignores tools and returns a per-model scaled count, not real tokens; precedence table updated"]
---

# Native token-count endpoints on subscription logins

M3 slice 1, unit U2. All calls were live on 2026-10-27 between 18:44 and 18:53
(Europe/Zurich) on the accounts in `~/.pi/agent/auth.json`, read-only, no reset credits
touched. Captures with secrets removed: [`captures/`](captures/).

## Verdicts

| Endpoint | Auth used | Verdict | Accuracy vs the same payload's stream usage | p50 latency |
|---|---|---|---|---|
| Anthropic `POST /v1/messages/count_tokens` | `claude` OAuth + Claude Code identity | **works, exact** | 0 delta on six payloads (plain, 11 tools, tool result, cached prefix, image, unicode) once the billing block and `metadata` are dropped | 166 ms |
| Google `POST /v1internal:countTokens` | `antigravity` OAuth | **works, incomplete** | counts `contents` only: `systemInstruction` and `tools` are ignored, and only the base catalog model id gets the full count. Gemini −14…−103, Claude-on-Google −3341…−3780, gpt-oss +528…+603 | 439 ms |
| xAI tokenize | `xai` OAuth | **rejected (absent)** | `/v1/tokenize-text` → 404 (resolved as a model lookup), `/v1/tokenize` → 404 | – |
| OpenAI `POST /v1/responses/input_tokens` | `openai` OAuth (ChatGPT) | **rejected** | 401 `rejected_by_hardened_oauth_boundary`, code `hardened_oauth_rule_missing` | – |
| Synthetic `POST /anthropic/v1/messages/count_tokens` | `synthetic` API key | **works, but not a token count** | identical to the stream's `message_start.input_tokens` (0 delta on 6 payloads, once tools are excluded); both are 0.42× the model's real tokenizer for the DeepSeek family, 1.36× for GLM-4.7-Flash, 2.44× for gpt-oss-120b; 500 on 5 of 14 always-on models | 253 ms |
| OpenCode Zen `POST /zen/v1/messages/count_tokens` | anonymous `public` | **rejected** | 404 | – |

Only Anthropic's endpoint can be used as an authoritative pre-flight count. Google's is
usable only for content delta accounting that excludes the system prompt and tools, which
in a real Pi session dominate the payload.

**Revision 2 correction (Synthetic).** Revision 1 recorded Synthetic's endpoint as absent after
a 500. It is present and documented (`https://dev.synthetic.new/docs/anthropic/messages/count-tokens`)
and answers 200 for every shape we send, including a verbatim claim from a real Pi session. The
500 is **model-gated**: `syn:large:vision`, `hf:zai-org/GLM-5.3`, `hf:zai-org/GLM-5.3-Flash`,
`hf:moonshotai/Kimi-K3` and `hf:Qwen/Qwen3.8-27B` answer 500 to any body, the other nine
always-on models answer 200. The number it returns is not a token count: it equals the stream's
`message_start.input_tokens` exactly, ignores tool declarations, and is the model's real
tokenizer count multiplied by a per-model factor (0.4208 for the DeepSeek family, 1.357 for
GLM-4.7-Flash, ~2.44 for gpt-oss-120b). The provider's context check uses the real count, not
this one. Full evidence: [`../synthetic-counts/report.md`](../synthetic-counts/report.md).

## Anthropic `count_tokens`: what makes it exact

The endpoint accepts the same shaped body our provider sends to `/v1/messages` — identity
system block, wire (PascalCase) tool names, cache_control breakpoints, images — with two
changes and one mandatory header:

1. Delete `metadata`. `shapeBody` always sets `metadata.user_id` and the endpoint answers
   `400 invalid_request_error: metadata: Extra inputs are not permitted`.
2. Delete the `x-anthropic-billing-header: …` system block from `system`. The real Messages
   API **strips it before counting**; `count_tokens` counts it, which is the whole error.
   Measured on the same body: identity only → 60 vs 60 (delta 0); identity + billing → 99 vs 60
   (+39); billing only → 76 vs 36 (+40).
3. Send `anthropic-version: 2023-06-01` (otherwise `400 anthropic-version: header is required`).

Not required: the `?beta=true` query parameter, `anthropic-beta:
token-counting-2024-11-01`, or any other beta beyond the list our provider already sends —
all four combinations returned the same `input_tokens`. The identity block itself **is**
counted, so it must stay.

Exact body and headers: [`captures/anthropic/count-recipe.request.json`](captures/anthropic/count-recipe.request.json).
Rows: [`captures/anthropic/count-vs-usage.json`](captures/anthropic/count-vs-usage.json).

| Payload (shaped, minus billing and metadata) | `count_tokens` | Messages `input + cache_creation + cache_read` | delta |
|---|---|---|---|
| plain user text | 60 | 60 | 0 |
| 11 tool declarations | 1882 | 1882 | 0 |
| assistant tool_use + ~14 KB tool_result | 7848 | 7848 | 0 |
| 3.5k-token system prefix with `cache_control` | 3569 | 34 + 3535 | 0 |
| 64×64 PNG + text | 75 | 75 | 0 |
| Japanese/Greek/emoji text | 110 | 110 | 0 |

`count_tokens` includes cached prefixes, matching `input + cache_creation + cache_read`.
Latency p50 166 ms over 5 sequential calls (157–175), against 576–6237 ms for the Messages
calls. One Messages call in thirteen (all `max_tokens: 1`) answered `429 rate_limit_error`
while none of 32 `count_tokens` calls in the same window was limited: the count endpoint is
the cheap path and the Messages fallback (what Claude Code does on a 501) is not viable at
Pi's request rates.

Open point: a fabricated thinking signature is rejected with `400 … Invalid 'signature' in
'thinking' block`. The account's `claude-sonnet-5-5` returned plain text for
`thinking: {type: "enabled"}`, so a signed thinking block could not be produced to confirm
acceptance; UNVERIFIED. The family should omit thinking blocks from the count request or fall
back when the call 400s.

## Google `v1internal:countTokens`: what it does and does not count

Accepted body: `{"request": {model, contents, systemInstruction, tools, generationConfig}}`
against `https://daily-cloudcode-pa.googleapis.com/v1internal:countTokens` with the agy
headers (`antigravity/cli/1.4.8 …`). Rejected fields inside `request`: `toolConfig`, `labels`,
`sessionId`, `project`; at top level only `request` exists. No rate-limit headers.

Counting behaviour, measured on one canonical payload:

- `contents` text parts are counted exactly: 3490 for a 2400-word text, 25 for a short one.
- `systemInstruction` is **ignored** (a request with only `systemInstruction` returns `{}`),
  `tools` are ignored, `generationConfig` is ignored.
- `functionCall` / `functionResponse` parts are counted only when `model` is a base catalog id
  (`gemini-3.8-flash`, `gemini-4-argon` → 1230). With a level id (`gemini-3.8-flash-medium`),
  a model enum (`MODEL_PLACEHOLDER_M319`) or any `gpt-oss-*` id the same body returns 25 —
  the text-parts-only count.

Against the stream's `usageMetadata.promptTokenCount` for identical contents:

| Route | payload | count | stream | delta |
|---|---|---|---|---|
| `gemini-3.8-flash` | text | 3490 | 3504 | −14 |
| `gemini-3.8-flash` | text + 2 tools | 3490 | 3593 | −103 |
| `claude-sonnet-5-5` | text | 3490 | 6831 | −3341 |
| `claude-sonnet-5-5` | text + 2 tools | 3490 | 7270 | −3780 |
| `gpt-oss-120b` | text | 3490 | 2887 | +603 |
| `gpt-oss-120b` | text + 2 tools | 3490 | 2962 | +528 |
| `claude-sonnet-5-5` | text + tool call + tool result (level id) | 25 | 2382 | −2357 |

A real Pi session sends ~10 tool declarations (≈1900 tokens in the Anthropic measurement
above) plus a system instruction, so the endpoint would under-report every antigravity
request by at least that much. It cannot replace usage.

Captures: [`captures/google/count-vs-usage.json`](captures/google/count-vs-usage.json),
[`captures/google/model-id-fallback.json`](captures/google/model-id-fallback.json),
[`captures/google/count-shapes-rejected.json`](captures/google/count-shapes-rejected.json),
[`captures/google/latency.json`](captures/google/latency.json).

Both antigravity Claude and gpt-oss streams did report `usageMetadata.promptTokenCount`
(6831/7270 and 2887/2962), so the plan's "gpt-oss frames carry no `usageMetadata`" gap did not
appear in these two non-streamed-tool payloads. U1 should re-check it on a real tool loop
rather than treat it as settled.

## Same text, four routes

The identical 15 489-character text, text only, no tools. Error is the chars/4 estimate
against the route's own number, (estimate − actual) / actual:

| Route | prompt tokens | chars/4 (Pi's clamp estimate) | error |
|---|---|---|---|
| Gemini 3.8 Flash | 3504 | 3872 | +10% |
| gpt-oss-120b | 2887 | 3872 | +34% |
| grok-4.7 | 4058 | 3872 | −5% |
| Claude Sonnet 5.5 served by Google | 6831 | 3872 | −43% |

The Claude-on-Google figure suggests that route applies Anthropic-side accounting (or an
instruction/tool wrapper) that no count of the Gemini-shaped body produces. It is a further
argument against deriving antigravity's Claude counts from the anthropic family, which the
plan assumed would be reusable.

## Recommended source precedence per family

Order per AGENTS.md: provider usage > native count endpoint > known tokenizer > generic
tokenizer. Concretely:

| Family / route | 1. usage | 2. native count | 3. tokenizer | Notes |
|---|---|---|---|---|
| `claude` (anthropic provider) | streamed `usage` | **`count_tokens`** (exact, 166 ms, shape minus billing and `metadata`, `anthropic-version` header) | – | the only route where a pre-flight count is authoritative; add a 400 fallback for thinking blocks |
| `antigravity` Gemini (`gemini-*`) | `usageMetadata.promptTokenCount` | `v1internal:countTokens` with the **base** catalog id, contents only, is *not* accurate enough for a full prompt; use only where system+tools are out of scope | – | label any endpoint number an estimate |
| `antigravity` Claude (`claude-*`) | `usageMetadata.promptTokenCount` | none usable (−49…−52% on the tested payload) | – | do not reuse anthropic-family counts: the wire payload and the accounting differ |
| `antigravity` gpt-oss (`gpt-oss-*`) | `usageMetadata.promptTokenCount` (present in both probes) | none usable (+18…+21%) | – | fix the plan's missing-usage assumption if U1 confirms usage is present |
| `synthetic` | streamed `usage` | `count_tokens` (same number as the stream, tool declarations excluded; 500 on 5 of 14 models) | **the model's own HF tokenizer** — the only count the provider's context check agrees with | With no tokenizer the provider number is 0.42× the real prompt for the DeepSeek family (2.37× under-report in Pi's context %) and 2.4× for gpt-oss; label it `provider-count`. Evidence: [`../synthetic-counts/report.md`](../synthetic-counts/report.md) |
| `openai` / `codex` | streamed `usage` | `POST /v1/responses/input_tokens` only with an API key; 401 with the subscription login | – | treat as unavailable unless a key is configured |
| `xai` | `usage.prompt_tokens` (incl. `cached_tokens`) | none (404) | – | estimate before the request, labelled |
| `opencode` (Zen, Go) | streamed `usage` | none (404) | – | free tier; usage only |

Implications for slice 3: only `claude` gets a real pre-flight count (tool results before the
next request, `/tokens` tab). `synthetic` gets a cheap pre-flight number, but it is the
provider's own scaled count and must be labelled `provider-count`, not exact. Every other
family must present its numbers as estimates until the next assistant message delivers usage,
and the store should key the anthropic counts by the shaped payload (post-shaping, pre-billing)
so a re-shape with a new version does not reuse a stale count.

## Reproduction

Every probe is a plain `bun` script against the endpoints above; bodies and headers are in
`captures/`. The token is read from Pi's `auth.json` slot and passed as-is; no refresh was
needed. `claude` was valid until 23:09 and `xai` until 23:14; the `antigravity` slot's
`expires` moved from 18:56 to 19:51 while probing (another Pi session refreshing it under the
file lock), which is the only credential write observed and none of them by this probe.

## Follow-ups

- `.project/analyses/claude-code-cli/tracking.md` pins 2.1.306; the installed `claude` reports
  2.1.311 and `ReportedVersion` resolved to it, so every probe carried `user-agent:
  claude-cli/2.1.311`. Either bump the pin or record why the installed version wins here.
- `count_tokens` spends no subscription quota that the usage audit can see, but it is still an
  authenticated call per count; slice 3 needs a rate limit and a content-hash cache in front
  of it rather than one call per rendered number.
- Google `countTokens` returns `{}` instead of an error for bodies it counts as empty; a
  caller must treat a missing `totalTokens` as "unknown", never as 0.
