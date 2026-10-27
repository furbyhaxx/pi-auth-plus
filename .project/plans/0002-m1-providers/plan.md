---
document:
  type: "plan"
  id: "0002-m1-providers"
  title: "M1 providers"
  description: "Absorb the opencode, synthetic, claude and antigravity providers as vendor families"
  status: "published"
  revision: 4
  created_at: "2026-10-27T10:20:46+01:00"
  updated_at: "2026-10-27T10:58:12+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["opencode slice in detail, synthetic next, claude and antigravity sparse"]
    - revision: 2
      reason: "opencode slice done, synthetic catalog done"
      changes:
        - "Recorded the opencode 2.1.2 fingerprint and the stock-Pi transport limit."
        - "Synthetic now; web search is its remaining unit; claude next."
    - revision: 3
      reason: "synthetic slice done"
      changes: ["Web-search tool landed and live-verified; claude is now"]
    - revision: 4
      reason: "claude slice detailed"
      changes: ["Six units with write scope and the test that matters; antigravity stays sparse"]
---

# M1 providers

Goal: each absorbed provider runs from `src/families/<vendor>/`, registered in the factory,
logged in through Pi's `/login`, visible in `/auth` Providers, and live-verified in Pi-Bolt
and stock Pi. Order: opencode, synthetic, claude, antigravity (smallest risk first).

## Slice 1: opencode (done)

Outcome: done in `77e6b62` and earlier commits. Units 1-4 are done, with these deviations. Request
ids were dropped, because the CLI 2.1.2 identity needs only the session id, sent as four
affinity headers. A `before_provider_request` hook adds the CLI's `<env>` block, which Zen
checks. Unit 5: Pi-Bolt answers `pong` anonymously. Stock Pi cannot: Zen refuses Node's HTTP
client for identical bytes. The keyed lane is untested because the host has no Zen key.
Evidence: `.project/analyses/opencode-cli/2.1.2/` (not `providers/opencode/`).

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

## Slice 2: synthetic (done)

Outcome: the catalog and provider landed in `2b91acd` and `3ffaa1b`, and the web search after
them. Live: `--list-models synthetic`, a turn on `hf:zai-org/GLM-5.3-Flash` in Pi-Bolt and stock
Pi, and the refresh persisted in `models-store.json`. The tool was called in both runtimes, and
the `auth-plus.json` setting toggles it. Legacy opt-in migration is deferred to the migration
engine.

Source: `pi-synthetic-auth` (438 LOC): provider delegating streaming to the builtin
anthropic api, live catalog fetched in the factory today, opt-in web-search tool.

- Catalog through `refreshModels`: restore `stored` offline, fetch only when allowed and stale,
  `publish({ persist })`; bundled snapshot in `assets/` for the first run only.
- Prices and limits from the live catalog; web search stays opt-in via `auth-plus.json`.
- Verify: `--list-models` offline after one refresh, a turn on one model, the search tool.

## Slice 3: claude (now)

Source: `pi-claude-auth` 0.2.2 (1.1k LOC src). It registers a pi-ai `createProvider` provider
`claude` whose stream delegates to Pi's `anthropicMessagesApi()` with header-owned auth
(`apiKey: undefined`, `Authorization: Bearer`) and a request-local fetch wrapper. That keeps Pi's
own OAuth branch (its Claude Code identity and tool renaming) out, so the wrapper's shaping
runs exactly once. Pi 1.4 accepts `registerProvider(provider)` and supports header-owned auth
(`anthropic-messages.js:173-197`). Pi 1.4's catalog already carries the 5.5 models, so the
mirrored 5.5 entries are dropped. The stored `claude` slot in `auth.json` has the same shape,
so existing logins carry over.

| # | Unit | Write scope | Test that matters |
| --- | --- | --- | --- |
| 1 | seams (done `5456883`) | `anthropic/{tool-names,version}.ts`, `claude.replacePatterns` field | wire names round-trip exactly; collisions refused; version precedence, probe runs once and lazily |
| 2 | login | `core/auth/{pkce,code-paste}.ts`, `anthropic/oauth.ts` | refresh retries 5xx and network errors, fails a 4xx at once, never leaks a token in errors; a pasted code with the wrong state is refused |
| 3 | request shaping | `anthropic/{sanitize,billing,request}.ts` | body becomes `[billing, identity, sanitized prompt]`, tools and tool references are `mcp_`-prefixed, cch matches known vectors, headers carry betas, UA and `x-app` without `x-api-key` |
| 4 | response restore | `anthropic/response.ts` | SSE and JSON bodies split at every byte boundary restore the exact Pi tool names |
| 5 | provider wiring | `anthropic/{transport,provider,index}.ts`, `families/index.ts` | OAuth credential: zero cost, header-owned auth, wrapper applied; API key: Pi's path untouched; `parity-verify` lists `claude` |
| 6 | live + tracking | `.project/analyses/claude-code-cli/tracking.md` | Pi-Bolt and stock Pi: a turn and a tool call on `claude-sonnet-5-5` with the stored login, request head captured redacted |

Changes vs pi-claude-auth: the `claude --version` probe runs on first request, not in the
factory. The replace patterns move from Pi's `settings.json` to `auth-plus.json`; legacy
migration waits for the migration engine. The PKCE verifier and state are 32 random bytes as in
Claude Code 2.1.310.

## Later slices (sparse)

- **antigravity**: review session with the user first (features, UX, API, vault yes/no),
  then port as provider id `antigravity` with migration from `google`.
