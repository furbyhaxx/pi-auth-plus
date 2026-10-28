---
version: 1
id: "model-management-and-routing"
title: "Model management, search and quota-aware routing ideas"
description: "User ideas and feasibility for model filtering, overrides, aliases, verbosity, unified search and grouped routing."
type: "ideas"
created: "2026-10-28T10:05:55+01:00"
updated: "2026-10-28T10:22:09+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "ideas"
  id: "model-management-and-routing"
  title: "Model management, search and quota-aware routing ideas"
  description: "User ideas and feasibility evidence; not an implementation plan."
  status: "draft"
  revision: 3
  created_at: "2026-10-28T10:05:55+01:00"
  updated_at: "2026-10-28T10:22:09+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "Record user ideas for feasibility assessment"
      changes: ["Model filtering and editing", "Request verbosity", "Unified provider search", "Quota-aware model groups"]
    - revision: 2
      reason: "Assess feasibility against installed Pi, local code and provider documentation"
      changes: ["Startup catalog and filtering seams", "Alias limit and Codex verbosity constraints", "Search backend differences", "Virtual model routing and quota attribution"]
    - revision: 3
      reason: "Incorporate independent review and reproducible catalog probes"
      changes: ["Existing Pi model scopes and their limitations", "Isolated catalog probe fixtures and results", "Clarify Codex verbosity stream option"]
---

# Model management, search and quota-aware routing

These are user ideas, not approved architecture or implementation scope. Model IDs and limits in
examples are illustrative and do not establish current provider availability or entitlement.
Evidence applies to Pi 1.4.0 as installed on 2026-10-28 unless stated otherwise.

## Model filtering

Hide or disable models using ordered wildcard and negation rules, editable interactively:

```text
opencode/*
!opencode/deepseek-free
antigravity/*claude*
openrouter/*
!openrouter/stealth*
!openrouter/google/*argon*
```

**Goal:** excluded entries must be absent from `pi --list-models`, not merely `/model` or cycling.
One candidate is default-visible, last matching rule wins and `!` re-includes. The syntax and how
wildcards cross `/` are still open; the example contains slashes inside provider model IDs.

**Feasibility:** Pi already has positive model scopes via `--models` and `enabledModels`; these
restrict startup selection and cycling, and `--models` also scopes `/model`. They do not provide
the requested ordered negation: an isolated `--models '!probe-physical/one'` reported no match.
The same probe showed `--models` did not restrict `--list-models`. Pi waits for extension factories
and resolves the available catalog before listing; it does not start a session on that path.

Pi's provider-specific availability filters apply at `getAvailable`, not to the underlying full
`getModels` catalog; the installed virtual-model composition adds virtual entries separately.
Those are source-derived observations, not a documented universal filter hook. This package loads
its settings in `session_start`, too late for the requested CLI behavior (`src/index.ts`). A
session-start picker filter would not satisfy it. The isolated listing probes are recorded below.

**Candidate path:** investigate a public, early catalog/availability-filter hook in Pi, with user
and trusted-project configuration available before model resolution. A provider-specific filter
could cover providers we own, but would not establish universal coverage. Verify `--list-models`,
`--model`, `/model`, cycling, virtual models, catalog refresh and trust behavior together; the
handling of a saved default or resumed session whose model is now hidden also needs defining.
Patching Pi internals is not assumed or authorized. A factory-only virtual-model registration was
independently confirmed visible in `--list-models`; the filter itself has not been prototyped.

## Model overrides and aliases

**Goal:** interactively edit model metadata and create separately selectable variants of the same
upstream model, such as a smaller default context and an expanded-context variant. An alias must
send the original upstream model ID, preserve authentication and pricing, and not claim capacity
that the actual service does not grant.

**Feasibility:** Pi already supports `modelOverrides` in `models.json` and reloads that file when
opening `/model`. An isolated Pi-Bolt probe confirmed an overridden context limit appears in
`--list-models` before a session starts. An editor could build on that existing store, preserving
unrelated settings, credentials and concurrent changes. Model entries use `id` as the API model ID;
a second entry alone is not an alias.

Pi's experimental virtual models can display a second selectable ID and route to the original
physical model. However, after a response Pi uses the **physical** model's context limits for
context usage and compaction; it also checks routed limits before a request. A plain virtual alias
therefore does not by itself enforce different persistent context limits for the two variants.
Alternatives include an upstream alias/limit seam or a carefully scoped physical-entry and request
rewrite; neither has been proven. Verify the on-wire ID, compaction before and after responses,
session resume, max output and provider-specific behavior before committing to an approach.

## OpenAI/Codex verbosity

