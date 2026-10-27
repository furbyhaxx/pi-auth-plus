---
document:
  type: "plan"
  id: "0003-m2-quotas"
  title: "M2 quotas"
  description: "Port the pi-quotas engine, seven providers, line, panels, bus and CLI onto core/ and families/"
  status: "published"
  revision: 1
  created_at: "2026-10-27T14:28:39+01:00"
  updated_at: "2026-10-27T14:28:39+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["User decisions D32 recorded; slice 1 (engine core) in detail, slices 2-8 sparse"]
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
- The antigravity project id leaves `tier`; it never reaches the UI, `--quotas-json` or the bus.
- Credentials come from `ctx.modelRegistry.getProviderAuth(id)`: Pi refreshes OAuth, and the
  token is `auth.apiKey` or the bearer of `auth.headers.Authorization` (our header-only claude
  and antigravity). No own credential file, no `<cwd>/.auth.json` read.
- Header snapshots never move `fetchedAt`; they are stored with their own `observedAt`.
- While pi-quotas is loaded the engine stays off (no double polling, no second cache writer).
  The dev loop runs pi-auth-plus with `-e` and `--no-extensions`.

## Slices

```
[>] 1 Engine core       contract, registry quota part, cache gaps, drainage, engine, settings
[.] 2 Existing families claude, antigravity, synthetic fetchers (+ fixtures from pi-quotas)
[.] 3 New families      openrouter, deepseek, openai (ChatGPT), xai as quota-only adapters
[.] 4 Headers + bus     header ingestion in our transports; pi-auth-plus:v1:quotas:* + report
[.] 5 Line              template parser/renderer, line placements, widget, footer
[.] 6 Panels            /auth quotas panel with refresh, settings panel from the catalog
[.] 7 Resets + CLI      panel resets with confirm dialog; --quotas-json / --quotas-list
[.] 8 Cutover           fill-only quotas.json migration, docs, live parity run, setup swap, release
```

## Slice 1: engine core (now)

Outcome: a fake family with a `quota` part refreshes through the engine, lands in the host
cache, survives a second session reading the same file, and backs off on 429/403. No real
provider is wired yet.

Units, in order. U1 defines the interfaces; U2 and U3 run in parallel; U4 builds on all three.

1. **U1 contract** (me). Write scope: `src/quotas/types.ts`, `src/core/registry/index.ts`.
   - Port the snapshot types with `provider: string` (a Pi id). Drop `ProviderQuotaId`,
     `PROVIDER_META`, `piProviders`.
   - `ProviderEntry.quota?: QuotaSource` with `kind`, `shortLabel`, `parserVersion`,
     `minPollMs?`, and `fetch(ctx: QuotaFetchContext): Promise<ProviderQuotaSnapshot>`.
   - `QuotaFetchContext` = `{ auth(): Promise<QuotaAuth | undefined>, fetch, signal, now }`.
   - Test that matters: none beyond typecheck (types only).
2. **U2 cache gaps**. Write scope: `src/core/cache/index.ts`, `tests/core/cache.test.ts`.
   - `backoffFor` treats a configurable set of statuses (default 429) as rate limits; the quota
     engine passes `[403, 429]`.
   - A `patch(key, fn)` that changes the value without touching `fetchedAt`, lease or backoff.
   - Test: a patched entry keeps its `fetchedAt`, and a second `HostCache` on the same file sees
     the patched value after `sync()`.
3. **U3 drainage**. Write scope: `src/quotas/drainage.ts`, `tests/quotas/drainage.test.ts`.
   Port `cache/drainage.ts` as pure functions over samples stored inside the cached value.
   Test: the ported pi-quotas drainage cases pass unchanged in meaning.
4. **U4 engine + settings**. Write scope: `src/quotas/{engine,state,settings}.ts`,
   `src/core/config/catalog.ts` (`quotas.*` keys), `src/index.ts` wiring, `tests/quotas/engine.test.ts`.
   - `HostCache<QuotaState>` at `cacheDir()/quotas.json`; `QuotaState` = endpoint snapshot,
     optional header partial with `observedAt`, drainage samples.
   - Timer lifecycle from pi-quotas `runtime.ts` (start on `session_start`, stop on shutdown,
     `refreshIntervalSec`, per-provider `minPollMs`, `refreshOnRequest`).
   - Off when pi-quotas is loaded (reuse `core/conflicts` package detection).
   - Test: two engines on one cache file, one fake source: only one fetch per interval, the other
     engine sees the result; a 403 from the source backs off and a forced refresh does not bypass it.

Verification: `bun test tests/core/cache.test.ts tests/quotas`, `bun run typecheck`, `bun run lint`.

## Slice 2+: sparse

- Fixtures: port pi-quotas `tests/fixtures/*.json`, keep them unchanged, one assertion each.
- claude: `api.anthropic.com/api/oauth/usage`, 300 s floor, version/headers from the family.
- antigravity: reuse `families/google/project.ts` and `transport.ts`; five buckets per
  `.project/analyses/antigravity-cli/1.4.8/05-quota.md`.
- openai: ChatGPT `backend-api/wham/*`, needs the account id from Pi's `openai` OAuth credential.
- The footer token math stays until M3.
