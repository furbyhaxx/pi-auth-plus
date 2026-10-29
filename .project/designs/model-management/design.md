---
document:
  type: "design"
  id: "design-model-management"
  title: "Model management, verbosity and model groups"
  description: "Verified seams, UX and mechanisms for model rules, overrides, aliases, OpenAI verbosity and quota-aware groups (web search evidence kept for a separate extension)"
  status: "draft"
  revision: 5
  created_at: "2026-10-28T11:45:00+01:00"
  updated_at: "2026-10-29T19:09:11+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 5
      reason: "Reconcile approved audit remediation UX and current routing semantics"
      changes: ["Searchable pickers and explicit runtime scope", "Optional metadata and adaptive layout", "Unknown-quota best effort and physical attribution"]
    - revision: 1
      reason: "document creation"
      changes: ["Probe results for filter seams, verbosity, search, routing, alias limits and attribution; UX for /auth Models, Groups and Settings additions"]
    - revision: 2
      reason: "user decisions D62-D64 and built-in re-registration probe"
      changes: ["Rules default-visible decided", "Built-in enforcement via provider re-registration", "Cross-provider failover decided"]
    - revision: 3
      reason: "user decisions on paid members and web search"
      changes: ["Group members get priority tiers; cost class is a label only", "Web search moved to a separate extension"]
    - revision: 4
      reason: "user prohibited filing Pi hook requests upstream and authorized implementation"
      changes: ["Record Pi API limitations without proposing upstream requests"]
---

# Model management, verbosity and model groups

Source ideas: `.project/ideas/model-management-and-routing/ideas.md`. Interactive wireframes:
`wireframes/index.html` (views `rules`, `catalog`, `detail`, `groups`, `group`, `settings`;
`?view=<id>&w=36|57|80|140`). Evidence: `.project/analyses/model-management/*/report.md`.
All findings are against Pi 1.4.0 (Pi-Bolt 1.0.6/1.0.7) on 2026-10-28.

## What the probes established

The table records the initial 2026-10-28 probes. Current behavior and audit corrections
are tracked in `../../plans/0006-extension-audit-remediation/plan.md`.

| Idea | Verdict | Evidence |
|---|---|---|
| Model rules hide from `--list-models` | **Not with a supported seam.** Provider filters ignore named configs; native replacement filters listings and `/model` but `--model <hidden>` still works; virtual models bypass provider filters; native filters don't compose (last wins). Project trust is not visible in the factory. | `filter-seams/` (25/25 assertions) |
| Overrides | Feasible now through Pi's own `models.json` `modelOverrides` (metadata only). | `ideas.md` probe |
| Aliases with own limits | Feasible **for providers whose stream we own**: physical alias entry + `onPayload` model-id rewrite inside the provider stream (covers compaction summaries, which `before_provider_request` misses). Virtual aliases lose their limits after the first response. Built-ins (`openai`, `xai`, `openrouter`, `opencode`) need a Pi seam. | `alias-limits/` |
| OpenAI verbosity | **Verified live** on `openai` (ChatGPT OAuth, Responses) and `openai-codex` (legacy Codex). `before_provider_request` merge accepted at low/medium/high, output length rose with level, `text.format` preserved. | `verbosity/` |
| Unified web search (moved to a separate extension) | **Executed live on every subscription route**: Claude OAuth (encrypted results + cited prose), ChatGPT-direct and legacy Codex (2 searches each, `web_search.num_requests: 2`, cited prose), xAI OAuth (2 searches + page open, citations; `cost_in_usd_ticks` reported, subscription billing unverified), Synthetic (raw hits + page text), OpenRouter (citations, $0.001), OpenCode Exa MCP (unauthenticated). Only Synthetic and Exa return raw results; the others are a full model call (~17-21K input tokens). | `search-entitlement/` |
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

## Pi API limitations

The installed Pi API lacks the following capabilities. The user explicitly prohibited filing
upstream hook requests; these are technical constraints, not planned external actions.

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
                            │       │       └ Models · OpenAI sections
                            │       └ list → group detail (strategy, policy, members)
                            └ Rules ⇄ Catalog (v) → model detail (overrides, aliases)
