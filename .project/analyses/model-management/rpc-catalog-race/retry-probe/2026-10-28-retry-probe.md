---
document:
  type: "analysis"
  id: "analysis-rpc-catalog-retry-probe"
  title: "Catalog interruption retry feasibility"
  description: "Tests a bounded extension-only Synthetic catalog retry against stock Pi and Pi-Bolt, including cancellation, offline mode, concurrency, and deadlines."
  status: "published"
  revision: 4
  version: 1
  created: "2026-10-28T15:43:33+01:00"
  updated: "2026-10-28T15:47:49+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T15:43:33+01:00"
  updated_at: "2026-10-28T15:47:49+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Record retry, cancellation, publication, and timeout experiments"]
    - revision: 2
      reason: "evidence clarification"
      changes: ["Record exact network-trace commands and socket families"]
    - revision: 3
      reason: "picker control"
      changes: ["Record successful user-controlled refresh"]
    - revision: 4
      reason: "evidence precision"
      changes: ["Limit socket conclusions to observed address families"]
---

# Catalog interruption retry feasibility

status: "root-caused"
confidence: "high"

## Summary

A buffered, single-flight, capped retry can repair the observed RPC startup race, including an injected 200 ms implicit offline refresh, on both tested runtimes. It is not safe to deploy as a general reaction to `refreshModels` aborts: the same signal and reason also represent a user closing `/model` or Pi's 15-second deadline. The prototype restarted and persisted a catalog after the real picker was canceled on both runtimes.

A retry can also supersede a newer refresh, return `aborted=false` after itself being superseded, exhaust its cap during registration storms, and restart after its own timeout. A pre-aborted registry refresh can itself abort a live refresh. An accepted provider persistence publication does not confirm Pi's later in-memory publication.

The safe extension-only choice demonstrated today is to leave ambiguous aborts canceled and retain the bundled or stored catalog; a later Pi-owned, user-initiated refresh remains available. No automatic extension-only solution meeting all requested cancellation, offline and boundedness requirements was demonstrated. A heuristic startup retry remains best-effort and must not be presented as deterministic or cancellation-safe.

## Reproduction and environment

Captured matrix: [`evidence.json`](evidence.json) (38 runs), [`pre-aborted-evidence.json`](pre-aborted-evidence.json) (2 runs), and [`picker-wait-evidence.json`](picker-wait-evidence.json) (2 runs), including the exact subprocess commands, complete event sequences, RPC results and picker pane captures. Checkout HEAD at capture was `31b746664657e398addef181e657bdc3e3506a68`; the earlier race report used `9fde18e27280abce5a94c5c7d95928a5f3f769e1`. The shared checkout's group-registration file changed between those commits. No source was changed by this probe.

Stock Pi 1.4.0 runs with Node 26.11.1 from the repository's installed CLI bundle; Pi-Bolt is 1.0.7 / Pi 1.4.0. Each run uses isolated temporary HOME, XDG directories, project, agent directory and, for interactive cases, tmux server. The only Synthetic key is an inert dummy string. The probe replaces JavaScript `fetch`: a fabricated catalog returns after 800 ms, and all other fetches return 503. No real credentials or external services are used. Only the specifically named delay and publication experiments instrument private runtime methods; the retry itself calls the public `ctx.modelRegistry.refresh` method.

The synthetic fixture has `race-visible` and `race-hidden`. With the test visibility rule, the expected live and RPC result is visible=true, hidden=false; both raw entries may legitimately remain in the Pi store. `--delay-implicit 200` injects a 200 ms delay into a registration-triggered, global offline refresh; it is not a measurement of a naturally observed delay. Each matrix row below is one captured run per runtime; it is not a statistical reliability claim.

For the commands below, set `R=/mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/rpc-catalog-race/retry-probe/run.py`. Each row was run once with `python3 "$R" <arguments> --runtime bolt` and once with `--runtime stock`.

