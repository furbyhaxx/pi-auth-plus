---
document:
  type: "plan"
  id: "0002-m1-providers"
  title: "M1 providers"
  description: "Absorb the opencode, synthetic, claude and antigravity providers as vendor families"
  status: "published"
  revision: 1
  created_at: "2026-10-27T10:20:46+01:00"
  updated_at: "2026-10-27T10:20:46+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["opencode slice in detail, synthetic next, claude and antigravity sparse"]
---

# M1 providers

Goal: each absorbed provider runs from `src/families/<vendor>/`, registered in the factory,
logged in through Pi's `/login`, visible in `/auth` Providers, and live-verified in Pi-Bolt
and stock Pi. Order: opencode, synthetic, claude, antigravity (smallest risk first).

## Slice 1: opencode (now)

Source: `pi-opencode-auth` (132 LOC). It patches Pi's builtin `opencode` (Zen) and
`opencode-go` so Zen's free tier accepts the requests.

Credential precedence in Pi 1.4.0 (`provider-composer.js:244-300`, `auth/resolve.js`):
stored `auth.json` > extension/models.json `apiKey` > `OPENCODE_API_KEY`. An anonymous
`public` key registered by the extension therefore shadows env and models.json keys.

| # | Unit | Done when |
| --- | --- | --- |
| 1 | `families/opencode/identity.ts`: `ses_`/`msg_` ULIDs, CLI header set, pinned CLI version | unit test: ids sort as the CLI's (session descending, request ascending) |
| 2 | `families/opencode/index.ts`: adapter for `opencode` + `opencode-go`; factory registers `apiKey: "public"` on `opencode` only when no env key and no models.json key exists | test: env or models.json key present means no anonymous registration |
| 3 | header patch on `before_provider_headers`: acts only when Pi's own `x-opencode-*` headers are present (the event has no provider id) | test: non-opencode headers untouched; Pi's stamp rewritten |
| 4 | `.project/analyses/opencode-cli/tracking.md`: pinned version, location in `src/`, imitated surface, live evidence | file exists with the live run below |
| 5 | live: `opencode/big-pickle` answers anonymously under `pi-bolt -ne -e` and stock `pi`; with a key the keyed lane is used | captured request headers and response in `.project/analyses/providers/opencode/` |

Fixed vs pi-opencode-auth: registration moves from `session_start` to the factory (so
`--model opencode/...` and session restore work), and the anonymous key no longer overrides
an env or models.json key.

## Slice 2: synthetic (next)

Source: `pi-synthetic-auth` (438 LOC): provider delegating streaming to the builtin
anthropic api, live catalog fetched in the factory today, opt-in web-search tool.

- Catalog through `refreshModels`: restore `stored` offline, fetch only when allowed and stale,
  `publish({ persist })`; bundled snapshot in `assets/` for the first run only.
- Prices and limits from the live catalog; web search stays opt-in via `auth-plus.json`.
- Verify: `--list-models` offline after one refresh, a turn on one model, the search tool.

## Later slices (sparse)

- **claude** (1.7k LOC): CC version pin and precedence, identity/billing block, `mcp_` rename
  both ways incl. streams, replace patterns setting, zero-cost subscription models.
- **antigravity**: review session with the user first (features, UX, API, vault yes/no),
  then port as provider id `antigravity` with migration from `google`.
