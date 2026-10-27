---
document:
  type: "analysis"
  id: "tokens-synthetic-counts"
  title: "Synthetic count_tokens: what it accepts, and whether its numbers are token counts"
  description: "Live probe of POST api.synthetic.new/anthropic/v1/messages/count_tokens against the real Pi payload, the stream's own usage, the models' public HF tokenizers and the enforced context limit; resolves the earlier 500 and the ~10 chars/token puzzle"
  status: "published"
  revision: 1
  created_at: "2026-10-27T19:27:43+01:00"
  updated_at: "2026-10-27T19:28:50+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Shape matrix, per-model 500 cause, count vs stream vs real tokenizer, enforced context limit, per-model scale factors"]
---

# Synthetic `count_tokens`: what it accepts, and whether its numbers are token counts

status: "root-caused"
confidence: "high"

## Summary

- `POST https://api.synthetic.new/anthropic/v1/messages/count_tokens` **works**. The earlier
  "rejected (500)" verdict in
  [`../count-endpoints/report.md`](../count-endpoints/report.md) was a **per-model** failure,
  not a shape or auth failure: 5 of the 14 always-on models answer 500 to *any* body, including
  a one-line string.
- It accepts every shape we send, including the verbatim claim from a real Pi session
  (system, 7 tool declarations, `stream`, `max_tokens`, `thinking`). It counts `system` and
  `messages` (all block types) and **ignores `tools` entirely**: the captured Pi request counts
  6273 with and without its 5232 bytes of tool JSON.
- **Neither `count_tokens` nor the stream's `usage` is a real token count.** For
  `hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` both report **0.4215–0.4245 ×** the count of the
  model's own public tokenizer on every text of 5 KB or more (0.46–0.47 at 1 KB, where framing
  dominates) across prose, JSON, random prose, hex, Japanese, emoji, mixed and Pi's own system
  prompt; the ratio does not depend on where the text sits in the payload, and the fit is
  `count ≈ 0.4208 × real + ~16`. `count_tokens` and `message_start.usage.input_tokens` are
  **identical** on every payload without tools. The factor is per model: 0.42 for the DeepSeek
  models, 1.36 for `hf:zai-org/GLM-4.7-Flash`, ~2.44 for `hf:openai/gpt-oss-120b`.
- **Output tokens are exact** (128 vs 127, 209 vs 208 real tokens), so the served model does
  use the public tokenizer; only the input accounting is scaled.
- **The context limit is enforced on real tokens.** 510 840 real tokens (reported 215 042) is
  accepted; 599 339 real tokens (reported 252 294, and a *smaller* body) is rejected with
  "maximum context length is 524288 tokens".
- Consequently **Pi's context % for the Synthetic DeepSeek models is 2.37× too low**: at the
  moment the provider rejects the request Pi would show ~42 %.

## Reproduction

Environment: pi-bolt 1.4.0 / Pi-Bolt 1.0.5, repo dev HEAD `7df8824`, 2026-10-27 19:20–19:30
Europe/Zurich. Key: Pi's `~/.pi/agent/auth.json` slot `synthetic`, field `key`, passed as
`x-api-key` (Bearer gives the same answers); headers `content-type: application/json` and
`anthropic-version: 2023-06-01`. No credential was printed or written; all probes read
`auth.json` at runtime.

Scripts sit under [`captures/scripts/`](captures/scripts/) (`shape.ts`, `scale.ts`,
`disc.ts`, `accuracy.ts`, `position-models.ts`, `model-matrix.ts`, `big-context.ts`,
`big-hex.ts`, `gen.ts`, `gen2.ts`, and `probe.ts`, the Pi extension that captured the real
payload). They expect the texts the report describes in `/tmp/m3probe`; they are kept for
shape and size, not as a runnable suite.

Real-tokenizer checks: `python3 -m venv` + `tokenizers` 0.23.3, tokenizer files
`deepseek-ai/DeepSeek-V4.1-Flash-1017`, `openai/gpt-oss-120b`, `zai-org/GLM-4.7-Flash`,
`Qwen/Qwen3.8-27B` from huggingface.co. `DeepSeek-V3.1` and `DeepSeek-R1` tokenizer files produce the
same ids as V4.1 for the short test sentence; long texts were only checked against V4.1.

