---
document:
  type: "plan"
  id: "ROADMAP"
  title: "pi-auth-plus roadmap"
  description: "Milestone tree for absorbing the five auth and quota packages into one Pi package"
  status: "published"
  revision: 18
  created_at: "2026-10-27T09:43:00+01:00"
  updated_at: "2026-10-27T17:55:28+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["M0-M4 tree after AGENTS.md approval"]
    - revision: 2
      reason: "M0 progress"
      changes: ["core seams, ui frame + /auth, verify recipes and conflict detection done"]
    - revision: 3
      reason: "M0 complete, released as v0.1.0"
      changes: ["imports and seams report done; M1 is now current"]
    - revision: 4
      reason: "claude slice done"
      changes: ["claude live-verified; wire alignment with the real CLI noted as a decision"]
    - revision: 5
      reason: "claude wire aligned"
      changes: ["claude matches the interactive Claude Code CLI on the wire"]
    - revision: 6
      reason: "antigravity slice done"
      changes: ["antigravity reviewed, ported and live-verified; fork login migration blocked on a Pi seam; M1 release is next"]
    - revision: 7
      reason: "M1 released as v0.2.0"
      changes: ["M1 done except the blocked fork-login migration; M2 quotas is now"]
    - revision: 8
      reason: "fork login migration wired"
      changes: ["Locked auth.json write; review of the absorbed packages and setup swap next"]
    - revision: 9
      reason: "swap review passed, user setup swapped"
      changes: ["Review fixes landed (pi-quotas coexistence, antigravity timeouts and hooks); 4 packages replaced by pi-auth-plus"]
    - revision: 10
      reason: "M2 planned"
      changes: ["Plan 0003: full parity first, Pi ids, read-only namespaced CLI; slice 1 engine core is now"]
    - revision: 11
      reason: "M2 slices 1-3 done"
      changes: ["Engine + 7 quota fetchers merged and live-verified; headers + bus is now"]
    - revision: 12
      reason: "M2 slice 4 done"
      changes: ["Header ingestion + quotas bus live-verified; status line is now"]
    - revision: 13
      reason: "M2 slice 5 done"
      changes: ["Quota line live on both runtimes; panels are now"]
    - revision: 14
      reason: "M2 slice 6 done"
      changes: ["/auth quotas + settings tabs live; resets + CLI are now"]
    - revision: 15
      reason: "M2 slice 7 done"
      changes: ["Resets behind a confirm dialog + read-only CLI live; cutover is now"]
    - revision: 16
      reason: "codex decision (D33), cutover units landed"
      changes: ["ChatGPT quota is codex with its own login file; carry-over, docs, parity, bus client done; swap + release left"]
    - revision: 17
      reason: "M2 released as v0.3.0"
      changes: ["Setup swap is the last M2 step"]
    - revision: 18
      reason: "M2 done"
      changes: ["pi-quotas removed from the user setup; M3 tokens is next"]
---

# Roadmap

Legend: `[x]` done, `[>]` now, `[ ]` next, `[.]` later, `[!]` blocked. Only the current milestone has a
detailed plan; later ones hold the ideas that must not get lost.

```text
[x] M0 Foundation                         plans/0001-m0-foundation/plan.md
    [x] AGENTS.md adopted, default branch dev
    [x] tooling scaffold, just check + rpc-verify green
    [x] research and analyses imported with provenance
    [x] pi-provider-seams report
    [x] core/ seams (paths, config, http, redact, registry, bus, cache, auth)
    [x] ui/ frame + /auth router (empty tabs)
    [x] verify recipes: rpc-verify, parity-verify, aot-verify
    [x] conflict detection for the absorbed packages
[x] M1 Providers                          plans/0002-m1-providers/plan.md
    [x] opencode     patch builtin in the factory; 2.1.2 fingerprint; anonymous = Pi-Bolt only
    [x] synthetic    catalog via refreshModels, no network in factory; opt-in web search
    [x] claude       OAuth + API key, CC shaping, lazy version probe, replace patterns;
                     wire aligned with the interactive CLI 2.1.311 (slice 3b)
    [x] antigravity  reviewed (one account, no vault/pool); one model per family, level via
                     thinkingLevelMap; agy 1.4.8 identity over fetch; live on both runtimes
    [x] M1 release   v0.2.0
    [x] fork login migration   locked fill-only auth.json write (Pi has no store seam)
    [x] swap review   analyses/absorbed-packages-review/report.md; fixes landed
    [x] user setup swapped   4 packages -> pi-auth-plus; pi-quotas kept until M2
[x] M2 Quotas       pi-quotas engine on core/ + families/; reset-consume needs approval each
                    time; codex = openai-codex login or pi-quotas' file (D33)
    plan: plans/0003-m2-quotas/plan.md; full parity first, then one setup swap
    [x] 1 engine core   contract, registry quota part, cache gaps, drainage, engine
    [x] 2-3 fetchers    claude, antigravity, synthetic, openrouter, deepseek, xai, openai
                        (Pi's openai login gets 401 -> codex credential chain, live ok)
    [x] 4 headers + bus after_provider_response ingestion; pi-auth-plus:v1:quotas:*
    [x] 5 line          templates, placements, widget, footer
    [x] 6 panels        /auth quotas + settings tabs, /quotas
    [x] 7 resets + CLI  codex reset from the tab (confirm); --quotas-json/--quotas-list
    [x] 8 cutover       [x] carry-over, /quota, docs, parity run, bus client,
                        [x] codex id + /quota codex login, [x] v0.3.0, [x] swap
[.] M3 Tokens       per-family counting sources, content-hash store, footer reuses it
[.] M4 Later        codex/grok providers?, Claustrum vault?, Pi estimator hook upstream
```

## Ideas parked for later milestones

- Pi has no token-estimator hook (`estimate.ts`, 3.5 chars/token); M3 works through `usage`,
  `message_end` and `session_before_compact`, an upstream hook is an M4 candidate.
- pi-quotas footer duplicates token math; M3 removes that duplication.
- antigravity quota (five buckets, credits, reset times) is the M2 engine's first vendor input:
  `.project/analyses/antigravity-cli/1.4.8/05-quota.md`.
