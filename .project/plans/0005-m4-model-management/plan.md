---
version: 1
id: "0005-m4-model-management"
title: "M4 model management"
description: "Verbosity, model rules, overrides, aliases and quota-aware model groups"
type: "plan"
created: "2026-10-28T11:55:00+01:00"
updated: "2026-10-28T18:49:34+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "plan"
  id: "0005-m4-model-management"
  title: "M4 model management"
  description: "Verbosity, model rules, overrides, aliases, unified web search and quota-aware model groups, grounded in the 2026-10-28 probes"
  status: "published"
  revision: 5
  created_at: "2026-10-28T11:55:00+01:00"
  updated_at: "2026-10-28T11:29:26+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 5
      reason: "M4 implementation and release"
      changes: ["Mark completed slices and note bounded recovery and catalog coordination"]
    - revision: 1
      reason: "document creation"
      changes: ["Probe-backed slice order; slices 1-2 detailed, later slices sparse; upstream asks; open decisions"]
    - revision: 2
      reason: "user decisions D62-D64 and built-in re-registration probe"
      changes: ["S2 enforces on built-ins via re-registration", "Decided items removed from open decisions"]
    - revision: 3
      reason: "user decisions on paid members and web search"
      changes: ["S5 web_search moved to a separate extension", "S6 groups use priority tiers"]
    - revision: 4
      reason: "user prohibited filing Pi hook requests upstream and authorized implementation"
      changes: ["Removed upstream request work", "M4 implementation started"]
---

# M4 model management

Design: `.project/designs/model-management/design.md`. Wireframes:
`.project/designs/model-management/wireframes/index.html`. Evidence:
`.project/analyses/model-management/`. Implementation authorized; use local Pi seams and report
limitations without filing upstream hook requests.

## Order and why

```
[x] S1 OpenAI verbosity          verified live
[x] S2 Models tab: rules+catalog  owned and built-in enforcement
[x] S3 Overrides editor          Pi modelOverrides
[x] S4 Aliases                   provider-local aliases
[-] S5 web_search               moved to a separate extension (2026-10-28)
[x] S6 Model groups              tiers, routing, failover, attribution and balancing
[x] Gemini thought-signature recovery and guarded RPC startup coordination
```

S1 and S2 are independent; S3 reuses S2's catalog view; S4 extends S3's detail view; S6
depends on the guard fixes (S6a) and uses the S2 catalog for member picking.

## S1 OpenAI verbosity (detail)

- Settings catalog: `openai.verbosity` (`default|low|medium|high`, default `default`),
  `openai.verbosityProviders` (default `["openai", "openai-codex"]`); Settings tab section
  "OpenAI".
- `before_provider_request` handler: act only when the setting is not `default`, the session
  model's provider is in scope **and** the payload is a Responses body whose `model` equals the
  session model id; return `{ ...payload, text: { ...payload.text, verbosity } }`.
- Test that matters: merge keeps `text.format` and other fields, initializes a missing `text`,
  leaves non-Responses and out-of-scope payloads untouched (identity).
- Verify: `just check`; live one request per route at `high` and `low` with the payload logged
  (re-use `.project/analyses/model-management/verbosity/` probe).

## S2 Models tab: rules and catalog (detail)

Units:

1. `src/models/rules/` pure engine: parse, glob (`*` one segment, `**` across, bare
   `provider/*` matches nested ids), evaluate last-match-wins; tests on the user's example
   list and nested OpenRouter ids.
2. Settings: `models.rules` (ordered string list), user + trusted project scopes, read
   synchronously in the factory for the user scope.
3. Enforcement on owned families (`claude`, `antigravity`, `synthetic`): drop hidden ids from
   static and refreshed catalogs. Test: hidden id absent from `--list-models`; `--model` on it
   warns (isolated `pi-bolt --offline` fixture as in `filter-seams/`).
4. Built-in enforcement (`src/models/rules/reregister.ts`): for each built-in provider with an
   active hide rule, merge `getModels(id)` + `models-store.json` on `type:id`, drop hidden,
   `pi.registerProvider(id, { models })`; repeat on catalog refresh. Test: isolated fixture
   diff of `--list-models` equals exactly the hidden set (as in
   `builtin-reregistration/report.md`); one live call on a kept openai model.
5. OpenRouter spike: apply `personalizeOpenRouterCatalog` to the rebuilt list; parity diff
   must be empty. Until it passes, openrouter rules show `re-reg (raw)`.
6. `/auth` Models tab: Rules and Catalog views per wireframe, `h` appends a rule, saves
   through the existing scope dialog.
7. Panel captures at 36/57/80/140.

## Later slices (sparse)

- **S3 Overrides**: locked, order-preserving edit of `models.json` `modelOverrides`; detail
  view rows `default|override`; `backspace` resets.
- **S4 Aliases**: owned families append alias entries to static + refreshed catalogs; stream
  wrapper chains caller `onPayload` then rewrites `model`; regression set from
  `alias-limits/report.md` (first response, compaction summary, output cap, refresh, logout).
  Live Anthropic and Responses checks still open.
- **S5 web_search**: dropped here; the separate extension takes
  `analyses/model-management/search-entitlement/` as input. `synthetic_web_search` stays.
- **S6 Groups**: (a) replace `ctx.model.provider` guards in OpenCode identity and Synthetic
  usage with request/physical-message checks; (b) router: priority tiers (strategy inside the lowest healthy
  tier, next tier only when a tier is exhausted), branch-state stickiness, `retry` switching; (c) `agent_before_settle` recovery for 401/quota before output; (d) quota
  attribution from physical assistant messages; (e) Groups tab per wireframe.

## Decided 2026-10-28

- Rules default-visible, hide rules, `!` re-shows, last match wins.
- Enforce via owned catalogs and built-in re-registration where possible; do not file Pi hook
  requests upstream (explicit user decision).
- Group failover may cross providers.
- Group members carry priority tiers; paid is a label, not a policy.
- Web search leaves pi-auth-plus.

## Open decisions

1. `balance` strategy: weigh cost or only quota headroom (decide inside S6).
