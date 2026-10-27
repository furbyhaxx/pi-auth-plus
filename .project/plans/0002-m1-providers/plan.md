---
document:
  type: "plan"
  id: "0002-m1-providers"
  title: "M1 providers"
  description: "Absorb the opencode, synthetic, claude and antigravity providers as vendor families"
  status: "published"
  revision: 8
  created_at: "2026-10-27T10:20:46+01:00"
  updated_at: "2026-10-27T12:10:00+01:00"
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
    - revision: 5
      reason: "claude slice done"
      changes: ["All six units landed and live-verified on Pi-Bolt and stock Pi; antigravity review is next"]
    - revision: 6
      reason: "claude wire alignment planned"
      changes: ["Slice 3b: match the real Claude Code CLI on the wire, two units plus live verification"]
    - revision: 7
      reason: "claude wire alignment done"
      changes: ["Units A-C landed and live-verified; identity line and cache control fixed during live verification"]
    - revision: 8
      reason: "antigravity review done, slice planned"
      changes: ["Slice 4: review decisions, level codec landed, units 1-7 with write scope and the test that matters"]
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

## Slice 3: claude (done)

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
| 2 | login (done `b0fb6e7`) | `core/auth/{pkce,code-paste}.ts`, `anthropic/oauth.ts` | refresh retries 5xx and network errors, fails a 4xx at once, never leaks a token in errors; a pasted code with the wrong state is refused |
| 3 | request shaping (done `ca1aa16`) | `anthropic/{sanitize,billing,request}.ts` | body becomes `[billing, identity, sanitized prompt]`, tools and tool references are `mcp_`-prefixed, cch matches known vectors, headers carry betas, UA and `x-app` without `x-api-key` |
| 4 | response restore (done `ca13a29`) | `anthropic/response.ts` | SSE and JSON bodies split at every byte boundary restore the exact Pi tool names |
| 5 | provider wiring (done `629add4`) | `anthropic/{transport,provider,index}.ts`, `families/index.ts` | OAuth credential: zero cost, header-owned auth, wrapper applied; API key: Pi's path untouched; `parity-verify` lists `claude` |
| 6 | live + tracking (done `7ec14e0`) | `.project/analyses/claude-code-cli/tracking.md` | Pi-Bolt and stock Pi: a turn and a tool call on `claude-sonnet-5-5` with the stored login, request head captured redacted |

Changes vs pi-claude-auth: the `claude --version` probe runs on first request, not in the
factory. The replace patterns move from Pi's `settings.json` to `auth-plus.json`; legacy
migration waits for the migration engine. The PKCE verifier and state are 32 random bytes as in
Claude Code 2.1.310.

Result: `claude/claude-sonnet-5-5` answered a turn with a `bash` tool call on Pi-Bolt and stock
Pi with the stored login (HTTP 200 throughout); `parity-verify` lists 17 `claude` models on both
runtimes. A side-by-side capture against Claude Code 2.1.310 found wire differences that the
absorbed package already had (tool names, `cch`, user agent, betas, the deferred placeholder
name); they are listed in `.project/analyses/claude-code-cli/tracking.md` and await a decision.

## Slice 3b: claude wire alignment (done)

Decision (user, 2026-10-27): match the real CLI fully. Evidence: interactive and `-p` captures
of Claude Code 2.1.311 with its own login, plus the 2.1.310 binary
(`.project/analyses/claude-code-cli/tracking.md`).

| # | Unit | Write scope | Test that matters |
| --- | --- | --- | --- |
| A | bare tool names | `anthropic/{tool-names,request,response}.ts` | Pi tools go out PascalCase (`bash` → `Bash`, `web_search` → `WebSearch`) everywhere a name appears (tools, `tool_choice`, `tool_use`, `tool_reference`, `tool_addition`, `tool_removal`); Pi's placeholder goes out as `DeferredToolPlaceholder`; responses split at any byte restore the exact Pi names |
| B | identity | `anthropic/{billing,request,oauth,transport,provider}.ts`, new `anthropic/identity.ts` | billing `cc_entrypoint=cli`, no `cch`; the CLI's beta set first; `x-claude-code-session-id` and `metadata.user_id` `{device_id, account_uuid, session_id}` share one UUID; `account.uuid` kept from token responses; one unauthenticated `HEAD /api/hello` per process |
| C | live | `tracking.md` | Pi-Bolt and stock Pi: a turn with a tool call, proxy capture compared field by field with the CLI capture |

Outcome: unit A in `e19fd7e`/`b55276a`, unit B in `30c1206`, merged and live-verified on
Pi-Bolt and stock Pi (HTTP 200, a `Bash` tool call round-trip). Live verification also caught the
identity line: the old Agent SDK line belonged to `sdk-cli`, so it is now the interactive CLI's
`You are Claude Code, Anthropic's official CLI for Claude.` with cache control (`864490c`).

