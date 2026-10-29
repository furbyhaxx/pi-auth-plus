---
version: 1
id: "extension-audit-2026-10-29"
title: "Extension completeness and quality audit"
description: "Read-only audit of configuration wiring, runtime composition, TUI behavior, performance, design compliance and documentation."
type: "review"
created: "2026-10-29T15:29:16+01:00"
updated: "2026-10-29T15:29:16+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "review"
  id: "extension-audit-2026-10-29"
  title: "Extension completeness and quality audit"
  description: "Verified findings and explicit gaps from a read-only extension audit."
  status: "published"
  revision: 1
  created_at: "2026-10-29T15:29:16+01:00"
  updated_at: "2026-10-29T15:29:16+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "Requested extension review"
      changes: ["Consolidate configuration, runtime, live terminal, performance and documentation evidence"]
---

# Verdict

The extension is broadly implemented, but it is **not fully wired or behaviorally complete**. All 19 catalog settings have runtime consumers and appear in Settings; that does not mean every save path applies them correctly. Composition between aliases, filters, groups, token counting and settings scopes is the main correctness weakness.

The existing gates are green. Independent probes and real terminal interaction nevertheless found wrong-model routing, lost settings updates, lost drafts, settings that do not take effect, and a measurable rendering bottleneck. Address the high-priority findings before calling the current feature set complete.

This is a review, not an implementation. Product source, tests, manifests and user settings were not changed. The pre-existing untracked `.pi/` was preserved. No publishing, real login, reset-credit consumption or external provider verification occurred.

## Evidence and scope

- Audited revision: `e8b6d7e36f43`, package `0.5.1`.
- Runtime: Bun `1.4.3`, Pi `1.4.0`, Pi-Bolt `1.0.7`, Linux x64, JIT off.
- `just check`: typecheck and lint passed; **824 tests passed, 0 failed, 8,641 assertions across 110 files**.
- `just rpc-verify`: `get_commands` succeeded.
- `just parity-verify`: **555 listed models, nine provider entries checked**, including the explicitly quota-only Codex entry.
- `just aot-verify`: **155 modules, 1,919,776 bytes total bytecode**; largest module `src/index.ts`, 57,184 bytes. The AOT budget passed; this is not a startup-latency benchmark.
- Additional real RPC probe: `/auth settings` returned all 19 effective settings and `disposition: handled`.
- Runtime reviewer: 162 focused tests passed, 873 assertions; six successful in-memory defect reproductions.
- Configuration reviewer: 58 focused tests passed, 2,980 assertions; deterministic storage/interleaving and component probes.
- Live TUI: 36/57/80/140 columns; short heights; dark/light fullscreen; regular mode; rebound keys; saves to user/project/runtime; malformed JSON; aliases/groups/model overrides. Child processes had isolated HOME/XDG/agent directories and a network-disabled bubblewrap namespace. All owned sessions and temporary directories were cleaned up.

Evidence locations:

- `evidence/{check,parity,aot,rpc}.log` and `evidence/headless.json`.
- `evidence/config-report.txt`, `evidence/config-probes.txt`: complete setting trace and original probe commands/results.
- `evidence/runtime-report.txt`, `evidence/runtime-probes.txt`: complete runtime review and original probe commands/results.
- `evidence/{render-probe.ts,performance.json,offline-probe.ts,offline-observation.json}`.
- `evidence/docs-notes.txt`.
- `../../analyses/extension-audit/tui/report.md` and its `captures/` directory: detailed reproductions for terminal findings, numbered there as TUI 1–17.

Evidence labels below mean:

- **Reproduced**: observed in a real process, component probe or explicit simulation, as specified.
- **Source-confirmed**: wiring/control flow establishes the mismatch; full live scenario was not exercised.
- **UNVERIFIED risk**: plausible interleaving, without a demonstrated host-level reproduction.
- **Convention/design gap**: an explicit expectation is missing; this is not necessarily a runtime failure.

# High priority

## F01 — Rejected Synthetic aliases can redirect a real model to another model

**Reproduced, in-memory request shaping.** Catalog expansion rejects an alias whose ID collides with an existing physical model. Synthetic request hooks independently read the raw alias list and still rewrite that physical model's request. The probe retained `physical-a` and `physical-b`, reported a collision, then changed a request for `physical-b` into `{"model":"physical-a"}`.