**Goal:** expose the response verbosity setting interactively, with configurable scope. OpenAI
[documents](https://developers.openai.com/api/reference/resources/responses/methods/create)
`text.verbosity` as `low`, `medium` or `high` for Responses, with `medium` as its API default.

**Feasibility:** installed Pi's `openai-codex-responses` transport sends `text.verbosity` using
the stream option `textVerbosity`, defaulting to `low`. The documented model configuration exposes
no corresponding Codex verbosity field. Pi's model `samplingParams` applies to `openai-responses` but not
`openai-codex-responses`; it is therefore not a complete solution for both routes. The
`before_provider_request` payload hook is a candidate for a scoped override;
merge the existing `text` object rather than replacing other fields. Check how to identify the
actual physical provider when virtual models route requests, and test structured-output settings,
model support and both subscription transports. **UNVERIFIED:** acceptance and effect on the
user's OpenAI/Codex subscriptions. No paid or authenticated probe was performed for this idea.

## Unified authenticated web search

**Goal:** offer a unified search interface using authenticated providers, including OpenAI/Codex,
Claude Code, xAI and Synthetic where each account permits it.

**Feasibility:** Synthetic already has an opt-in direct search tool returning hits and page text.
OpenAI, Anthropic and xAI document hosted search tools used inside model requests; those can return
answers with citations and source URLs rather than the same raw search data. A common adapter can
represent both, but must distinguish direct results from generated answers, preserve citations,
and expose cost, quota and fallback controls. A model-backed adapter adds an inference call unless
the hosted tool is integrated into an existing inference stream. Subscription search entitlement
and behavior are **UNVERIFIED**, even where ordinary subscription inference has worked.

See `.project/research/unified-web-search/report.md` for sources, output differences and gaps.
Do not assume an OAuth subscription grants access to an API-key endpoint or silently switch to a
separately billed backend.

## Quota-aware model groups

**Goal:** expose one selectable group of explicitly chosen provider models with configurable
thinking-level mappings, context/output limits and strategies such as random, balance and failover.
Normally select once per session; failover may change providers when needed.

**Feasibility:** Pi's experimental virtual models route each request to a physical model and can
store JSON routing state on the session branch. An isolated Pi-Bolt probe registered one in an
extension factory and confirmed it appears in `--list-models`; routing and failover were not
probed. Pi records the physical responder and can route retries, but session stickiness and
selection policy are the router's responsibility. Direct requests have no persisted router state.
Forks, resumes, tool continuations and retries require explicit behavior.

Quota snapshots in this package are provider-level, can be stale or unknown, and may represent
shared account windows rather than model-specific capacity. Response-header attribution currently
uses `ctx.model` only as a hint, so a virtual selection may complicate mapping usage to the physical
provider; verify attribution before using it for routing. Auth, real model revision, context/output
limits, modalities, thinking, tools and billing must be evaluated for each physical member. Similar
names do not prove identical releases: the [models.dev catalog](https://models.dev/api.json)
showed separate base and `1017` releases in the user's DeepSeek example on 2026-10-28.

A retry/failover policy needs safe boundaries for partial output, tool calls, side effects and
prompt-cache/signature changes. Never silently replay actions or switch to a paid backend contrary
to configured policy. Group limits cannot be assumed to override Pi's physical-model compaction
behavior; validate that interaction explicitly.

## Recommended next investigation

Start with a small **early catalog-filter seam** spike: determine whether a supported Pi extension
hook can meet the `--list-models` requirement for built-in, custom and virtual providers; if not,
specify the smallest upstream hook. This is the clearest shared foundation for interactive model
management and yields a concrete yes/no result without committing to a UI or implementing the
other ideas. Follow it with an alias-limit probe when that slice is selected.

## Open questions

- Final rule syntax and scope; behavior for hidden defaults, resumed sessions and project trust.
- Alias mechanism and how per-alias limits interact with Pi's physical-model compaction.
- Actual search and verbosity support on each configured OAuth route, and paid-fallback policy.
- Quota freshness/unknown policy, session and branch stickiness, and safe failover boundaries.
- Whether the unified search interface should expose direct results, grounded answers, or both.

## Isolated catalog probe

On Pi 1.4.0 in Pi-Bolt 1.0.6 on 2026-10-28, an empty temporary agent directory, dummy credential and
`--offline --no-extensions` were used; no network request or real credentials were involved.
The extension fixture (`probe.ts`) registered two physical models and one virtual alias:

```ts
export default function (pi) {
  pi.registerProvider("probe-physical", {
    api: "openai-completions", apiKey: "probe-key", baseUrl: "https://example.invalid/v1",
    models: ["one", "two"].map(id => ({id, name: id, reasoning: false, input: ["text"],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 100000, maxTokens: 1000}))
  });
  pi.registerVirtualModel({provider: "probe-virtual", id: "alias", name: "Alias",
    contextWindow: 200000, maxTokens: 1000, route() { throw new Error("not a real provider"); }});
}
```

The agent directory's `models.json` contained:

```json
{"providers":{"probe-physical":{"modelOverrides":{"one":{"contextWindow":345000}}}}}
```

From that directory with `HOME`, `PI_CODING_AGENT_DIR`, and the XDG config, cache, data and state
homes set to it, each command used `pi-bolt --offline --no-extensions -e ./probe.ts` plus the
shown arguments:

```text
--list-models
  probe-physical  one    345K
  probe-physical  two    100K
  probe-virtual   alias  200K
--models probe-physical/one --list-models
  same three entries, including probe-physical/two and probe-virtual/alias
--models '!probe-physical/one' --list-models
  same three entries; Warning: No models match pattern "!probe-physical/one"
```

All three commands exited 0. The probe confirms listing and override application, not request
routing, alias limits after responses, or all provider-specific filtering behavior.

## Pi references

- `devlap05:/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/cli.md`
- `devlap05:/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/settings.md`
- `devlap05:/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-ai@1.4.0@@@1/dist/models.d.ts`
- `devlap05:/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-coding-agent@1.4.0@@@1/dist/core/virtual-models.js`
- `devlap05:/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models-configuration.md`
- `devlap05:/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md`
- `devlap05:/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/custom-provider.md`
- `devlap05:/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/virtual-models.md`
- `devlap05:/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/extensions.md`