Deliberate deviations: `x-stainless-*` stay Pi's SDK values; cache TTL stays Pi's
`cacheRetention`; the auto-mode betas and `safeguards` body (`afk-mode`, `dangerous-tool-use`)
and `thinking-display-updates` are not sent, because Pi has no such modes. Pi's two body betas
are appended after the CLI set. Logins stored before 3b send an empty `account_uuid` until their
next refresh.

## Slice 4: antigravity (now)

Source: the `pi-antigravity-auth` fork 3.0.12, inventoried against agy 1.4.8 in
`.project/analyses/pi-antigravity-auth/inventory.md`. Wire evidence: the agy dossier in
`.project/analyses/antigravity-cli/1.4.8/` (another session's directory: read only).

Decisions (user, 2026-10-27):

- The Claustrum vault is dropped, and so is the account pool: one account through `/login antigravity`.
- Provider id `antigravity`, with a fill-only migration from the fork's `google` slot.
- One Pi model per family: `antigravity/gemini-4-argon`, `gemini-3.8-flash`,
  `claude-opus-5-5`, `claude-sonnet-5-5`, `gpt-oss-120b`. The catalog level
  (`gemini-4-argon-low`) is picked per request from the effective Pi thinking level through
  `thinkingLevelMap`; there is no `antigravity-` prefix and no level suffix.
- Catalog via `refreshModels` (`v1internal:fetchAvailableModels`) plus a bundled snapshot.
- Plain `fetch` with the CLI's 7 headers and the agy 1.4.8 user agent; the fork's raw TLS client is ported only if the wire refuses `fetch`.
- The project id is re-derived once per session through `loadCodeAssist`, never packed into `refresh`.
- Signatures are carried for the same model only, and thinking is stripped for Claude.
- A live capture settles the redirect, the scopes (+`aicode`, `openid`), the envelope `userAgent` and `toolConfig`.
- The `/antigravity` menu becomes `/auth` tabs, and quota comes in M2.

Wire facts: the envelope `model` is the catalog level id, and `labels.model_enum` is the catalog
`model` (`MODEL_PLACEHOLDER_M419`). Argon levels send `thinkingLevel`, Claude levels send
`thinkingBudget: 0` plus `thinkingLevel`, and Flash and GPT-OSS levels send a `thinkingBudget`.
Pi's `api/google-shared` already converts messages and tools and keeps signatures only for the
same provider and model.

| # | Unit | Write scope | Test that matters |
| --- | --- | --- | --- |
| 0 | level codec (done) | `google/levels.ts` | an encoded level survives a `models-store.json` round trip; foreign values are refused; thinking configs match the CLI |
| 1 | catalog | `google/catalog.ts`, `assets/antigravity/models.json` | the live 1.4.8 catalog yields exactly the 5 families in `agentModelSorts` order, each with a map holding only its catalog levels (`off`/`minimal` null, GPT-OSS medium only); auxiliary, internal and image models are excluded; offline restores stored models |
| 2 | login + project | `google/oauth.ts`, `google/project.ts` | the auth URL carries the 7 scopes and the remote redirect; a pasted code with the wrong state is refused; refresh retries 5xx and fails 4xx without leaking a token; the project is discovered once per session |
| 3 | request | `google/request.ts`, `google/schema.ts` | the envelope and request keys match the 1.3.5 capture's order, labels and `thinkingConfig` for the chosen level; Claude turns carry no earlier thinking; tool schemas pass the allowlist |
| 4 | stream + errors | `google/stream.ts`, `google/errors.ts` | an SSE body split at every byte boundary yields identical Pi events (text, thinking, signatures, tool calls, usage); `RATE_LIMIT_EXCEEDED` and the other named reasons map to a cause with a recovery hint |
| 5 | migration | `google/migration.ts` | a fork OAuth slot under `google` fills an empty `antigravity` slot with the unpacked refresh; an existing `antigravity` slot and a non-OAuth `google` slot stay untouched |
| 6 | wiring | `google/{provider,transport,index}.ts`, `families/index.ts` | the effective Pi level selects the wire level; zero cost; the 7 headers and UA go out; `parity-verify` lists `antigravity` |
| 7 | live + tracking | `.project/analyses/agy-cli/tracking.md` | Pi-Bolt and stock Pi: a turn on Argon and Claude, a tool call, and a level switch mid-session, with request heads captured redacted |

Units 1-5 run in parallel; unit 6 integrates them.

## Later slices (sparse)

- End of M1: version bump, release section, tag.
