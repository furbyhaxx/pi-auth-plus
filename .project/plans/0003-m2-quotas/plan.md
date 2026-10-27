---
document:
  type: "plan"
  id: "0003-m2-quotas"
  title: "M2 quotas"
  description: "Port the pi-quotas engine, seven providers, line, panels, bus and CLI onto core/ and families/"
  status: "published"
  revision: 5
  created_at: "2026-10-27T14:28:39+01:00"
  updated_at: "2026-10-27T15:37:07+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["User decisions D32 recorded; slice 1 (engine core) in detail, slices 2-8 sparse"]
    - revision: 2
      reason: "slices 1-3 done"
      changes: ["Engine and all seven fetchers merged and live-verified; slice 4 (headers + bus) in detail"]
    - revision: 3
      reason: "slice 4 done"
      changes: ["Header ingestion + bus live-verified on both runtimes; slice 5 (line) in detail"]
    - revision: 4
      reason: "slice 5 done"
      changes: ["Quota line live-verified on both runtimes, all placements, 80/120/160 columns"]
    - revision: 5
      reason: "slice 6 started"
      changes: ["Slice 6 (panels) units in detail; dashboard tabs are pluggable views"]
---

# M2 quotas

Goal: pi-auth-plus replaces pi-quotas. All seven providers report quotas through family `quota`
parts, one engine owns the host cache, the line, the `/auth quotas` panel, the settings panel,
the bus and the read-only CLI. Then the user's setup drops pi-quotas in one swap.

Input: `.project/analyses/quotas/pi-quotas-inventory.md` (pi-quotas `3284a14`).

## Decisions (D32, user, 2026-10-27)

- **Cutover = full parity first.** pi-quotas stays loaded and owns `/quota` until every slice
  below has landed. The swap happens once, at the end.
- **CLI**: read-only flags survive, namespaced: `--quotas-json`, `--quotas-list`. No CLI reset;
  a reset credit is spent only from the panel, behind a confirm dialog.
- **Ids = Pi provider ids everywhere**: `openai` (not `codex`), `claude`, `antigravity`,
  `synthetic`, `openrouter`, `deepseek`, `xai`. Old names (`codex`, `cox`, `cl`, `ag`, `grok`, ...)
  stay as registry aliases, so `/quota codex` and `{codex:...}` templates still resolve.

Agent decisions (not user-facing choices):

- Unknown is never zero: deepseek missing balance, xai double failure and antigravity missing
  `remainingFraction` become errors or unknown values, not `0`/`1`.
- A window or balance the provider exposes stays visible even when its numbers are missing
  (usage `undefined`). xai: an omitted `creditUsagePercent` is 0% while the period runs (the
  API omits it for unused periods), unknown after it ended. antigravity: a missing
  `remainingFraction` is unknown, because an exhausted bucket was recorded with an explicit `0`.
- The antigravity project id leaves `tier`; it never reaches the UI, `--quotas-json` or the bus.
- Credentials come from `ctx.modelRegistry.getProviderAuth(id)`: Pi refreshes OAuth, and the
  token is `auth.apiKey` or the bearer of `auth.headers.Authorization` (our header-only claude
  and antigravity). No own credential file, no `<cwd>/.auth.json` read.
- Header snapshots never move `fetchedAt`; they are stored with their own `observedAt`.
- While pi-quotas is loaded the engine stays off (no double polling, no second cache writer).
  The dev loop runs pi-auth-plus with `-e` and `--no-extensions`.

## Slices

```
[x] 1 Engine core       contract, registry quota part, cache gaps, drainage, engine, settings
[x] 2 Existing families claude, antigravity, synthetic fetchers (+ fixtures from pi-quotas)
[x] 3 New families      openrouter, deepseek, openai (ChatGPT), xai as quota-only adapters
[x] 4 Headers + bus     header ingestion from after_provider_response; pi-auth-plus:v1:quotas:* + report
[x] 5 Line              template parser/renderer, line placements, widget, footer
[>] 6 Panels            /auth quotas panel with refresh, settings panel from the catalog
[.] 7 Resets + CLI      panel resets with confirm dialog; --quotas-json / --quotas-list
[.] 8 Cutover           fill-only quotas.json migration, docs, live parity run, setup swap, release
```

