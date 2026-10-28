---
document:
  type: "design"
  id: "design-model-management"
  title: "Model management, verbosity, web search and model groups"
  description: "Verified seams, UX and mechanisms for model rules, overrides, aliases, OpenAI verbosity, unified web search and quota-aware groups"
  status: "draft"
  revision: 1
  created_at: "2026-10-28T11:45:00+01:00"
  updated_at: "2026-10-28T11:45:00+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Probe results for filter seams, verbosity, search, routing, alias limits and attribution; UX for /auth Models, Groups and Settings additions"]
---

# Model management, verbosity, web search and model groups

Source ideas: `.project/ideas/model-management-and-routing/ideas.md`. Interactive wireframes:
`wireframes/index.html` (views `rules`, `catalog`, `detail`, `groups`, `group`, `settings`;
`?view=<id>&w=36|57|80|140`). Evidence: `.project/analyses/model-management/*/report.md`.
All findings are against Pi 1.4.0 (Pi-Bolt 1.0.6/1.0.7) on 2026-10-28.

## What the probes established

| Idea | Verdict | Evidence |
|---|---|---|
| Model rules hide from `--list-models` | **Not with a supported seam.** Provider filters ignore named configs; native replacement filters listings and `/model` but `--model <hidden>` still works; virtual models bypass provider filters; native filters don't compose (last wins). Project trust is not visible in the factory. | `filter-seams/` (25/25 assertions) |
| Overrides | Feasible now through Pi's own `models.json` `modelOverrides` (metadata only). | `ideas.md` probe |
| Aliases with own limits | Feasible **for providers whose stream we own**: physical alias entry + `onPayload` model-id rewrite inside the provider stream (covers compaction summaries, which `before_provider_request` misses). Virtual aliases lose their limits after the first response. Built-ins (`openai`, `xai`, `openrouter`, `opencode`) need a Pi seam. | `alias-limits/` |
| OpenAI verbosity | **Verified live** on `openai` (ChatGPT OAuth, Responses) and `openai-codex` (legacy Codex). `before_provider_request` merge accepted at low/medium/high, output length rose with level, `text.format` preserved. | `verbosity/` |
| Unified web search | **Executed live on every subscription route**: Claude OAuth (encrypted results + cited prose), ChatGPT-direct and legacy Codex (2 searches each, `web_search.num_requests: 2`, cited prose), xAI OAuth (2 searches + page open, citations; `cost_in_usd_ticks` reported, subscription billing unverified), Synthetic (raw hits + page text), OpenRouter (citations, $0.001), OpenCode Exa MCP (unauthenticated). Only Synthetic and Exa return raw results; the others are a full model call (~17-21K input tokens). | `search-entitlement/` |
| Groups: stickiness | Works: router state on the branch survives tool continuations, restart, fork and clone (forks inherit ancestor state). State is saved **before** dispatch, so it records attempts. | `virtual-routing/` |
| Groups: failover | Pi retries ordinary 429/5xx/transient errors and calls `route(reason: "retry")` with the failed message; the router can switch. **No retry** for 401, quota-exhausted 429, OpenCode free-tier 429. `agent_before_settle` + `context_edit` recovered a quota failure in a probe. Partial output may already be shown before a retry. | `virtual-routing/` |
| Groups: attribution | `ctx.model` is the **virtual** model in every hook. Physical provider/model/usage only on the assistant message (`message_end`, `turn_end`). Headers cannot be attributed generically; 429s fire no `after_provider_response`. | `quota-attribution/` |

Side findings that affect existing code:

- `src/families/opencode/index.ts` (and Synthetic usage capture) guard on
  `ctx.model.provider`. Under a virtual group that is the group, so OpenCode identity headers
  and Synthetic usage correction silently stop. Groups require switching these guards to the
  request itself (payload model id, base URL) or the physical assistant message.
- `ctx.modelRegistry.complete()` does not route virtual models; `streamSimple().result()` does.
- `AGENTS.md` stated `before_provider_request` runs before the headers event; Pi runs headers
  first. Corrected.

## Upstream asks (Pi)

Smallest seams that unblock the parts a pure extension cannot do. Each is one issue/PR.

1. **Model visibility filter**:
   `pi.registerModelVisibilityFilter((id, { cwd, projectTrusted }) => boolean)`, applied
   centrally to physical and virtual ids in listing, `--model` resolution (including
   synthesized ids), saved defaults, `/model` and cycling. Multiple filters intersect.
2. **Physical model on response**: `after_provider_response` carries the resolved
   `{ provider, id, api }` that Pi already passes to `onResponse`, and fires for error
   statuses (429) too.
3. **Alias entries for any provider** (optional): a `models.json` model field such as
   `wireId` (or `upstreamId`) honoured by every built-in API, so aliases work for built-ins.

## UX

All surfaces live in the existing `/auth` panel and reuse its frame: `── Auth › Tab ──`
rule, `▸` tab row, description line, keybinding-derived hints that drop by priority,
shrink-wrapped body. Two new tabs; Settings gains three sections. `/auth models` and
`/auth groups` open them directly (tab aliases `model`, `filter`, `group`).