Sources: `src/models/aliases/named.ts:19–30`, `src/families/synthetic/physical.ts:17–25`, `src/models/aliases/index.ts:116–126`. Evidence: runtime reproduction “Rejected Synthetic alias rewrites physical request.”

There is also no user-facing collision/missing-source reporter wired at `src/index.ts:113–123`; alias saves can succeed without adding an alias. Use one validated alias-resolution result for catalogs, dispatch and token selection, and surface rejected entries.

## F02 — Concurrent settings saves lose unrelated updates

**Reproduced with deterministic mocked storage.** `SettingsStore.save()` reads, merges and atomically replaces the file without a lock. Two successful saves to distinct keys can both read the same snapshot; the last write silently removes the other's change. The probe preserved an unknown key but lost `quotas.alwaysShortIds` when another writer saved `quotas.refreshOnRequest`.

Source: `src/core/config/index.ts:119–140`. Atomic rename in `src/core/fs/index.ts:15–31` prevents partial files, not lost updates. Evidence: config probe “concurrent-settings-save.” This demonstrates the interleaving, not its frequency on a real filesystem. Serialize the whole read-modify-write transaction across sessions, as the model-override path already does.

## F03 — Closing the dashboard can silently destroy drafts in other tabs

**Reproduced in live Pi-Bolt and a component probe.** Stage a Settings change, Tab to Providers, then Escape: the dashboard closes and the draft vanishes. Escape within Settings, Groups and model detail also discards directly rather than asking for confirmation.

Sources: `src/ui/dashboard/index.ts:117–125`, `settings.ts:114–118`, `groups.ts:107–110`, `models.ts:165–168`, `model-detail.ts:190`. Evidence: TUI 1, especially `settings-stage-tab{,-close,-reopen}.txt`. The current user docs describe immediate discard, but the project panel convention explicitly requires confirmation. Draft ownership and close confirmation need to be dashboard-wide.

## F04 — A visible native alias becomes unavailable when its source is hidden

**Reproduced through the composed provider wrappers.** A rule can leave alias `short` visible while hiding its original `base`. The catalog then contains `short`, but both availability methods return an empty list: alias filtering removes aliases, then attempts to rebuild them from a source already removed by visibility filtering.

Sources: `src/models/aliases/native.ts:129–159`, `src/models/catalog/owned-filter.ts:10–15`. Evidence: runtime probe returned `{"catalog":["short"],"available":[],"allAvailable":[]}`. This breaks `/model` and cycling for a valid, independently visible alias. Resolve source eligibility before applying final visibility.

## F05 — Offline mode still starts automatic quota requests

**Reproduced in real Pi RPC with intercepted transport.** With both `--offline` and `PI_OFFLINE=1`, isolated directories and dummy Synthetic auth, startup invoked `https://api.synthetic.new/v2/quotas` during `session_start`. The probe returned a local 503 response; no actual outbound request was sent.

Sources: `src/index.ts:74–77,282`, `src/quotas/engine.ts:263–277`. The local offline flag only gates startup coordination; quota startup refreshes unconditionally. Installed Pi `docs/cli.md:241–242` defines offline mode as disabling automatic network activity. Propagate this policy to background work rather than treating it only as a catalog option.

## F06 — Codex login is not connected to session cancellation

**Source-confirmed missing wiring; real login completion after replacement is UNVERIFIED.** `AuthCommandDeps.signal` and all its guards exist, but the production `registerAuthCommands` dependency object never supplies a signal. Login therefore has only its own 15-minute deadline, with a five-minute browser callback limit. In a still-running host, an old login can continue toward credential persistence and stale UI notifications after its originating session is gone.

Sources: `src/index.ts:420–540`, `src/ui/commands/index.ts:60,308–334`, `src/families/openai/codex-auth/oauth.ts:108–155,171–204`. No login, callback server or account-changing call was executed. Supply a current per-session signal at invocation, cancel it on replacement/shutdown, and retain the pre-write and late-UI guards.

# Medium priority: configuration and runtime composition

## F07 — Generic group saves/reset do not update virtual registrations

