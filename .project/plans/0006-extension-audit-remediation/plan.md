---
version: 1
id: "extension-audit-remediation"
title: "Extension audit remediation"
description: "Resolve all findings from the extension completeness and quality audit with regression and acceptance evidence."
type: "plan"
created: "2026-10-29T16:40:10+01:00"
updated: "2026-10-29T20:23:06+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "plan"
  id: "extension-audit-remediation"
  title: "Extension audit remediation"
  description: "Finding-level closure ledger and rolling-wave implementation boundaries."
  status: "draft"
  revision: 7
  created_at: "2026-10-29T16:40:10+01:00"
  updated_at: "2026-10-29T20:23:06+01:00"
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
    - revision: 5
      reason: "Integrate production pickers, typed collections and session-owned dashboard actions"
      changes: ["Record canonical group health, live panel preferences and remaining outcome/help consumers"]
    - revision: 6
      reason: "Complete production consumers and start combined and live acceptance"
      changes: ["Map every remaining finding to integrated code", "Record cancel-safe host selection and its failed-reload review correction", "Keep pending acceptance and baseline failures explicit"]
    - revision: 7
      reason: "Collect acceptance results and remediate observed count and timer defects"
      changes: ["Record actual provider and performance limits", "Integrate shutdown deadline cleanup", "Define full-request count boundary and honest native labels", "Keep host baseline gate blocked"]
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
done   Production picker/typed collections and creation-time panel ownership
       └─ Scrollable shared health UI, canonical quota IDs and live frame preferences
done   Scoped placement/rule outcomes, complete compact Help and wide input allocation
       └─ Live provenance/rule controls, branch-selected routes and startup warnings
done   Initial combined gates, 167-capture offline terminal matrix and performance measurements
now    Resolve live count-framing defect and native-count authentication feedback
       ├─ Shutdown deadline cleanup integrated; narrow real-host recheck pending
       └─ Focused trusted-project save and Synthetic tool-renderer terminal acceptance
