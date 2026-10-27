---
document:
  type: "analysis"
  id: "analysis-quotas-parity-run"
  title: "Quota parity run: pi-quotas vs pi-auth-plus on the same host"
  description: "Side-by-side JSON, table, status line and panel comparison at the same moment, with every difference classified as intended, defect or timing"
  status: "published"
  revision: 1
  created_at: "2026-10-27T16:45:43+01:00"
  updated_at: "2026-10-27T16:45:43+01:00"
  created_by: "analyst"
  updated_by: "analyst"
  changelog:
    - revision: 1
      reason: "U24 parity run of slice 8"
      changes: ["live JSON/table/line/panel comparison, openai credential root cause, template token audit"]
---

# Quota parity run (U24)

status: "partially explained"
confidence: "high" for the values, "medium" for the pi-quotas claude staleness mechanism

## Summary

pi-auth-plus reproduces every quota number, window id, label, short label, reset time,
credit balance and tier that pi-quotas reports, once the snapshot age is accounted for.
Two gaps remain. (1) The one-shot CLI drops on-demand reset credits that pi-quotas shows in
both `--json` and `--list-quotas` (`resets.available` / an "On-Demand Resets" column).
(2) openai/`codex` reports `needs-auth` (HTTP 401) because Pi's `auth.json` `openai` slot
holds a token without the ChatGPT account claims; pi-quotas only works because it keeps a
private copy of a Codex CLI login. Everything else is intended (Pi ids, project id out of
tier, unknown as `?`, no CLI reset, namespaced flags), cosmetic (titles, provider order,
`piProvider`, deepseek `tier`) or timing (drainage history, snapshot age).

## Environment

- Host: same host, user `furbyhaxx`, cwd `/tmp/parity-cwd` (empty dir, no project `.pi/`).
- pi-bolt from `~/.local/bin`; both packages loaded alone with
  `pi-bolt --no-session -ne -e <src/index.ts>`; never resolve to the installed copies.
- pi-auth-plus `dev` at `93e37bb`, pi-quotas `dev` at `3284a14`.
- Auth: `~/.pi/agent/auth.json` read-only, never copied or written. No reset credit spent.
- Captures: `.project/analyses/quotas/parity-run/captures/`.

## Reproduction

All four commands ran inside one second (16:36:31-16:36:32 +01:00):

```
pi-bolt --no-session -ne -e /mnt/Projects/furbyhaxx/pi-quotas/src/index.ts --list-quotas --json
pi-bolt --no-session -ne -e /mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts --quotas-json
pi-bolt --no-session -ne -e /mnt/Projects/furbyhaxx/pi-quotas/src/index.ts --list-quotas
pi-bolt --no-session -ne -e /mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts --quotas-list
```

