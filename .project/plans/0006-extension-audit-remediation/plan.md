---
version: 1
id: "extension-audit-remediation"
title: "Extension audit remediation"
description: "Resolve all findings from the extension completeness and quality audit with regression and acceptance evidence."
type: "plan"
created: "2026-10-29T16:40:10+01:00"
updated: "2026-10-29T18:34:46+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "plan"
  id: "extension-audit-remediation"
  title: "Extension audit remediation"
  description: "Finding-level closure ledger and rolling-wave implementation boundaries."
  status: "draft"
  revision: 4
  created_at: "2026-10-29T16:40:10+01:00"
  updated_at: "2026-10-29T18:34:46+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "User authorized resolving every audit finding"
      changes: ["Record full scope and first correctness units"]
    - revision: 2
      reason: "Integrate first verified correctness and performance units"
      changes: ["Record regression results and remaining integration seams"]
    - revision: 3
      reason: "Integrate accepted physical identities, offline enforcement and editor contracts"
      changes: ["Record approved UX, focused evidence and remaining production adoption"]
    - revision: 4
      reason: "Integrate committed persistence, isolated effects and recursive editor ownership"
      changes: ["Record combined runtime regressions and current production adoption units"]
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
done   Locked transactions, accepted alias identities, offline policy, session fences
       ├─ Synthetic dispatch and token counters consume validated physical targets
       └─ Group visibility, typed save outcomes and dashboard draft/busy contracts
done   Committed persistence warnings, independent effects and catalog retry outcomes
       └─ Settings/Groups/Models/Alias recursive draft and busy contracts
now    Production picker/typed-collection adoption and creation-time panel ownership
       └─ Shared health UI, compact layouts, appearance and metadata consumers
next   Complete scoped placement/rule outcomes and compact feedback/help
       └─ Documentation/design reconciliation and acceptance evidence