next   Re-run affected combined gates, recheck live native counts and finalize finding evidence
```

Concurrent writers use isolated worktrees and explicit scopes. Shared entrypoint changes integrate
sequentially. The Workbench project task P1 owns this effort; task notes retain per-unit checks/SHAs.

# Current acceptance follow-up

This section supersedes older pending-acceptance wording in the per-finding rows until final
closure is recorded. The initial green gate is not the final gate after these source changes.

- Real streaming succeeded on five configured paths, including a Synthetic virtual group.
  Registered free OpenCode routes returned upstream HTTP 429; no extension cause was established.
  Codex generation lacks a Pi OAuth slot; legacy Codex quota authentication works. OpenRouter
  classification is outside this extension's quota-only adapter. P1bn1 remains blocked rather
  than claiming every-provider success.
- Six quota sources returned HTTP 200 with checked normalization. All seven deliberately missing
  credentials produced login-required reports with zero requests; Synthetic recovered on restoring
  the real credential. Claude quota returned 429; one bounded post-hold recheck is separate.
- Native Claude context counting failed live acceptance: full shaped requests counted 36/41,
  while additive engine reports gave 4/9. P1br now owns a full-request native boundary for supported
  contexts, preserves provider anchors and labels baseline-subtracted contributions as estimates.
  Shared contract `070353b` and truthful `count API` presentation `a9f66e0` are integrated; engine
  and family consumers remain in isolated implementation units. Missing-auth fallback guidance is
  the separate sequential P1bu unit. No fixed framing offset will be added.
- Performance found a bounded losing shutdown deadline. Fix `8712aaa` retains the two-second
  unreferenced drain and clears its timer in `finally`. Regression-first run failed three cases;
  final lifecycle suite passed 58 tests / 334 assertions, scoped Biome and typecheck passed.
  A real offline Pi-Bolt recheck is pending in P1bn7.
- Original 555-model preview rerun: 50-rule median 37.098 ms to 0.1004 ms; unchanged frames have
  zero instrumented evaluator calls/compilations. Raw-development import overhead was about
  1.86 s and factory 9–10 ms; installed/AOT startup was not measured. See the
  [performance report](../../analyses/extension-audit-remediation/performance/2026-10-29-extension-performance.md).
- The final host static job `j204` failed with exactly the same 13 baseline signing-key type
  diagnostics reproduced on clean `a459610`. Targeted selection/API 40 and post-login seven
  tests passed. Patch remains isolated, uncommitted and unbuilt. P1bj9 needs a scope decision;
  [host evidence](../../analyses/extension-audit-remediation/host-boundary/2026-10-29-model-selection-owner.md)
  records the complete static output. The clean temporary baseline worktree was removed.
- Evidence hygiene checked seven reports, 11 JSON files, 26 JSONL files / 177 records and 31
  references; 219 files had zero recognized credential, exact-secret or known identifier matches.
  New follow-up directories still require the final privacy/metadata pass before committing.

# Finding closure ledger

`Open` includes work in progress. A finding closes only with its correction and evidence recorded.

| ID | Required outcome | Status / evidence |
|---|---|---|
| F01 | Rejected aliases cannot affect dispatch; rejected entries explain why | Fixed: `d3dcc40`, `24be892`; accepted AliasCatalog only, rejected collision/missing source and dispatch/preload/usage regressions; Synthetic suites 34 passed, 946 assertions; combined host acceptance pending |
| F02 | Settings transactions serialize across processes without lost unrelated edits | Fixed: `72f610a`; 14 tests, 52 assertions including independent processes; P1a |
| F03 | Dashboard-wide drafts survive tab changes; close/discard is explicit | Integrated host and recursive Settings/Groups/Models/Alias hooks; typed collections retain nested drafts. Parent Settings/commands 53 passed/1802 assertions, lifecycle 30 passed/203 assertions; final terminal acceptance pending |
| F04 | Visible aliases retain source credential eligibility independently of visibility | Fixed: `bd551af`; composed native policy regression in aliases suite; P1b |
| F05 | Offline mode suppresses automatic network activity | Fixed: `dd47f02`, `e4d2ee7`; local tokenizer cache retained, automatic quota/native-count traffic suppressed; tokenizer 13 passed/118 assertions, runtime 41 passed/239 assertions; real-host acceptance pending |
| F06 | Codex login is cancelled with its invocation's session | Wired and harness-verified: `22fe006`; captured signal and delayed mock-login regression; real host replacement acceptance pending |
| F07 | All group mutation paths refresh registrations identically | Integrated: shared saver/effects, one group refresh per normal save, independent catalog/group failures and retryable per-group warnings; parent combined runtime gate 97 passed/618 assertions; final host acceptance pending |
| F08 | Visibility policy governs virtual groups consistently | Fixed: `ce0a6a7`; filtered registration/removal/restoration and selected-group warning/fallback; 13 passed/96 assertions and isolated host hidden/unhidden listing passed |
| F09 | Search tool enable/disable applies symmetrically and truthfully | Integrated: `74adb8a`, inactive factory registration, live activation membership and disabled execution refusal; Synthetic 25 passed/934 assertions, parent compatibility suites 57 passed/371 assertions; final host acceptance pending |
| F10 | Policy-controlled scopes and effective values agree | Fixed: `ab8a4dd`; field-owned allowed scopes used by read/source/load/save, forbidden legacy values removable; 17 passed/99 assertions |
| F11 | Every scoped save reports higher-layer shadowing | Integrated: `6ad1d1d`, `2dd635a`, `399fd94`; shared formatSaveOutcome consumed by Settings, JSON, Rules, Groups, Alias and Quotas. Scoped regression assertions cover higher-layer shadowing; final terminal acceptance pending |
| F12 | Group members pass the router's physical-model eligibility boundary | Integrated: `c140244`; shared predicate used by editor, router and settlement, rejects reserved group provider and virtual API, preserves physical aliases; final keyboard acceptance pending |
| F13 | Counter selection, cache identity and native requests use physical alias targets | Fixed: `4f9ca07`; resolve before cache/family selection, keep logical report identity; regression-first 3 failures then 16 passed/84 assertions |
| F14 | Physical group requests receive verbosity and refresh attribution | Integrated: `57a4fe0`; physical payload and actual response providers own effects; session-provider fallback only without physical hooks. Lifecycle regressions pass; live dispatch acceptance pending |
| F15 | UI health and router health share truthful definitions and member detail | Integrated `576ceb3`, `20399bb`, `d2044ff`: shared GroupMemberHealth, canonical quota IDs, per-member states and intra-group scrolling. Parent combined picker/health/group-routing gate 121 passed/3249 assertions; final terminal acceptance pending |
| F16 | Threshold relationships are validated rather than silently rewritten | Integrated: relation metadata validates loaded/locked target and higher layers, contradictory edits fail before write; credit and token threshold config regressions pass in parent combined 97-test gate |
| F17 | Stopped sessions cannot commit queued quota mutations | Fixed: `f7066d4`; real held-file-lock tests for acquire/snapshot/failure/headers, cancellation and restart; P1c |
| F18 | Token reports invalidate immediately when model identity changes | Fixed: `8f21555`; immediate invalidation, branch replacement and stale-result regressions; P1h |
| F19 | Rule preview compilation is bounded by state changes, not model count | Fixed: `f8b3e88`; batched rulesets and unchanged-frame cache regressions; measured warm compilation count 1,111 to zero; timings below; P1g |
| F20 | Model selection is searchable/pageable by ID or human name; members reuse it | Integrated `0c28352`, `96de700`, `68ba9ac`: shared Models/member picker, full identity inspection, bound paging with Alt+Up/Down fullscreen fallback; legacy picker fixtures migrated. Final terminal acceptance pending |
| F21 | Narrow panels retain/reveal full identity, recovery and essential actions | Integrated dashboard Help and complete consumers: `0b8e293`, `abf60a5`, `7af968b`, `46aa273`. Unclipped descriptions, feedback and actual owner hints survive narrow/one-row bodies; Models/picker 48 passed/1730 assertions; final terminal acceptance pending |
| F22 | Framework input cursor markup survives rendering | Fixed: `edd0b2b`; preserve framework Input output and sanitize seeds; 12 passed; live terminal acceptance pending |
| F23 | Missing credentials are login-required, not pending or raw failures | Integrated `1351c65`: structured missing-auth error, Synthetic needsAuth and actionable recovery; line distinguishes login/error/pending. Live engine recovery acceptance pending |
| F24 | Empty contributions do not claim provider-reported evidence | Fixed: `0b17b5d`; zero-item rows show none while actual usage remains exact; P1j |
| F25 | All collections have typed in-dashboard staging and editing | Integrated `3e49adb`, `84b6d22`: typed provider/literal-rule collections, dedicated Models/Groups navigation, registry provider choices and recursive drafts; parent Settings/commands 53 passed. Final terminal acceptance pending |
| F26 | Placement changes use explicit scope and shared save feedback | Integrated `399fd94`: staged placement, explicit scope chooser and shared saver/outcome feedback; final terminal acceptance pending |
| F27 | Hints match rebound keys and separate multi-character bindings | Integrated `edd0b2b`, `5db0796`, `6830b82`: bound labels and separated report navigation. Quotas/Tokens 28 passed/1334 assertions; final rebound terminal acceptance pending |
| F28 | Command targets validate and complete forgiving IDs/names/aliases | Integrated `aadfc99`: shared resolveTarget/closestNames, validation and abort checks; command regression coverage, final RPC/terminal acceptance pending |
| F29 | Short terminals preserve confirmation/scope/cancel controls | Integrated `8529508` and complete Help consumers; compact chrome prioritizes actions, full feedback and controls stay reachable. Parent dashboard regressions passed in 90-test integration; final live matrix pending |
| F30 | Row/input widths use actual remaining visible columns | Integrated `5db0796`, `cdace17`: remaining input width after chrome and natural Settings label width. Wide-label regression failed before fix; Settings 26 passed/1588 assertions; final terminal acceptance pending |
| F31 | Rule effects, alias/override provenance and routing indicators match current design | Integrated `a7aa782`, `32fa1b8`, `24a726f`, `b8ffd00`: optional metadata, winning-rule explanations and branch-selected physical route. Panel route states selection rather than claiming success. Design reconciled by `ab7baa5`; final live acceptance pending |
| F32 | Appearance/visible metadata/height and warning thresholds are configurable | Integrated `a162eb8`, `229a060`, `84b6d22`, `32fa1b8`: all six controls have runtime consumers. Metadata changes apply live; primary identity/state remain visible/revealable. Final terminal acceptance pending |
| F33 | Synthetic search has complete self-rendered tool states and expected error results | Fixed: `c89819f`; self-rendered semantic states, structured expected failure/cancellation, redacted details; 15 passed/860 assertions; live terminal acceptance pending |
| F34 | Public docs, agent guidance and design/status/storage claims match shipped behavior | Integrated `af66bf2`, `5688a17`, `ab7baa5`, `75ea7fb`: storage, typed editors, design reconciliation, guidance and guarded/manual selection. Final evidence synchronization pending; historical audit unchanged |
| R01 | Late editor continuations cannot save into a replacement session | Guarded: `22fe006`, `c185994`, `9ec8ed2`, `bf4bda8`, `75ea7fb`; invocation and startup-emission ownership, locked migration cancellation, panel callbacks. Automatic selection uses feature-detected host guard via `b8b3647`; paired host failed-reload correction and acceptance pending |
| R02 | Old physical responses cannot enter a replacement session | Guarded: `22fe006`, `57a4fe0`, `c185994`, `9ec8ed2`; actual provider attribution, captured lifetime, stop/start and startup supersession regressions. Final host acceptance pending |

# Integration evidence

- Settings transaction suite: 14 passed, 0 failed, 52 assertions (112 ms).
- Alias/cache/quota suites after integration: 60 passed, 0 failed, 316 assertions (206 ms).
- Lifecycle/commands/tracker/model-preview/token-view suites after integration: 43 passed,
  0 failed, 1,292 assertions (632 ms).
- Shared saver seam: `a79ba5d`, simplified in `6ad1d1d`; 8 passed/47 assertions. It captures
  invocation ownership, serializes persistence/effects and distinguishes committed effect warnings.
  Post-write lock failures were subsequently corrected by `136aea8` and verified in the runtime outcome integration below.
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
- Production editor integration: `3e49adb` typed collections, `64c3257` panel lifetime guards,
  `96de700` member picker, `0c28352` Models picker, `576ceb3`/`20399bb` scrollable member health,
  `84b6d22` provider choices/live frame preferences/override owner capture, and `d2044ff`
  canonical group quota health. Parent combined Settings/commands: **53 passed, zero failed,
  1,802 assertions**; lifecycle: **30 passed, zero failed, 203 assertions**; combined
  Models/Groups/picker/group-routing: **121 passed, zero failed, 3,249 assertions**.
  Logs: `/tmp/auth-collections-owners-integration.log`, `/tmp/auth-owner-wiring-integration.log`,
  `/tmp/auth-picker-health-integration.log`. These supersede the old viewport-assumption failure.
- Final runtime wiring: `75ea7fb` forwards the invocation signal to carry-over. Parent lifecycle,
  migration and dashboard run: **90 passed, zero failed, 1,834 assertions**.
- Guarded selection consumer: `b8b3647`; regression-first legacy-host safety, exact signal
  forwarding, cancellation/supersession and committed settings/override persistence; worker
  lifecycle run **55 passed, zero failed, 326 assertions**.
- First combined gate exposed one incomplete new group catalog fixture at typecheck, then
  four test-fixture contract mismatches: provenance must be explicitly enabled, and fake event
  emitters must share one payload object across all handlers. Corrected without weakening any
  assertions; targeted follow-up **20 passed, zero failed, 186 assertions**. Fixture corrections
  are committed as `e38dd17`.
- Final extension gate on that working tree: **1,183 passed, zero failed, 16,265 assertions**;
  typecheck and Biome passed (291 files). Real RPC command loading passed, provider parity passed
  for **555 models / nine provider entries**, and AOT passed for **165 modules**, largest module
  88,304 bytes. Commands: `just check`, `just rpc-verify`, `just parity-verify`, `just aot-verify`.
- Production terminal acceptance passed all exercised offline scenarios with **167 captures**,
  both themes, configured rebound keys, 36/57/80/140 columns and 8/12-row short cases. Evidence:
  [terminal report](../../analyses/extension-audit-remediation/terminal/2026-10-29-production-dashboard-terminal.md).
  Trusted-project saving, measured contrast and physical mouse/accessibility were not proved.
- Active acceptance: P1bn1 real provider streaming, P1bn2 quota/count endpoints, P1bn3
  performance and P1bn4 production terminal matrix. P1bj owns the paired host boundary.
- Provider streaming has five observed successful paths including a Synthetic virtual group;
  OpenCode returned an upstream free-tier error and another registered approved free route is
  being checked. Quota/count and fresh performance evidence are still in progress. Do not turn
  the green extension gate or offline terminal matrix into a claim that all endpoints passed.

## Pi-Bolt host boundary

The user approved adding an ownership guard. The uncommitted host patch is isolated at
`devlap05:/mnt/Projects/furbyhaxx/pi-bolt/.worktrees/fix-model-selection-owner` (base `a459610`).
Host `AGENTS.md` requires leaving it uncommitted; the independently advancing root checkout is
untouched. The new API is `setModelIfCurrent(model, signal): Promise<boolean>`; a true result
means committed and still current after `model_select`. Retirement, reload, newer selections
and cancellation invalidate old requests before authentication can resume into a new owner.
Stock builds without the method retain successful saves and warn for manual `/model` selection.

- Core and loaded-extension regressions passed in their scoped runs. Latest selection/API suite:
  **40 tests passed**. The related post-login boolean mock was corrected; its **seven tests
  passed**. The full host `npm run check` reached typecheck and found unrelated signing-key literal
  types. An untouched worktree at the exact `a459610` base, with matching installed dependencies,
  reproduced those 13 signing-type diagnostics. Final host static rerun is in progress.
- Independent paired review found and corrected a failed-reload liveness regression. The reload
  gate now clears in a generation-owned finally block, while old attempts stay invalidated and
  retirement stays closed. The new regression first failed three cases, then all **40 selection
  tests passed**, including fresh set/cycle after failure and overlapping reload ownership.
- No host binary was built, installed or published. Full static success is not yet established.

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