| Arguments | Observed on both runtimes |
|---|---|
| `--case project-both --delay-implicit 200` | No retry; fresh visible entry absent from registry and store. |
| `--case project-both --candidate --delay-implicit 200` | Two retries; first superseded, second publishes; visible=true, hidden=false, stored=true. |
| `--case user-group --delay-implicit 200` | No retry; fresh entry absent. |
| `--case user-group --candidate --delay-implicit 200` | One retry publishes; visible=true, hidden=false, stored=true. Original abort occurs **after** the session registry is available. |
| `--case project-both --candidate` and `--case user-group --candidate` | One retry each; filtered catalog visible and stored. |
| `--case user --candidate` | Normal unchanged user rules: one successful fetch, no retry. |
| `--case project-both --candidate --offline --delay-implicit 200 --action offline-kick` | No Synthetic catalog fetch, including the explicit default-policy targeted refresh. |
| `--case none --candidate --offline --action offline-trigger` | Test-only explicit `allowNetwork: true` starts and cancels one fake fetch. The ensuing candidate refresh uses the default policy and performs no second fetch. |
| `--case none --action picker --fail-first --sample-ms 3500 --keep-picker-open` | Real `/model` without the candidate: leaving it open lets the second fake fetch complete and persist the fixture. |
| `--case none --action picker --fail-first --sample-ms 3500` | Real `/model`, then Escape during fetch: two fake fetches total, no retry, no saved fixture. |
| `--case none --candidate --action picker --fail-first --sample-ms 3500` | The same Escape cancels fetch 2; candidate starts fetch 3 and persists the catalog. |
| `--case none --candidate --action overlap` | A competing targeted network refresh supersedes startup; the candidate starts another targeted refresh. The competing caller reports `aborted=false`, although superseded. |
| `--case project-both --candidate --action storm --max-attempts 2` | Two retries are interrupted by injected offline refreshes, both report `aborted=false` and no errors, cap is exhausted, fresh catalog absent. |
| `--case project-both --candidate --retry-timeout 300 --fetch-delay 20000 --max-attempts 2 --sample-ms 1600` | Each candidate deadline aborts its request and schedules the next retry; two attempts exhaust the cap. |
| `--case none --candidate --fetch-delay 20000 --sample-ms 16500` | Pi's startup abort occurs at approximately 15 s; candidate immediately starts a new 15 s request that remains live at 16.5 s until session shutdown. |
| `--case none --candidate --action manual --fail-first --fetch-delay 20000 --sample-ms 16500` | With no caller deadline, the provider's own 15 s HTTP timeout yields `ProviderTimeoutError`, `aborted=false`, `errors=[synthetic]`, and no candidate retry. |
| `--case none --candidate --action publish-race` | Injected delay after accepted persistence makes the composer's later update reject with `AbortError`; callback sees no phase-abort and schedules no retry. Offline restoration yields visible=true. |
| `--case none --candidate --action persist-race` | Injected delay during provider persistence: interruption raises `AbortError` from `publish`, instead of producing an observed `false`; one retry publishes. |
| `--case project-both --candidate --early-exit-ms 100` | Shutdown aborts the active candidate; result is `aborted=true`, no second retry, process exits 0. |
| `--case none --action pre-aborted` | A targeted `refresh` called with an already-aborted signal aborts the independently running startup fetch; its own result says `aborted=true` and the new catalog is absent. |

The TUI harness waits for the failing first startup request, enters `/model`, waits for a second catalog fetch and presses Escape in a real PTY. Its saved pane shows “Refreshing model catalogs…” and the cancel hint. With the candidate disabled, cancellation stops the request; with it enabled, a new request and publication occur after the picker closes. This is user-visible cancellation, not merely a simulated controller abort.

A captured representative delayed `project-both` Pi-Bolt trace, milliseconds from extension instrumentation:

```text
  22  network-phase 1, registry unavailable
  31  phase-abort 1, AbortError; pending buffered
  42  candidate-session pending=true
  43  retry-start 1
 230  phase-abort 2 after delayed implicit offline refresh
 231  retry-finish 1 aborted=false errors=[]
 233  retry-start 2
1036  publish accepted=true
2244  sample visible=true hidden=false storedVisible=true
```

## Root cause and evidence

1. Stock Pi combines the public caller signal and its private provider-generation controller in `node_modules/@earendil-works/pi-ai/dist/models.js:127-140,180-190`. Both a caller cancel and provider supersession use the default `AbortError`; the callback receives only the combined signal. In the captured traces, the default reason name **and message** match within each runtime for the project race, actual picker Escape and Pi's startup deadline. Consequently `ctx.signal.reason` is not a reliable discriminator. A different explicit reason may be supplied by some caller, but is not a general contract.
2. The outer result checks the caller signal and suppresses errors when the combined signal aborted (`models.js:211-234`). A superseded request can therefore return `aborted=false` with an empty error map. It is not evidence that the provider fetched or published successfully.
3. Every targeted registry refresh reloads configuration and recomposes the selected provider before forwarding the signal (`node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js:590-603`). Recomposition supersedes the prior generation. The pre-aborted test confirms that even a signal already aborted before invocation can cancel unrelated work. It also means merely aborting an outstanding attempt at shutdown cannot, by itself, establish that no later pre-refresh recomposition will occur if work was already in flight; that late-shutdown case was not separately observed.
4. `/model` cancels the refresh on selection or disposal, including Escape (`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/model-selector.js:125-178,333-355`). The prototype handles this abort indistinguishably from startup supersession and violates that cancellation.
5. `src/families/synthetic/catalog.ts:83-92` has an independent 15 s HTTP timeout and ignores the boolean returned by `ctx.publish`. The underlying HTTP wrapper combines that timeout with the provider signal (`src/core/http/index.ts:66-75`). The two timeout experiments show different outcomes: Pi's parent deadline aborts `ctx.signal`, while an independent HTTP timeout can leave `ctx.signal` un-aborted and surface a provider error.
6. The provider's accepted `persist` publication precedes the separate in-memory publication performed after `refreshModels` returns (`node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js:401-419`). The injected outer-publication experiment directly demonstrated a later `AbortError` invisible to an abort listener removed when the extension callback finished. In that experiment the successful persisted catalog was restored by the competing offline refresh, so it does not demonstrate lost models. No natural `publish` return of `false` was observed; the delayed persist case threw instead.
7. Pi's RPC startup deadline is 15 s (`node_modules/@earendil-works/pi-coding-agent/dist/main.js:765-776`); the prototype gives every retry a fresh 15 s. Thus its maximum elapsed time is not the original operation's deadline. Retry count and a fresh per-attempt timeout provide a finite attempt count but do not preserve a caller's deadline. Timer delays and pre-refresh work also prevent claiming a strict wall-clock bound from these experiments.