**Source-confirmed.** Dedicated Groups saves call `groups.apply()`. Editing `models.groups` through the Settings JSON editor, or removing its override with Backspace, only calls the generic `onSaved` callback, which refreshes model rules but never group registrations. Stored groups and the selectable/routing definitions can disagree until session restart.

Sources: `src/index.ts:434–437,528–539`, `src/models/groups/registration.ts:63–97`. Centralize post-save effects so every editor reaches the same mutation path. Full entrypoint save/reselection reproduction was not run.

## F08 — Group visibility rules are previewed but not enforced

**Source-confirmed.** Virtual groups enter the catalog preview and are evaluated against rules, but `GroupRegistrations.apply()` registers every configured group. The visibility layer only handles owned physical providers or its re-registered builtins. A preview can label `group/<id>` hidden while it remains selectable; hidden-default handling has the same coverage boundary.

Sources: `src/index.ts:410–419`, `src/models/groups/registration.ts:63–76`, `src/models/catalog/runtime.ts:144–146`. Either enforce the rule on virtual registrations or explicitly exclude unsupported targets from the editable contract. Host-level selection reproduction was not run.

## F09 — Synthetic web-search enablement is delayed and sticky

**Partly reproduced.** `synthetic.webSearch` is read only at `session_start`, and `searchRegistered` prevents later reconsideration. Saving true does not activate it immediately; after registration, a later session with false has no deactivation path. The captured handler probe confirmed registration remains after the setting becomes false.

Sources: `src/families/synthetic/index.ts:104–116`, `src/index.ts:528–539`. Documentation mentions session-start activation, but the editor gives no restart/effect guidance, and that does not explain failure to disable in a later session. Make enablement symmetric or present an explicit restart-required contract and implement it correctly.

## F10 — The rules-scope setting can display a value runtime deliberately ignores

**Reproduced with isolated in-memory settings.** With a project `models.rulesScope: "user"`, Settings displays `user (project)`, while effective rules still include the project rule list. Runtime intentionally excludes the project layer when resolving the policy, but the generic editor uses ordinary layered resolution.

Sources: `src/models/rules/settings.ts:4–7`, `src/ui/dashboard/settings.ts:46–49,199`. Preserve the user-policy boundary; make the setting's permitted scopes and effective-value display reflect that boundary. Evidence: `Scope UI: user project Effective rules: [ "project/*" ]`.

## F11 — Shadowed saves report success without explaining the unchanged behavior

**Reproduced live for Rules, Groups and Aliases; source-confirmed for JSON collection saves.** Runtime overrides remain effective after a lower-scope save, but these editors say “Saved to user scope” or close without a warning. Settings' inline path already performs the correct `shadowed()` check.

Sources: `src/ui/dashboard/models.ts:106–120`, `groups.ts:68–82`, `alias-detail.ts:93–103`, `src/ui/commands/index.ts:232–237`; compare `settings.ts:69–77`. Evidence: TUI 2 and `scope-file-checks.txt`. Share scoped-save feedback instead of duplicating incomplete variants.

## F12 — The group editor accepts members the router will never route

**Reproduced at staging; keyboard add path source-confirmed.** A virtual-only group passes the editor's catalog-membership check and schema validation. Routing explicitly excludes `api === "pi-virtual"`, leaving no usable physical members.

Sources: `src/ui/dashboard/group-detail.ts:145–162`, `src/models/groups/route.ts:134–141`. Evidence: config probe `Virtual-only group accepted: true`. Filter member choices and validate at the same physical-model boundary used by routing.

## F13 — Token selection is not consistently alias-aware

**Reproduced locally, with two distinct failure modes.**

- Retargeting a Synthetic alias leaves the engine's cached counter bound to the old source. The probe changed the source to `fixture/second`; family selection changed, but `engine.counterFor()` remained `fixture/first`. Source: `src/tokens/engine/index.ts:102–117`.
- Claude's native count request sends the extension-local alias ID to the server instead of its source. An injected fetch recorded `short-alias` twice. Sources: `src/families/anthropic/index.ts:46–55`, `count.ts:81`. Actual server rejection was not tested. Google likewise selects its counter from the alias's spelling rather than the source (`src/families/google/index.ts:24–50`).