```

### Models › Rules

- Ordered list, gitignore semantics: default listed, a rule hides, `!rule` shows again, last
  match wins. `*` stays inside one `/` segment, `**` crosses; a bare `provider/*` also
  matches nested ids (`openrouter/google/x`), as the user's example expects.
- Each row shows its live effect (`3 hidden`, `1 shown`); the bottom line shows the total and
  the surfaces it governs. Keys: `a` add, `enter` edit, `space` on/off, `shift+↑↓` reorder,
  `d` delete, `ctrl+s` save to user / trusted project / runtime. Saves report higher-layer
  shadowing and committed warnings; uncommitted failures retain drafts.
- Built-in providers are enforced by re-registration; provider enforcement limitations
  are explained in the model documentation.

### Models › Catalog and model detail

- A shared searchable/pageable catalog shows provider/model identity and listed/hidden
  state. Search accepts IDs and human names; `?` reveals full identity at narrow widths.
  Optional provenance and matched-rule metadata explain aliases and winning rules;
  secondary metadata gives way before identity and primary state.
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
  context window (default smallest member, editable down only), thinking map, members with
  live auth/quota, a priority tier (`T1` first) and an `included|free|paid` cost label.
- Tiers: the strategy picks inside the lowest tier that has a healthy member; the next tier
  is used only when every member of the current one fails. Paid members get no special
  treatment; e.g. paid OpenRouter in T1, free members x, y, z in T2 (or T2, T3, T4 for a
  strict order). Default: every member in T1, so plain strategy order applies.
- Failover boundary: only before the first output token and never across a started tool
  call; otherwise the turn errors with the reason. Partial-text retries are visible to the
  user; a switch notification and the Groups view identify the physical route.

### Settings additions

| Section | Setting | Values (default) |
|---|---|---|
| Models | Model rules scope | user, user + trusted project (user + trusted project) |
| Models | Hidden default model | warn and keep, fall back (warn and keep) |
| OpenAI | Response verbosity | Pi default (low), low, medium, high (Pi default) |
| OpenAI | Verbosity scope | providers: openai, openai-codex |

Per-model verbosity in model detail overrides the global value.

Web search moved out of pi-auth-plus (2026-10-28): it will live in a separate extension. The
live probe results in `analyses/model-management/search-entitlement/` stay as its input.

## Mechanisms

- **Rules engine**: pure function `(rules, id) → { hidden, ruleIndex }`, shared by panel
  preview, catalog view and enforcement. Config read synchronously in the factory from the
  user settings file; project rules apply from `session_start` (trust unknown earlier) and the
  panel says so.
- **Enforcement today**: owned families (`claude`, `antigravity`, `synthetic`) drop hidden
  ids from their catalog (verified to remove them from `--list-models`; explicit `--model`
  warns and reconstructs). Built-ins with at least one active hide rule: named
  `pi.registerProvider(id, { models })` from the factory with bundled `getModels(id)` +
  `models-store.json` merged on `type:id`, hidden ids dropped; re-run on catalog refresh.
  Verified: hidden ids leave `--list-models` online and offline, kept models answer live,
  `modelOverrides` still apply, openai list matches stock exactly. Gaps: OpenRouter
  personalization is lost (spike `personalizeOpenRouterCatalog`), explicit `--model` on a
  hidden id fails with a misleading `vercel-ai-gateway` key error, refresh behaviour
  unobserved (`analyses/model-management/builtin-reregistration/`). No upstream hook request
  will be filed.
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
  continue). UI and routing share physical eligibility and quota health. Unknown quota
  remains best-effort routable unless exhaustion is observed; when no routable candidate
  remains, the router can still attempt a configured physical candidate. Failed members
  are tracked on the branch for the turn. Physical request wrappers provide exact provider
  attribution for headers, global verbosity and request-triggered quota refresh.

## Decisions (2026-10-28)

- Rules: everything listed by default; rules hide, `!rule` shows again, last match wins.
- Enforcement: everywhere now. Owned families drop ids; built-ins via re-registration (user
  idea, probe-verified with the gaps above); no upstream hook request.
- Failover: any member, including other providers; the status line names the switch.

- Paid members: no paid policy; members get priority tiers instead (user: "only fall back to
  the free models in order x, y, z when the paid ones fail").
- Web search: dropped from pi-auth-plus; a separate extension will own it.

## Adopted audit controls

- `dashboard.density`: comfortable/compact; panels remain shrink-wrapped.
- `dashboard.maxBodyRows`: 0 (auto) or a 1–60-row cap.
- `dashboard.showProvenance` and `dashboard.showMatchedRule`: optional metadata, default off.
- `tokens.warningPercent` / `tokens.errorPercent`: defaults 70/90; warning must be below error.
- Cross-tab and nested drafts survive navigation. Discard requires confirmation; saves block
  conflicting navigation. Help reveals full feedback and rebound bindings on compact frames.
- Typed provider lists and literal replacement rules replace raw JSON editing; model rules,
  aliases and groups navigate to their dedicated editors.

## Balance decision

Balance uses comparable estimated remaining requests when credit/rate data supports it,
otherwise comparable quota headroom, otherwise ordered rotation. Cost labels remain
informational. Unified search stays separate; the existing Synthetic search tool remains.
