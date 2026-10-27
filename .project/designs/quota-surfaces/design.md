---
document:
  type: "design"
  id: "design-quota-surfaces"
  title: "CLI, event bus, on-demand resets and line templates"
  description: "Design and decisions for the four requested quota surfaces: a headless --list-quotas CLI, a cross-extension event bus, provider reset credits, and user-defined status-line templates"
  status: "published"
  revision: 5
  created_at: "2026-10-26T09:33:45+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "orchestrator"
  updated_by: "pi"
  source: "pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/designs/quota-surfaces/design.md"
  changelog:
    - revision: 5
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/designs/quota-surfaces/design.md"]
---

# Quota surfaces

Four requested features. Decisions were taken with the user; this file records the shape and
the reasoning so later slices do not re-litigate them.

## Verified constraints

Measured against pi 1.3.0 in this checkout, not assumed:

| Constraint | Evidence |
|---|---|
| `pi.events` is one bus shared across extension realms | `EventBus { emit, on → unsubscribe }`; jiti isolates module state, so exported singletons do not cross extensions |
| Flags are boolean/string only | `pi.registerFlag` in `dist/core/extensions/types.d.ts` |
| Unregistered flags are fatal | `pi --list-quotas --json` → `Error: Unknown option: --json` |
| A positional after a registered flag is safe | `pi --list-quotas codex --json` → provider lands in `argv`, `initialPrompt` stays `null` |
| `session_start` is too late for one-shot terminal output | TUI startup precedes the event; redraw erases the report and interactive shutdown forces exit `0` |
| Async extension factories are awaited before TUI startup | PTY regression in `tests/cli/startup.test.ts`, regular and fullscreen |
| Pi owns `process.stdout` | writing to it is lost on exit; `writeSync(1, …)` and `console.log` reach the real stdout |
| A git-installed package gets no PATH binary | `command -v pi-quotas` → nothing |

## 1. CLI `--list-quotas`

`pi --list-quotas [provider] [--json]`, driven by the registered flags `--list-quotas` and
`--json`, with the provider taken from `process.argv` after the trigger flag.

Rejected: a standalone `bin` entry (unreachable without a symlink), and one `--quotas=<mode>`
string flag (own parser, poor discoverability). The three-flag variant was the first
proposal and is superseded: the positional works, so the surface stays as requested.

Modules: `src/cli/report.ts` (pure `QuotaReport`), `src/cli/table.ts` (width-aware table),
`src/cli/flags.ts` (flags, argv parsing, fetch-on-stale, fd output).

The awaited factory parses argv because registered flag values are populated later. It
writes synchronously to fd 1 and exits before a session/UI starts. Headless OAuth refresh
uses a lazy model runtime with model-network discovery disabled.

The report preserves all normalized fields, with derived fractional percentages and
`resetInSec`. Human output uses Pi IDs (`openai`, `google`), not quota-family names;
JSON retains both. Money remains money. The table columns are Provider, Window, Used,
Remaining, Resets at, On-Demand Resets, Drainage (window), Drainage (1h), Drainage (24h).
Every window has a row; narrow output wraps cells and repeats Provider/Window in
continuation tables instead of dropping columns. Zurich timestamps include UTC offsets.

Exit `0` means every provider is fresh; `1` includes error/auth/stale/unknown; `2` is a
usage error. Colour is TTY/`FORCE_COLOR`-controlled and `NO_COLOR` wins.

Drainage uses successful observations, never cached reads or inherited header fields.
Two samples spanning at least 60 seconds are required; rates include actual coverage.
Utilization drops, balance top-ups and reset advances beyond 60 seconds start a new
segment. History retains its baseline plus bounded recent samples. ETA is linear,
anchored to the last observation, and suppressed when the scheduled reset comes first.
No extra polling is introduced. The former integer percentages and dropping-column
layout are superseded by the user's complete per-window report.

`QuotaReport` is the shared contract: the planned bus will reply with it, and a future model tool would
too, so the shape exists once.

## 2. Event bus

`pi.events` with namespaced, versioned channels and nonce replies, because the bus is
fire-and-forget with `unknown` payloads.

| Channel | Direction | Payload |
|---|---|---|
| `pi-quotas:v1:ready` | push | providers, capabilities |
| `pi-quotas:v1:snapshot` | push | one provider snapshot on change |
| `pi-quotas:v1:query` | request | `{ nonce, providers?, maxAgeSec? }` |
| `pi-quotas:v1:reply:<nonce>` | reply | `QuotaReport` |
| `pi-quotas:v1:refresh` | request | `{ nonce, providers?, force? }` |
| `pi-quotas:v1:event` | push | `reset-consumed`, `auth-required`, `rate-limited` |

Rules: payloads are plain data and validated by exported guards; no `ctx` crosses a channel;
unsubscribes are dropped on `session_shutdown`; the destructive reset channel requires
`confirm: true` and emits an audit event plus a notification in the owning session, because
otherwise any installed extension could silently spend a user's reset credit.