Use resolved physical identity for counter choice/cache invalidation while preserving logical identity in reports. Evidence: the corresponding runtime probes.

## F14 — Group requests bypass global verbosity and request-triggered quota refresh

**Source-confirmed; verbosity pure-function probe reproduced.** Both paths inspect `ctx.model`, which is the virtual group rather than its physical member. `applyOpenaiVerbosity()` refuses the group identity, and `agent_end` cannot resolve it to a quota family. Periodic refresh still exists; this finding concerns the configured after-request refresh and verbosity behavior.

Sources: `src/families/openai/index.ts:31–38`, `verbosity.ts:20–35`, `src/index.ts:316–322`. Per-model sampling metadata may still be honored by Pi; the failure here is this extension's global override path. Bind these effects to the physical request/response identity already available elsewhere.

## F15 — The Groups tab's “healthy” count does not represent routing health

**Source-confirmed.** UI health checks only catalog availability/auth eligibility; it does not inspect quota exhaustion. Routing does inspect quota windows. A quota-exhausted but available member can therefore be labeled healthy while routing avoids it. Group detail also lacks the designed live member auth/quota display.

Sources: `src/index.ts:425–432`, `src/ui/dashboard/groups.ts:163–175`, `src/models/groups/route.ts:89–104`; design `model-management/design.md:115`. Reuse one explicitly defined health model, or label the current count “available” rather than “healthy.” Unknown-quota fallback itself is intentional, not a newly claimed routing bug.

## F16 — Contradictory credit thresholds are accepted and silently changed

**Reproduced.** Settings accepts healthy=50 and critical=100, but `creditStress()` silently reduces critical below healthy; a balance of 60 renders healthy despite being below the configured critical threshold. The individual field ranges permit this state.

Sources: `src/core/config/catalog.ts:71–85`, `src/quotas/line/values.ts:18–25`. Validate the relationship, or expose the normalized effective thresholds instead of accepting a value runtime does not honor.

## F17 — Queued quota writes can still mutate cache after shutdown

**Reproduced with a delayed mutation-queue simulation.** `runRefresh()` checks cancellation before awaiting a queued cache write; the callback executed after the cache lock does not recheck. Holding that queue, calling `stop()`, then releasing it still produced the snapshot. Failure/backoff writes share the gap.

Sources: `src/quotas/engine.ts:312–330`, `src/core/cache/index.ts:122–136,175–192`. Check ownership/cancellation inside the locked mutation. Evidence: runtime probe `snapshotProducedAfterStop: "fake"`; actual multi-process disk scheduling was not stress-tested.

## F18 — Model changes temporarily publish the previous model's token report

**Reproduced.** Scheduling after `model_select` cancels computation but leaves `latest` unchanged. Bus consumers can read the previous model's report during the 250 ms debounce and subsequent asynchronous count. The standalone footer checks identity, but other consumers must currently defend themselves.

Source: `src/tokens/tracker/index.ts:56–62`. Evidence: runtime probe returned provider/model `fake/old` after switching to `fake/new`. Invalidate the published report on identity changes; ordinary same-model debounce can retain its prior report.

# Medium priority: performance and interactive behavior

## F19 — Rules preview recompiles on almost every model comparison

**Measured component benchmark.** `ModelsView.render()` alternates `beforeRule` and `throughRule` arrays for each model. The entrypoint caches only the last array reference, so every alternation recompiles the entire rule set. With 555 models this causes **1,111 compilations per render**.

Sources: `src/ui/dashboard/models.ts:250–270`, `src/index.ts:440–452`. At 140 columns, 30 body rows, five warmups and 30 samples, selecting the last rule produced:

| Rules | p50 render | p95 render |
|---|---:|---:|
| 1 | 0.433 ms | 2.003 ms |
| 10 | 5.825 ms | 8.473 ms |
| 25 | 16.940 ms | 19.253 ms |
| 50 | 37.098 ms | 42.210 ms |

This exceeds the adopted ~4 ms renderer budget at ten rules and grows with both catalog and rule count. Compile each rule set once per relevant state change and cache preview results. This measurement is component CPU time, not end-to-end terminal latency.

## F20 — Large model lists lack search, paging and a group-member picker

