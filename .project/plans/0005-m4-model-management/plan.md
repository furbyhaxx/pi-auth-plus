---
document:
  type: "plan"
  id: "0005-m4-model-management"
  title: "M4 model management"
  description: "Verbosity, model rules, overrides, aliases, unified web search and quota-aware model groups, grounded in the 2026-10-28 probes"
  status: "draft"
  revision: 1
  created_at: "2026-10-28T11:55:00+01:00"
  updated_at: "2026-10-28T11:55:00+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Probe-backed slice order; slices 1-2 detailed, later slices sparse; upstream asks; open decisions"]
---

# M4 model management

Design: `.project/designs/model-management/design.md`. Wireframes:
`.project/designs/model-management/wireframes/index.html`. Evidence:
`.project/analyses/model-management/`. Not started; waits for the open decisions below.

## Order and why

```
[ ] S1 OpenAI verbosity          verified live, smallest, no Pi seam needed
[ ] S2 Models tab: rules+catalog  engine + editor; enforcement on owned families
[ ] S3 Overrides editor          Pi's modelOverrides, works for every provider
[ ] S4 Aliases (owned families)   stream-level id rewrite; built-ins wait for Pi
[ ] S5 Unified web_search         all backends verified; replaces synthetic_web_search
[ ] S6 Model groups               router, failover recovery, attribution, guard fixes
[ ] U  Upstream Pi asks           visibility filter, response model metadata, wireId
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
4. `/auth` Models tab: Rules and Catalog views per wireframe, `needs Pi hook` marker for
   other providers, `h` appends a rule, saves through the existing scope dialog.
5. Panel captures at 36/57/80/140.

## Later slices (sparse)

- **S3 Overrides**: locked, order-preserving edit of `models.json` `modelOverrides`; detail
  view rows `default|override`; `backspace` resets.
- **S4 Aliases**: owned families append alias entries to static + refreshed catalogs; stream
  wrapper chains caller `onPayload` then rewrites `model`; regression set from
  `alias-limits/report.md` (first response, compaction summary, output cap, refresh, logout).
  Live Anthropic and Responses checks still open.
- **S5 web_search**: one tool, backends `synthetic`, `exa`, `claude`, `codex`/`openai`, `xai`,
  `openrouter` (paid); result contract `results|answer`; cost class per backend; paid off by
  default. Remove `synthetic_web_search` with a settings migration.
- **S6 Groups**: (a) replace `ctx.model.provider` guards in OpenCode identity and Synthetic
  usage with request/physical-message checks; (b) router with branch-state stickiness and
  `retry` switching; (c) `agent_before_settle` recovery for 401/quota before output; (d) quota
  attribution from physical assistant messages; (e) Groups tab per wireframe.
- **U Upstream**: file the three Pi asks from the design; when the visibility filter lands,
  extend S2 enforcement to all providers and drop the `needs Pi hook` marker.

## Open decisions (block S2 and S6 only)

1. Rules semantics: default listed + hide rules (designed) or allowlist.
2. Ship S2 enforcement on owned families now, or wait for the Pi hook.
3. Cross-provider failover default on or off.
4. Paid members default: never, or only when free ones fail.
5. web_search output: results, answers, or results-else-answer (designed).