## Slices 1-3: done

Engine (`src/quotas/{types,engine,state,settings,drainage}.ts`) on `HostCache` at
`cacheDir()/quotas.json`; session start and turn end never wait on the network. Seven quota
parts, each live-verified read-only on 2026-10-27: claude, antigravity, synthetic, openrouter,
deepseek, xai, openai. openai returned HTTP 401 for the current credential (needs a ChatGPT
`/login openai`), so its success path is fixture-tested only. Aliases `cl`, `cc`, `ag` added.

## Slice 4: headers + bus: done

`QuotaSource.headers` parsers for claude (`anthropic-ratelimit-unified-*`) and openai
(`x-codex-*`); `engine.ingestHeaders` stores them via `cache.patch` with `observedAt`;
`merge.ts` overlays newer header values on endpoint windows (unknown never erases known).
`pi-auth-plus:v1:quotas:{ready,snapshot,event,query,refresh}` served per session
(`src/quotas/{report,bus}.ts`). Live on Pi-Bolt and stock Pi 1.4.0: a claude turn's headers
land in the cache 6/6 runs; a bus `query` for `cc` answers as `claude`, `nope` gets the known-id
list. Two bugs found live and fixed: an endpoint write dropped headers observed during the
fetch (`putWith` under the lock), and print mode exited before the header write landed
(shutdown waits up to 2 s).

## Slice 5: line: done

`src/quotas/line/`: template engine (pi-quotas grammar, Pi ids, registry aliases, unknown
renders `?`), row packing capped at `terminalRows - 8`, widget placements, footer placement
(pi-workbench `setFooterRows("pi-auth-plus")` when it serves, else the ported pi-quotas footer),
seven catalog settings. Live on Pi-Bolt and stock Pi: every placement at 80 and 160 columns,
plus the pi-workbench handoff at 120; 80 columns switches to short ids and wraps to two rows.
Known gap kept for parity: the own footer omits Pi's newer `(sub)` cost suffix (M3 removes the
footer token math anyway).

## Slice 6: panels (now)

Outcome: `/auth quotas` shows live per-provider quota detail with refresh, and `/auth settings`
edits every catalog key with staged edits, scope choice and a live line-template preview.

Groundwork (done, `226b0c7`): `AuthDashboard` renders each tab through a `TabView`
(`src/ui/dashboard/view.ts`); Providers and Tokens stay static `RowsView`s. A view sees keys
first; `finish({editSetting})` closes the panel so the command can open a Pi dialog.
`engineReport()` in `report.ts` is the one report builder for the bus and the panel.

Units. U15 and U16 run in parallel; U17 needs both.

15. **U15 quotas tab**. `src/ui/dashboard/quotas.ts` + test. pi-quotas `ui/panel.ts` quotas
    half: selection, `r`/`R` refresh, `a` solo/all, `p` cycle placement, bars, countdowns,
    drainage, auth/error rows. Test: unknown usage shows `?` with no filled bar; selection
    survives a data change; refresh hits the selected provider.
16. **U16 settings tab**. `src/ui/dashboard/settings.ts` + test. pi-quotas `ui/settings.ts`
    over our catalog and `SettingsStore`: staged edits, save to user/project/session, default
    reset, list/rules fields via a Pi editor after close, template preview. Test: staged edits
    save only to the chosen scope; a shadowed key warns.
17. **U17 wiring** (me). `src/ui/commands/index.ts`, `src/index.ts`: live tabs, `/auth quotas
    <provider>`, `/quota` and `/quotas` entry points only while pi-quotas is not loaded, line
    remount on placement change, editor follow-up. tmux pass at 36/57/80/140 columns.

## Slice 7+: sparse

- Resets: openai only (`codex-resets.ts`), `ctx.ui.select` with "Keep the credit" first.
- CLI: `--quotas-json`, `--quotas-list`.
- Cutover: fill-only migration of pi-quotas' cache/config, live parity run, setup swap, release.
- The footer token math stays until M3.
