---
document:
  type: "analysis"
  id: "flexible-templates-2026-10-26-antigravity-argon-and-claude-absent"
  title: "Antigravity Argon limit absent; Claude absent from the condensed line"
  description: "Live diagnosis of provider-side removal of Argon quota and the auth-state filter hiding Claude"
  status: "published"
  revision: 2
  created_at: "2026-10-26T15:32:21+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "analyst"
  updated_by: "pi"
  source: "pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/analyses/flexible-templates/2026-10-26-antigravity-argon-and-claude-absent.md"
  changelog:
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/analyses/flexible-templates/2026-10-26-antigravity-argon-and-claude-absent.md"]
---

# Antigravity Argon limit absent; Claude absent from the condensed line

status: "partially explained"
confidence: "high"

Analysed revision: `8237cee` (installed package `~/.pi/agent/git/git.viitrium.io/furbyhaxx/pi-quotas`, identical
to `git archive HEAD` of the checkout). The checkout working tree also holds another agent's in-progress
edits to `src/types.ts`, `src/config/fields.ts`, `src/config/store.ts`; every repro below ran against a clean
HEAD snapshot in `/tmp/pi-quotas-head` (removed afterwards), never against those edits.

## Summary

- **Antigravity Argon is not a pi-quotas regression.** The provider stopped returning the group: the live
  `retrieveUserQuotaSummary` payload has two groups and weekly buckets only, and
  `fetchAvailableModels` marks `gemini-4-argon-disabled` as `disabled: true` ("available to Ultra and
  paid Pro plan subscribers"). The parser and renderer handle the old payload correctly.
- **Claude's total disappearance is a renderer bug.** `src/render/line.ts:148` drops every provider whose
  snapshot has `needsAuth` from the `{all}` remainder, except `codex`. With credentials removed, the same
  binary renders the exact reported symptom. `needsAuth` is also sticky: it survives header snapshots and
  failures in the shared cache, so one transient auth miss hides Claude for minutes.
- Smallest fixes: stop filtering at line 148 (render `login`), and stop inheriting `needsAuth` in
  `SharedQuotaCache.putSnapshot`/`recordFailure`.

## Reproduction

Environment: pi-bolt 1.4, Bun 1.4.3, host `cachy-max`-class workstation, agent dir `~/.pi/agent`.
Sanitized responses and terminal evidence remain in `fixtures/` and `captures/`.
The temporary `capture-live.ts`, `probe-antigravity.ts`, `repro-fixtures.ts` and
`repro-line.ts` scripts named below were removed after verification.

1. Live line, current state, 100 columns — Claude present:

   ```
   or: 9.62$ · ds: 20.53$ · cox: 13% (r 1) · cl: 14%/32%/100% · ag: 0%/0% · syn: 0%/82% · xai: 100%
   ```

   (`captures/line-100-live-current.txt`)
2. Same binary, agent dir copy without the `claude` and `google` credentials — Claude gone entirely, Codex
   still shown as `login` (`captures/line-120-no-claude-credential.txt`):

   ```
   openrouter: 9.62$ · deepseek: 20.53$ · codex: login · synthetic: sub 0% 7d 82% · xai: 100%
   ```
3. Antigravity quota, one read-only POST per variant (`probe-antigravity.ts`, 2026-10-26 15:20 +01:00):
   UA `2.19.1` and `2.24.0` × body `{"project": …}` and `{}` all return HTTP 200, 1056 bytes,
   `Gemini Models[gemini-weekly] | Claude and GPT models[3p-weekly]`. No argon group, no 5h buckets.
   Body `{"project": …, "metadata": …}` returns 400.
4. `fetchAvailableModels`: `gemini-4-argon-disabled` with `"disabled": true`,
   `tagTitle: "Unavailable"`, `tagDescription: "Gemini 4 Argon is currently available to Ultra and paid
   Pro plan subscribers."`, no `quotaInfo`.
5. Parser replay of the 2026-10-21 three-group capture (`repro-fixtures.ts`) →
   `gemini-argon-wtu-weekly[arg] used=1 important=true`, line `ag: 0%/0%/100%` / `arg 100%`.

## Root cause

### Antigravity (upstream)

The account's free tier lost Gemini 4 Argon access, so the endpoint no longer emits the
`Gemini 4 Argon` group or any `5h` bucket; the top-level payload description changed from
"a weekly limit and a 5-hour limit" (research capture, `.project/research/provider-quota-credits-reporting.md:127`)
to "models share a weekly limit". Shared-cache history agrees: argon samples 11:57–14:23, weekly-only from
15:08 (`~/.pi/agent/cache/quotas-cache.json`).

Code-side check: group classification from the first bucket id (`src/providers/antigravity.ts:91-97`) and
window emission (`:100-124`) reproduce the old payload faithfully. The classification would only mislabel
if Argon ever arrived as a *second* bucket inside the `Gemini Models` group.

### Claude (code)

- `src/render/line.ts:148`: `shown = remainder.filter((id) => id === "codex" || !snapshots.get(id)?.needsAuth)`
  — every `needsAuth` provider except Codex is removed from the line, while
  `renderProviderSegment` (`src/render/line.ts:31-33`) already knows how to print `login`.
- Sticky flag: `src/cache/host-cache.ts:235-262` merges a header snapshot as `{ ...prev, ...snapshot }`, and
  `:296-303` merges failures the same way, so `needsAuth: true` and `windows: []` survive both. Only a 200
  from `GET /api/oauth/usage` (`src/providers/claude.ts:129`) clears them.
- Claude's usage endpoint currently answers `429` with `retry-after: 0`
  (`fixtures/claude-usage-live-2026-10-26-429.json`); with a 300 s poll floor (`src/types.ts:44-46`) and the
  60 s rate-limit hold (`src/cache/host-cache.ts:43`), a transient `needsAuth` keeps Claude invisible while
  `/quota` (panel, `ui/panel.ts:323`; summary, `render/summary.ts:25`) still lists it.
- `needsAuth` is produced only by `src/providers/fetch.ts:48-60` when no token resolves; it is not produced by
  401/429. Contributing condition: Pi writes `auth.json` non-atomically (`pi-coding-agent/dist/core/auth-storage.js:71`),
  and `readAuthJson` swallows parse errors to `{}`.

## Evidence

- Live captures and sanitized fixtures (no tokens, no project/account ids) in `fixtures/`:
  `antigravity-quota-live-2026-10-26.json`, `antigravity-quota-research-contract.json`,
  `antigravity-available-models-argon-2026-10-26.json`, `claude-usage-live-2026-10-26-429.json`.
- Width matrix from the real cache (`repro-line.ts`): Claude and Antigravity are both present at 140/100/80
  columns for every active-provider value; at 57 columns units are dropped from the end
  (`line.ts:167-180`), so a narrow terminal can hide Claude by design. Not the reported cause at 100 columns.
- Ruled out: request body and client UA (probe above); project resolution (the `google` refresh token carries
  `…|aicode-consumers` and `loadCodeAssist` agrees); parser version gating
  (`PROVIDER_PARSER_VERSIONS.claude = 2`, live snapshot carries `parserVersion: 2`); enabled providers
  (`~/.pi/agent/quotas.json` lists `claude`); project-scope config (no `.pi/quotas.json` exists in the user's
  projects).
- Missing evidence: the moment of the user's "Claude entirely absent" observation. The shared cache here has
  no `needsAuth` snapshot and the live line shows Claude. A capture from the affected session, or the host it
  was seen on (a host whose `auth.json` lacks `claude`/`anthropic` reproduces it immediately), would close it.

## Recommended fix

1. `src/render/line.ts:148` — render every provider; delete the `codex`-only exception and the filter
   (`const shown = remainder;`). Claude then shows `claude: login` instead of vanishing, matching project goal
   4 ("Nothing silently disappears"). Regression test in `tests/render/line.test.ts`: a `needsAuth` snapshot
   for `claude` and `antigravity` must appear as `login` in `{all}` output.
2. `src/cache/host-cache.ts:235` and `:296` — do not inherit `needsAuth`/empty `windows` implicitly. Compose the
   merged snapshot from explicit fields (`windows`, `credits`, `tier`, `resetCredits`, `fetchedAt`, `source`)
   and clear `needsAuth` when a fresh header snapshot arrives. Test: put a `needsAuth` snapshot, then a header
   snapshot, then assert `needsAuth` is gone and windows are kept; same for `recordFailure`.
3. Antigravity needs no code change. If the lead wants the removed Argon window visible, that is a design
   decision, not a parser fix: the provider exposes no data for it (`fetchAvailableModels` marks the model
   unavailable).

## Applied resolution

- The new renderer keeps configured providers visible as `login`, `err`, `…` or `?`;
  narrow output wraps instead of filtering providers or dropping later segments.
- Successful header snapshots clear inherited `needsAuth` and `error` while retaining
  supplementary quota data. Ordinary failed requests retain authentication state; a
  failure is not evidence of successful authentication.
- Named Antigravity selectors use stable bucket-derived scopes, with parser version 2.
  Missing Argon data renders `?`; no allowance is inferred from Gemini or `3p` buckets.
- Cache, selector and provider-fixture regressions pass. Live terminal verification and
  the final integration gate are recorded in `qa.md`.

## Open questions / follow-ups

- Is Argon's removal permanent for this tier? Re-check `gemini-4-argon-disabled.disabled` in a few days.
- Claude `429` on `/api/oauth/usage` with `retry-after: 0` → `parseRetryAfterMs` returns 0, so the code applies
  the 60 s default (`src/cache/host-cache.ts:284-292`). Confirm with the lead whether a `0` immediate-retry
  header should shorten the hold.
- Claude numbers are stale while 429s continue (`cl: 13%` from headers vs `14%` from the last endpoint read);
  unrelated to the absence but visible in the same row.