Real Pi payload: `pi-bolt -ne -e probe.ts -e src/index.ts --model
synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017 --thinking off -p "Read /tmp/fixture.json
with the read tool, then answer …"` → 2 requests, system prompt 66 520 chars, 7 tools
(5232 bytes), a `read` tool call and a 7401-char JSON tool result.

## Root cause of the two earlier wrong conclusions

1. **The 500.** Model-gated. A one-line `{"model": <id>, "messages": [{"role":"user",
   "content":"What is the capital of France?"}]}` returns 500 with an empty body for
   `syn:large:vision`, `hf:zai-org/GLM-5.3`, `hf:zai-org/GLM-5.3-Flash`,
   `hf:moonshotai/Kimi-K3` and `hf:Qwen/Qwen3.8-27B`, and 200 for the other nine always-on
   models. The endpoint is not otherwise fragile; the earlier probe presumably used one of
   those models, sent a body that no longer reaches the counter, or hit the endpoint while it
   was transiently broken at 18:53. Its capture recorded only
   `{endpoint, status_with_x_api_key, status_with_bearer}` — no body, no model id — so that
   specific 500 cannot be attributed any further. What is settled: the endpoint is present,
   documented, and answers correctly for the default `hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`
   and 8 other always-on models.
2. **~10 chars/token.** The provider's input accounting reports the model's real count
   multiplied by a per-model factor (0.4208 for the DeepSeek family). It is not a coarser
   tokenizer and not a truncation: the ratio is constant to ±0.5 % over prose, JSON, hex,
   Japanese, emoji and Pi's system prompt, and it does not depend on where the expensive text
   sits in the payload (`hex+prose` 7323 vs `prose+hex` 7322). The stream and the count endpoint
   use the same number, which is why the usage audit's 9.9–10.3 chars/token looked uniform.

The mechanism behind the per-model factor is **not established**. It is applied to inputs only
(outputs are exact), it is not the model's tokenizer, and it is not price-driven
(`hf:openai/gpt-oss-120b` and `hf:zai-org/GLM-4.7-Flash` cost the same $0.0000001/token but
scale by 2.44 and 1.36). Whether Synthetic bills this number or the real one is unknown.

## Evidence

### Shape support (model `hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`)

| Shape | Status | `input_tokens` |
|---|---|---|
| `content` as string / as `[text]` array | 200 | 16 / 16 |
| `system` string | 200 | 18 (+2 for "You are terse.") |
| `system` as two `text` blocks | 200 | 610 (same as one string) |
| 7 real Pi tool declarations (5232 bytes) | 200 | 16 — **tools are not counted** |
| `tool_use` + `tool_result` blocks | 200 | 38 |
| `tool_result` with plain-string content | 200 | 17 |
| `thinking` block with a fabricated signature | 200 | 20 |
| `thinking: {type: disabled}` / `{type: enabled}` | 200 | 16 / 16 |
| 1×1 PNG + text | 200 | 92 |
| `metadata.user_id` | 200 | 16 |
| `max_tokens` + `temperature` + `top_p` + `stop_sequences` + `stream` | 200 | 16 |
| `system`/`content` blocks with `cache_control` | 200 | 16 |
| `anthropic-beta: token-counting-2024-11-01`, `?beta=true` | 200 | 14 |
| verbatim captured Pi request 1 (system + tools + message) | 200 | 6273 |
| verbatim captured Pi request 2 (adds tool_use + 7.4 KB tool_result) | 200 | 7222 |
| request 1 minus `tools` | 200 | 6273 (identical) |
| 200 000-char text | 200 | 25 054 |
| empty `messages` array | 200 | 1 |
| non-always-on or unknown model | 400 | `Only always-on models can be counted` |
| missing `model` | 400 | `.model is missing` |
| unknown content-block type | 400 | schema error listing the allowed options |
| `syn:large:vision`, GLM-5.3, GLM-5.3-Flash, Kimi-K3, Qwen3.8-27B | **500** | empty body, every shape |

