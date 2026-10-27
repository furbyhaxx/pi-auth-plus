---
document:
  type: "plan"
  id: "ROADMAP"
  title: "pi-auth-plus roadmap"
  description: "Milestone tree for absorbing the five auth and quota packages into one Pi package"
  status: "published"
  revision: 3
  created_at: "2026-10-27T09:43:00+01:00"
  updated_at: "2026-10-27T10:19:20+01:00"
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
---

# Roadmap

Legend: `[x]` done, `[>]` now, `[ ]` next, `[.]` later. Only the current milestone has a
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
[>] M1 Providers                          plans/0002-m1-providers/plan.md
    [x] opencode     patch builtin in the factory; 2.1.2 fingerprint; anonymous = Pi-Bolt only
    [>] synthetic    [x] catalog via refreshModels, no network in factory  [ ] web search
    [ ] claude       CC version pin, mcp_ rename, cch billing header, replace patterns
    [ ] antigravity  review session with the user FIRST (features, UX, API, vault yes/no),
                     then port as provider id `antigravity` with migration from `google`
[.] M2 Quotas       pi-quotas engine on core/ + families/; codex via Pi login, not its own
                    OAuth file; reset-consume needs approval each time
[.] M3 Tokens       per-family counting sources, content-hash store, footer reuses it
[.] M4 Later        codex/grok providers?, Claustrum vault?, Pi estimator hook upstream
```

## Ideas parked for later milestones

- Pi has no token-estimator hook (`estimate.ts`, 3.5 chars/token); M3 works through `usage`,
  `message_end` and `session_before_compact`, an upstream hook is an M4 candidate.
- pi-quotas footer duplicates token math; M3 removes that duplication.
- antigravity carries ~2.9k LOC of vestigial account-pool code; the review decides what dies.
