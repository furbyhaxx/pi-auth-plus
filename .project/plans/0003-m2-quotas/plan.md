---
document:
  type: "plan"
  id: "0003-m2-quotas"
  title: "M2 quotas"
  description: "Port the pi-quotas engine, seven providers, line, panels, bus and CLI onto core/ and families/"
  status: "published"
  revision: 2
  created_at: "2026-10-27T14:28:39+01:00"
  updated_at: "2026-10-27T14:56:16+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["User decisions D32 recorded; slice 1 (engine core) in detail, slices 2-8 sparse"]
    - revision: 2
      reason: "slices 1-3 done"
      changes: ["Engine and all seven fetchers merged and live-verified; slice 4 (headers + bus) in detail"]
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
[>] 4 Headers + bus     header ingestion from after_provider_response; pi-auth-plus:v1:quotas:* + report
[ ] 5 Line              template parser/renderer, line placements, widget, footer
[.] 6 Panels            /auth quotas panel with refresh, settings panel from the catalog
[.] 7 Resets + CLI      panel resets with confirm dialog; --quotas-json / --quotas-list
[.] 8 Cutover           fill-only quotas.json migration, docs, live parity run, setup swap, release
```

## Slices 1-3: done

Engine (`src/quotas/{types,engine,state,settings,drainage}.ts`) on `HostCache` at
`cacheDir()/quotas.json`; session start and turn end never wait on the network. Seven quota
parts, each live-verified read-only on 2026-10-27: claude, antigravity, synthetic, openrouter,
deepseek, xai, openai. openai returned HTTP 401 for the current credential (needs a ChatGPT
`/login openai`), so its success path is fixture-tested only. Aliases `cl`, `cc`, `ag` added.

## Slice 4: headers + bus (now)

Outcome: a claude or ChatGPT turn updates that provider's windows from response headers
without a poll, and another extension can query, refresh and watch quotas over
`pi-auth-plus:v1:quotas:*`.

Facts that shape it:

- Pi fires `after_provider_response` (`{status, headers}`, no provider id) from the agent's
  `onResponse` for every provider, ours included (antigravity was fixed to call it). One handler
  covers all of them; a second ingestion inside our fetch wrappers would double-count.
- Header shapes (pi-quotas `providers/parse.ts:40-140`): ChatGPT
  `x-codex-{primary,secondary}-{used-percent,window-minutes,reset-at}` + `x-codex-plan-type`;
  claude `anthropic-ratelimit-unified-{5h,7d,7d_oi,overage}-{utilization,reset}` (fraction,
  may exceed 1, clamped).
- Nobody consumes the pi-quotas bus, so the channel contract is new, without compat shims.

Units. U8 defines the interface; U9, U10, U11 run in parallel (disjoint files); I wire
`src/index.ts`.

8. **U8 contract** (me). `QuotaSource.headers?(headers, now)` returns a `source: "headers"`
   snapshot or `undefined` when the shape is not its own.
9. **U9 header parsers**. Write scope: `src/families/{anthropic,openai}/quota.ts` + tests.
   Test: a real-shaped header set yields the windows; an unrelated header set yields `undefined`;
   a missing utilization stays unknown.
10. **U10 engine ingestion**. Write scope: `src/quotas/{engine,state}.ts`, new
    `src/quotas/merge.ts`, `tests/quotas/`. `engine.ingestHeaders(headers, hint)` asks the hinted
    provider's parser first, then the others; the claimant's state gets `headers` via
    `cache.patch` (no `fetchedAt` move) plus a drainage sample. `view()` returns the endpoint
    snapshot overlaid with newer header windows (per window id; labels, period and scope from the
    endpoint). Test: a header patch after an endpoint fetch shows the header value, keeps the
    endpoint's other windows and `fetchedAt`, and a later endpoint fetch wins again.
11. **U11 report + bus**. Write scope: `src/quotas/{report,bus}.ts`, tests. `QuotaReport` from
    pi-quotas `cli/report.ts` with Pi ids; channels `ready`, `snapshot`, `event`
    (`auth-required`, `rate-limited`), `query {providers?, maxAgeSec?}`, `refresh {providers?,
    force?}` over `core/bus`. Resets channels come with slice 7. Test: a `query` for an alias
    answers with the Pi id, an unknown provider gets an error listing known ids.

Verification: `bun test --isolate tests/quotas tests/families/{anthropic,openai}`, typecheck,
lint; then one live claude turn on Pi-Bolt and stock Pi with pi-quotas absent, showing the
header-updated windows in the cache file.

## Slice 5+: sparse

- Line: pi-quotas `render/*` template parser and placements; Pi ids, aliases resolve.
- Panels: `/auth quotas` with refresh; settings tab from the catalog.
- Resets: openai only (`codex-resets.ts`), `ctx.ui.select` with "Keep the credit" first.
- Cutover: fill-only migration of pi-quotas' cache/config, live parity run, setup swap, release.
- The footer token math stays until M3.
