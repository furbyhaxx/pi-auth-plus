---
document:
  type: "analysis"
  id: "tokens-usage-audit"
  title: "Usage audit: assistant usage per route (M3 slice 1, U1)"
  description: "Live audit of the persisted assistant usage per provider route against the raw provider frames, plus Pi's 4 chars/token estimate error"
  status: "published"
  revision: 1
  created_at: "2026-10-27T18:55:00+01:00"
  updated_at: "2026-10-27T18:55:00+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Live usage audit of 7 routes, chars/token per tokenizer, synthetic double count root cause"]
---

# Usage audit: assistant usage per route

status: "root-caused"
confidence: "high"

## Summary

- Seven of eight visited routes persist **complete and correctly mapped** `usage` on every
  assistant turn, including cache fields on later turns. Every stored field equals what Pi's
  mapping produces from the raw provider frame (24/24 checked turns).
- One route is wrong: **synthetic** (`api.synthetic.new/anthropic`) reports
  `cache_creation_input_tokens` equal to the delta's `input_tokens`, so Pi adds the uncached run
  twice. The first turn stores `totalTokens` 13758 for a prompt the provider counts at 6869
  (**+100 %**); later turns are +6.4 %. A `message_end` replacement fixes it, verified.
- Pi's 4 chars/token estimate is a poor fit for the real tokenizers: Claude content is
  2.9-3.0 chars/token (**Pi is 25-33 % low**), Gemini/GPT-6/xAI/opencode-DeepSeek are
  4.1-4.7 (Pi is close), and synthetic/DeepSeek is 10.3 (**Pi is 2.5x high**).
- A JSON tool result (2896-char fixture) sits in the tail Pi estimates: 2.1-2.9 chars/token on
  Claude and Gemini, 3.3-4.2 on GPT/xAI/opencode, 7.6 on synthetic. Pi's tail estimate was
  **25-55 % low on seven routes** and ~2x high on synthetic.
- The lever the plan identified holds: because `usage` is already correct on every route except
  synthetic, Pi's anchor (footer %, `getContextUsage`, compaction, `maxTokens` clamp) is sound
  to within one turn's tail. No provider route needs a better estimator for the anchor; the
  remaining error is the estimated tail and the compaction that consumes it.

## Method

- Binary: `pi-bolt` 1.4.0 (Pi-Bolt 1.0.5), dev HEAD `6809e35`, loaded as an explicit extension
  (`-ne -e <probe> -e src/index.ts`), print mode, `--thinking off`. Every run used dev HEAD, not
  the installed 0.3.2.
- Probe (`captures/capture-probe.ts`): wraps `globalThis.fetch` and records URL, status,
  request body and the raw response body (SSE verbatim); also dumps Pi's
  `provider_stream_event`, `before_provider_request` payloads and `message_end` messages.
  Auth header values are never recorded (names only).
- The probe must load **before** `src/index.ts`: `src/families/index.ts:12` builds `FAMILIES` at
  module scope, so `createGoogleFamily()` (`src/families/google/index.ts:13`,
  `fetchFn: FetchFn = fetch`) binds whatever `globalThis.fetch` is at that moment. Loaded after
  it, the probe sees nothing from antigravity.
- Two prompts per route, one session: prompt 1 forces one `read` of a fixed 2896-char JSON
  fixture, prompt 2 asks a follow-up question about the same file. That yields three requests
  (tool call, answer, follow-up), two assistant turns per process run.
- Analysis (`captures/capture-analyze.ts`): reads the persisted session JSONL, extracts raw
  usage per API family (anthropic `message_start`/`message_delta`, Google `usageMetadata`,
  OpenAI chat/Responses `usage`), recomputes Pi's expected mapping and compares it to the
  persisted message; then computes Pi's estimate with `estimateTokens` exported from
  `@earendil-works/pi-coding-agent`, applied to the session messages in the same way
  `estimateProjectedContextTokens` does (anchor `usage.totalTokens` plus estimate of the tail).
- Separate single-variable experiment for chars/token: the same 14000-char markdown slice
  appended as one user message; the delta of the provider prompt total against the previous
  anchor is the cost of that text in each tokenizer
  (`captures/prose-chars-per-token.json`).
- Real prompt total per request = what the provider counted for the prompt:
  anthropic `input + cache_read + cache_creation`, Google `promptTokenCount`,
  OpenAI `input_tokens`/`prompt_tokens` (cached included).

## Per-route results

Usage verdict is on the persisted assistant message (session JSONL), against the raw frames.