later  Documentation/design reconciliation and complete real-host acceptance
```

Concurrent writers use isolated worktrees and explicit scopes. Shared entrypoint changes integrate
sequentially. The Workbench project task P1 owns this effort; task notes retain per-unit checks/SHAs.

# Finding closure ledger

`Open` includes work in progress. A finding closes only with its correction and evidence recorded.

| ID | Required outcome | Status / evidence |
|---|---|---|
| F01 | Rejected aliases cannot affect dispatch; rejected entries explain why | Fixed: `d3dcc40`, `24be892`; accepted AliasCatalog only, rejected collision/missing source and dispatch/preload/usage regressions; Synthetic suites 34 passed, 946 assertions; combined host acceptance pending |
| F02 | Settings transactions serialize across processes without lost unrelated edits | Fixed: `72f610a`; 14 tests, 52 assertions including independent processes; P1a |
| F03 | Dashboard-wide drafts survive tab changes; close/discard is explicit | Open; `caa7654`, `be1392e` host contracts, 15 passed/545 assertions; production tab/detail hooks still required |
| F04 | Visible aliases retain source credential eligibility independently of visibility | Fixed: `bd551af`; composed native policy regression in aliases suite; P1b |
| F05 | Offline mode suppresses automatic network activity | Fixed: `dd47f02`, `e4d2ee7`; local tokenizer cache retained, automatic quota/native-count traffic suppressed; tokenizer 13 passed/118 assertions, runtime 41 passed/239 assertions; real-host acceptance pending |
| F06 | Codex login is cancelled with its invocation's session | Wired and harness-verified: `22fe006`; captured signal and delayed mock-login regression; real host replacement acceptance pending |
| F07 | All group mutation paths refresh registrations identically | Integrated: shared saver/effects, one group refresh per normal save, independent catalog/group failures and retryable per-group warnings; parent combined runtime gate 97 passed/618 assertions; final host acceptance pending |
| F08 | Visibility policy governs virtual groups consistently | Fixed: `ce0a6a7`; filtered registration/removal/restoration and selected-group warning/fallback; 13 passed/96 assertions and isolated host hidden/unhidden listing passed |
| F09 | Search tool enable/disable applies symmetrically and truthfully | Integrated: `74adb8a`, inactive factory registration, live activation membership and disabled execution refusal; Synthetic 25 passed/934 assertions, parent compatibility suites 57 passed/371 assertions; final host acceptance pending |
| F10 | Policy-controlled scopes and effective values agree | Fixed: `ab8a4dd`; field-owned allowed scopes used by read/source/load/save, forbidden legacy values removable; 17 passed/99 assertions |
| F11 | Every scoped save reports higher-layer shadowing | Open |
| F12 | Group members pass the router's physical-model eligibility boundary | Implemented: `c140244`; shared editor/router predicate rejects reserved group provider and virtual API, preserves physical aliases; 27 passed; settlement adoption remains |
| F13 | Counter selection, cache identity and native requests use physical alias targets | Fixed: `4f9ca07`; resolve before cache/family selection, keep logical report identity; regression-first 3 failures then 16 passed/84 assertions |
| F14 | Physical group requests receive verbosity and refresh attribution | Open |
| F15 | UI health and router health share truthful definitions and member detail | Open |
| F16 | Threshold relationships are validated rather than silently rewritten | Integrated: relation metadata validates loaded/locked target and higher layers, contradictory edits fail before write; credit and token threshold config regressions pass in parent combined 97-test gate |
| F17 | Stopped sessions cannot commit queued quota mutations | Fixed: `f7066d4`; real held-file-lock tests for acquire/snapshot/failure/headers, cancellation and restart; P1c |
| F18 | Token reports invalidate immediately when model identity changes | Fixed: `8f21555`; immediate invalidation, branch replacement and stale-result regressions; P1h |
| F19 | Rule preview compilation is bounded by state changes, not model count | Fixed: `f8b3e88`; batched rulesets and unchanged-frame cache regressions; measured warm compilation count 1,111 to zero; timings below; P1g |
| F20 | Model selection is searchable/pageable by ID or human name; members reuse it | Open |
| F21 | Narrow panels retain/reveal full identity, recovery and essential actions | Open |
| F22 | Framework input cursor markup survives rendering | Fixed: `edd0b2b`; preserve framework Input output and sanitize seeds; 12 passed; live terminal acceptance pending |
| F23 | Missing credentials are login-required, not pending or raw failures | Open |
| F24 | Empty contributions do not claim provider-reported evidence | Fixed: `0b17b5d`; zero-item rows show none while actual usage remains exact; P1j |
| F25 | All collections have typed in-dashboard staging and editing | Open |
| F26 | Placement changes use explicit scope and shared save feedback | Open |
| F27 | Hints match rebound keys and separate multi-character bindings | Open |
| F28 | Command targets validate and complete forgiving IDs/names/aliases | Open |
| F29 | Short terminals preserve confirmation/scope/cancel controls | Open |
| F30 | Row/input widths use actual remaining visible columns | Open |
| F31 | Rule effects, alias/override provenance and routing indicators match current design | Open |
| F32 | Appearance/visible metadata/height and warning thresholds are configurable | Partial: `a162eb8` defines all six approved controls; `229a060` consumes live 70/90 context thresholds (21 narrow tests passed). Frame/metadata consumers pending; primary identity/state remain visible |
| F33 | Synthetic search has complete self-rendered tool states and expected error results | Fixed: `c89819f`; self-rendered semantic states, structured expected failure/cancellation, redacted details; 15 passed/860 assertions; live terminal acceptance pending |
| F34 | Public docs, agent guidance and design/status/storage claims match shipped behavior | Open; final integration |
| R01 | Late editor continuations cannot save into a replacement session | Guarded: `22fe006`; delayed dashboard/editor/scope/save harness tests; real host boundary acceptance pending |
| R02 | Old physical responses cannot enter a replacement session | Guarded: `22fe006`; delayed entrypoint callback and stop/start harness regression; real host boundary acceptance pending |

# Integration evidence

- Settings transaction suite: 14 passed, 0 failed, 52 assertions (112 ms).
- Alias/cache/quota suites after integration: 60 passed, 0 failed, 316 assertions (206 ms).
- Lifecycle/commands/tracker/model-preview/token-view suites after integration: 43 passed,
  0 failed, 1,292 assertions (632 ms).
- Shared saver seam: `a79ba5d`, simplified in `6ad1d1d`; 8 passed/47 assertions. It captures
  invocation ownership, serializes persistence/effects and distinguishes committed effect warnings.
  A separate post-write lock-failure correction is required before claiming full save correctness.
- Offline/alias integration: 20 passed, 0 failed, 156 assertions.
- Corrected interactive preview: `b85320c` at
  [the dashboard preview](../../designs/audit-remediation/index.html). Independent Chromium/CDP
  retested all six defects: `VERDICT PASS failures=0 pageExceptions=0`, loopback requests only.
  The user approved the interaction and appearance direction through `ask_user`.
- Runtime outcome integration: `136aea8` preserves committed persistence after lock failures;
  `702f5d2` isolates effects; `bc42884` retains failed group registrations; `6ee6143` returns catalog
  warnings and retries failed work. Parent config/saver/lifecycle/catalog/group-registration run:
  **97 passed, zero failed, 618 assertions**, `/tmp/auth-runtime-outcomes-integration.log`.
- Panel adoption: `5a8a23a`, `e8f1e56`, `73ce614`, wired by `2a7abf5`; editor integration:
  **117 passed, one failed**. Failure is a Settings fixture assuming every catalog section fits
  in one viewport after six fields were added; correction belongs to typed collection adoption.
- Tool lifecycle compatibility: `060b810`, `6ef48cf`; **57 passed, zero failed, 371 assertions**.
  The online quota test now explicitly opts out of suite-wide offline mode.
- Adaptive frame `8529508`: frame/dashboard regressions pass; worker exercised isolated tmux
  at 8/12/24 rows and 36/57/80/140 columns. Compact feedback and long rebound hint reachability
  still need the final integrated pass.
- These are focused regression runs, not the final full gate or live acceptance.

## Rule-preview performance

Same 555-model probe at 140 columns/30 rows; 5 warmups and 30 measured samples. Values are
before to after p50/p95 milliseconds; P1g notes retain the exact command/log references.

- 10 rules: 6.031/9.769 to 0.061/0.089.
- 25 rules: 16.578/19.417 to 0.063/0.082.
- 50 rules: 33.630/35.528 to 0.040/0.058.
- Warm compilation count: 1,111 to zero.

# Decisions retained

- Shrink-wrapped panels remain intentional; do not reintroduce a fixed-height redesign.
- Unknown-quota best-effort routing is intentional; improve truthful health display without
  inventing a stricter fallback policy.
- Unified search remains outside this extension; fix existing Synthetic search only.
- Do not remove features, weaken tests or mark partial work complete to reduce scope.
- New UX preserves keyboard-first operation, configured bindings, themes and 36/57/80/140-column
  support. Primary identity and state remain visible/revealable regardless of metadata settings.
- Approved interaction direction: shared searchable/pageable model/member picker, typed in-dashboard
  collections, cross-tab draft protection, explicit scoped saves. No further direction approval needed.
- Approved controls: compact/comfortable density, auto/capped body rows, optional provenance and
  matched-rule metadata, configurable context warning/error percentages with defaults 70/90.
