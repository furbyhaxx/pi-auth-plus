---
document:
  type: "analysis"
  id: "absorbed-packages-review"
  title: "Absorbed packages vs pi-auth-plus swap review"
  description: "Go/no-go review before replacing the four provider packages with pi-auth-plus"
  status: "published"
  revision: 1
  created_at: "2026-10-27T13:40:00+01:00"
  updated_at: "2026-10-27T13:40:00+01:00"
  created_by: "second-opinion"
  updated_by: "second-opinion"
---

# Absorbed packages vs pi-auth-plus swap review

Reviewed pi-auth-plus `dev` 23b5b04 (in sync with origin/dev) against pi-claude-auth b489042, pi-opencode-auth 0195f47, pi-synthetic-auth 20f7b12, pi-antigravity-auth b04d594, pi-quotas 9cdf100, Pi 1.4.0 dist in `node_modules`.

## Verdict

**GO with fixes.** The four providers themselves are a safe replacement: every enabledModels entry resolves in an isolated `pi-bolt --list-models` run, the synthetic catalog parses to the identical 14 models with identical costs, existing `claude`/`synthetic`/`antigravity` slots need no re-login, a fork-format `google` slot does not crash Pi's builtin google, `bun test` (182 pass) and `tsc` are green. What breaks is the **pi-quotas coexistence** the user explicitly keeps: antigravity quota stops resolving (and goes stale within an hour), `/quota` is renamed to `/quota:1` by Pi's duplicate-command rule, and pi-auth-plus warns every session to `pi remove` pi-quotas. Fix those three before or with the swap; the rest is non-blocking.

## Blocking findings

1. **[major] pi-quotas loses the antigravity quota after the swap.**
   Where: pi-quotas `src/types.ts:105` `piProviders: ["google", "google-antigravity"]`; `src/providers/request.ts:34-52`; pi-auth-plus `src/families/google/oauth.ts:252` (`toAuth` returns headers only, no `apiKey`).
   Why: pi-quotas resolves the token via `modelRegistry.getApiKeyAndHeaders` over `piProviders`, then falls back to raw `auth.json[piProv].access`. After the swap, `google` is Pi's API-key-only builtin (`pi-ai/dist/providers/google.js:10`), so the registry path returns no apiKey (`pi-ai/dist/models.js:237-240` → `undefined`), and the raw path reads the fork's leftover `google.access`, which nobody refreshes once the fork is gone → 401 within ≤1 h. The fork worked because it used legacy `getApiKey` (fork `src/index.ts:155-160`), which gave pi-quotas an apiKey through the refreshing registry path.
   Fix (pi-quotas): add `"antigravity"` as the first entry of `piProviders` for `antigravity`. Note that even then pi-quotas only gets the raw `antigravity.access` (header-only `toAuth`), refreshed only when an antigravity turn runs; this equals today's claude behavior (pi-claude-auth was header-only too). Better: let `resolveBearerToken` accept `res.headers.Authorization` as token.

2. **[major] `/quota` becomes `/quota:1` while pi-quotas and pi-auth-plus are both loaded.**
   Where: pi-auth-plus `src/ui/commands/index.ts:26-30,120-124` registers `quota`, `quotas`, `tokens`; Pi `core/extensions/runner.js:556-586` suffixes duplicate command names. Verified: RPC `get_commands` with both extensions returns `quota:1` (pi-quotas) and `quota:2` (pi-auth-plus).
   Why: the user's daily `/quota` (the one with real data) disappears; pi-auth-plus's `/quota:2` opens an empty Quotas tab.
   Fix: drop the `quota`/`quotas`/`tokens` entry points from pi-auth-plus until the quota engine lands (M2), or skip registering them when `detectConflicts` finds pi-quotas.

3. **[minor, pairs with 2] Wrong conflict warning every session.**
   Where: `src/core/conflicts/index.ts:4-10` lists `pi-quotas`; `src/index.ts:44-56` notifies "pi-auth-plus replaces ... pi-quotas ... Remove: pi remove git:https://git.viitrium.io/furbyhaxx/pi-quotas".
   Why: pi-auth-plus has no quotas yet; following the advice would remove the user's only quota surface.
   Fix: remove `pi-quotas` from `ABSORBED_PACKAGES` until M2 (and the matching expectation in `tests/core/conflicts.test.ts`).

