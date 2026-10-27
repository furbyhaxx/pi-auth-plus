---
document:
  type: "plan"
  id: "PLAN-0001"
  title: "M0 foundation"
  description: "Tooling, imported knowledge, core seams, UI frame and verify recipes before any provider lands"
  status: "completed"
  revision: 2
  created_at: "2026-10-27T09:43:00+01:00"
  updated_at: "2026-10-27T10:19:20+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["M0 slices after AGENTS.md approval"]
    - revision: 2
      reason: "milestone complete"
      changes: ["all slices landed; released as v0.1.0"]
---

# M0 foundation

Goal: a package that loads in Pi-Bolt and stock Pi, registers nothing vendor-specific yet,
and gives M1 every shared seam it needs. Done when `just check`, `just rpc-verify` and
`just aot-verify` pass on `dev` and `/auth` opens an (empty) dashboard.

## Slices

| # | Slice | Done when |
|---|---|---|
| 1 | Tooling scaffold | `just check` green on an entry that registers nothing |
| 2 | Import artifacts | every imported file has `document:` frontmatter + `source:` |
| 3 | pi-provider-seams report | startup order, registerProvider merge, refreshModels, estimator gap |
| 4 | `core/` seams | each seam has its one behavior test (below) |
| 5 | `ui/` frame + `/auth` | panel opens in tmux at 36/57/80/140 cols; headless prints text |
| 6 | Verify recipes | rpc, parity (no providers yet: harness only), aot pass |
| 7 | Conflict detection | loading an absorbed package warns once and names it |

## Slice 4 units (detail when slice 3 lands)

- `core/paths`: agent dir, XDG, project `.pi`. Test: env overrides win, `ctx.cwd` not
  `process.cwd()`.
- `core/redact`: Test: bearer, API keys and OAuth tokens never survive in errors or bus
  payloads.
- `core/http`: fetch + signal + timeout, `ProviderHttpError`, `Retry-After`. Test: abort and
  retry-after parsing.
- `core/config`: catalog, layers, staged save. Test: precedence and unknown-key preservation;
  malformed file blocks save.
- `core/cache`: atomic write, leases, parser-version fence. Test: stale parser version is
  ignored, concurrent writers do not corrupt.
- `core/bus`: `pi-auth-plus:v1:*`, nonce replies. Test: reply reaches only its requester.
- `core/registry`: `FamilyAdapter`, ids, aliases. Test: alias resolution and duplicate id
  refusal.
- `core/auth`: `auth.json` slot access through Pi only. Test: never writes outside the slot.

## Next (sparse)

M1 starts with opencode (smallest, proves the registration seam), then synthetic (proves
`refreshModels`), then claude. Antigravity waits for its review session.
