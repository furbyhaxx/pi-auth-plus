---
document:
  type: "plan"
  id: "0004-m3-tokens"
  title: "M3 tokens"
  description: "Accurate token counts per family: correct usage on every assistant turn, count sources, store, /tokens surface"
  status: "published"
  revision: 3
  created_at: "2026-10-27T18:43:41+01:00"
  updated_at: "2026-10-27T19:19:44+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Seams and sources scouted; slice 1 (evidence) in detail, later slices sparse"]
    - revision: 2
      reason: "slices 1-2 done"
      changes: ["Live usage audit and count probes recorded; synthetic double count fixed; slice 3+ scope awaits user"]
    - revision: 3
      reason: "user scope decision"
      changes: ["Scope = counts + /tokens + offline tokenizers, no early compaction; Synthetic count_tokens exists (user correction)"]
---

# M3 tokens

Goal: the token numbers Pi and our surfaces show are right, and say where they come from.

## What the scouting established (2026-10-27)

- Pi has two estimators and no hook to replace either: pi-ai clamps `maxTokens` at 3.5
  chars/token, pi-coding-agent drives the footer, `getContextUsage` and auto-compaction at 4.
  Both anchor on the latest valid assistant `usage` and estimate only the messages after it.
- The one lever on Pi's own numbers: correct `usage` on every assistant message. Our streams
  set it; for Pi builtins a `message_end` handler may return a same-role replacement, which Pi
  copies in place before persisting (reaches session file, footer, compaction, clamp).
- `context` edits are request-scoped; `turn_end` is after persistence; `session_before_compact`
  changes compaction, not estimation.
- Known gap: antigravity gpt-oss frames carry no `usageMetadata` (1 s trailing grace only).
- No tokenizer data exists in this repo or the absorbed ones. Native count endpoints are only
  documented: Anthropic `/v1/messages/count_tokens` (Claude Code treats it as nonessential,
  OAuth acceptance unknown) and Google `v1internal:countTokens` (never observed; agy gates its
  estimator by `supportsEstimateTokenCounter`, false for Claude and named Gemini models).
- Our footer clone (`src/quotas/line/footer.ts`) re-sums Pi's usage; it estimates nothing.

## Slices

```
[x] 1 Evidence     analyses/tokens/{usage-audit,count-endpoints}/report.md
[x] 2 Usage fix    synthetic duplicate cache write dropped (message_end); antigravity clamp
[.] 3 Counts       sources per family (usage > count endpoint > tokenizer) + content-hash store
[.] 3b Tokenizers  offline tokenizer assets per family (research/tokenizers)
[.] 4 Surface      /tokens tab, bus pi-auth-plus:v1:tokens:*, footer reuses the store
```

## Decision (user, 2026-10-27)

Remaining scope: count sources per family, content-hash store, `/tokens` tab, bus
`pi-auth-plus:v1:tokens:*`, and offline tokenizers. No early compaction (`ctx.compact()` from
our count was offered and not chosen). Synthetic gets a live probe.

User correction: Synthetic documents `POST /anthropic/v1/messages/count_tokens`
(subscriber-only, free against limits, always-on models only). It answers 200 on our key with
`x-api-key` or `Bearer` (16 tokens for "What is the capital of France?"); the earlier 500
came from parts of the full Anthropic payload. Provider capabilities are checked against
current docs before they are stated; tokenizer availability is researched, not assumed.

In flight: `analyses/tokens/synthetic-counts/` (shape support, which count is real, which
one the context limit enforces) and `research/tokenizers/` (offline tokenizer per family).

## Slices 1-2 results (2026-10-27)

- Usage is complete and correctly mapped on claude, antigravity (Gemini, Claude, gpt-oss),
  opencode, openai and xai: persisted prompt = real prompt, 0.0 % error. The gpt-oss
  missing-usage gap did not reproduce (4 of 4 streams carried `usageMetadata`).
- Synthetic repeated the uncached input as `cache_creation_input_tokens` (+100 % first turn).
  Fixed by a `message_end` replacement that drops the duplicate `cacheWrite` (Pi copies the
  replacement in place and does not recompute cost, so `input` keeps the input price).
  Live: 6869-token prompt persists as `totalTokens 6871` (was 13758).
- Pi's remaining error is the tail estimate after the last usage anchor: JSON tool results
  run at 2.1-3.5 chars/token, so 4 chars/token is 12-55 % low (claude 33 %, antigravity
  Claude 48 %). Whole-context estimates without an anchor are -26 % to +16 %.
- Count endpoints (U2; Synthetic row superseded by the decision section): Anthropic `count_tokens` works on the claude OAuth login and is exact
  (0 delta, 6 payloads, p50 166 ms; drop `metadata` and the billing system block, keep
  identity). Google `countTokens` ignores system and tools (-50 % on Claude), unusable.
  xAI tokenize 404, OpenAI `input_tokens` 401, Synthetic/Zen 500/404.
- Open: Synthetic reports ~10 chars/token uniformly; either its counts are not real token
  counts or the endpoint counts differently. Its context % may be 2-3x too low.
- `ctx.compact()` exists, so an extension can trigger compaction from its own count.

## Slice 1: evidence (done)

Two read-only analyst units, in parallel, outputs under `.project/analyses/tokens/`.

1. **U1 usage audit** (`usage-audit/`). One short tool-using turn per route: claude,
   antigravity (Gemini, Claude, gpt-oss), synthetic, opencode free, openai (builtin), xai.
   Per route: raw provider usage vs the persisted assistant `usage` (input, output, cacheRead,
   cacheWrite, totalTokens), a second turn to see cache fields, and Pi's 4 chars/token
   estimate of the same context. Verdict per route: complete, wrong mapping, or missing.
2. **U2 count endpoints** (`count-endpoints/`). Live probes with the configured logins:
   Anthropic `count_tokens` (claude OAuth with our Claude Code identity), Google
   `v1internal:countTokens` (Gemini and Claude model ids), xAI tokenize, each compared with
   the stream-reported input for the identical payload. Latency and rate limits noted.

Exit: a table route x (usage verdict, native count source, accuracy of Pi's estimate), which
decides slice 2's fix list and slice 3's source precedence.

## Later

- Offline tokenizers (assets, bytecode budget) only if slice 1 shows a route without usage
  and without a count endpoint where the estimate error matters.
- Pi estimator hook upstream stays an M4 candidate.