**Reproduced live.** A catalog with over 1,600 rows requires single-step movement; `/` and PageDown left the capture unchanged. Group-member entry requires a complete exact `provider/model-id` and rejects prefixes without suggestions. The accepted wireframe advertises `/ filter`.

Sources: `src/ui/dashboard/models.ts:191–225`, `src/ui/dashboard/group-detail.ts:145–156`, `.project/designs/model-management/wireframes/index.html:214`. Evidence: TUI 5. Provide searchable/pageable selection and reuse it for group membership. This is a usability/completeness gap, not an absent group schema field.

## F21 — Narrow layouts hide information needed to act safely

**Reproduced at 36 columns.** Two different model IDs become indistinguishable in both catalog and detail, with no way to reveal the suffix before changing overrides or aliases. Provider recovery commands become `/log…` or `/quo…`, also without a detail/reveal path. Empty Groups drops the only add hint while retaining an inactive save hint; Settings and Quotas lose primary navigation/action hints.

Sources: `src/ui/dashboard/models.ts:289–304`, `model-detail.ts:275–281,338–341`, `rows.ts:12–26`, `tabs.ts:87–110`, `src/ui/frame/index.ts:114–136`. Evidence: TUI 6, 7 and 16. Prioritize identity and recovery, wrap/reveal long identifiers, and provide reachable help instead of relying solely on truncated hints.

## F22 — Group text inputs expose Pi's internal fake-cursor markers

**Reproduced live.** Editing a group ID displayed `audit _pi:fc _pi:/fc …`. The renderer sanitizes already-rendered `Input` output while preserving only the older cursor marker, damaging the current fake-cursor markup.

Source: `src/ui/dashboard/group-detail.ts:43,317–318`; installed `pi-tui/dist/tui.js:69–74`. Evidence: `group-id-cursor-artifacts.txt` and TUI 9. Sanitize user/provider text before rendering; preserve the framework component's own terminal markup.

## F23 — Missing Synthetic credentials produce the wrong state and indefinite pending text

**Reproduced in isolated live Pi-Bolt without credentials.** Pi's credential resolver throws for the absent Synthetic environment key before the quota fetcher's `needsAuth` branch. The panel displays a raw auth-resolution failure without `/login synthetic`, while the quota line continues to show `synthetic: …` even after failure.

Sources: `src/quotas/auth.ts:11`, `src/families/synthetic/quota.ts:114–125`, `src/quotas/engine.ts:311–330`, `src/quotas/line/template.ts:120–125`. Evidence: TUI 4, `synthetic-error-220.txt`. Normalize missing-auth failures and distinguish loading, login-required and failed/backoff states in every surface.

## F24 — Empty assistant content is labeled as provider-reported usage

**Reproduced live after a network-blocked failed chat attempt.** Tokens simultaneously displayed “No provider usage yet” and `assistant 0 · exact (usage)`. `sumCounts([])` represents exact arithmetic zero by assigning the provider source; the renderer turns that into a claim about evidence from a provider.

Sources: `src/tokens/types.ts:35–42`, `src/tokens/engine/index.ts:159–173,255–265`, `src/ui/dashboard/tokens.ts:21–25`. Evidence: TUI 3, `token-command.txt`. Preserve an empty/exact-zero distinction or omit the empty contribution; do not attribute it to a response that never arrived.

# Lower-priority completeness and convention findings

## F25 — Collection editing breaks the typed, staged-panel contract

**Reproduced live and source-confirmed.** Six collection settings leave the dashboard for a raw JSON editor and separate scope selector. Three have dedicated alternatives elsewhere: model rules, aliases and groups. `quotas.providers`, `openai.verbosityProviders` and `claude.replacePatterns` have no typed alternative. The generic path also discards other tabs' state when it closes the dashboard, linking it to F03.

Sources: `src/ui/dashboard/settings.ts:149–154`, `src/ui/commands/index.ts:203–237`; evidence TUI 13. The user docs accurately describe JSON editing, but it falls short of the adopted interactive settings convention. Group/alias schemas themselves are fully represented by their dedicated editors. Broader Pi `models.json` fields are a separate documented coverage limit, below.

## F26 — The quota placement shortcut persists immediately to user scope