## Recommended handling

- Do not automatically retry every Synthetic network `ctx.signal` abort or failed publication. Keep the stored/bundled catalog on ambiguous cancellation. Let Pi's own later `/model` refresh be user-controlled and cancellable. This can leave the startup catalog stale; it is not a deterministic race fix.
- For any future extension-owned, explicitly user-authorized refresh, propagate that operation's controller and one absolute time budget across all work; stop on caller abort, shutdown, own deadline, or exhaustion. Check cancellation before invoking registry refresh and clear timers. Use `providers: ['synthetic']` without setting `allowNetwork`, preserving Pi's network policy. Do not treat `result.aborted === false` as proof of publication. Avoid beginning a new refresh if it would supersede another owner's in-flight refresh.
- Automatic repair of *other owners'* interrupted refreshes requires, at minimum, reliable provenance separating supersession from caller cancellation/deadline, a way to preserve the owner's remaining deadline, and coordination with newer refreshes. These are not available through the tested public `RefreshModelsContext` and registry surface. Tracking only aborts before `session_start` misses the delayed `user-group` case; waiting a fixed delay or capping retries is heuristic. No Pi-internal patch is proposed or authorized here. A future public Pi seam or a separately approved change in requirements is needed before claiming automatic repair with these semantics.
- If a best-effort heuristic is ever considered separately, it needs an explicit policy decision acknowledging that bounded retries can still lose the catalog and that starting one can cancel a user's or another extension's refresh. The current prototype intentionally demonstrates these failures; it is not production code.

Regression coverage for any eventual solution should retain the matrix above, especially real picker cancellation, both delayed startup triggers, an already-aborted targeted refresh, a competing later network refresh, a multi-conflict storm, a shared total deadline, shutdown while pending, persistence and outer publication, TTL behavior, and offline defaults. Assert registry visibility and store state rather than the outer `aborted` flag alone.

## Verification and follow-ups

```text
python3 /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/rpc-catalog-race/retry-probe/verify.py
42 captured runs verified; both runtimes passed all trace assertions
```

The following real syscall traces were run using `trace.py`, which executes `strace -f -e trace=network` around the isolated probe:

```text
python3 /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/rpc-catalog-race/retry-probe/trace.py --runtime bolt
bolt rpc: IP-family network syscalls=0, connect syscalls=0, AF_UNIX connects=0
python3 /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/rpc-catalog-race/retry-probe/trace.py --runtime stock
stock rpc: IP-family network syscalls=0, connect syscalls=0, AF_UNIX connects=0
python3 /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/rpc-catalog-race/retry-probe/trace.py --runtime bolt --picker
bolt picker: IP-family network syscalls=0, connect syscalls=8, AF_UNIX connects=8
python3 /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/rpc-catalog-race/retry-probe/trace.py --runtime stock --picker
stock picker: IP-family network syscalls=0, connect syscalls=8, AF_UNIX connects=8
```

All four commands exited 0. All 8 picker `connect` calls used the local AF_UNIX family; no IP-family syscall was observed. Other runs used the same fake transport but were not all separately traced. Offline mode prevents the Synthetic catalog fetch under Pi's default policy; the extension's unrelated quota fetch was still attempted and blocked by the fake transport, so this is not a claim of process-wide offline enforcement.

No production files, tests, configs, git state or user credentials were changed. RPC and tmux processes and scratch directories were cleaned up; no probe processes remained. Full project checks were not run because the work consists of throwaway instrumentation and analysis artifacts. Product-level behavior beyond the captured schedules and runtimes remains unverified.