## Non-blocking findings

4. **[minor] Antigravity `streamSimple` never calls `options.onPayload`/`onResponse`.** `src/families/google/provider.ts:84-120`; Pi contract `pi-coding-agent/dist/core/extensions/types.d.ts:1427-1429`; own AGENTS.md "Provider integration". `before_provider_request`/`after_provider_response` extensions never see antigravity traffic. Same gap in the fork (no `onPayload` in fork `src/`), so no regression. The user's loaded extensions do not hook those events for antigravity (`gemini-reasoning-guard` is `.disabled` and OpenRouter-only).
5. **[minor] No bounded timeout or idle watchdog on the antigravity stream.** `provider.ts:104-109` plain `fetch` with only the caller signal; `stream.ts:parseAntigravitySse` reads without an idle timer. The fork had `pre-response-deadline.ts` (10 min) and an idle watchdog in `agy-transport.ts`. A stalled connection hangs the turn until Esc. Violates AGENTS.md "A turn never hangs". Fix: `AbortSignal.any([signal, AbortSignal.timeout(...)])` for headers plus an idle timer between frames.
6. **[minor] Leftover `google` oauth slot.** Pi's builtin `google` treats an oauth slot on an apiKey-only provider as "not authenticated" (`pi-ai/dist/models.js:267-268`), so builtin google stays hidden even with `GEMINI_API_KEY`, and pi-quotas reads its stale token (finding 1). No crash: `--list-models` ran fine with a fork-format `|`-packed slot. Recommend `/logout google` once `/auth` shows antigravity signed in and finding 1 is fixed. Migration is a no-op for this user (`antigravity` slot already present → `forkLoginPending()` false, no lock taken; `src/families/google/migration.ts:9-11`).
7. **[nit] Migration scope wider than decision D3.** `migration.ts:14-33` migrates any `google` oauth slot, not only packed-form/fork ones (inventory D3). Moot here.
8. **[nit] Claude `account_uuid` empty until refresh.** Existing slot has no `accountUuid`; `oauth.ts:252-257` sends `""`; refresh adds it only if the token response carries `account.uuid` (`oauth.ts:88-95`). UNVERIFIED that the refresh response includes it. Documented in plan.md:152-153.
9. **[nit] First Claude OAuth turn pays up to 2 s for `claude --version`** (`version.ts:DETECT_TIMEOUT_MS`, lazy via `ReportedVersion.get`). Moved from startup to first request; acceptable.
10. **[info] Known limits do not affect this user.** `settings.json` has `claude: null`, `websearch: null` (jq); `SYNTHETIC_WEB_SEARCH` unset in this shell, UNVERIFIED for the user's login shell.
11. **[info] Session restore.** Sessions recorded on `google/antigravity-gemini-4-argon` fall back to the default model on restore; expected consequence of the id change.
12. **[info] Endpoint.** pi-auth-plus uses `daily-cloudcode-pa` only (`transport.ts:6`); the fork defaulted to prod with daily fallback (fork `constants.ts:35-37`). pi-quotas also queries daily; CLI 1.4.8 dossier says daily is the default origin.

## Per-package parity

### pi-claude-auth → `families/anthropic`

