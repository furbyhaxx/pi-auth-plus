# AGENTS.md — pi-auth-plus

Pi package (`@furbyhaxx/pi-auth-plus`): subscription and API-key providers that behave like Pi
builtins (`claude`, `antigravity`, `synthetic`, a patched `opencode`), quota and credit
monitoring, and accurate token counting, with one `/auth` dashboard; login stays in Pi's
`/login`. It supersedes
`pi-claude-auth`, `pi-opencode-auth`, `pi-synthetic-auth`, `pi-antigravity-auth` and
`pi-quotas`. These instructions apply to the whole repository.

## Project goals

In priority order:

1. **Builtin parity.** Every provider we add or patch works like one of Pi's own: `--model`,
   `--list-models`, `/model`, `/login`, `/logout`, scoped models, cycling, session restore, RPC
   and print mode. A regression here outranks everything else.
2. **Honest numbers and failures.** Quotas, credits and token counts are reported by their
   owner or shown as unknown, never interpolated. Every failure names the provider, endpoint,
   status and a recovery action.
3. **No credential leaks.** Tokens, refresh tokens, cookies and keys appear in no log, output,
   fixture, doc, bus payload or commit.
4. **Performance.** The factory does no network I/O; per-request shaping, per-chunk stream
   mapping and per-frame rendering are measured hot paths. Code is written for Pi-Bolt's AOT
   compiler ([Pi-Bolt AOT](#pi-bolt-aot-and-performance)).
5. **One Pi-native UI.** One `/auth` family and the pi-workbench UI language: shared frame,
   keys from keybindings, the same widths and truncation rules.
6. **Vertical isolation.** A vendor change stays inside its family directory; engines never
   import a family directly.
7. **Testable core.** Transforms, parsers, catalogs, quota and token math are plain functions
   over plain data; Pi and TUI wiring stays thin.

## Tech stack

- Bun `1.4.3` (`.bun-version`, `packageManager`); `bun test` for tests.
- TypeScript `7.0.2`, the strictness flags in `tsconfig.json`, erasable syntax only, explicit
  `.ts` import specifiers.
- Biome `2.5.15`: tabs, 100 columns, no `any`, no non-null assertions.
- Pi APIs (`@earendil-works/pi-coding-agent`, `-pi-ai`, `-pi-agent-core`, `-pi-tui`) and
  `typebox` as `peerDependencies: "*"`, pinned exactly in `devDependencies`. Development types
  target Pi 1.4; terminal acceptance uses Pi-Bolt.
- Runs on Pi-Bolt (Bun) and stock Pi (Node `>=22.19`): `node:*` APIs by default; a `Bun.*` API
  only behind a runtime check with a `node:*` fallback, and only where a measurement shows the
  gain.
- Runtime dependencies: none. Each new one needs user approval.
- `Justfile` is the command surface.

## Commands and completion criteria

`just check` (typecheck + lint + test) is the required gate. Single steps: `just typecheck`,
`just lint`, `just test`, `just format`.

- `just rpc-verify`: loads the extension in a real Pi RPC session (`PI_BIN`, default
  `pi-bolt`). Required after changing provider, command, flag or event registration, the
  factory, or settings persistence.
- `just parity-verify`: runs `--list-models` and `--model <id>` resolution against an isolated
  agent dir with dummy credentials and asserts every provider of ours is listed. Required after
  touching provider registration or catalogs.
- `just aot-verify`: bundles `src/index.ts` with Pi externalized and checks the AOT rules
  (literal imports only, no value import from `pi-coding-agent`, per-module bytecode budget).
  Required after adding modules, embedded assets or dependencies.
- Run the narrow test while iterating and `just check` once before merging; fix every error
  and warning. Docs-only changes need no gate.
- Never claim a check passed unless it ran in this session and you read its output.
- Live verification is authorized and expected for `claude`, `antigravity`, `opencode` (free
  models), `synthetic`, `openai`/`codex`, `xai` and `openrouter` (classifiers only), on the
  user's configured accounts, plus every quota and token-count endpoint those reach. Capture
  request and response with secrets redacted; a mock never proves a provider path. Pick model
  ids from `.project/references/models.md`. Missing credential: report it, never fake it.
- Irreversible or account-changing calls (consuming a reset credit, creating an API key,
  revoking a token) need explicit user approval each time.
- Panel, line or renderer changes need a live Pi-Bolt terminal pass (tmux capture) at the
  [TUI widths](#tui-widths). Captures go to `.project/analyses/<group>/<slug>/captures/`.
- Implement, validate and QA fully before claiming completion or pushing.

## Repository shape

```text
src/
  index.ts              Pi entrypoint: awaits family registration, registers commands, flags,
                        events. No logic.
  core/                 shared seams, no vendor knowledge
    paths/              agent dir, XDG state/cache/data, project .pi
    config/             settings catalog, layers, sanitizing parse, staged save, legacy migration
    cache/              host cache: atomic write, leases, backoff, parser-version fences
    http/               fetch with AbortSignal + timeout, ProviderHttpError, Retry-After
    auth/               auth.json slot access, PKCE, callback server, manual code paste
    bus/                versioned pi.events channels, nonce replies, consumer helpers
    redact/             secret redaction for errors, captures and bus payloads
    registry/           family registry: provider ids, aliases, capabilities
    conflicts/          detection of absorbed packages loaded alongside, one warning
  ui/                   frame, menus, settings panel, render kit, /auth command router
  families/<vendor>/    everything one vendor needs, exposed as one FamilyAdapter
    anthropic/          claude provider, anthropic/claude quota and token counting
    google/             antigravity provider, quota and token counting
    openai/             codex quota and token counting
    synthetic/          synthetic provider, catalog, web search, quota, token counting
    opencode/           builtin opencode patch
    xai/ openrouter/ deepseek/   quota (and token counting where available)
  quotas/               quota engine: snapshots, refresh, header ingestion, line, panel, CLI
  tokens/               token engine: source selection, content-hash store, family dedup
tests/                  bun:test suite mirroring src/; fixtures/ hold captured payloads
assets/                 embedded data (catalog snapshots, tokenizer tables), imported with
                        `with { type: "file" }` or `{ type: "text" }`
scripts/                development only, not shipped: verify helpers, upstream probes
docs/                   end-user documentation (layout below)
skills/                 bundled agent skills, only when a real agent workflow exists
.project/               development artifacts (layout below)
README.md, CHANGELOG.md, LICENSE, NOTICE, AGENTS.md
```

- A family module exports one `FamilyAdapter` (`provider?`, `quota?`, `tokens?`, ids,
  aliases). `src/index.ts` lists the adapters as literal imports; engines reach families only
  through `core/registry`.
- Split a module by responsibility; ~400 lines is the point where a module does two jobs.
- Tests live in `tests/`, mirroring `src/`. Fixtures stay byte-for-byte as captured.
- The package ships raw TypeScript: `pi.extensions` → `./src/index.ts`, `files` ships `src/`,
  `assets/`, `docs/`. No build step; Pi-Bolt compiles the installed package itself.
- Import `@earendil-works/*` only through specifiers Pi's loader aliases (`pi-ai`,
  `pi-ai/compat`, `pi-ai/oauth`, `pi-coding-agent`, `pi-tui`); anything else mixes Pi versions.

## Not yet aligned

This file describes the target state.

- `families/index.ts` registers `opencode` and `synthetic` only; `claude` and `antigravity`
  follow M1. `FamilyAdapter` has no `quota`/`tokens` parts until those engines land.
- No legacy migration exists yet: pi-synthetic-auth's `websearch.synthetic` in Pi's
  `settings.json` and its `SYNTHETIC_WEB_SEARCH` variable are not read.
- `quotas/`, `tokens/` and `docs/` do not exist yet; the dashboard's Settings tab has no
  settings panel yet (`core/config` exists).
- `core/auth` reads slots only; PKCE, the callback server and code paste arrive with the first
  OAuth provider.
- Absorption follows `.project/plans/roadmap.md`; delete each line here when its part lands.

## Provider integration

`.project/research/pi-provider-seams/report.md` records the Pi startup order and API facts.
Read it before touching registration, and correct it when Pi changes.

- **Register in the factory.** Pi drains provider registrations after the awaited factories
  and before model resolution. Anything registered in `session_start` or later misses
  `--model`, `--list-models`, scoped models and session restore. If registration depends on
  credential state, resolve it in the factory from Pi's auth storage and environment.
- **No network in the factory.** Dynamic catalogs use Pi's own lifecycle: `refreshModels`
  restores `context.stored` (Pi's `models-store.json`) when `allowNetwork` is false, fetches
  only when allowed and stale (`stored.checkedAt`, or `force`), and persists through
  `publish({ persist })` only when the catalog changed. Pi runs the network refresh in the
  background after interactive start and when `/model` opens. No catalog cache of our own; a
  bundled snapshot in `assets/` covers only a first run that never refreshed (print mode never
  does).
- **Login is Pi's.** Every provider logs in and out through Pi's `/login` and `/logout` via the
  provider's `oauth` or API-key config. No login commands or flows of our own.
- **Reuse Pi's wire implementations.** When the protocol matches a Pi `api`
  (`anthropic-messages`, `openai-completions`, …), set `api`, `baseUrl` and headers and let Pi
  stream. A custom `streamSimple` only where no Pi `api` fits (antigravity), and its `api` must
  equal the models' `api` or Pi ignores it. It must forward the `onPayload`/`onResponse`
  callback options, or Pi's request hooks never see its traffic.
- **Re-registration merges.** `registerProvider` merges defined keys over the previous
  registration. To drop `oauth`, `streamSimple` or headers, register the full intended config
  with those keys explicitly replaced; never rely on omission. Provider ids are global: another
  extension registering the same id merges into ours (the conflict check exists for this). A
  provider without explicit auth still gets Pi's generic API-key prompt in `/login`.
- **One mechanism per concern.** Body and header shaping for our providers happens inside the
  provider (fetch wrapper or stream). Patches to a Pi builtin (`opencode`) use
  `before_provider_headers` / `before_provider_request`. Those events and
  `after_provider_response` carry no provider id. Identify the request from the request itself
  (Pi's own provider headers or the base URL); `ctx.model` is the session model and can differ
  for helper calls, so it is a hint, never the filter on its own. `before_provider_request`
  runs before the headers event and its payload carries no headers, so a payload patch requires
  both: the session model is ours and the payload's `model` equals that model's id.
- **Credentials live in Pi's `auth.json`**, under our provider ids, so `/login` and `/logout`
  work. A separate credential file needs a recorded reason in the provider's research report.
- Every request honors the caller's `AbortSignal` with a bounded timeout. A turn never hangs.

### Provider ids

API-key and subscription access get separate ids: `anthropic` → `claude`, `google` →
`antigravity`, `openai` → `codex`, `xai` → `grok`. `synthetic` is one id, since both behave
alike. Aliases come from `core/registry`; never hardcode an id outside its family. Provider
and model ids stay slash-free: installed Pi 1.4.0 splits `provider/model` at the first slash.

### Family invariants

- **claude:** Claude Code identity and billing system block, the beta and user-agent set, and
  the `mcp_` tool-name rewrite in both directions, including streamed responses. Version
  precedence: env override > installed `claude --version` (if newer) > pinned. Subscription
  models carry zero cost.
- **antigravity:** the wire envelope, request metadata and payload order; the raw transport
  timeouts and abort forwarding; exact wire model ids with retired models refused before any
  credential work; schema allowlist sanitizer; strip thinking blocks for Claude models;
  cross-model signature sanitizing.
- **antigravity scope:** pi-antigravity-auth is a fork whose feature set, UX and API surface
  get a dedicated review with the user before porting. Nothing from it is ported unreviewed,
  and no `@cortexkit/*` package is used.
- **opencode:** spoof headers only when Pi's own opencode headers are present; a stored or
  environment key always wins over the anonymous fallback. Zen's free tier checks the
  `opencode/` user agent, `x-opencode-client: cli`, a `ses_` session-affinity header and an
  `<env>` block with the working directory in the system message. It also gates on the HTTP
  client: Bun's fetch passes, Node's undici (stock Pi) and curl get `429 FreeUsageLimitError` for
  identical bytes, so anonymous free models work from Pi-Bolt only. No workaround exists at the
  header or body level (`.project/analyses/opencode-cli/2.1.2/report.md`).
- **synthetic:** native `anthropic-messages` with no stream of our own; the catalog comes from
  `refreshModels` with Pi's store and a 4 h TTL, and has real prices and limits. Rows without a usable
  price or tool support are skipped. The `synthetic_web_search` tool registers at session start
  only when `synthetic.webSearch` or `--synthetic-web-search` enables it. It returns each
  result's highlights and saves the full page text to a 0600 temp file, since pages run to 100 KB.

### Upstream client tracking

We impersonate clients that change without notice. Each has
`.project/analyses/<client>/tracking.md` (`claude-code-cli`, `antigravity-cli`,
`opencode-cli`, `synthetic-api`): pinned version, where it is pinned in `src/`, the surface we
imitate (headers, user-agent, body shape, endpoints), last live verification and its evidence.

- Bumping a pinned version means a `<client>/<version>/report.md` with the observed delta,
  refreshed fixtures, a live verification, and the `tracking.md` row, in the same change.

## Quotas

Endpoints, auth, schemas, units and reset semantics per provider are in
`.project/research/provider-quotas/`. Read the relevant report before changing a fetcher.

- One fetcher + one parser per family, normalized to the quota snapshot. UI never reads a
  provider payload.
- Units are explicit; a missing field is `undefined`, never `0`. Keep "no limit", "0% used"
  and "unknown" distinguishable. Every window a provider exposes stays visible.
- Quota state from response headers is ingested inside our own providers' fetch wrappers, and
  for builtins from `after_provider_response` attributed by the header shape (the event has no
  provider id; `ctx.model` is only a hint). Never poll for what a response already said.
- One host cache (atomic writes, leases, backoff with Retry-After) so concurrent sessions do
  not fetch twice. A corrupt cache file is ignored, never fatal. No timers outlive the session.

## Token counting

- Source precedence: provider-reported usage > native count endpoint > known tokenizer >
  generic tokenizer. Every count carries its source; anything but the first two is labelled an
  estimate.
- Counts are keyed by tokenizer family and content hash and computed once: antigravity's
  Claude models reuse the anthropic family's counts.
- Counting never blocks a request or a frame: async, batched, cached, rate-limited.
- Pi has no hook to replace its estimators (pi-ai context clamping at 3.5 chars/token,
  compaction at 4). Both trust the latest assistant `usage` and estimate only what follows, so
  set authoritative `usage` in our streams and correct builtin messages in `message_end` (the
  returned same-role replacement persists). Publish counts on the bus for our own surfaces;
  `session_before_compact` changes compaction, not estimation. Patching Pi internals needs
  user approval.

## Pi-Bolt AOT and performance

Pi-Bolt compiles installed packages into its executable (`pi-bolt compile`). Write for that
compiler (`docs/PLUGINS.md` of Pi-Bolt):

- **Factory stays light:** registration from cached data only; sockets, timers and refreshes
  start in `session_start` or on first use.
- **Type-only imports** from `pi-coding-agent`; value imports cost startup on every launch.
  Value imports from `pi-ai` and `typebox` are free.
- **Literal imports only.** Lazy loading uses a table of literal `import()` thunks.
- **Embed files** (`with { type: "file" | "text" }`); never read beside the source.
- **Bytecode budget:** no module or function above 256 KB of bytecode. Large data (tokenizer
  ranks, catalogs) ships as an embedded file and loads lazily, never as a JS literal.
- **Hot paths** (stream mapping, request shaping, renderers): regex literals, module-level
  helpers, one object shape, no `Proxy`/getters, no intrinsic overrides.
- Measure before and after with `PI_TIMING=1` (factory time) and focused benchmarks; record
  baselines in `.project/analyses/performance/`.

## Settings and data

- Layers: defaults < user (`<agentDir>/auth-plus.json`) < project (`<cwd>/.pi/auth-plus.json`,
  trusted projects only) < runtime. One settings catalog in `core/config/catalog.ts`; features
  never read config files directly. The entrypoint loads it per session in a `session_start`
  handler registered before the families' handlers, and families read it through
  `FamilyHost.settings()`; the factory sees defaults only.
- Host cache (quota snapshots, token counts) under `<agentDir>/cache/auth-plus/`; state and
  data follow XDG (dirs 0700, files 0600).
- Legacy migration from the absorbed packages is one-time, fill-only and non-destructive:
  legacy files are never deleted or rewritten.
- Stored formats (`auth.json` slots, cache files, settings, bus payloads) change only with a
  reader for the old form.
- Resolve paths from `ctx.cwd` and the agent-dir helpers, never `process.cwd()`.

## Event bus

Channels are `pi-auth-plus:v1:<area>:<event>` (`quotas`, `tokens`, `auth`), with nonce
replies; the contract is `docs/events.md` and the client helpers ship as
`@furbyhaxx/pi-auth-plus/bus`. A payload change is a versioned contract change: new channel
version or additive fields only. `pi.events` emits synchronously and never awaits listeners,
so request/reply goes through nonce reply channels, never through emit ordering.

## Slash commands and panels

Adopted from pi-workbench; a new surface looks like the existing ones.

- `/auth` is the only command family: status of every provider (signed in, plan,
  expiry, quota), settings, quotas and token counts. It never logs in; it points to
  `/login <id>`. Standalone commands (`/quota`, `/quotas`, `/tokens`) are entry points into
  the same handlers.
- Commands with arguments provide `getArgumentCompletions`. Subcommands accept forgiving
  aliases and singular/plural forms; providers are selectable by id or alias. Unknown input
  reports the usage line and the closest valid names.
- Headless-safe: panels need `ctx.mode === "tui" && ctx.hasUI`. Without a TUI, read-only
  output renders as text; interactive-only actions say so and name the alternative.
- Feedback via `ctx.ui.notify` with the right tone; multi-line results render as a message.
- Panels use `ctx.ui.custom` and the one shared frame in `ui/`. Keys come from the user's
  keybindings and hint rows show them. Enter confirms, Esc goes back (asks before discarding
  staged edits), Ctrl+C dismisses, Tab switches sections, `/` or typing filters long lists.
- Panels size to content, cap at terminal height minus Pi's footer, then scroll. Side-by-side
  layouts fall back to a separate screen when narrow.
- Settings panels stage edits, show each value's source scope and save to an explicit scope;
  saving preserves unknown keys, and a malformed file blocks the save.
- A panel, refresh or login belongs to the session that started it; late results after
  shutdown change nothing. Display state is monotonic.
- Surfaces are configurable: visible fields, density, placement and appearance come from
  settings with sensible defaults, never one hard-coded layout.
- New surfaces or layout changes are the user's call: show captures at the check widths, or a
  served HTML mock for larger designs, before settling a layout.

### TUI widths

- Theme tokens and Pi's ANSI-aware helpers (`visibleWidth`, `truncateToWidth`,
  `wrapTextWithAnsi`); never `String.length` for layout.
- Every line fits. Check 36, 57, 80 and 140 columns. Identity and primary state survive
  truncation; secondary metrics go first.
- Color is never the only signal. Strip control characters from provider-supplied text.

## Code conventions

- Explicit, readable code; descriptive names; early returns; no dead code; kebab-case files;
  named exports except the Pi entry's default export.
- Types describe reality: no `any`, no non-null assertions, no silencing casts, no
  `@ts-ignore`/`@ts-expect-error`.
- `node:` protocol imports; `import type` for types; top-level imports, plus literal lazy
  `import()` thunks where startup cost justifies them.
- Validate unknown input once at the boundary that owns it (provider payloads, config files,
  bus messages, auth.json), then stay typed.
- Errors carry what failed, where, and a recovery action; no empty catch blocks.
- No compat shims or feature flags in a `0.x` package, except the documented legacy migration.
- Public modules get a lean module doc comment: what it owns. Comments state constraints.

## Testing

- `bun:test` only; `tests/setup.ts` isolates HOME, XDG and agent dirs per file. Assert
  observable behavior: shaped requests, mapped stream events, parsed snapshots, rendered lines
  at a given width, settings precedence, migration outcomes.
- Every new transform, parser, renderer or key branch gets a case that fails when it breaks;
  a regression fix gets a test that reproduces it.
- No network and no real credentials: fake the transport, use captured fixtures, fake theme
  and terminal. Inject clocks, ids and widths.
- Never touch the user's real `auth.json`, caches or vault state in tests. Bun's
  `os.homedir()` ignores a runtime `HOME` change, so path code resolves from env and Pi's
  agent-dir helper, never `os.homedir()` directly.
- Live verification is separate from the suite and never replaces it.

## Git and delivery

- Conventional Commits, granular, English. Stage explicit paths; never `git add -A`/`.`.
- Never `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`,
  `git commit --no-verify` or force-push. Never touch files you did not change.
- `dev` is the default branch; work happens on `dev` or on feature branches merged into it.
- Installed from `git:https://github.com/furbyhaxx/pi-auth-plus`, so unpushed work never
  reaches a session. After `just check` and the relevant live verification: commit, merge to
  `dev`, push, `pi-bolt update --extensions`, then `pi-bolt compile` and confirm with
  `pi-bolt compile --status`. That sequence is the authorized default; do not ask again.
- Releases are the agent's job too: at the end of a verified slice, bump the `0.x` version,
  move `[Unreleased]` into a dated release section, tag `vX.Y.Z` and push the tag.
- Delete worktrees and branches once merged. Publishing to a registry stays with the user.

## Documentation sync

```text
docs/
  getting-started.md      install, first login, migrating from the absorbed packages, conflicts
  providers/<id>.md       claude, antigravity, synthetic, opencode: login, models, env, caveats
  quotas.md               status line, templates, panel, --list-quotas, resets
  tokens.md               sources per family, accuracy, dedup
  commands.md             /auth reference with aliases
  configuration.md        settings catalog, layers, files, environment variables
  events.md               pi.events contract for other extensions
  performance.md          Pi-Bolt compile, startup budget, how to measure
  troubleshooting.md
  development/architecture.md   invariants: seams, registry, engines, data flow
```

Adding or removing a provider, model family, command, flag, setting, environment variable,
bus channel or storage location is a docs change in the same commit. `README.md` lists
features, install and the conflict note; it points into `docs/`.

Markdown is lean but complete: no walls of text, no filler, and never an instruction, fact or
invariant dropped to save lines. When a file grows unwieldy, split it by topic (a `docs/`
page, a nested `AGENTS.md`) instead of cutting content. Implementation status and evidence
live in `.project/`, never in `AGENTS.md`.

## Changelog

`CHANGELOG.md`, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). New entries under
`## [Unreleased]` in the right subsection; read it first and append. One bullet per change: a
bold lead-in, then why and what a user must do. Released sections are immutable.

## Development artifacts

Plans, specs, designs, research, analyses, reviews and ideas live in `.project/`, never in
`docs/`, and are committed.

```text
.project/
  plans/roadmap.md                    milestone tree: done / now / next / later
  plans/<NNNN-slug>/plan.md           current and next slice only; evidence/ beside it
  specs/<NNNN-slug>.md                contracts and decisions, updated when reality differs
  designs/<slug>/                     architecture and UX decisions, HTML mocks
  research/<slug>/report.md           third-party facts: APIs, protocols, prior art
  analyses/<client>/                  upstream client tracking (tracking.md + <version>/)
  analyses/<group>/<slug>/            local QA, measurements, root causes; captures/ beside them
  reviews/<slug>/  ideas/<slug>/      on demand
  references/models.md                model ids pre-authorized for tests, docs and live runs
```

- Every artifact starts with the nested `document:` frontmatter (`type`, `id`, `title`,
  `description`, `status` = `sketch|draft|published|archived`, `revision`, `created_at`,
  `updated_at`, `created_by`, `updated_by`, `changelog`), timestamps from `date -Iseconds`.
  Imported artifacts add `source: "<repo>@<sha>:<path>"` and keep their original author.
- Bump `revision` with a `changelog` entry on every substantive change. Superseded artifacts
  get `status: "archived"` and a link to the successor.
- Evidence (captures, request/response dumps, fixtures) sits beside the report with
  credentials redacted. Reference artifacts by relative path.

## Absorbed packages

`pi-claude-auth`, `pi-opencode-auth`, `pi-synthetic-auth`, `pi-antigravity-auth` and
`pi-quotas` are reference implementations, not code to copy. Read their source for behavior,
then rebuild it in this architecture. Their research and analyses are imported into
`.project/` with provenance. Loading any of them next to pi-auth-plus is a conflict: detect it
at startup, warn once, and name the package to remove.

## Self-maintenance

pi-auth-plus serves the user's models and footer in every session, including yours. If login,
streaming, quotas or counts misbehave live, reproduce with `pi-bolt -e ./src/index.ts`,
confirm loading with `just rpc-verify`, and fix it in the owning family or engine. Until the
fix ships, `-builtin:pi-auth-plus` or `pi-bolt --no-extensions` disables it.

## What to avoid

- Registering providers, catalogs or OAuth after the factory.
- Network calls or heavy disk work in the factory.
- New runtime dependencies, frameworks or model-facing tools without user approval; no
  `@cortexkit/*` packages at all.
- Login flows, credential files or model caches of our own where Pi's `/login`, `auth.json`
  or `models-store.json` already serve.
- Weakening type safety, an invariant or a test to get a check green.
- Hardcoded machine-specific paths, agent dirs, accounts or credentials.
- Printing, logging or committing secrets, `auth.json` contents or unredacted dumps.
- Stubs, placeholders or TODOs presented as finished work.
- Drive-by refactors, reformatting or dependency upgrades inside an unrelated change.

## User override

If the user's instructions conflict with a rule here, name the rule and the conflict, get
confirmation, then follow the user.
