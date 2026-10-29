---
version: 1
id: "live-quotas-counts-qa"
title: "Configured-account quota and native-count QA"
description: "Live quota normalization, missing-auth recovery, and native-count accuracy"
type: "analysis"
created: "2026-10-29T19:58:29+01:00"
updated: "2026-10-29T19:58:29+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Bun 1.4.3; pi-coding-agent 1.4.0; Linux x64"
sha: "e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60"
document:
  type: "analysis"
  id: "live-quotas-counts-qa"
  title: "Configured-account quota and native-count QA"
  description: "Live quota normalization, missing-auth recovery, and native-count accuracy"
  status: "published"
  revision: 1
  created_at: "2026-10-29T19:58:29+01:00"
  updated_at: "2026-10-29T19:58:29+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "live read-only acceptance"
      changes: ["record endpoint normalization, missing-auth behavior, and count differential"]
      updated_at: "2026-10-29T19:58:29+01:00"
---

# Configured-account quota and native-count QA

status: "qa-complete"
confidence: "high"

## Summary

Six configured-account quota sources returned usable HTTP 200 responses; their checked
normalized values match the captured payloads. Claude quota returned HTTP 429 and surfaced an
actionable `rate-limited` report. Synthetic recovered from an intentionally hidden credential.

**Acceptance failed:** the composed Claude token engine undercounts two minimal full contexts by
32 tokens while identifying both totals as exact native counts. A deliberately missing Claude
credential falls back to a labelled estimate but gives no authentication recovery hint.

## Environment and scope

- 2026-10-29 19:52–19:57 Europe/Zurich, Linux x64, Bun 1.4.3, coding-agent 1.4.0.
  Tested checkout: `e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60`.
- Used `FAMILIES`, `Registry`, `registerFamilyProviders`, Pi `ModelRuntime`/`ModelRegistry`,
  `quotaAuthFor`, the actual user model overrides and user quota settings, `QuotaEngine`,
  `engineReport`, the actual quota line renderer, and `createTokenEngine`. The runtime-only
  provider-list setting was set to all sources; the configured list already named all seven.
- Pi credential storage was wrapped in a read-only guard. Expiring OAuth credentials and
  command-valued credentials were refused instead of refreshed or executed. The separate
  Codex fallback credential was valid for more than two minutes at fetch time.
- Quota, model-store and XDG caches used a private temporary directory. Every HTTP call had
  an abort signal and timeout. No login, token refresh, generation, credential change, reset
  consumption, or product/source/test/settings edit was performed. OpenRouter's read-only
  key-metadata GET was explicitly authorized for this QA.
- These are composed-engine and renderer probes, not a live Pi-Bolt terminal capture.
  Native reference counts were fetched directly against the shaped count endpoint; no
  corresponding generation was made, as prohibited.

## Test matrix

Percentages and balances are point-in-time values. Full redacted requests, response statuses,
raw response bodies and snapshots are in [the live capture](2026-10-29-live-capture.md).

| Source | Observed result | Normalization / state |
| --- | --- | --- |
| Synthetic quota | `GET /v2/quotas`: 200 | Subscription 0/500, weekly 37.045456% used, search 0/250. All three checked against the payload. |
| Claude quota | `GET /api/oauth/usage`: 429, `Retry-After: 0` | Report `rate-limited`, endpoint/status/retry guidance; line `5h/err 7d/err`. No authoritative current windows observed. Engine applies its 60 s fallback hold. |
| Antigravity quota | `loadCodeAssist`: 200; `retrieveUserQuotaSummary`: 200 | All five bucket fractions equal `1 - remainingFraction`; weekly Gemini 9.44886%, third-party 8.20592%, Argon 99.4404%. |
| Codex quota | `GET /backend-api/wham/usage`: 200 | Legacy Codex OAuth fallback: primary 7d 56% used, one available reset credit reported. The `openai-codex` Pi slot was missing. No reset operation was performed. |
| xAI quota | Both `/v1/billing` forms: 200 | Unified weekly usage 44%, matching `creditUsagePercent`. Monthly limit 0 does not establish a monthly quota under the project's provider research. |
| OpenRouter quota | `GET /api/v1/credits` and read-only `/api/v1/key`: 200 | Remaining account credit $17.6340302840008 equals total minus usage; key limit is null. |
| DeepSeek quota | `GET /user/balance`: 200 | USD total balance $11.59, matching the source. This endpoint is present in project source and was permitted by the brief. |
| Claude native text and tool counts | Five differential calls plus three initial calls: all 200 | Full-context comparisons **fail** below. Initial raw `x` baseline 33, `Hello.` request 36, and `x` with one tool 375; the counter's tool delta is 342. |
| Other native counts | No native request sent | Selected Synthetic alias, OpenAI, xAI, OpenRouter and DeepSeek counters expose estimate IDs. Antigravity's family has no native counter in the composed source; no Antigravity model ID is in the requested reference list. This does not prove those vendors lack endpoints. |
| Missing auth | All seven credentials deliberately hidden; empty private Codex agent directory | Seven reports say `needs-auth`, all contain a login action; every line shows `login`; zero network calls. See [missing-auth capture](2026-10-29-missing-auth.md). This is a deliberate isolation case, not the configured state. |
| Synthetic recovery | Hide only Synthetic auth, then restore the actual configured credential on the same engine | `needs-auth` / `synthetic: login` became HTTP 200, `ok` / `synthetic: 37%`. The test used a fresh private cache, not fabricated credentials. |
| Missing Claude count auth | Deliberately return no credential to the actual token engine | Zero network calls; total `3 · estimate`; dashboard text has no reason or login action. |

## Defects

### Major: Claude native context total omits the common request baseline