**Source-confirmed.** Quotas' placement action writes `quotas.linePlacement` directly to user settings, bypassing staged edits, explicit scope choice and shadow warnings. It can appear ineffective under a project/runtime override.

Source: `src/index.ts:512–514`. The shortcut is documented, so this is a settings-interaction consistency issue rather than an undocumented write. Route it through the same scope/effect policy as other settings.

## F27 — Some hints ignore rebinding or concatenate multi-character keys

**Reproduced live with custom bindings.** Group and model details still show literal left/right arrows although those keys no longer perform the advertised action. Quotas combines rebound provider-navigation keys as `ctrl+pctrl+n` without a separator.

Sources: `src/ui/dashboard/group-detail.ts:281–282,361`, `model-detail.ts:231–232,371`, `quotas.ts:239–244`. Evidence: TUI 10. Derive hints from the same bindings used by handlers and separate keys legibly.

## F28 — Command-target validation and completion are incomplete

**Reproduced live.** `/auth quotas claud` silently opens the unfiltered list; a misspelled setting target selects the first setting. `/auth quotas c` has no provider completion, although `/quota c` does. Section typo handling itself works and suggests a correction.

Sources: `src/ui/commands/index.ts:136–155,185–186,260–261,300,343–355`, `src/ui/dashboard/settings.ts:38–40`. Evidence: TUI 11–12. Validate every supplied target and share argument completion between the dashboard and standalone entry points. The quota fallback is documented, but conflicts with the project requirement for actionable unknown-input feedback.

## F29 — Short terminals lose essential footer and scope controls

**Reproduced at 36×12 and 80×8.** The frame forces a minimum four-row body despite fixed chrome and variable surrounding quota/footer height. Description, hints and part of the save-scope prompt disappear.

Sources: `src/ui/frame/index.ts:19–26`, `src/ui/dashboard/index.ts:82–102`. Evidence: TUI 8. Budget the total visible surface and prioritize confirm/cancel/scope over optional body rows.

## F30 — Label/input width allocation wastes space or implies false truncation

**Reproduced live.** At 140 columns, Settings still clips “Refresh quotas after requests” because labels are capped at 28 columns. Model-name editing shows an ellipsis for a short value because the input reserves almost the whole width before the label/source are added; alias detail uses the same pattern.

Sources: `src/ui/dashboard/settings.ts:187`, `model-detail.ts:289–311`, `alias-detail.ts:172–174`. Evidence: TUI 15 and 17. Compute the input's remaining width after row chrome and allow labels to use available space.

## F31 — Model-management explanations promised by the design are missing

**Design gap.** The catalog lacks the designed matched-rule reason, override/provenance indication and alias row markers. Rules show the selected rule's effect in a description rather than per-rule effects and `re-reg`/`re-reg (raw)` badges. Group switches use notifications rather than the designed statusline indication. These omissions make enforcement and routing harder to understand.

Sources: `.project/designs/model-management/design.md:95–104,122,174`, `src/ui/dashboard/models.ts:274–305,328–334`, `src/index.ts:337–341`. The design remains draft and some mechanisms evolved after its probes; reconcile the intended current surface rather than treating every old wireframe pixel as mandatory. No fresh UI design was settled in this audit.

## F32 — Some required surface controls are absent from the settings catalog

**Convention/configurability gap.** The catalog provides quota placement, templates, short IDs, width and credit thresholds, but no dashboard density, visible-field or height controls. The fallback context footer hardcodes warning/error thresholds at 70/90 percent, and frame/body reserves are fixed constants.

Sources: `src/core/config/catalog.ts`, `src/quotas/line/footer.ts:139–141`, `src/ui/frame/index.ts:17–23`; project convention `AGENTS.md:337–338`. These are missing controls, not existing unwired keys. Decide which of these supported surface behaviors belong in configuration, with defaults preserving the current presentation.

## F33 — Synthetic web search has no custom multi-state tool renderer

**Source-confirmed convention gap.** The tool provides execution and structured details, but no `renderCall`, `renderResult` or `renderShell: "self"`. Missing credentials throw instead of returning an expected error result with details. Pi's default renderer remains functional; the adopted self-rendered, multi-state tool UX is absent.