| route | usage verdict | cache fields, later turns | persisted prompt vs provider prompt | Pi estimate error, whole context (turn 0) | Pi estimate error, live (turn 1 / turn 2) | Pi estimate error on the JSON tool-result tail |
| --- | --- | --- | --- | --- | --- | --- |
| claude/claude-sonnet-5-5 | complete, correct | cacheRead 21672 (turn 1), cacheWrite 5129 (later prompt) | 0.0 % | -12.1 % | -2.4 % / 0 % | -41.8 % |
| antigravity/gemini-3.8-flash | complete, correct | cacheRead 15585 | 0.0 % | +9.1 % | -2.5 % / 0 % | -38.1 % |
| antigravity/claude-sonnet-5-5 | complete, correct | cacheRead 24213 | 0.0 % | -26.4 % | -3.5 % / 0 % | -55.4 % |
| antigravity/gpt-oss-120b | complete, correct | cacheRead 15360, then 16576 | 0.0 % | +16.5 % | -3.4 % / +0.2 % | -48.7 % |
| synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017 | **wrong: cacheWrite duplicates input** | cacheRead 6843, cacheWrite 468 | **+100 % turn 0, +6.4 % after** | +160.7 % | +98.1 % / +6.6 % | n/a (cache accounting) |
| opencode/deepseek-v4.1-flash-free | complete, correct | cacheRead 16384 | 0.0 % | +9.0 % | -1.3 % / n/a | -28.0 % |
| openai/gpt-6-luna | complete, correct | cacheRead 15360 | 0.0 % | +16.0 % | -1.4 % / 0 % | -24.7 % |
| xai/grok-4.7 | complete, correct | cacheRead 17152 | 0.0 % | +4.4 % | -1.6 % / 0 % | -28.9 % |

`cost` is stored on every turn. It is zero on claude/antigravity (subscription, by design) and
computed locally (`totalFromProvider: false`) on openai/xai/synthetic/opencode. Synthetic's cost
follows its `usage`: turn 0 stored `cost.input 0.0041214` for the 6869 tokens the provider
reported as cache *writes* (`cost.cacheWrite 0`, so its catalog carries no write price). Fixing
the usage moves that charge; whether the catalog should price cache writes is a separate
question and is not covered here.

Raw frames confirming the mapping, one per family (full set in
`captures/raw-usage-excerpts.json`):

```json
// claude, turn 0: anthropic message_start, then message_delta (cache already warm from the
// preceding run; a cold cache puts the same 20361 in cache_creation_input_tokens instead)
{"input_tokens":4,"cache_creation_input_tokens":0,"cache_read_input_tokens":20363,"output_tokens":16}
{"input_tokens":4,"cache_creation_input_tokens":0,"cache_read_input_tokens":20363,"output_tokens":61}
// -> persisted: input 4, output 61, cacheRead 20363, cacheWrite 0, totalTokens 20428
```

```json
// antigravity/gemini-3.8-flash, turn 1: google usageMetadata (last of 3 chunks)
{"promptTokenCount":17630,"candidatesTokenCount":12,"thoughtsTokenCount":5,"totalTokenCount":17647,"cachedContentTokenCount":15585}
// -> persisted: input 2045 (= 17630 - 15585), output 17 (= 12 + 5), cacheRead 15585, cacheWrite 0, totalTokens 17647
```

```json
// openai/gpt-6-luna, turn 1: response.completed.usage (input_tokens includes cached)
{"input_tokens":16433,"output_tokens":15,"total_tokens":16448,"input_tokens_details":{"cached_tokens":15360,"cache_write_tokens":0}}
// -> persisted: input 1073 (= 16433 - 15360), cacheRead 15360, totalTokens 16448
```

```json
// synthetic, turn 0: message_start reports the prompt total, message_delta redefines input_tokens
{"type":"message_start","usage":{"input_tokens":6869,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}
{"type":"message_delta","usage":{"input_tokens":6869,"cache_creation_input_tokens":6869,"cache_read_input_tokens":0,"output_tokens":20}}
// -> persisted: input 6869, output 20, cacheRead 0, cacheWrite 6869, totalTokens 13758; real prompt 6869
// turn 1: start 7311 / delta {"input_tokens":468,"cache_creation_input_tokens":468,"cache_read_input_tokens":6843}
// -> persisted totalTokens 7785; real prompt 7311 (+6.4 %)
```

Non-usage evidence worth keeping:

- `antigravity/gpt-oss-120b` returned `503 MODEL_CAPACITY_EXHAUSTED` ("No capacity available for
  model gpt-oss-120b-medium on the server") on one request. Pi persisted
  `stopReason: "error"` with all-zero usage and retried; the retry carried `usageMetadata`. No
  fabricated numbers, and `getAssistantUsage` skips error messages, so the anchor stayed valid.
- The known gpt-oss "frames without `usageMetadata`" gap did **not** reproduce: 4 of 4
  successful gpt-oss streams carried `usageMetadata`.
- `opencode/deepseek-v4.1-flash-free` answered prompt 1 and its intra-turn request 2 (with
  `cacheRead 16384`), then prompt 2 failed with
  `429 FreeUsageLimitError: Free usage limit reached`. Nothing was substituted.
- `xai/grok-4.7` reports `reasoning_tokens` (22, 18, 76) that Pi stores as `reasoning`;
  `input_tokens` includes `cached_tokens` there as well.

## Chars per token (why 4 is the wrong constant)

| route / tokenizer | chars/token, 14000-char markdown | chars/token, 2896-char JSON tool result | Pi's 4 chars/token on that JSON |
| --- | --- | --- | --- |
| claude (Anthropic) | 2.73 | 2.7 | 33 % low |
| antigravity/gemini-3.8-flash | 4.07 | 2.88 | 28 % low |
| antigravity/claude-sonnet-5-5 | - | 2.08 | 48 % low |
| antigravity/gpt-oss-120b | - | 2.5-3.0 | 26-38 % low |
| openai/gpt-6-luna | 4.19 | 3.51 | 12 % low |
| xai/grok-4.7 | 4.17 | 3.31 | 17 % low |
| opencode/deepseek-v4.1-flash-free | - | 4.15 | 4 % high |
| synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017 | 9.89 | 7.64 | 2x high |

(Last column = real chars/token divided by 4: below 4 chars/token means Pi's estimate is short
of the real token count.)

The synthetic ratio is uniform across system prompt, prose and JSON (10.3 chars/token for the
whole 71.7 KB request, 9.9 for the prose delta, 7.6 for the JSON delta): either that endpoint's
counts are not token counts or it does not count the whole prompt. Not settled here; see open
questions.

## Recommended fix (prioritized)

1. **synthetic: stop double counting the cache write.** `src/families/synthetic/index.ts:46`
   (`register`) is the seam: add a `message_end` handler that, for
   `message.provider === "synthetic"` and `usage.cacheWrite > 0 && usage.cacheWrite === usage.input`,
   returns a same-role replacement with `input = 0` and
   `totalTokens = input + output + cacheRead + cacheWrite`. That expresses the provider's real
   semantics: `message_start.input_tokens` is the prompt total and `cacheRead`/`cacheWrite` are
   subsets of it, while `message_delta` replaces `input_tokens` with the uncached remainder and
   duplicates it in `cache_creation_input_tokens`.
   Verified live with `captures/capture-fixprobe.ts` (same rule): raw delta
   `{"input_tokens":18,"cache_creation_input_tokens":18,"cache_read_input_tokens":6843}` persisted
   as `input 0, output 1, cacheRead 6843, cacheWrite 18, totalTokens 6862` instead of 6880, and Pi
   recomputed `cost` from the replacement. Regression test: a `message_end` case with the
   captured synthetic frame (fixture from `captures/synthetic-hf-deepseek-ai-DeepSeek-V4.1-Flash-1017.json`)
   asserting the persisted `input`/`totalTokens` and a second case proving a normal anthropic
   frame (`cacheWrite != input`) is left untouched.
   Alternative, larger: own the synthetic stream mapping. Not worth it while Pi's
   `anthropic-messages` api is a match everywhere else.
2. **antigravity: clamp the derived input.** `src/families/google/stream.ts:235`
   (`input: count(usage["promptTokenCount"]) - cacheRead`) is currently exact on all three
   antigravity models, including cached reads of 15.4-24.4 K. A provider that ever reports
   `cachedContentTokenCount > promptTokenCount` yields a negative `input`, which Pi would
   subtract from its context total. `Math.max(0, …)` is one word of insurance; no observed
   failure.
3. **Nothing to fix in the tail estimator, only in expectations.** Pi's 25-55 % low estimate on
   a JSON tool result and ~2x high on synthetic cannot be corrected from `usage`: the tail is
   whatever Pi estimates after the anchor. M3 slice 3's store is the place where our own surfaces
   can report the truth, and `session_before_compact` only changes compaction content, not the
   estimate. If a tokenizer-based correction is wanted for the tail, it needs the M4 upstream
   hook.
4. **Do not add provider workarounds for missing usage.** The gpt-oss 503 shows the right
   behaviour: zeros plus `stopReason: "error"`, which Pi's `getAssistantUsage` skips. Keep it.

## Open questions / follow-ups

- **UNVERIFIED:** whether `api.synthetic.new` reports token counts at all. Its numbers imply
  ~10 chars/token for every kind of text (markdown, JSON, whole request), 2.5x coarser than any
  tokenizer. U2's count-endpoint probe (Anthropic-style `count_tokens` on that host, if it
  exists) would settle it; if it agrees with the streams, the endpoint does not count the whole
  prompt and our token work must not treat synthetic usage as ground truth for accuracy claims.
- Cache accounting is not additive across turns: the same 2896-char tool result measured 1246
  tokens in the final claude run and 1624 in an earlier one (cache_creation/cache_read
  repartitioning), and one gpt-oss turn came out 12 tokens *smaller* than its anchor while adding
  that tool result (`cachedContentTokenCount` jumped 64 → 15360). Tail percentages therefore
  carry ±10 % noise; the chars/token numbers do not.
- Only one second-turn sample per route (two for claude). Cache-field behaviour across a
  5-minute TTL boundary, a compaction, and a model switch inside a session is untested.
- Probe artefact for future audits: loading a fetch-wrapping extension before `src/index.ts` is
  required (see Method); the harness is committed under `captures/`.