```
 Providers  Quotas  Tokens  Models  Groups  Settings
                            │       │       └ Models · OpenAI · Web search sections
                            │       └ list → group detail (strategy, policy, members)
                            └ Rules ⇄ Catalog (v) → model detail (overrides, aliases)
```

### Models › Rules

- Ordered list, gitignore semantics: default listed, a rule hides, `!rule` shows again, last
  match wins. `*` stays inside one `/` segment, `**` crosses; a bare `provider/*` also
  matches nested ids (`openrouter/google/x`), as the user's example expects.
- Each row shows its live effect (`3 hidden`, `1 shown`); the bottom line shows the total and
  the surfaces it governs. Keys: `a` add, `enter` edit, `space` on/off, `shift+↑↓` reorder,
  `d` delete, `ctrl+s` save with the existing scope dialog (user / trusted project).
- Where a rule cannot be enforced (built-ins until upstream ask 1 lands), the row says so
  rather than pretending: e.g. `2 hidden · picker only`.

### Models › Catalog and model detail

- Every model grouped by provider: `●` listed, `○` hidden, context column (override values
  highlighted), reason column (`rule 4`, `override`) dropped below 57 columns, `↳` alias rows.
- `h` appends a rule for the row instead of flipping a hidden flag, so rules stay the one
  source of truth.
- Detail uses the Settings row grammar (label · value · `default|override`), writes
  `modelOverrides` in `models.json` with a round-trip-safe, locked edit. Verbosity row only for
  OpenAI Responses models. Aliases section lists and creates aliases (owned providers only;
  others show why not).

### Groups

- Group = selectable virtual model `group/<name>`. List row: id, strategy, healthy/total;
  second line shows member order.
- Detail: strategy (`sticky` default, `failover`, `balance`, `random`), fail-over triggers,
  paid policy (`never` / `only when free fail` / `always`), context window (default smallest
  member, editable down only), thinking map, ordered members with live auth/quota and
  `included|free|paid` cost class.
- Failover boundary: only before the first output token and never across a started tool
  call; otherwise the turn errors with the reason. Partial-text retries are visible to the
  user, so the status line names the switch (`→ opencode`).

### Settings additions

| Section | Setting | Values (default) |
|---|---|---|
| Models | Model rules scope | user, user + trusted project (user + trusted project) |
| Models | Hidden default model | warn and keep, fall back (warn and keep) |
| OpenAI | Response verbosity | Pi default (low), low, medium, high (Pi default) |
| OpenAI | Verbosity scope | providers: openai, openai-codex |
| Web search | Web search tool | on / off (off) |
| Web search | Search backends | ordered list of signed-in, verified backends |
| Web search | Result kind | results, answer, results else answer |
| Web search | Allow paid backends | off |

Per-model verbosity in model detail overrides the global value.

### Web search tool

One `web_search` tool replaces `synthetic_web_search`. Rendering stays Pi's default tool
rendering, as `synthetic_web_search` today. Result contract: `{ backend, kind: "results" |
"answer", results?: [{url,title,text,published?}], answer?: {text, citations:[{url,title}]},
cost?: {class, usd?} }`. Backends tried in configured order; paid ones only when allowed.
Claude's encrypted result blocks are not exposed; only prose + citations. Model-backed
backends cost a full inference call (observed 17-21K input tokens) against the account's
quota, so they rank after direct backends by default and show their quota class.

## Mechanisms

- **Rules engine**: pure function `(rules, id) → { hidden, ruleIndex }`, shared by panel
  preview, catalog view and enforcement. Config read synchronously in the factory from the
  user settings file; project rules apply from `session_start` (trust unknown earlier) and the
  panel says so.
- **Enforcement today**: owned families (`claude`, `antigravity`, `synthetic`) drop hidden
  ids from their catalog (verified to remove them from `--list-models`; explicit `--model`
  warns and reconstructs). Built-ins: picker-only via native provider filter is rejected
  because it replaces another owner's registration; wait for upstream ask 1.
- **Overrides**: locked read-modify-write of `models.json` preserving unknown keys and order.
- **Aliases**: owned families append alias entries (copied metadata, own limits) to static and
  refreshed catalogs; the stream wrapper chains the caller's `onPayload`, then rewrites the
  model id. Assistant messages keep the alias id.
- **Verbosity**: `before_provider_request` returns `{ ...payload, text: { ...payload.text,
  verbosity } }` only for Responses payloads whose model matches a configured scope; unset
  means untouched.
- **Groups**: `registerVirtualModel` per group from the factory. `route()` keeps the target in
  branch state; `retry` switches to the next healthy member; `agent_before_settle` handles
  401/quota failures before output (mark member, `context_edit` the failed assistant,
  continue). Health = sign-in + quota snapshot (unknown = not healthy) + recent failure
  cool-down. Quota attribution from physical assistant messages; header ingest for routed
  requests waits for upstream ask 2.

## Open decisions

1. Rules semantics: default listed + hide rules (designed) vs. allowlist.
2. Enforcement scope now: owned families only + upstream PR, or wait for the PR.
3. Cross-provider failover by default (breaks prompt cache and thinking signatures)?
4. Paid members default: never vs. only when free fail.
5. Web search output: results, answers, or both.