Source: `src/families/synthetic/web-search.ts:77–140`. No live web-search call was made. This is independent of F09's enablement wiring.

## F34 — Documentation and agent instructions have drifted

**Source-confirmed; no broken README installation link found.**

- `docs/configuration.md:81–95,102–122` omits the tokenizer cache and `XDG_CACHE_HOME` behavior documented correctly in `docs/tokens.md:63`; it also omits the persisted `claude-device-id` created by `src/families/anthropic/identity.ts:47`.
- The configuration storage/environment table presents `$XDG_DATA_HOME/pi-auth-plus` as used storage, but `dataDir()` has no callers (`src/core/paths/index.ts:55`).
- `AGENTS.md:44` says `proper-lockfile` is the only runtime dependency; `package.json` also has `@huggingface/tokenizers`.
- `AGENTS.md:138` says the first callback server is still future work; Codex already implements one. Its host-cache description also includes token counts, while that cache only stores quotas; tokenizer artifacts use XDG cache and token-count memoization is in memory.
- The AGENTS documentation tree names absent provider guides, troubleshooting, performance and development architecture pages, but omits the existing `docs/models.md`. README links are not broken; the missing pages are an incomplete internal documentation contract.
- M4 plan frontmatter still describes unified search although the body correctly moves it to another extension. Roadmap frontmatter has inconsistent top-level/nested update times.
- Getting-started's final links omit Models and Tokens even though README links them. Package keywords omit quota-only providers; this is discoverability polish, not a packaging failure.

Evidence: `evidence/docs-notes.txt`. Main commands, settings defaults/ranges, bus exports and migration documentation largely match source. Documentation also accurately describes some current behavior that conflicts with stronger UI conventions (JSON editors, immediate Escape discard); fixing those behaviors would require updating their docs together.

# Lifecycle risks requiring targeted reproduction

These are not counted as reproduced defects:

- **R01 — Late JSON-editor continuations:** `src/ui/commands/index.ts:207–237` does not check session/disposal identity after awaiting editor and scope dialogs. If a host allows the session to change while either dialog is outstanding, the old continuation can save settings and trigger callbacks. **UNVERIFIED at host level.** Guard after each await and reproduce session replacement with an outstanding dialog.
- **R02 — Old physical responses entering a replacement session:** `src/index.ts:362–368` captures no session generation and checks mutable `quotasEnabled`. A late response after a new session starts could ingest under its new controller. **UNVERIFIED at host level.** Reproduce delayed response + shutdown/startup, then fence by owning generation if confirmed.

F06 is a definite missing signal connection; its real post-replacement login side effects remain unverified. F17 is demonstrated with a queue simulation, not a disk stress test.

# Settings coverage

There are **19 catalog entries: 13 inline typed controls and six JSON collection controls**. Three of those collections also have dedicated structured editors. No completely unreferenced catalog key was found.

| Setting | Editor | Runtime status |
|---|---|---|
| `quotas.refreshIntervalSec` | Inline number | Consumed; provider floors apply |
| `quotas.refreshOnRequest` | Inline boolean | Consumed; group-member gap F14 |
| `quotas.providers` | JSON list | Consumed; typed selector absent |
| `quotas.linePlacement` | Inline enum / quota shortcut | Consumed; Workbench ownership supersedes placement; F26 |
| `quotas.percentDisplay` | Inline enum | Consumed |
| `quotas.compactWidthCols` | Inline number | Consumed |
| `quotas.alwaysShortIds` | Inline boolean | Consumed |
| `quotas.creditHealthyUsd` | Inline number | Consumed; joint validation gap F16 |
| `quotas.creditCriticalUsd` | Inline number | Consumed; silently normalized in F16 |
| `quotas.lineTemplate` | Inline text / preview | Consumed |
| `models.rules` | JSON / dedicated Rules | Consumed; group enforcement gap F08 |
| `models.rulesScope` | Inline enum | Effective scope mismatch F10 |
| `models.hiddenDefault` | Inline enum | Applies to providers the visibility layer handles |
| `models.aliases` | JSON / dedicated Alias | Consumed; resolution/composition issues F01/F04/F13 |
| `models.groups` | JSON / dedicated Groups | Generic save side effect missing F07 |
| `openai.verbosity` | Inline enum / model override | Consumed; group path gap F14 |
| `openai.verbosityProviders` | JSON list | Consumed; typed selector absent |
| `claude.replacePatterns` | JSON rules | Request/count consumers present; typed editor absent |
| `synthetic.webSearch` | Inline boolean | Startup-only/sticky F09 |