Captures: [`captures/count-shapes.json`](captures/count-shapes.json),
[`captures/count-shapes-edge.json`](captures/count-shapes-edge.json),
[`captures/model-matrix.json`](captures/model-matrix.json).

`count_tokens` includes `system`, ignores `tools`, and **the stream does the opposite
addition**: for the captured request the stream reports 6881 = 6273 + 608, and 608 ≈ 0.42 × the
1327 real tokens of the tool declarations. A pre-flight count must therefore add the tool
prompt itself.

### Count vs stream vs real tokenizer

`count_tokens` equals `message_start.usage.input_tokens` exactly on every payload without
tools: DeepSeek 16/16, 2517/2517, 3041/3041; gpt-oss-120b 181/181, 14231/14231, 17398/17398
([`captures/count-vs-stream-usage.json`](captures/count-vs-stream-usage.json), raw SSE beside
it).

Scaling against the model's own tokenizer
([`captures/scaling-vs-tokenizer.json`](captures/scaling-vs-tokenizer.json)):

| text | chars | `count_tokens` | DeepSeek-V4.1 tokens | ratio |
|---|---|---|---|---|
| prose | 1 000 | 128 | 274 | 0.47 (framing dominates) |
| prose | 5 000 | 610 | 1 418 | 0.430 |
| prose | 20 000 | 2 517 | 5 949 | 0.423 |
| prose | 66 000 | 8 263 | 19 599 | 0.4216 |
| JSON | 60 000 | 9 089 | 21 562 | 0.4215 |
| random prose | 20 000 | 1 739 | 4 099 | 0.4242 |
| hex | 20 000 | 4 818 | 11 416 | 0.4220 |
| Japanese | 2 240 | 552 | 1 280 | 0.4313 |
| emoji | 2 069 | 1 581 | 3 724 | 0.4245 |
| Pi system prompt | 66 520 | 6 260 | 14 840 | 0.4218 |
| captured Pi request 1 (system + tools + message) | 72 923 | 6 273 | 16 235 | 0.3863 (tools uncounted) |

Per-model factors, same 20 000-char prose and hex
([`captures/model-matrix.json`](captures/model-matrix.json)):

| model | `count_tokens` prose / hex | real tokens prose / hex | factor |
|---|---|---|---|
| `hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` (and `-Flash`, `syn:large:text`, `syn:small:vision`, `infinite:small:vision`) | 2 517 / 4 818 | 5 949 / 11 416 | 0.42 |
| `hf:zai-org/GLM-4.7-Flash` (= `syn:small:text`) | 7 871 / 18 032 | 5 798 / 13 289 | 1.36 |
| `hf:openai/gpt-oss-120b` | 14 231 / 27 681 | 5 762 / 11 271 | 2.44 (+ ~170 fixed) |
| `hf:nvidia/…-Nemotron-3-Super-120B…` | 5 852 / – | not measured | – |

Generated text is counted correctly
([`captures/output-tokens-vs-tokenizer.json`](captures/output-tokens-vs-tokenizer.json)):
`output_tokens` 128 vs 127 real tokens, and 209 vs 208, on two independent generations.

### Which count the context limit enforces

Model `hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`, catalog `context_length` 524 288, one request
each ([`captures/context-limit.json`](captures/context-limit.json)):

| payload | bytes | `count_tokens` | real tokens | result |
|---|---|---|---|---|
| prose, 1.72 M chars | 1 761 173 | 215 042 | 510 840 | **200** (stream reports 215 031) |
| hex, 1.05 M chars | 1 050 108 | 252 294 | 599 339 | **400** `maximum context length is 524288 tokens … at least 524289 input tokens` |
| prose, 2.10 M chars | 2 150 213 | 262 552 | 623 709 | **400**, same body |

The rejected hex body is *smaller* than the accepted prose body, so the limit is not a byte
cap; and both rejected payloads are far below 524 288 by Synthetic's own number. The decision
is taken on the real tokenizer count against 524 288.

