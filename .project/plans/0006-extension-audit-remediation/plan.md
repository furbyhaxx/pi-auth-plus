---
version: 1
id: "extension-audit-remediation"
title: "Extension audit remediation"
description: "Resolve all findings from the extension completeness and quality audit with regression and acceptance evidence."
type: "plan"
created: "2026-10-29T16:40:10+01:00"
updated: "2026-10-29T17:02:48+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "plan"
  id: "extension-audit-remediation"
  title: "Extension audit remediation"
  description: "Finding-level closure ledger and rolling-wave implementation boundaries."
  status: "draft"
  revision: 2
  created_at: "2026-10-29T16:40:10+01:00"
  updated_at: "2026-10-29T17:02:48+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "User authorized resolving every audit finding"
      changes: ["Record full scope and first correctness units"]
    - revision: 2
      reason: "Integrate first verified correctness and performance units"
      changes: ["Record regression results and remaining integration seams"]
---

# Scope and acceptance

Resolve F01–F34 and investigate/fence R01–R02 from
[the audit](../../reviews/extension-audit/report.md). The audit remains historical evidence;
this file records closure. Preserve existing `.pi/` and user state. Local commits are allowed;
publishing and account-changing operations require the user's authorization.

Every behavioral correction needs a regression protecting the observed failure, not a source-text
assertion. Integration finishes with `just check`, RPC/parity/AOT verification, representative
live terminal acceptance, focused performance comparison and documentation sync. Unknown evidence
stays explicit. No new bundled skill is required or promised.

# Rolling-wave work

```text
now    Correct physical identity, persistence and session ownership
       ├─ P1a: locked SettingsStore transaction; concurrent real-file saves
       ├─ P1b: one validated alias catalog/eligibility contract
       ├─ P1c: cancellation inside queued quota mutation
       └─ P1f: invocation-owned command and physical-response lifetimes
next   Shared save effects, physical alias/token selection and dashboard draft ownership
       └─ P1e: interactive UX preview before settling new editor patterns
later  Group enforcement/health, typed collections/search/layout, truthful reports
later  Documentation/design reconciliation and complete acceptance
```

Concurrent writers use isolated worktrees and explicit scopes. Shared entrypoint changes integrate
sequentially. The Workbench project task P1 owns this effort; task notes retain per-unit checks/SHAs.

# Finding closure ledger

`Open` includes work in progress. A finding closes only with its correction and evidence recorded.

| ID | Required outcome | Status / evidence |
|---|---|---|
| F01 | Rejected aliases cannot affect dispatch; rejected entries explain why | Open; catalog contract P1b, dispatch wiring next |
| F02 | Settings transactions serialize across processes without lost unrelated edits | Fixed: `72f610a`; 14 tests, 52 assertions including independent processes; P1a |
| F03 | Dashboard-wide drafts survive tab changes; close/discard is explicit | Open |
| F04 | Visible aliases retain source credential eligibility independently of visibility | Fixed: `bd551af`; composed native policy regression in aliases suite; P1b |
| F05 | Offline mode suppresses automatic network activity | Open |
| F06 | Codex login is cancelled with its invocation's session | Wired and harness-verified: `22fe006`; captured signal and delayed mock-login regression; real host replacement acceptance pending |
| F07 | All group mutation paths refresh registrations identically | Open |
| F08 | Visibility policy governs virtual groups consistently | Open |
| F09 | Search tool enable/disable applies symmetrically and truthfully | Open |
| F10 | Policy-controlled scopes and effective values agree | Open |
| F11 | Every scoped save reports higher-layer shadowing | Open |
| F12 | Group members pass the router's physical-model eligibility boundary | Open |
| F13 | Counter selection, cache identity and native requests use physical alias targets | Open |
| F14 | Physical group requests receive verbosity and refresh attribution | Open |
| F15 | UI health and router health share truthful definitions and member detail | Open |
| F16 | Threshold relationships are validated rather than silently rewritten | Open |
| F17 | Stopped sessions cannot commit queued quota mutations | Fixed: `f7066d4`; real held-file-lock tests for acquire/snapshot/failure/headers, cancellation and restart; P1c |
| F18 | Token reports invalidate immediately when model identity changes | Fixed: `8f21555`; immediate invalidation, branch replacement and stale-result regressions; P1h |
| F19 | Rule preview compilation is bounded by state changes, not model count | Fixed: `f8b3e88`; batched rulesets and unchanged-frame cache regressions; benchmark evidence preservation pending; P1g |
| F20 | Model selection is searchable/pageable by ID or human name; members reuse it | Open |
| F21 | Narrow panels retain/reveal full identity, recovery and essential actions | Open |
| F22 | Framework input cursor markup survives rendering | Open |
| F23 | Missing credentials are login-required, not pending or raw failures | Open |
| F24 | Empty contributions do not claim provider-reported evidence | Fixed: `0b17b5d`; zero-item rows show none while actual usage remains exact; P1j |
| F25 | All collections have typed in-dashboard staging and editing | Open |
| F26 | Placement changes use explicit scope and shared save feedback | Open |
| F27 | Hints match rebound keys and separate multi-character bindings | Open |
| F28 | Command targets validate and complete forgiving IDs/names/aliases | Open |
| F29 | Short terminals preserve confirmation/scope/cancel controls | Open |
| F30 | Row/input widths use actual remaining visible columns | Open |
| F31 | Rule effects, alias/override provenance and routing indicators match current design | Open |
| F32 | Appearance/visible metadata/height and warning thresholds are configurable | Open; preview P1e |
| F33 | Synthetic search has complete self-rendered tool states and expected error results | Open |
| F34 | Public docs, agent guidance and design/status/storage claims match shipped behavior | Open; final integration |
| R01 | Late editor continuations cannot save into a replacement session | Guarded: `22fe006`; delayed dashboard/editor/scope/save harness tests; real host boundary acceptance pending |
| R02 | Old physical responses cannot enter a replacement session | Guarded: `22fe006`; delayed entrypoint callback and stop/start harness regression; real host boundary acceptance pending |

# Integration evidence

- Settings transaction suite: 14 passed, 0 failed, 52 assertions (112 ms).
- Alias/cache/quota suites after integration: 60 passed, 0 failed, 316 assertions (206 ms).
- Lifecycle/commands/tracker/model-preview/token-view suites after integration: 43 passed,
  0 failed, 1,292 assertions (632 ms).
- Interactive preview integrated as `1f709ab` at
  [the dashboard preview](../../designs/audit-remediation/index.html); QA and user review pending.
- These are focused regression runs, not the final full gate or live acceptance.

# Decisions retained

- Shrink-wrapped panels remain intentional; do not reintroduce a fixed-height redesign.
- Unknown-quota best-effort routing is intentional; improve truthful health display without
  inventing a stricter fallback policy.
- Unified search remains outside this extension; fix existing Synthetic search only.
- Do not remove features, weaken tests or mark partial work complete to reduce scope.
- New UX preserves keyboard-first operation, configured bindings, themes and 36/57/80/140-column
  support. Primary identity and state remain visible/revealable regardless of metadata settings.
