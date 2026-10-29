---
version: 1
id: "model-selection-owner-acceptance"
title: "Host-owned model-selection verification"
description: "Verification of the isolated uncommitted Pi-Bolt ownership guard and resolved baseline static-gate failure."
type: "analysis"
created: "2026-10-29T20:10:30+01:00"
updated: "2026-10-29T20:43:18+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "analysis"
  id: "model-selection-owner-acceptance"
  title: "Host-owned model-selection verification"
  description: "Core/API/consumer evidence, failed-reload correction and successful isolated host gate."
  status: "published"
  revision: 2
  created_at: "2026-10-29T20:10:30+01:00"
  updated_at: "2026-10-29T20:43:18+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "Collect final isolated-host verification and preserve its limits"
      changes: ["Record selection regression results and baseline signing diagnostics"]
    - revision: 2
      reason: "User authorized isolated signing-type corrections"
      changes: ["Record the successful final host static gate and preserved uncommitted patch"]
---

# Outcome

The host guard is implemented and targeted regressions pass. Full isolated host static
verification now passes after the separately authorized correction of two signing-key parameter
types. The earlier 13 diagnostics were also reproduced on the untouched exact base with matching
dependencies. No host build, installation, commit or publication occurred.

The patch remains uncommitted at
`devlap05:/mnt/Projects/furbyhaxx/pi-bolt/.worktrees/fix-model-selection-owner`, base
`a45961070738557b2a709f4be04222b0119855be`. The independently advancing host root was not
modified or built. The temporary clean baseline worktree was inspected clean and removed after
verification; the ownership patch was preserved.

# Contract

`setModelIfCurrent(model, signal): Promise<boolean>` returns true only when selection committed
and is still current after `model_select` delivery. Retirement, reload, cancellation and newer
selection attempts invalidate old authentication continuations. Failed reload releases only its
own generation's reload gate; retirement remains closed and old attempts stay invalidated.

Auth-plus feature-detects this method. Unsupported hosts preserve successful settings/override
writes and warn to select the model manually with `/model`; automatic selection never falls
back to the unsafe legacy asynchronous API. This is implemented by extension commit `b8b3647`.

# Targeted evidence

Task notes P1bj3/P1bj4/P1bj6/P1bj7/P1bj8 retain detailed implementation/review outputs.

- From the isolated host's `packages/coding-agent`:
  `node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-model-extension.test.ts`
  passed **40 tests, one file**, duration 2.93 s after the final reload correction.
  The regression-first run failed three cases out of 40: fresh set/cycle after a failed reload
  remained stuck, and a second failed reload did not release its own gate.
- The same suite covers delayed old authentication, no stale model/thinking/default/transcript
  or event writes, fresh selection after failure, retirement, and overlapping reload ownership.
- `node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/7027-credential-refresh-hang.test.ts`
  passed **seven tests** after its boolean selection mock was aligned.
- The earlier replacement suite passed **six tests**; it was not rerun after the reload-only
  correction. The final 40-test selection suite exercises the changed reload boundary directly.
- Scoped Biome for the final core/reload test pair checked two files with no fixes.
  `git diff --check` exited zero.
- Independent paired host/extension review found the failed-reload liveness defect. It was
  corrected and the initially failing regression rerun successfully; the guard was not accepted
  solely on its initial implementer's report.

# Baseline static failure

`npm run check` in the isolated patch worktree, earlier job `j204`, exited **1** after 23.3 s.
See [the complete output](host-static-check.txt).

Before TypeScript failed, catalog generation, Biome (**1,728 files, no fixes**), pinned/runtime
 dependency checks, relative import checks, entry-graph budgets and install-lock consistency
passed. TypeScript reported **13 TS2345 diagnostics** in:

- `packages/coding-agent/src/pi-bolt-compile.ts` (one).
- `packages/coding-agent/test/pi-bolt-compile-ux.test.ts` (eight).
- `packages/coding-agent/test/pi-bolt-compile.test.ts` (four).

All concern a `string` argument inferred against a literal signing public-key type. The clean
`a459610` baseline with matching dependencies reproduced the same 13 diagnostics. No ownership
file was named. Browser smoke follows TypeScript and was **not reached**. This establishes a
baseline failure, not a successful complete host gate.

# Successful final static gate

The user explicitly authorized fixing the signing types in isolation. In
`packages/coding-agent/src/pi-bolt-compile.ts`, `checkReleaseSums` and `releaseArchives`
now declare `key: string = PIBOLT_RELEASE_KEY`; default values and behavior are unchanged.
The two signing test files passed **72 tests** and scoped Biome passed.

The final isolated `npm run check`, job `j227`, exited **0** after 17.3 s. Parent read
[the complete successful output](host-static-check-final.txt): catalog generation for 42
providers, Biome (**1,728 files, no fixes**), pinned/runtime dependencies, relative imports,
entry graphs, install-lock consistency, TypeScript and browser smoke all passed.

# Preserved work and limits

Eight modified host paths were verified: four core/API files, three focused test files and
one compile-helper file containing only the two authorized signing annotations. `git diff --check`
passed after the final gate. No other tracked path was modified by this unit. No installed-host or compiled-binary acceptance is
claimed; the user required preserving this uncommitted isolated patch. Auth-plus's guarded and
manual-selection branches are covered by the extension regression suite.