### What this does to Pi

- Pi anchors on `usage`, which for the Synthetic DeepSeek models is 42 % of the real prompt.
  Pi's footer/`getContextUsage`/compaction would show **42 % when the provider is at its
  limit** — a 2.37× under-report. At 20 KB of prose Pi says 2 517 tokens where the model sees
  5 949.
- The error is per model and changes sign: 1.36× high for `GLM-4.7-Flash`, ~2.44× high for
  `gpt-oss-120b` (Pi would compact at ~41 % of that model's real window), 0.42× for the
  DeepSeek aliases and `syn:large:text`/`syn:small:vision`/`infinite:small:vision`. The
  compaction consequence is inferred from the DeepSeek limit test; the 400 was only produced
  on DeepSeek.
- Captured at `message_end` the persisted-looking usage was `input 6871, cacheWrite 6871,
  totalTokens 13764`; that is the pre-correction value the probe sees inside the event, not a
  regression of `correctSyntheticUsage` (the usage audit verified the corrected value live; not
  re-verified here).

## Recommended fix

**Precedence for `synthetic`** (overrides the generic order in `AGENTS.md` for this family):

1. **Known tokenizer** for context-window math and any "real tokens" number. The exact models
   publish `tokenizer.json` on HF (`deepseek-ai/DeepSeek-V4.1-Flash-1017`, 6.4 MB). It is the
   only source whose number the provider's own backend agrees with.
2. **Provider `usage`** for everything the provider itself reports: cost, billing display,
   `/tokens` history. Label it as the provider's count, because it is 0.42× the real prompt for
   the DeepSeek family and 2.4× for gpt-oss.
3. **`count_tokens`** as a cheap pre-flight substitute for (2) — same number, 253 ms p50
   (121 ms ≤ 5 KB, 389 ms > 50 KB, n = 44), no subscription cost. Remember it drops `tools`
   and 500s on 5 of 14 always-on models, so the caller must fall back to (1) or (2).

Do **not** ship a corrective factor: the factors are per model, unexplained, and not stable
across content in a way we can test. If a tokenizer asset is too large for the bytecode budget
(DeepSeek 6.4 MB, GLM-4.7-Flash 20 MB, gpt-oss 28 MB), the honest fallback is to label
Synthetic's numbers as the provider's own unit and to keep Pi's 3.5/4 chars/token estimate out
of Synthetic's context bar until the tokenizer lands.

For slice 3's store: `count_tokens` results can be cached by content hash, but until a
tokenizer exists the cached number must carry source `provider-count` — never `exact`.

Regression test that should exist once the family gets a token source: a fixture of the
captured Pi request (72923 bytes) asserting `count_tokens`-derived numbers are labelled
`provider-count`, and a table-driven test of the per-model factor so a provider change that
fixes the scaling shows up as a failing expectation instead of a silent 2.4× error.

## Open questions / follow-ups

- **Why the per-model factor exists** (0.42 / 1.36 / 2.44 with exact proportionality to the
  real tokenizer). Not a tokenizer, not a price ratio, inputs only. Worth one web check of
  Synthetic's docs/changelog, or a support question, before slice 3 hard-codes a workaround.
- Whether Synthetic **bills** the scaled input count or the real one. The catalog price per
  token is public; a balance/usage endpoint would settle it. Not probed (would need an
  account-mutating or paid surface).
- The 500 models (`syn:large:vision`, GLM-5.3, GLM-5.3-Flash, Kimi-K3, Qwen3.8-27B) may start
  answering later; a fetcher must treat 500 as "unknown", never as 0.
- Image tokens: a 1×1 PNG counted 92, i.e. a fixed per-image cost. Not mapped further; vision
  models are exactly the ones that 500.
- `.project/analyses/tokens/usage-audit/report.md` still calls the streamed number "real prompt
  tokens ... 6869". For Synthetic it is 0.42× the real prompt; that report's Synthetic rows
  and its "~10 chars/token ⇒ not token counts or not the whole prompt" sentence should be read
  against this report.