| feature | old | pi-auth-plus | status |
|---|---|---|---|
| provider `claude`, Pi anthropic catalog re-tagged | provider.ts:92 + hardcoded 5.5 models | provider.ts:54-56 (`getModels("anthropic")`, Pi 1.4 has 5.5/fable/haiku) | parity, verified by `--list-models` |
| OAuth login (PKCE, state, code paste), API-key manual/create, `ANTHROPIC_API_KEY` | provider-auth.ts | oauth.ts | parity |
| refresh retries 5xx/network, 500 ms/1 s backoff | provider-auth.ts:34-56 | oauth.ts:214-241 | parity (+ timeout via core/http) |
| zero cost for oauth | provider.ts:104-106 | provider.ts:47-49,101-102 | parity |
| `mcp_` tool prefix | constants.ts:24 | bare PascalCase, `tool-names.ts` | intentional change (decided) |
| `cch` billing hash | cch.ts | billing block without `cch` | intentional (decided) |
| identity string | "You are a Claude agent, built on Anthropic's Claude Agent SDK." | "You are Claude Code, Anthropic's official CLI for Claude." + session header + metadata.user_id | intentional (match CLI) |
| sanitizer anchors/replacements | constants.ts:110-178 | sanitize.ts:7-24 (same lists) | parity |
| `claude.replacePatterns` in settings.json | settings.ts | `auth-plus.json` only | documented drop; user has none |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_INSECURE`, `ANTHROPIC_CLAUDE_CODE_VERSION`, installed-claude detection | config.ts | request.ts, version.ts | parity (probe now lazy) |
| SSE/JSON tool-name restoration, stale headers removed | transform.ts | response.ts | parity |
| collision error for same-wire tool names | README | tool-names.ts:28-31 | parity |

### pi-synthetic-auth → `families/synthetic`

| feature | old | pi-auth-plus | status |
|---|---|---|---|
| provider `synthetic`, anthropic-messages at `api.synthetic.new/anthropic` | provider.ts | index.ts:33-40 | parity |
| catalog fetch in factory (network at startup) | index.ts:21-27 | bundled snapshot + `refreshModels`, 4 h TTL | improvement; store continuity verified (14 stored models restore) |
| model filter: always_on, tools, ctx/max | models.ts:58-70 | catalog.ts:21-30 (+ skips rows without price; `[]` features) | identical result on current catalog (0 diff, verified) |
| `/login synthetic`, `SYNTHETIC_API_KEY` | auth.ts | `apiKey: "$SYNTHETIC_API_KEY"` + Pi generic prompt | parity |
| `--synthetic-web-search` flag | index.ts:13 | index.ts:41-44 | parity |
| `websearch.synthetic` setting, `SYNTHETIC_WEB_SEARCH` env | index.ts:36-38 | `synthetic.webSearch` in auth-plus.json | documented drop; user has none |
| results without `published` kept | dropped | kept | improvement |

### pi-opencode-auth → `families/opencode`

| feature | old | pi-auth-plus | status |
|---|---|---|---|
| header spoof gated on Pi's `x-opencode-*` stamp | spoof.ts:33-55 | identity.ts:82-100 | parity (UA 2.1.2 vs 1.18.18, tracked) |
| anonymous `public` key when no credential | registered in `session_start` | factory (models.json/env check) | improvement (works for `--model`) |
| `x-opencode-request` per request | set | not set | minor drop, undocumented |
| `<env>` block in system prompt | none | identity.ts:106-131 | addition (Zen gate) |

### pi-antigravity-auth → `families/google`

| feature | old | pi-auth-plus | status |
|---|---|---|---|
| provider id | `google` | `antigravity` | decided |
| model ids | `antigravity-gemini-4-argon`, `-gemini-3.8-flash`, `-claude-opus-5-5`, `-claude-sonnet-5-5`, `-gpt-oss-120b-medium`, `-gemini-3.5-flash`, `-gemini-3.1-flash-image` | `gemini-4-argon`, `gemini-3.8-flash`, `claude-opus-5-5`, `claude-sonnet-5-5`, `gpt-oss-120b` | decided; 3.5-flash and image model dropped (not in live catalog) |
| OAuth client/scopes/redirect | 5 scopes, loopback | 7 scopes, remote redirect, code paste | decided |
| packed `refresh\|project` | core/auth.ts | project per session (`project.ts`) | decided; migration unpacks |
| envelope, labels, thinkingConfig, VALIDATED toolConfig, schema allowlist | stream.ts, agy-request-metadata.ts | request.ts, levels.ts, schema.ts | parity |
| SSE parse, in-band error, promptFeedback, gpt-oss usage grace, empty/truncated errors | stream.ts | stream.ts | parity |
| named reasons with recovery (RATE_LIMIT_EXCEEDED ...) | raw text | errors.ts | improvement |
| pre-response deadline / idle watchdog | pre-response-deadline.ts, agy-transport.ts | none | gap (finding 5) |
| raw TLS transport | agy-transport.ts | plain fetch | decided |
| `/antigravity` menu, vault, pool, env vars | commands.ts, vault-* | `/auth`; dropped | decided |
| account_uuid/telemetry | none | none | parity |

## enabledModels resolution

Isolated `PI_CODING_AGENT_DIR=$(mktemp -d)` with dummy `claude`/`antigravity` oauth, `synthetic` api_key and a fork-format `google` slot; `pi-bolt --offline --no-extensions -e ./src/index.ts --list-models` exit 0, 120 rows.

| entry | result |
|---|---|
| claude/claude-opus-5-5, claude-fable-5-1, claude-haiku-5-5, claude-sonnet-5-5 | listed |
| synthetic/hf:moonshotai/Kimi-K3, hf:Qwen/Qwen3.8-27B, hf:zai-org/GLM-5.3, hf:zai-org/GLM-5.3-Flash, infinite:small:vision, syn:large:text, syn:small:text, syn:large:vision, syn:small:vision, hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4, hf:deepseek-ai/DeepSeek-V4.1-Flash-1017 | all 11 parse from the bundled snapshot with costs/caps identical to pi-synthetic-auth's builder (script diff: 0 old-only, 0 new-only, no cost diff); Kimi-K3, syn:large:text, infinite:small:vision spot-checked in `--list-models` |
| google/antigravity-gemini-4-argon → antigravity/gemini-4-argon | listed; levels low/medium/high (`off`/`minimal` null) |
| openai, xai, deepseek, nvidia, openrouter | untouched by pi-auth-plus (no registration for those ids) |

## What I checked

Read: pi-auth-plus `src/**` (all families, core/auth, conflicts, registry, ui/commands), CHANGELOG, plan 0002, inventory; the four old packages' entries, READMEs and auth/provider/transport sources; pi-quotas `types.ts`, `providers/request.ts`, `providers/antigravity.ts`, `auth/credentials.ts`; Pi 1.4 dist (`models.js` credential resolution and `clampThinkingLevel`, `runner.js` command dedup, `types.d.ts` streamSimple contract, `google.js` auth). Ran: `bun test --isolate` (182 pass), `tsc --noEmit` (0), isolated `--list-models`, isolated RPC `get_commands` with pi-quotas + pi-auth-plus, synthetic/antigravity catalog parse scripts (temp files removed). Looked at `~/.pi/agent` read-only: settings packages/enabledModels/`claude`/`websearch` keys, auth.json slot types/keys only, models-store.json provider keys and ids. Not checked: live provider calls, Pi-Bolt compile of the package, the user's login-shell env, the `/auth` dashboard rendering, `proper-lockfile` compatibility with Pi's actual lock (store.ts comment claims it; plan says live-verified).

## Confidence

High on findings 1-3 (reproduced 2 live; 1 traced through Pi dist and both repos' code). Medium on 5 and 8 (code reading only). Would change my mind on 1 if pi-quotas has an unseen antigravity path outside `providers/request.ts`.

---

**Final: GO with fixes.** Blocking before/with the swap: (1) pi-quotas `src/types.ts:105` add `"antigravity"` to antigravity `piProviders` (otherwise the antigravity quota row dies within an hour on the stale `google` token); (2) pi-auth-plus `src/ui/commands/index.ts:26-30` remove `quota`/`quotas`/`tokens` entry points until M2 (Pi renames the user's `/quota` to `/quota:1`, verified); (3) drop `pi-quotas` from `ABSORBED_PACKAGES` (`src/core/conflicts/index.ts:9`) so the per-session "pi remove pi-quotas" warning stops. Then `/logout google` after `/auth` confirms antigravity. All listed enabledModels resolve; no re-login needed.