Built in `src/bus/{protocol,service,consumer}.ts`. Replies are `{ ok: true, report }` or
`{ ok: false, error }` so an unknown provider is reported instead of timing out. A running
refresh is shared, so concurrent requests for one provider await the same fetch. The reset
channels `pi-quotas:v1:resets` (list) and `pi-quotas:v1:reset` (spend) arrived with P3.

## 3. On-demand resets

Decision: list/query first, gate `consume` per provider on a verified endpoint. Codex has
source-backed routes; Claude has a distinct first-party feature and private client routes.
The research report (`.project/research/provider-on-demand-resets.md`) settles the
rest:

| Provider | Reset exists | Reachable programmatically |
|---|---|---|
| Codex | Yes | Yes — list `GET /backend-api/wham/rate-limit-reset-credits`, consume `POST …/consume` with `{redeem_request_id}` → `{code, windows_reset}` |
| Claude | Yes — account-specific “Limit resets,” separate from usage credits | Private GET usage query (`cedar_ember=1&skip_spend=1`) and POST organization `reset_rate_limits` found statically; not live-verified or publicly supported |
| xAI, Antigravity, Synthetic | Unknown | No route found in the inspected interfaces |
| OpenRouter, DeepSeek | No | Money balance or budget windows, not resettable tokens |

The Codex consume route arrives with the same headers as the usage read (`Bearer`,
`ChatGPT-Account-Id`, UA) and no beta header. It is irreversible and idempotency is
unverified, so the implementation lists first, consumes once, and never blind-retries after
a timeout.

```ts
type ResetScope = "provider" | `window:${string}`;
interface ResetCredit { provider; available; scope; expiresAtMs? }
const RESET_SUPPORT: Record<ProviderQuotaId, { list: boolean; consume: boolean }>;
```

Built: `/quota reset [provider]`, panel key `x` on capable rows, the bus channels and
`pi --quota-reset [provider] [--confirm-reset]`. Never automatic. Code lives in
`src/providers/codex-resets.ts`, `src/resets/service.ts` and `src/cli/resets.ts`.

Decision (stricter than the bus rule above): every spend needs a human decision. `/quota`
and the panel show a confirmation dialog; a bus request needs `confirm: true` **and** the
dialog, and is refused when the session has no UI; the CLI needs `--confirm-reset`. The panel
closes before the dialog so no dialog stacks over a custom UI. Only Codex is enabled: Claude's
routes are not verified. A consume sends a fresh `redeem_request_id`, once; network failures
and 5xx set `outcomeUnknown` and tell the user to list again instead of retrying.

## 4. Line templates

Decision: two per-width templates, `lineTemplate` (wide) and `lineTemplateNarrow` (below
`compactWidthCols`), defaults `{all}` and `{all:short}` so out-of-the-box output is unchanged.

Tokens: `{all}`, `{<alias>}` / `{<alias>:<fields>}` with
`name|short|tier|credits|pct|wins|rst|r|bar|err|login`, plus `{sep}` and literal text.
Unknown tokens vanish and the settings panel warns; explicit templates drop whole segments at
`{sep}` boundaries before truncating with `…`; the compiled template is memoized because the
line renders every frame.

Rejected: per-provider field templates only (cannot reorder or select), and a full DSL with
conditionals (unbounded failure modes on a one-row surface).

Built in `src/render/template.ts` (parse, memoized compile, field rendering) and
`src/render/line.ts` (units and width fallback). Deviations from the sketch above: `err` and
`login` are not fields; missing data, login and failure replace the value fields
automatically, so an explicit template cannot hide a broken provider. `{all}` renders only
the enabled providers without their own token. Width fallback is the built-in one,
generalized: detail levels (full, compact windows, short ids) apply to `{all}` and plain
provider tokens, then whole `{sep}` units drop from the end except the active provider's,
then `…`. A differential run against the previous renderer (about 44,000 cases over widths
0-220, states, settings and active providers) matched byte for byte except one old bug: a
hidden active provider that needs login blanked a narrow line. The settings panel previews
the line live and lists ignored tokens. Captures: `.project/analyses/line-templates/captures/`.

## Sequencing

1. CLI + lossless `QuotaReport` and drainage — implemented and verified locally; Claude freshness blocked by HTTP 429
2. Event bus — implemented and verified live (probe extension in a real RPC session)
3. Resets — implemented; list verified live, consume verified against the pinned contract only
4. Templates — implemented; captures at 36/57/80/140 awaiting sign-off

## Open items

- Codex consume is UNVERIFIED live: spending the account's single credit needs the user's
  go-ahead. Claude's private list/claim flow still needs read-only verification. Unknown
  reset counts remain unknown.
- `--json` is registered as a global flag name; a second extension registering `json` would
  collide. Acceptable for a personal setup, noted for review.
