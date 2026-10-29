---
document:
  type: "analysis"
  id: "analysis-model-management-rpc-catalog-race"
  title: "RPC startup model-catalog refresh race"
  description: "Isolated reproduction of catalog refresh cancellation during model visibility and group registration."
  status: "published"
  revision: 1
  version: 1
  created: "2026-10-28T15:22:31+01:00"
  updated: "2026-10-28T15:22:31+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T15:22:31+01:00"
  updated_at: "2026-10-28T15:22:31+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Reproduce the RPC race and assess refresh ordering"]
---

# RPC startup model-catalog refresh race

status: "root-caused"
confidence: "high"

## Summary

A trusted project rule that differs from the user rules can cancel Pi's in-progress RPC startup catalog fetch. The default bundled or previously stored catalog remains, but the fresh network catalog is not published. This reproduces on both Pi-Bolt and stock Pi 1.4.0; no artificial scheduling delay is necessary.

The initial `#appliedRules === undefined` hypothesis is incorrect: the factory calls `apply()` and records the user rules before any session starts. A later project rule change triggers the actual race. A separate, related trigger is session-start virtual group registration, which cancels a catalog fetch even when user rules are unchanged.

The robust startup fix requires ordering network refresh after session-start registration **and** waiting for Pi's implicit registration-triggered offline refreshes. A blind retry after `session_start` is not guaranteed to win. The prototype barrier described below is diagnostic, not a production patch.

## Reproduction

Environment: checkout `9fde18e27280abce5a94c5c7d95928a5f3f769e1`, Linux, Bun 1.4.3, Node 26.11.1, stock Pi 1.4.0 and Pi-Bolt 1.0.7 / Pi 1.4.0. `reproduce.py` creates and removes an isolated home, XDG directories, project, `PI_CODING_AGENT_DIR`, and tmux server per run. The subprocess environment is allowlisted and contains only a dummy Synthetic key. The probe intercepts all JavaScript `fetch` calls: the Synthetic catalog returns two fabricated test entries after 800 ms, and other requests receive HTTP 503. No real credentials or network catalog are used. `before.ts` records calls and abort signals; `after.ts` samples the live registry and isolated model store and drives an RPC `get_available_models` request.

Run from the repository root:

```sh
python3 .project/analyses/model-management/rpc-catalog-race/reproduce.py --case project-owned
python3 .project/analyses/model-management/rpc-catalog-race/reproduce.py --case project-owned --runtime stock
python3 .project/analyses/model-management/rpc-catalog-race/reproduce.py --case user
python3 .project/analyses/model-management/rpc-catalog-race/reproduce.py --case project-owned --mode tui
python3 .project/analyses/model-management/rpc-catalog-race/reproduce.py --case user-group
```

Representative Pi-Bolt RPC `project-owned` output, with times measured from the probe's first session handler:

```text
  2 ms  fetch-start
 12 ms  registry-refresh allowNetwork=false providers=[synthetic,claude,antigravity]
 13 ms  fetch-abort
 23 ms  after-session
1826 ms sample visible=false hidden=false storedVisible=false storedHidden=false
         get_available_models success=true visible=false hidden=false
```

The trusted project's rule hides `synthetic/race-hidden`; `race-visible` is the test-only new network model. Thus its absence from both the registry and the store demonstrates the lost network publication, rather than successful filtering. The stock RPC run likewise logged fetch at 4 ms, targeted offline refresh at 23 ms, abort at 25 ms, and no new model in the registry or store. Both returned process exit 0.

Repeated without injected delay: trusted-project owned rule aborted 5/5 runs, trusted-project built-in rule aborted 5/5, and unchanged user-only rule aborted 0/3. The user-only runs all published `race-visible` while hiding `race-hidden` from `get_available_models`. These counts use independent isolated processes, a fixed 800 ms fake response, and concurrent execution.

Additional controls:

- A trusted project with the same effective rules as the user retained the fresh filtered catalog. With `models.rulesScope: "user"`, a differing project rule was ignored and the user rule remained effective. An untrusted project rule was ignored and both test models appeared.
- Interactive startup in a real tmux PTY retained the fresh filtered catalog on both Pi-Bolt and stock Pi: session-start offline work completed before the startup network refresh began. This is an observed startup result, not a guarantee for subsequent settings changes or delayed internal work.
- `--offline` produced no Synthetic catalog fetch. The extension's independent quota request was intercepted and blocked; this is not a claim that the entire process made no attempted network calls.
- A configured user model group, even with unchanged user rules, produced a global offline refresh from `registerVirtualModel`, aborted the Synthetic fetch and lost the new catalog entry. The same group case succeeded at ordinary interactive startup.
- `just rpc-verify`, run with an isolated HOME/XDG and its own temporary agent directory, exited 0 and returned `get_commands success=true`. `Justfile:20-21` passes `--offline` and checks registration only, so it cannot detect this race.
- `bun test --isolate tests/models/catalog/runtime.test.ts`, with isolated HOME, TMPDIR, XDG and agent directory: `2 pass`, `0 fail`, `5 expect() calls`. The unchanged-rules test uses a mock registry and does not exercise a trusted-project change or Pi's actual concurrent refresh.

## Root cause

