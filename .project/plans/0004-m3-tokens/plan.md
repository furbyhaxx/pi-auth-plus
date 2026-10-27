---
document:
  type: "plan"
  id: "0004-m3-tokens"
  title: "M3 tokens"
  description: "Accurate token counts per family: correct usage on every assistant turn, count sources, store, /tokens surface"
  status: "published"
  revision: 6
  created_at: "2026-10-27T18:43:41+01:00"
  updated_at: "2026-10-27T20:20:48+01:00"
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
    - revision: 4
      reason: "slice 3 shaped"
      changes: ["Synthetic probe and tokenizer research results; asset delivery and usage-correction decisions; slice 3 units"]
    - revision: 5
      reason: "U3a-U3c landed"
      changes: ["Tokenizer store, Synthetic usage rescale and wiring landed and live-verified on Pi-Bolt and stock Pi"]
    - revision: 6
      reason: "U3d split, slice 4 detailed"
      changes: ["Counter contracts landed (c58f881, 14120c0); engine, claude counter and family counters delegated; slice 4 units"]
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
[>] 3 Counts       sources per family (usage > count endpoint > tokenizer) + content-hash store
[.] 3b Tokenizers  offline tokenizer assets per family (research/tokenizers)
[.] 4 Surface      /tokens tab, bus pi-auth-plus:v1:tokens:*, footer reuses the store
```

## Slice 3 (now)

Evidence: `analyses/tokens/synthetic-counts/report.md`, `research/tokenizers/report.md`.

- Synthetic: `count_tokens` = `message_start.input_tokens`, both scaled per model vs the
  model's real HF tokenizer (DeepSeek 0.42x, GLM-4.7-Flash 1.36x, gpt-oss 2.44x); output
  exact; context limit enforced on the real count (524288). `count_tokens` ignores tools and
  500s on 5 of 14 always-on models.
- Offline tokenizers exist only for open models (DeepSeek, gpt-oss, GLM, Qwen; Kimi unverified).
  None for Claude, Gemini, GPT-6, Grok. `@huggingface/tokenizers@0.2.0` (Apache-2.0, no deps)
  runs on Bun and Node: 195 ms load, ~4.5 MB/s encode (DeepSeek, 6.4 MB file).

Decisions (user, 2026-10-27): tokenizer files download on first use from Hugging Face into
`$XDG_CACHE_HOME/pi-auth-plus/tokenizers/`, pinned revision + hash check (HF paths-info gives
LFS sha256 or git blob sha1), offline afterwards, fallback to provider usage. Synthetic's
persisted usage is corrected to the tokenizer count at `message_end`; cost unchanged.

Source precedence per family:

```
claude            usage > count_tokens (exact, drop metadata + billing block)
antigravity       usage (Google countTokens unusable); gpt-oss tail: tokenizer
synthetic hf:*    tokenizer (corrects usage) > usage > count_tokens
openai/xai/opencode/deepseek   usage; tail: estimate
```

Units:

```
[x] U3a tokenizer store   src/tokens/tokenizer/ (a3ec7b3, retry/repair 793ce21)
[x] U3b synthetic usage   message_end rescale to tokenizer count (a972462)
[x] U3c wiring + live     32ccdf1; live: DeepSeek prompt persists 15966 (provider ~6.8K),
                          offline reuse ok, stock Pi on Node same
[x] U3d-0 contracts      TokenCounter, FamilyAdapter.tokens, ratio estimates (c58f881, 14120c0)
[x] U3d-1 engine         src/tokens/engine: anchor (mirrors Pi) + tail, breakdown, memo (da5152a)
[x] U3d-2 claude counter count_tokens minus baseline, backoff to measured ratios (19ffeb3)
[x] U3d-3 family hooks   antigravity (claude/gemini ratios, gpt-oss tokenizer),
                         synthetic tokenizer, openai/xai ratios; others default 4/3 (65c63a2)
```

## Slice 4 (next)

```
[>] U4a tracker   src/tokens/tracker: latest ContextReport per session, recompute on
                  session_start, model_select, message_end, turn_end, session_compact,
                  session_tree; debounced, abortable; CounterDeps from quotaAuthFor + store
[>] U4b bus       pi-auth-plus:v1:tokens:{ready,context,query}, decoders + typed consumers
                  in src/bus like the quota bus
[>] U4c tab       /auth tokens view + /tokens entry: total with source, ours vs Pi's,
                  anchor/tail, breakdown (computed on open), tokenizer state; text fallback
[ ] U4d footer    footer clone shows our context % when it matches the model, marked
                  when estimated; tmux pass 36/57/80/140
[ ] U4e docs      docs/tokens.md, README pointer, CHANGELOG; release
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
