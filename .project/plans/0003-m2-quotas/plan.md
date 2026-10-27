---
document:
  type: "plan"
  id: "0003-m2-quotas"
  title: "M2 quotas"
  description: "Port the pi-quotas engine, seven providers, line, panels, bus and CLI onto core/ and families/"
  status: "completed"
  revision: 11
  created_at: "2026-10-27T14:28:39+01:00"
  updated_at: "2026-10-27T17:55:28+01:00"
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
    - revision: 6
      reason: "slice 6 done"
      changes: ["Quotas and settings tabs live on both runtimes; /quota moved to cutover; slice 7 in detail"]
    - revision: 8
      reason: "slice 7 done"
      changes: ["Resets with confirm and read-only CLI live on both runtimes; slice 8 (cutover) in detail"]
    - revision: 9
      reason: "codex credential decision (D33)"
      changes: ["ChatGPT quota id becomes codex with its own credential chain and login; U20-U25 and codex units done"]
    - revision: 10
      reason: "M2 released"
      changes: ["Live tmux pass at 36/57/80/140 done; released as v0.3.0; setup swap next"]
    - revision: 11
      reason: "M2 done"
      changes: ["pi-quotas swapped out of the user setup; live check on Pi-Bolt and stock Pi"]
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

**D33 (user, 2026-10-27, deliberate change of the id rule and the login rule above).** Pi's
`openai` login ("Sign in with ChatGPT") gets HTTP 401 on every ChatGPT usage and reset endpoint
(`.project/analyses/quotas/openai-chatgpt-login.md`), and `/login openai-codex` duplicates the
Codex models in the picker. So the ChatGPT quota is `codex` everywhere (aliases `openai`,
`openai-codex`, `chatgpt`, `cx`, `cox`, `oai`); its credential is Pi's `openai-codex` login,
else pi-quotas' `quotas-codex-auth.json` (refreshed under a file lock), and
`/quota codex login [--device|--browser]` writes that file.

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
[x] 6 Panels            /auth quotas panel with refresh, settings panel from the catalog
[x] 7 Resets + CLI      panel resets with confirm dialog; --quotas-json / --quotas-list
[x] 8 Cutover           carry-over, docs, parity, bus client, codex (D33), v0.3.0, swap
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

## Slice 6: panels: done

`/auth` tabs render through `TabView`s (`src/ui/dashboard/view.ts`). Quotas tab
(`quotas.ts`): selection, `r`/`R` force refresh, `a` solo, `p` placement (saved to user scope),
bars, countdowns, drainage, `/login <id>` hints; clipped labels keep their `(5h)` qualifier.
Settings tab (`settings.ts`): every catalog key by section, staged edits, `ctrl+s` then
`u`/`p`/`r` scope, shadow warnings, template preview with ignored tokens; list and rules fields
open Pi's editor as JSON after the panel closes, then the panel reopens on that row.
`/quotas [provider]` opens the tab; `/quota` stays with pi-quotas until cutover, because Pi
renames duplicate commands to `quota:1`/`quota:2`. With pi-quotas loaded the tab says so.
Live: Pi-Bolt and stock Pi at 36/57/80/140 columns, editor round trip, RPC text output.

## Slice 7: resets + CLI: done

openai reset credits (`src/families/openai/resets.ts`: list, consume sent once, never retried)
behind `engine.listResets`/`consumeReset` (consume, then forced refresh) and
`src/quotas/resets.ts`. Spending needs an in-session `ctx.ui.select` with "Keep the credit"
first: Quotas tab `x` (only where supported), `/quotas reset [provider]`, and bus `reset`
(`confirm: true` plus the same dialog, prefixed "Another extension requests this reset.");
without UI nothing is spent. Families now declare Pi providers through
`providerRegistrations(host)`, so `registerFamilyProviders` serves both the extension and a
standalone `ModelRegistry`. `src/cli/`: `--quotas-json`/`--quotas-list [provider]` run at the
top of the factory with a lazily imported `ModelRuntime` (user settings only), exit 0/1/2.

Live on Pi-Bolt and stock Pi: `--quotas-json cc` answers `claude`, `nope` exits 2 with the
known ids, auth.json untouched; `/quotas reset` and `x` stop at openai's HTTP 401 without
spending (a fake credit reached the dialog at 36/57/80/140 columns, Keep spent nothing). Bug
found live and fixed: staleness ignored provider polling floors, so claude (5 min floor)
read `stale` between polls and the CLI exited 1.

## Slice 8: cutover: done

Outcome: pi-auth-plus owns `/quota`, carries the user's pi-quotas settings over, is documented,
and matches pi-quotas side by side; then pi-quotas leaves the setup and M2 is released.

Inputs: pi-quotas config `<agentDir>/quotas.json` (user) and `<cwd>/.pi/quotas.json` (project),
cache `<agentDir>/cache/quotas-cache.json` (inventory lines 424, 504).

Units (all landed on dev unless marked):

- [x] U20 settings carry-over, U21 history carry-over (once, fill-only, only without pi-quotas;
      history merges into the host cache, snapshots are not imported).
- [x] U22 `/quota` + pi-quotas conflict hint.
- [x] U23 docs: `docs/{quotas,events,configuration,commands,getting-started}.md`, README.
- [x] U24 parity run (`.project/analyses/quotas/parity-run.md`): missing reset counts fixed;
      remaining differences are titles/order (intended) and pi-quotas' own staleness.
- [x] U25 `@furbyhaxx/pi-auth-plus/bus` client.
- [x] Codex (D33): credential store with locked refresh, id `codex`, `QuotaSource.auth`
      resolver, `/quota codex login`, Providers tab and panel show the codex login commands.
      Live: `--quotas-json codex` ok on Pi-Bolt and stock Pi through the pi-quotas file.
- [x] Cache fix: same-millisecond writes from another session win over stale memory.
- [x] Live tmux pass at 36/57/80/140 (line, `/auth` Providers + Quotas,
      `/quota codex login --device` first leg); released as v0.3.0.
- [x] Swapped `pi-quotas` out of `~/.pi/agent/settings.json` (D29); live check: `/quota`,
      line and `--quotas-json`/`--quotas-list` on Pi-Bolt and stock Pi.

## Later

- The footer token math stays until M3.