1. `src/index.ts:59-61,292-293` loads user settings, registers owned providers and calls `catalogVisibility.apply()` in the factory. `src/models/catalog/runtime.ts:52-55,116` stores the serialized effective rules there. Consequently, the first session does **not** refresh merely because `#appliedRules` was initially undefined.
2. `src/index.ts:161-168` subsequently loads the trusted-project layer in `session_start`. If its effective rules differ, `src/models/catalog/runtime.ts:118-125` refreshes every owned provider plus registered filtered built-ins with `allowNetwork: false`. `src/models/rules/settings.ts:4-8` ensures user-scope restriction still applies.
3. Installed stock Pi `node_modules/@earendil-works/pi-coding-agent/dist/main.js:765-776` starts the RPC network refresh before `runRpcMode`; `dist/modes/rpc/rpc-mode.js:230-258,287` binds extensions and awaits `session_start` afterwards. The instrumentation directly observed the same order in Pi-Bolt.
4. `dist/core/model-runtime.js:590-607` recomposes the selected providers before refreshing them. `node_modules/@earendil-works/pi-ai/dist/models.js:52-57,127-140,180-205` advances a provider generation and aborts its previous controller when the provider is replaced or a new refresh begins. Thus the later offline refresh supersedes the Synthetic network operation. `src/families/synthetic/catalog.ts:78-102` only persists after the network response, so an aborted first fetch leaves the bundled or older stored catalog.
5. `src/models/catalog/runtime.ts:106-107` also registers newly affected non-owned providers during `session_start`. Stock Pi's `dist/core/model-runtime.js:665-682` launches an unawaited **global** offline refresh after that registration. The Pi-Bolt trace shows the same global refresh from `registerProvider`; it can cancel an unrelated Synthetic fetch even if the newly filtered provider is different. `src/index.ts:343` and `src/models/groups/registration.ts:64-75` re-register virtual groups; the trace shows their `registerVirtualModel` also launches a global offline refresh.

A superseded provider refresh is not reliably reported as `aborted` to the outer caller: `pi-ai/dist/models.js:209-232` suppresses provider errors when that provider's signal is aborted and returns the caller signal's aborted state. In the delayed-retry experiment below, the result reported `aborted=false` even though the Synthetic fetch had been aborted.

## Evidence for the fix and its limits

An additional diagnostic `session_start` handler after this extension issues an all-provider background refresh with Pi's default network policy. On the ordinary tested scheduling, `--case project-both --retry` restarted the aborted fetch and produced `visible=true`, `hidden=false`, with the visible entry stored. The equivalent stock test also succeeded. The result contained one expected provider error because the probe intentionally returned 503 for the unrelated pi.dev catalog.

That retry alone is not deterministic. The probe can deliberately defer the implicit global offline refresh to represent a late-finishing registration operation:

```sh
python3 .project/analyses/model-management/rpc-catalog-race/reproduce.py --case project-both --retry --delay-implicit 200
python3 .project/analyses/model-management/rpc-catalog-race/reproduce.py --case project-both --retry --delay-implicit 200 --barrier
```

Without the barrier, the restarted fetch began at 16 ms, the delayed implicit offline refresh aborted it at 210 ms, and `visible=false`, `storedVisible=false`. With the diagnostic barrier, it waited until 212 ms for tracked offline work, then started a new fetch; the sample had `visible=true`, `hidden=false`, `storedVisible=true`. This was repeated successfully with stock Pi. The 200 ms scheduling change was injected by the probe; it was not observed naturally. The barrier monkey-patches the isolated runtime to track promises, so it demonstrates the required ordering rather than an acceptable extension implementation.

## Recommended fix

The smallest deterministic startup change identified is in Pi's refresh orchestration:

1. Track the offline refresh work spawned by provider and virtual-model registration so startup can await its completion, or serialize that work with the startup network refresh. These registration APIs currently return `void`; merely awaiting this extension's explicit targeted refresh does not wait for the global refresh they launch.
2. In RPC mode, start Pi's existing bounded background network refresh **after** all `session_start` handlers and their registration-triggered offline work settle. Preserve `--offline` and the existing non-blocking network behavior. Apply the same ordering barrier to interactive startup, even though ordinary tested interactive ordering passed.
3. Preserve the factory's user-rule application and trusted-project/user-scope semantics. Avoid unconditional group re-registration where possible, but do not rely on that optimization as the race fix. For later in-session visibility changes, use the same coordinator or preserve/restart affected network work after all conflicting offline refreshes; the startup-only ordering does not by itself solve later races.

This is a recommended design, not a verified production patch. The local public extension API does not expose an awaitable handle for Pi's implicit registration refreshes; a blind extension-only retry passed normal scheduling but failed the controlled late-refresh experiment. The repository instruction `AGENTS.md` says "Patching Pi internals needs user approval"; obtain that approval before changing the host. No conclusion is claimed that every possible extension-only design is impossible.

Regression coverage should use the real Pi runtime and a controlled abort-aware dynamic provider: assert that a trusted project rule change in RPC yields a newly fetched visible model, excludes the hidden model, and persists the fetched catalog. Include unchanged user rules, user-only rule scope, untrusted project, built-in filtering registration, configured virtual groups, delayed implicit offline refresh, interactive mode, and `--offline`. Assert the actual provider publication, rather than only the outer `aborted` flag. Update `rpc-verify` or add a companion online-with-fake-transport check; keep the existing offline smoke.

## Open questions / follow-ups

- The production host coordinator and behavior across live settings edits have not been implemented or verified. No live provider credentials or real remote catalog were used.
- The user-group registration trigger is independently reproducible and needs coverage when the startup ordering is changed; it does not depend on visibility rules changing.
- No project source, tests, settings, lockfiles or user state were changed. The repro scripts are analysis artifacts and all probe processes and temporary tmux servers were stopped.