Exit codes: pi-quotas JSON `0`, table `0`; pi-auth-plus JSON `1`, table `1` (needs-auth
counts as a problem on both sides' rules).

**Command correction for the brief:** pi-quotas `--json` on its own is a no-op — it exits 0
with an empty stdout because `parseOneShotArgs` only builds a list request when
`--list-quotas` is present (`pi-quotas/src/cli/args.ts:33-55`). `--list-quotas --json` is the
working form.

Back-to-back single-provider reruns and raw endpoint probes:

```
pi-bolt ... pi-quotas/src/index.ts --list-quotas claude --json      # 16:38:12
bun probe.ts   # 2x GET api.anthropic.com/api/oauth/usage, 3 s apart, claude token from auth.json
bun openai-probe.ts  # wham/usage with pi-quotas' codex token +/- account id, then Pi's token
```

## Value comparison (JSON, same minute)

Provider/window values are equal wherever both sides have data. Only rows with a difference
are listed; everything not listed matched exactly (ids, labels, short labels, `important`,
`period`, `scope`, `valueText`, `resetAt` to the second, `usedPercent`, `remainingPercent`).

| provider | field | pi-quotas | pi-auth-plus | verdict |
|---|---|---|---|---|
| codex / openai | id | `codex` | `openai` | intended (D32) |
| codex / openai | state | `ok`, 7d 63%, tier `pro`, 1 reset | `needs-auth`, HTTP 401 | see D2 below |
| codex / openai | windows | `primary` (Plan 7d, 63%, ↻ 2026-11-02 07:08:05) | none | follows from D2 |
| claude | 5h used% | 4% (16:36:19) | 5% (16:36:15) | timing: pi-quotas stale, see E3 |
| claude | scoped:fable used% | 12% | 18% | pi-quotas stale, see E3; provider says 18% |
| claude | 5h/7d/fable `resetAt` ms | `…000` / `…000827` | `…154` on all three | cosmetic (sub-second server jitter) |
| antigravity | tier | `aicode-consumers` | absent | intended (project id leaves tier) |
| antigravity | title, panel heading | `Google Antigravity` | `Antigravity` | cosmetic |
| antigravity | 5h `resetAt` | 21:35:57 (fetch 21:35:56 + 5 h) | 21:36:16 (fetch 21:36:16 + 5 h) | timing (same formula) |
| deepseek | tier | `available` | absent | cosmetic (pi-quotas puts `is_available` in `tier`) |
| deepseek / openrouter | credits remaining | 20.60 / 29.3559 | 20.60 / 29.3549 | timing (account spending) |
| synthetic | subscription reset | 21:36:07 | 21:36:15 | timing (fetch + 5 h) |
| xai | id, tier, 7d | `xai`, `unified`, 0% | `xai`, `unified`, 0% | equal; `{grok:…}` renders `grok` on both |
| any | `piProvider` | present | absent | cosmetic (ids are Pi ids) |
| any | `title` | `OpenAI Codex`, `Claude Code`, `Google Antigravity`, `xAI Grok` | `OpenAI`, `Claude`, `Antigravity`, `xAI` | cosmetic |
| any | provider order | enabledProviders order (`openrouter, deepseek, codex, claude, antigravity, synthetic, xai`) | registry order (`synthetic, claude, antigravity, openai, xai, openrouter, deepseek`) | cosmetic (templates name ids) |
| any | on-demand resets | `resets: {available: 1}` on codex | field absent everywhere | **defect D1** |

Top-level shape is identical on both: `{v: 1, generatedAt, providers: []}`; window objects
carry the same key set (`id, shortLabel, label, important, usedFraction, resetAtMs,
usedPercent, remainingPercent, resetAt, resetInSec, drainage` plus optional
`period/scope/group/valueText`).

## Drainage (separate: no shared history)

pi-quotas has days of history, pi-auth-plus minutes. Rates and ETAs therefore differ; after
U21 (history carry-over) this converges and it is not a parity defect.

| provider/window | pi-quotas | pi-auth-plus |
|---|---|---|
| openrouter credits | 0.0289 $/h, coverage 1927 s, ETA 42d8h | 0.0301 $/h, coverage 717 s, ETA 40d15h |
| deepseek credits | 0.9416 $/h, coverage 2409 s, ETA 21h52m | 0.3011 $/h, coverage 717 s, ETA 2d20h |
| claude 5h | 6.63 %/h (2173 s) | 10.03 %/h (718 s) |
| claude 7d | 2.05 %/h, no ETA | 2.73 %/h, ETA 15h45m |
| claude scoped:fable | 0.56 %/h | 1.36 %/h, ETA 2d12h |
| antigravity 5h windows | 0 %/h over 313 s | no drainage yet |
| synthetic 7d, xai 7d, antigravity 7d | ~0 %/h | ~0 %/h |

## Table (`--list-quotas` vs `--quotas-list`)

pi-quotas (16:36:31):

```
Provider     Window                   Used  Remaining  Resets at                   On-Demand Resets  Drainage (window)  Drainage (1h)  Drainage (24h)
openrouter   credits                           29.36$
deepseek     credits                           20.60$                                                 0.94$/h → 21h52m
openai       7d                        63%        37%  2026-11-02 07:08:05 +01:00  1                  1.96%/h → 18h55m        1.03%/h         1.96%/h
claude       5h                         4%        96%  2026-10-27 21:00:00 +01:00                              6.63%/h
claude       7d (Fable)                12%        88%  2026-10-31 19:00:00 +01:00                              0.56%/h        1.17%/h         0.58%/h
antigravity  7d (gemini)            58.75%     41.25%  2026-10-28 14:38:11 +01:00                                 0%/h           0%/h
…
```

pi-auth-plus (16:36:31):

```
Provider     Window                   Used  Remaining  Resets at                   Drainage (window)  Drainage (1h)  Drainage (24h)
synthetic    Subscription requests      0%       100%  2026-10-27 21:36:15 +01:00
claude       5h                         5%        95%  2026-10-27 21:00:00 +01:00           10.03%/h
claude       7d (Fable)                18%        82%  2026-10-31 19:00:00 +01:00    1.36%/h → 2d12h
antigravity  7d (gemini)            58.75%     41.25%  2026-10-28 14:38:11 +01:00               0%/h
openai
xai          7d                         0%       100%  2026-11-03 13:23:09 +01:00               0%/h
openrouter   credits                           29.35$                               0.03$/h → 40d15h
deepseek     credits                           20.60$                                0.30$/h → 2d20h
```

Differences: no "On-Demand Resets" column (D1); provider order; the openai row is empty and
its 401 goes to stderr (`openai: needs-auth: … HTTP 401 …; data from 16:36:15`); column
labels, alignment and number formats are otherwise identical. pi-quotas' "Used" column is
omitted for credits rows on both sides.

## Status line (defaults, tmux 80x30 and 140x30)

pi-quotas, 80 cols (user `quotas.json` template, which equals its default):

```
or: 29.35$ · ds: 20.56$ · cox: 64% (1r) · cl: 5h/5% 7d/57% · ag: gem/59% arg/35%
syn: 66% · xai: 0%
```

pi-auth-plus, 80 cols (default template, user `quotas.json` not read by this package):

```
or: 29.35$ · ds: 20.53$ · oai: login · cl: 5h/5% 7d/57% · ag: gem/59% arg/35%
syn: 66% · xai: 0%
```

At 140 cols, pi-quotas: `openrouter: 29.35$ · deepseek: 20.53$ · codex: 64% (1r) · claude:
5h/5% 7d/57% · antigravity: gem/59% arg/35% · synthetic: 66% · grok: 0%`; pi-auth-plus:
identical except `openai: login` (and `xai`/`grok` only where the template names it).
Placement (`below-editor-first`), separators, percent direction, wrapping point, short-id
switch below the compact width and the `(1r)` optional group all behave the same. The only
textual differences are the intended openai/codex id (`oai` vs `cox`) and the 401.

## Panel (`/quota claude` vs `/quotas claude`, `… antigravity`)

pi-quotas, claude, 80 cols:

```
── Provider Quotas   Quotas  · Settings ────────────────── below-editor-first ──
 ❯ Claude Code (cl) · just now
     5h session             ▕█░░░░░░░░░░░▏   5% used · ↻ 4h 19m
     7d weekly              ▕███████░░░░░▏  57% used · ↻ 4d 2h
     7d Fable               ▕█░░░░░░░░░░░▏  12% used · ↻ 4d 2h
     $250 cap               ▕████████████▏ 100% used ($250.22 / $250) · ↻ 8d 16h
 ↑↓ provider · r/R refresh · a show all · p position · l codex login · Tab/s se…
```

pi-auth-plus, claude, 80 cols:

```
── Auth › Quotas ───────────────────────────────────────── below-editor-first ──
  Providers  ▸Quotas   Tokens   Settings
 ❯ Claude (cl) · 2m ago
     5h session          ▕█░░░░░░░░░░░▏ 6% used · ↻ 4h 16m
     10.6%/h (window) · 10.6%/h (1h) · 10.6%/h (24h) · resets first
     7d weekly           ▕███████░░░░░▏ 58% used · ↻ 4d 2h
     …
     7d Fable            ▕██░░░░░░░░░░▏ 18% used · ↻ 4d 2h
     $250 cap            ▕████████████▏ 100% used ($250.22 / $250) · ↻ 8d 16h
 tab switch · ↑↓ provider · r/R refresh · a show all · p position · esc close
```

pi-quotas keeps `[aicode-consumers]` next to `Google Antigravity (ag)`; pi-auth-plus omits it
(intended). At 80 cols pi-quotas truncates `Claude and GPT models…` and drops the `(7d)`
qualifier; pi-auth-plus keeps it (`Claude and GP… (7d)`). pi-auth-plus adds a drainage line per
window and a descriptions row; pi-quotas adds an `l codex login` hint. Bar widths and the
`↻` countdown format match at both widths (140-col captures in `captures/`).

## Template audit (user `~/.pi/agent/quotas.json`)

The user's `lineTemplate` compiled against pi-auth-plus' real engine and cache
(`/tmp/parity-cwd/render.ts`, read-only, no TUI):

```
unknown tokens: []
explicit ids: ["openrouter","deepseek","openai","claude","antigravity","synthetic","xai"]
--- width 80
"or: 29.35$ · ds: 20.41$ · oai: login · cl: 5h/6% 7d/58% · ag: gem/59% arg/35%"
"syn: 66% · xai: 0%"
--- width 140
"openrouter: 29.35$ · deepseek: 20.41$ · codex: login · claude: 5h/6% 7d/58% · … · grok: 0%"
```

Every token the template uses is supported: `id`, `credits-remaining`, `window-<id>-used-percent`,
`resets-available`, the `[ … ]` optional group, and the aliases `codex`/`grok`
(`src/quotas/line/template-parser.ts:8-27`, alias resolution via `core/registry`). The legacy
window names `7d-gemini` and `7d-gemini-4-argon` are mapped explicitly
(`src/quotas/line/template.ts:60-81`). `resets-available` renders from
`snapshot.resetCredits` (`src/quotas/line/template.ts:165-172`), which the openai usage body
populates once the login works — so the template will show `(1r)` after `/login openai`
(`UNVERIFIED` live, 401 today). U20's carry-over can therefore keep `lineTemplate` verbatim.

## Defects

### D1 (major) — one-shot CLI drops on-demand reset credits

- pi-quotas: JSON `providers[].resets = {available: 1}` for `codex`, and a table column
  "On-Demand Resets" (`pi-quotas/src/cli/table.ts:11-21` header, `:144` cell,
  `pi-quotas/src/cli/report.ts:40` field, `:112` populated from `snap.resetCredits`).
- pi-auth-plus: neither. `ReportProvider` has no reset field
  (`src/quotas/report.ts:80-114`) and the table headers stop at drainage
  (`src/cli/table.ts:11-20`).
- Cause: the value exists in the snapshot layer (`ProviderQuotaSnapshot.resetCredits`,
  `src/quotas/types.ts:50`, filled by `src/families/openai/quota.ts:147-159`, preserved by
  `src/quotas/merge.ts:31`), but `buildQuotaReport` never copies it into the report and the
  table never renders it. Display-only gap, no fetcher change needed.
- Impact after the swap: the only read-only way to see openai's 1 reset credit disappears,
  and any script reading `.providers[].resets.available` breaks. The panel and
  `/quotas reset` are unaffected.
- Fix: emit `resets: { available }` from `snapshot.resetCredits` in `src/quotas/report.ts`,
  add the "On-Demand Resets" column to `src/cli/table.ts` (`HEADERS`, `RIGHT_ALIGNED`, row
  builder), extend `tests/quotas/report.test.ts` and the table test with a snapshot that has
  `resetCredits: 1`.

### D2 (blocker for the swap, not a code defect) — openai quota needs `/login openai`

- pi-auth-plus: `state: "needs-auth"`, `openai: GET https://chatgpt.com/backend-api/wham/usage
  rejected authentication (HTTP 401)`. pi-quotas: 7d 63-64%, tier `pro`, 1 reset.
- Root cause (observed): Pi's `auth.json` `openai` token carries only
  `{per_user_salt, encrypted_auth_metadata}` in its `https://api.openai.com/auth` claim — no
  `chatgpt_account_id`, no plan — and wham/usage answers 401, with and without a
  `ChatGPT-Account-Id` header. pi-quotas never touches that slot: it keeps its own copy of a
  Codex CLI login in `~/.pi/agent/quotas-codex-auth.json` (claim has `chatgpt_account_id`,
  plan `pro`), which returns 200 (`primary 64`, `reset credits 1`) from the same host at the
  same minute. `loadCodexCredential` seeds that file from `auth.json`'s `openai-codex` slot
  (`pi-quotas/src/auth/credentials.ts:32-60`).
- Consequence: D32 forbids a private credential file, so parity depends on the user running
  `/login openai` before pi-quotas leaves the setup. Until then the openai line shows `login`,
  the table row is empty, and the reset credit is invisible even after D1 is fixed.

### D3 (cosmetic) — provider titles

`OpenAI Codex`→`OpenAI`, `Claude Code`→`Claude`, `Google Antigravity`→`Antigravity`,
`xAI Grok`→`xAI` in JSON `title` and panel headings (`src/families/anthropic/index.ts:21`,
`src/families/google/index.ts:19`; pi-quotas titles at `pi-quotas/src/types.ts:86-122`). Keep
or align deliberately; nothing depends on it.

### D4 (cosmetic) — provider order and dropped `piProvider` / deepseek `tier`

JSON and table order follow the registry, not the user's `enabledProviders` string; templates
and consumers address providers by id, so this only affects reading order. `piProvider` is
redundant because ids are Pi ids; deepseek `tier: "available"` is pi-quotas exposing
`is_available` (`pi-quotas/src/providers/deepseek.ts:36`), not a plan.

## Evidence and ruled out

- E1. Full JSON pair captured at 16:36:31/32; all equal fields enumerated above by diffing
  key sets and values (`captures/1-pi-quotas-json.json`, `captures/2-pi-auth-plus-json.json`).
- E2. Table pair captured back to back (`captures/3-pi-quotas-table.txt`,
  `captures/4-pi-auth-plus-table.txt`).
- E3. The claude 4% vs 5% and Fable 12% vs 18% gap is **pi-quotas staleness**, not a
  pi-auth-plus defect: a direct double GET of `api.anthropic.com/api/oauth/usage` at 16:41
  returned `session=5, weekly_all=57, weekly_scoped(Fable)=18` both times, matching
  pi-auth-plus exactly; pi-quotas still reported Fable 12% at 16:38. pi-quotas' cached claude
  snapshot has `source: "headers"` and its header merge keeps windows the headers do not carry
  (`pi-quotas/src/cache/host-cache.ts:230-263`), while claude's polling floor is 300 s
  (`pi-quotas/src/types.ts:45`) and header ingestion runs on every streamed response — so its
  displayed age stays "just now" while the scoped window is old. Which endpoint fetch left
  `0.12` behind is not established (its own history for that window stops earlier at `0.14`,
  which does not line up); mechanism partially explained.
- E4. openai root cause: `openai-probe.ts` output — pi-quotas token + account id `200`,
  pi-quotas token alone `200`, Pi's `auth.json` token `401`; claim keys printed, values never.
- E5. Line and panel captures at 80 and 140 columns for both packages
  (`captures/pq-line-*.txt`, `ap-line-*.txt`, `pq-panel-*.txt`, `ap-panel-*.txt`).
- E6. Unknown rendering: pi-auth-plus renders `?` for an undefined fraction
  (`tests/quotas/line/template.test.ts:182,239`); no provider returned an unknown value in
  this run, so the `?`-vs-`0` difference could not be observed live.
- Ruled out: different endpoints or credentials for claude (same URL, same token, same UA,
  same `anthropic-beta`); different parse of claude `limits[]` (both map `percent/100`,
  `resets_at`, scope display name); different openai request headers (both send
  `codex_cli_rs/0.60.0`, `originator`, `Accept`, optional `ChatGPT-Account-Id`); a
  pi-auth-plus formatting regression in credits/percent/bar/countdown (byte-identical output
  apart from values).

## Not compared / open questions

- Bus (`pi-auth-plus:v1:quotas:*`) skipped as allowed by the brief.
- `--quotas-json <provider>` / `--quotas-list <provider>` accepted aliases confirmed only for
  `claude`; pi-quotas' `--quota-reset`/`--confirm-reset` have no pi-auth-plus counterpart by
  design (no CLI reset), so they were not exercised.
- Whether Pi's current `openai` slot ever worked (a Codex login that expired vs an
  API-scoped token) is unknown; one `/login openai` settles it.
- After U20/U21 land, re-run this file's commands: the line should become identical to
  pi-quotas' except ids and the openai state, and drainage columns should converge.
- Unrelated observation: the accidental Enter in the pi-quotas tmux session sent a stray chat
  message (`uota claude`) that was aborted within seconds; it used model tokens, no quota
  credit.
