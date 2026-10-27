---
document:
  type: "analysis"
  id: "analysis-migration-src-restructure"
  title: "Migration to src/ domain modules: verification evidence"
  description: "What the src/, tests/, docs/ restructure changed, the checks that ran, the live provider fetches, and the terminal captures at 36, 57, 80 and 140 columns"
  status: "published"
  revision: 2
  created_at: "2026-10-26T09:06:44+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "orchestrator"
  updated_by: "pi"
  source: "pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/analyses/migration/report.md"
  changelog:
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/analyses/migration/report.md"]
---

# Migration to `src/` domain modules

The package moved from nine flat root modules to domain folders, matching the layout
contract in `AGENTS.md`.

## What moved

| Before | After |
|---|---|
| root `index.ts` (502 lines, all logic in one closure) | `src/index.ts` (12 lines), `src/runtime.ts`, `src/events.ts`, `src/commands/quota.ts` |
| root `providers.ts` (999) | `src/providers/{fetch,request,parse,openrouter,deepseek,codex,claude,antigravity,synthetic,xai}.ts` |
| root `render.ts` (415) | `src/render/{format,line,footer,widget,summary}.ts` |
| root `ui.ts` (799) | `src/ui/{panel,settings,primitives}.ts` + `src/config/fields.ts` |
| root `config.ts` (240) | `src/config/store.ts` + `src/auth/credentials.ts` |
| root `cache.ts` (191) | `src/cache/host-cache.ts` |
| root `codex-oauth.ts` (390) | `src/auth/codex-oauth.ts` |
| root `quotas.test.ts` (297) | `tests/types/`, `tests/providers/`, `tests/cache/`, `tests/render/` |

Behavior was held identical: every provider body, URL, header, timeout, clamp and message
was carried over unchanged, and no exported symbol was renamed.

## Checks

| Check | Result |
|---|---|
| `just check` (tsc + biome + bun test) | pass, 8 tests / 50 assertions across 5 files |
| `just rpc-verify` | pass, `/quota` registered from `src/index.ts` |
| Live fetch, openrouter | `source=endpoint`, credits 11.59$, detail day/wk/mo |
| Live fetch, codex | `tier=pro`, `resetCredits=1`, 7d window at 2% |
| Live fetch, xai | 7d window at 100%, reset in ~1d 4h |
| Live fetch, claude (direct script) | HTTP 429 at that moment; the running session fetched the same provider successfully 15s earlier (panel capture shows 5h 2%, 7d 25%, Fable 0%, $250 cap 100%) |
| Terminal captures | 36, 57, 80, 140 columns; zero over-width lines in every capture |

## Captures

`.project/analyses/migration/captures/`

- `width-{36,57,80,140}.txt` — condensed line degradation: full labels and seven providers
  at 140, short ids from 80, tail dropped at 57 and 36, and `cox` retained at 36 because the
  active model maps to codex.
- `panel-140.txt`, `panel-80.txt` — provider panel, labels truncated with `…` at 80.
- `panel-settings-140.txt`, `panel-settings-80.txt` — settings tab with source scopes.
- `live-fetch.txt`, `live-fetch-2.txt` — raw live provider snapshots.

## Open items

- The claude usage endpoint answered 429 to a direct call while the same provider's data
  arrived normally inside the running session; treat that as provider-side rate limiting, not
  a regression.
- `xai` reports 100% used with a reset about a day out; that is the account state, not a parse
  bug.