**Reproduction:** With the configured Claude OAuth account and `claude-haiku-5-5`, use the real
family counter in `createTokenEngine` on one user message, `Hello.`, no tools, and no prior
provider-usage anchor. Compare its result to a count request containing the same shaped Claude
identity, user message and optional system text. The reference count omits billing and metadata
as described by the existing live count-endpoint research.

| System text | Full native response | Engine report | Difference |
| --- | --- | --- | --- |
| empty | 36 | 4, `count-endpoint` | -32 |
| `Be concise.` | 41 | 9, `count-endpoint` | -32 |

All five differential requests returned 200. The actual requests and responses, including the
full shaped reference payloads, are in [the differential capture](2026-10-29-count-differential.md).
A comparison assertion exited 1 with `FAIL Claude exact full-payload context matches provider
count`. This establishes a difference from the native full-request count; matching future
streamed generation usage was not independently tested because generation was prohibited.

**Causal chain:** `src/families/anthropic/count.ts:117-133` counts each segment by subtracting
an identity-plus-one-message baseline and adding one. `src/tokens/engine/index.ts:219-237`
sanitizes system segments but does not restore the identity framing;
`src/tokens/engine/index.ts:284-312` sums the segment counts as the whole unanchored context.
The `count-endpoint` source survives the sum. `src/ui/dashboard/tokens.ts:21-27` describes that
source as `exact (count API)`. The subtraction explains the 33 - 1 = 32 missing tokens observed
in both cases; larger or differently shaped contexts may have additional role/tool overhead.

**Recommended fix:** Count the complete shaped request for unanchored authoritative context,
or otherwise preserve all required framing while proving exactness; do not hardcode the observed
32-token offset. Count post-usage tails independently and label them estimates unless exactness
is established. Add regression cases comparing engine totals with full native request counts
for empty and nonempty system prompts, multi-message/tool contexts, and usage-anchored tails.

### Minor: missing native-count credentials silently fall back

**Reproduction:** Supply no Claude credential to the real family/token engine and request the
same minimal context. No HTTP request is made. `tokensText` shows `Total: 3 · estimate` and
`Tail: 1 message · 3 · estimate` with no missing-auth reason or `/login claude` hint. The
estimate itself is labelled correctly, but the user cannot tell why native counting is absent.

`src/families/anthropic/count.ts:60` returns no count when auth is absent, and lines 129–131
replace it with an estimate. The token result contract carries no fallback reason; the
presentation at `src/ui/dashboard/tokens.ts:21-27` only receives the source. Propagate a
non-secret missing-auth diagnostic alongside the fallback and show a provider-specific recovery
action. Add a regression for both the labelled estimate and login hint; retain estimation as a
fallback.

## Commands and evidence

Temporary scripts used only read-only transports and were removed after the run. Exact commands:

```sh
MODELS_DEV_CACHE_DIR=/tmp/pi-quota-live.v7UEJY5D/xdg-cache XDG_CACHE_HOME=/tmp/pi-quota-live.v7UEJY5D/xdg-cache timeout 30 /home/furbyhaxx/.pi/agent/skills/models-dev/scripts/models.dev --summary --no-color 'claude-haiku-5-5'
XDG_CACHE_HOME=/tmp/pi-quota-live.v7UEJY5D/xdg-cache XDG_STATE_HOME=/tmp/pi-quota-live.v7UEJY5D/state timeout 120 bun /tmp/pi-quota-live.v7UEJY5D/probe.ts
XDG_CACHE_HOME=/tmp/pi-quota-live.v7UEJY5D/xdg-cache XDG_STATE_HOME=/tmp/pi-quota-live.v7UEJY5D/state timeout 30 bun /tmp/pi-quota-live.v7UEJY5D/missing.ts
XDG_CACHE_HOME=/tmp/pi-quota-live.v7UEJY5D/xdg-cache XDG_STATE_HOME=/tmp/pi-quota-live.v7UEJY5D/state timeout 60 bun /tmp/pi-quota-live.v7UEJY5D/count-differential.ts
XDG_CACHE_HOME=/tmp/pi-quota-live.v7UEJY5D/xdg-cache XDG_STATE_HOME=/tmp/pi-quota-live.v7UEJY5D/state timeout 15 bun /tmp/pi-quota-live.v7UEJY5D/missing-token.ts
timeout 15 bun /tmp/pi-quota-live.v7UEJY5D/verify.ts
timeout 15 bun /tmp/pi-quota-live.v7UEJY5D/privacy.ts
```

The first five commands exited 0; models.dev listed the referenced Claude model. The verifier
passed quota comparisons and Synthetic recovery but exited 1 for the full-context count
assertion described above. The privacy check exited 0: zero full configured-secret matches,
zero abbreviated key labels, zero recognized credential patterns in all three captures, and
zero short known credential fields. The initial capture contained an abbreviated OpenRouter
key label and account identifiers when first read into the tool transcript; a subsequent
in-memory `src/core/redact/index.ts` pass masked them in the retained capture. No full
credential value was output. The earlier transcript retains the abbreviated label.

The live capture's first `nativeCount.context.tail` is `[circular]` because the redactor treats
a repeated reference as circular; `context.tokens` is intact. The independent differential
capture records both complete engine totals without that serialization artifact.

## Gaps and follow-ups

- Claude quota success and successful recovery from its live 429 were not observed; no
  rate-limit bypass or polling was attempted. Recheck after the provider hold has expired.
- No claim is made about untested vendor-native count APIs, actual generation usage, or
  Pi-Bolt TUI placement. No full test suite was run; this was live QA without source changes.
- Source, tests, manifests, historical audits, `.pi`, configured auth and settings were not
  edited. Other agents' pre-existing worktree changes were left untouched.