The dedicated group editor covers ID, name, strategy, context cap, triggers, member identity/order/tier/cost/thinking map. Alias detail covers every alias schema field. Exact identity/thinking-map text inputs are less usable than pickers, but those knobs are not absent.

The physical-model override editor deliberately exposes a subset of Pi's broader schema: name, limits, reasoning, input, costs and relevant verbosity. Pi's `thinkingLevelMap`, `inputLimits`, tiered costs, prompt cache, general sampling, headers and compatibility settings still require file editing. This is a **coverage limit**, not an unwired `SETTINGS` entry or a regression in the documented subset. Compare `src/ui/dashboard/model-detail.ts:50–75` with installed `pi-coding-agent/dist/core/model-config.d.ts:192–248`.

# Duplication and design assessment

The harmful duplication is behavioral, not the repeated existence of small formatting helpers:

1. Alias expansion, wire rewriting and counter selection independently interpret alias configuration; they disagree in F01, F04 and F13.
2. Settings, JSON, Rules, Groups and Alias saves have different post-save effects, scope warnings and lifecycle guards; F07/F11/F26 and R01 follow.
3. Group UI health and routing health use different definitions; F15 follows.
4. Each editor repeats scrolling, width allocation, hint and close-state machinery; the repeated defects in F03/F27/F30 are evidence for a small shared editor/save boundary, rather than a broad rewrite.

Important exclusions:

- The TUI reviewer flagged vertical frame movement. **This is not treated as a defect here:** `.project/designs/model-management/design.md:75–78` explicitly specifies a shrink-wrapped body, matching the project's content-sized panel rule. That local decision overrides generic fixed-height Workbench guidance. Changing it requires a design decision.
- Workbench statusline ownership overriding quota placement is intentional and documented in `docs/quotas.md:89–93`.
- Backspace's default preview followed by scope-key removal is explicitly documented; inheritance returning a lower-scope value is not itself a bug.
- Unknown-quota/best-effort group fallback is intentional and tested. Draft language about recent-failure cooldown and stricter unknown-health policy needs reconciliation, not an automatic behavior change.
- No bundled `skills/` directory or `pi.skills` declaration exists, and none is promised. Its absence is not a packaging defect. Unified search moved to another extension; Codex/Grok inference providers and a Pi estimator hook are explicitly deferred.

# Verification gaps

- No live provider responses, OAuth completion/refresh, real token-count endpoint rejection, reset-credit consumption or real quota windows/credits were verified. Offline/dummy/sandbox evidence does not prove those paths.
- The terminal driver accidentally submitted an uncleared completion-test prompt as chat; bubblewrap blocked network access, and no credentials were present. Its failed empty response exposed F24. The incident and capture are recorded in the TUI report.
- Concurrent settings-write loss and late quota mutation were deterministic simulations; no multi-process filesystem stress run was performed.
- No physical-terminal contrast assessment, screen-reader or mouse pass, CJK ambiguous-width locale matrix, or untrusted-project save rejection pass was performed. Trusted-project save did work.
- No full startup/idle/stream-mapping benchmark was performed. AOT size and the focused Models render benchmark establish only their measured properties.
- Existing specs are mixed-status artifacts; this audit checked the current model-management design and wireframe source, but did not establish that every older draft requirement remains an accepted product decision.

# Recommended order

1. **Correctness first:** one validated alias resolution path; locked settings transactions; dashboard-wide draft protection; session cancellation/offline policy.
2. **Next slice:** centralize save side effects and scope reporting; close group visibility/member/verbosity/quota gaps; fix counter invalidation and truthful auth/token/health states.
3. **Then UX/performance:** eliminate preview recompilation; add searchable model selection and typed collections; fix narrow/short layouts and key hints; reconcile docs and design status.

No fixes were applied. The findings are ready to be split into focused implementation units; the later work should remain a short roadmap rather than a new all-at-once rewrite.
