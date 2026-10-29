---
document:
  type: "analysis"
  id: "analysis-rpc-startup-delay-probe"
  title: "Guarded RPC startup catalog delay probe"
  description: "Tests a factory-time, startup-only delay and registration-scoped offline refresh against stock Pi and Pi-Bolt."
  status: "published"
  revision: 1
  version: 1
  created: "2026-10-28T17:05:23+01:00"
  updated: "2026-10-28T17:05:23+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T17:05:23+01:00"
  updated_at: "2026-10-28T17:05:23+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Record guarded startup delay, lifecycle and targeted registration experiments"]
---

# Guarded RPC startup catalog delay probe

status: "root-caused"
confidence: "high"

## Summary

On both actual hosts, holding the identified RPC startup refresh *before* the original `ModelRuntime.refresh` until this test's application handlers and tracked offline refreshes settled repaired the originally reproduced project-rule and group races. RPC saw project-filtered built-in models immediately; the fresh fabricated catalog appeared asynchronously. Registration remained synchronous in the tested calls, EOF was prompt, and the original startup deadline and actual picker Escape worked in the tested schedules.

This is not a complete solution. A separately loaded later asynchronous `session_start` handler ran after the probe's readiness marker and canceled the released refresh on both hosts. After active refresh cancellation on shutdown or session replacement, the old runtime still updated its snapshot and queued availability work. The private startup classifier is pinned to two exact binary call sites, not a public identity contract. No production change or retry is proposed.

An optional, registration-scoped narrowing of later global offline refreshes protected a different provider's active request in the tested cases. It did not protect the same provider and changed host behavior: an unrelated newly configured model appeared after a global refresh but remained absent at the equivalent sample after a narrowed refresh. It is therefore not a safe transparent substitution.

## Reproduction

Environment: Linux checkout `34d074955b315e75b0bb23b200c314641f37ee1f`; Bun 1.4.3; Node 26.11.1; `/home/furbyhaxx/.local/bin/pi-bolt` 1.0.7 / Pi 1.4.0; stock Pi 1.4.0 run as `/usr/bin/node node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`. The probes load the unmodified application entrypoint between the diagnostic factory and its final diagnostic handler. The stock installed source explains the behavior; the binary observations separately establish it for Pi-Bolt. These are not compiled-extension/AOT acceptance tests.

[`run.py`](run.py) reuses the earlier retry runner's polling helpers, [`pre.ts`](pre.ts) reuses its fake transport, and [`post.ts`](post.ts) reuses its action and registry/store sampler. Each run uses a fresh temporary HOME, XDG directories, agent directory, trusted project and, for picker tests, a private tmux server; it uses inert dummy keys. The fake JavaScript `fetch` returns fabricated Synthetic `race-visible` and `race-hidden` entries after 800 ms unless a case specifies otherwise, and returns 503 for other fetches. Neither real credentials nor a real network catalog were used. The model-store checks use only the isolated temporary agent directory. Captures contain events, RPC summaries and, for picker tests, terminal panes.

The final matrix contains one independent run per row per host, not a statistical reliability estimate. Its `final-{bolt,stock}-<row>.json` captures were generated using the final probe behavior. To reproduce any row without overwriting evidence, run `python3 "$D/run.py" --runtime bolt <arguments>` and again with `--runtime stock`, where `D` is this directory and `<arguments>` is exactly the following row:

| Capture suffix | Arguments |
|---|---|
| `observe` | `--case both --early-models` |
| `base-v3` | `--prototype delay --case both --early-models` |
| `group-v2` | `--prototype delay --case group --early-models` |
| `implicit-v2` | `--prototype delay --case both --implicit-delay 700 --sample-ms 2500` |
| `trailing` | `--prototype delay --case none --trailing-delay 300` |
| `trailing-narrow` | `--prototype delay --case none --trailing-delay 300 --narrow` |
| `guard` | `--prototype delay --case both --prepatched` |
| `offline` | `--prototype delay --case both --offline` |
| `deadline-wait` | `--prototype delay --case none --release-delay 20000 --sample-ms 16500` |
| `deadline-active` | `--prototype delay --case none --fetch-delay 20000 --sample-ms 16500` |
| `eof-wait` | `--prototype delay --case both --release-delay 3000 --eof waiting` |
| `eof-active-v3` | `--prototype delay --case none --fetch-delay 20000 --eof active` |
| `replace-wait-v2` | `--prototype delay --case none --release-delay 3000 --replace waiting --sample-ms 4200` |
| `replace-active-v3` | `--prototype delay --case none --fetch-delay 3000 --replace active --sample-ms 4200` |
| `replace-write-v3` | `--prototype delay --case none --fetch-delay 200 --store-delay 1200 --replace write --sample-ms 3000` |
| `preabort` | `--prototype delay --case none --action pre-aborted` |
| `preabort-wait` | `--prototype delay --case none --action pre-aborted --release-delay 1200 --sample-ms 2200` |
| `lookalike` | `--prototype delay --case none --action early-other --release-delay 1200 --sample-ms 2300` |
| `cancel` | `--prototype delay --case none --action cancel` |
| `picker-v2` | `--prototype delay --case none --mode picker --sample-ms 4000` |
| `picker-open-v2` | `--prototype delay --case none --mode picker --keep-picker-open --sample-ms 4000` |
| `other-global` | `--prototype delay --case none --action later-other` |
| `other-narrow` | `--prototype delay --case none --action later-other --narrow` |
| `provider-global` | `--prototype delay --case none --action later-provider` |
| `provider-narrow` | `--prototype delay --case none --action later-provider --narrow` |
| `same-global` | `--prototype delay --case none --action later-same` |
| `same-narrow` | `--prototype delay --case none --action later-same --narrow` |
| `error-narrow` | `--prototype delay --case none --action later-error --narrow` |
| `config-global` | `--prototype delay --case none --action later-config` |
| `config-narrow` | `--prototype delay --case none --action later-config --narrow` |

Verification in this run:

```text
$ python3 /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/rpc-catalog-race/startup-delay-probe/verify.py
60 captured runs verified; both runtimes passed evidence assertions; four representative network traces passed
```

The assertions include demonstrations of failures; they do not mean all requested product properties passed. The prototype, driver and captures were iterated in place in this new directory; earlier non-`final-` captures are retained. In an earlier stock picker-open attempt ([`stock-picker-open.json`](stock-picker-open.json)), the picker joined the still-finishing first interactive refresh and no second fetch was observed. The runner was changed to wait for the complete first outer refresh before opening the picker; both final open and cancel controls then exercised fetch 2.

Representative isolation checks used `python3 "$D/network.py" --runtime bolt`, `--runtime stock`, and each command again with `--picker`. All four exited 0:

```text
bolt rpc: IP-family network syscalls=0, connect syscalls=0, AF_UNIX connects=0
stock rpc: IP-family network syscalls=0, connect syscalls=0, AF_UNIX connects=0
bolt picker: IP-family network syscalls=0, connect syscalls=8, AF_UNIX connects=8
stock picker: IP-family network syscalls=0, connect syscalls=8, AF_UNIX connects=8
```

These trace only the representative cases and named address families; they are not a process-wide offline guarantee. The extension attempted an unrelated quota fetch even under `--offline`, which the fake transport blocked.

## Root cause

1. In stock Pi, `node_modules/@earendil-works/pi-coding-agent/dist/main.js:765-772` starts an RPC-only network refresh with a 15-second caller controller before `runRpcMode`. RPC awaits session binding before installing stdin EOF handling (`dist/modes/rpc/rpc-mode.js:228-230,289,639-645`). Stock's event runner awaits `session_start` handlers in extension order (`dist/core/extensions/runner.js:813-819`).
2. The app applies trusted-project model rules during `session_start` (`src/index.ts:160-170`) and also registers configured virtual groups (`src/index.ts:337-345`). Registration and filtered-provider changes cause offline refreshes. A global refresh calls `rebuildProviders`, which clears and recomposes providers (`dist/core/model-runtime.js:174-179,590-607`); provider generation supersession aborts active operations (`node_modules/@earendil-works/pi-ai/dist/models.js:52-64,127-140,180-190`). The original pre-prototype controls and the final `observe` rows reproduce one Synthetic fetch aborted and no fixture in the live registry or store.
3. Delaying the actual startup invocation, rather than waiting for an already-entered refresh, prevents those known startup mutations from canceling it. But an extension's own last observed handler is not the end of the host's lifecycle dispatch: a later extension can await and register after the diagnostic marker. The `trailing` cases show precisely that failure. The injected 700 ms implicit-refresh delay is a separate controlled schedule, not a claim that such a delay was naturally measured.
4. Aborting a signal after the original runtime method has begun does not stop every continuation. After `await this.models.refresh(...)`, stock `ModelRuntime.refresh` calls `updateModelSnapshot` and `queueAvailabilityRefresh` even on abort (`dist/core/model-runtime.js:612,625-629`); the former assigns a new snapshot and the latter advances availability sequences (`model-runtime.js:181-187,215-225`). Both calls were directly recorded on the old runtime after `session_shutdown` on both binaries. The tested abort stopped the fake request and no old-runtime store write completed, but the strict no-post-shutdown-work requirement still fails.

## Evidence

### Identification and gate

The factory wraps the actual runtime prototype before the host call ([`pre.ts:89-159`](pre.ts)). A candidate requires all of: literal `--mode rpc` arguments; no observed `session_start`; no earlier candidate on that runtime; the sole option key `signal`; and the immediate caller stack frame matching one exact observed build. The frames were:

```text
stock: at main (file://.../dist/bundle/chunks/chunk-MM3LKT73.js:1222:18193)
bolt:  at main2 (/$bunfs/root/entry-x282c8b9.js:11261:25)
```

The original caller signal is captured before entering Pi. The gate waits for the test's post-application marker and all currently tracked `allowNetwork: false` outer refresh promises for that runtime; it rechecks the set and checks cancellation, shutdown and overlap before calling the original once. It has no retry. For active shutdown cancellation it forwards `AbortSignal.any([originalSignal, sessionShutdownSignal])`, **not the identical signal object**. Thus the original signal and its deadline are preserved semantically in the tested cases; identity-sensitive behavior is changed and is not claimed compatible.

A same-shape registry call after session start and the real interactive refreshes were recorded as non-candidates ([`final-stock-lookalike.json`](final-stock-lookalike.json), [`final-bolt-picker-v2.json`](final-bolt-picker-v2.json)). A named prior patch was rejected and the unmodified host behavior continued ([`final-stock-guard.json`](final-stock-guard.json)); after replacement the probe recognized its own installed wrapper rather than nesting it. These tests do not establish a general collision-free or portable identification mechanism. Exact stacks, source locations, flag shape and private class identity can change. Checking the original function's name cannot detect every prior patch; it also does not guard later third-party patches or every registration method. Unsupported builds fail open and retain the original race.

If a non-startup network refresh occurs while the startup call is held, the prototype conservatively abandons startup rather than superseding that caller. The same-shape lookalike completed and stored its fixture; the startup was skipped. A pre-aborted lookalike also caused the pending startup to be skipped even though it did no useful fetch. That skip returns an `aborted: true` result despite the original caller signal not having aborted. This preserves the newer caller in that schedule but can leave a stale catalog and changes the startup result's meaning. After startup enters Pi, a later competing caller can still supersede it; no general refresh serialization is claimed.

### Readiness, filtering and synchronous registration

On both hosts the `base-v3` early RPC query succeeded with zero visible built-in OpenAI models under the trusted project's rule while the fake fresh fixture was still absent; the later query had `race-visible`, excluded `race-hidden`, and the isolated store contained the fixture. The raw store legitimately retained both fixture entries. With the user group, the group was already visible at the probe's post-application handler, and the later fixture was likewise filtered. This tests immediate project-rule visibility and group registration, not immediate completion of network discovery. The runner did not measure an absolute RPC response latency.

With a 700 ms injected delay on startup implicit offline operations, both gates observed a pending operation, drained it, then entered the one original startup call and published the fixture. Representative stock trace, relative milliseconds from [`final-stock-implicit-v2.json`](final-stock-implicit-v2.json):

```text
 437 startup-held          577 startup-ready pendingOffline=1
 580 startup-drain        1233 startup-enter
1247 fetch-start          2051 fetch-resolve
2054 store-write-finish   3083 sample visible=true hidden=false storedVisible=true
```

For actual later `registerVirtualModel` and `registerProvider` calls, both global and narrowed variants returned `undefined` with the new model immediately visible. A physical/virtual ID conflict still threw synchronously in the narrowed test. These are focused contract checks, not proof for every registration, error or Pi version.

### Cancellation, deadline, EOF and replacement

- With a 20-second injected gate, Pi's original startup signal aborted approximately 15 seconds after interception; neither host entered the original runtime refresh nor issued a Synthetic fetch. With a 20-second fake response instead, the same original signal aborted the active fetch at the original deadline. No new request was made. This tests an operation whose signal becomes aborted while waiting; an RPC startup signal already aborted at the instant of interception was not produced by the actual host.
- In a real tmux PTY, the first interactive startup fetch was intentionally failed; `/model` started a second request. Escape aborted it on both hosts, with no third fetch or stored fixture. Leaving the picker open as a positive control completed and stored fetch 2 ([`final-stock-picker-v2.json`](final-stock-picker-v2.json), [`final-stock-picker-open-v2.json`](final-stock-picker-open-v2.json), and Bolt equivalents). The picker and interactive-start calls did not match the RPC classifier. A separately driven active manual refresh also honored its controller, although starting it superseded the already active startup fetch.
- A separate targeted refresh with an already-aborted signal was passed through, not mistaken for startup. When invoked after startup entered, it still canceled the startup fetch on both hosts; its own result was `aborted=true` while the interrupted startup returned `aborted=false`. This is the pre-existing Pi recomposition behavior, not fixed by a startup-only wrapper. When invoked while startup was held, the conservative overlap rule abandoned startup.
- Closing RPC stdin while held or while the fake fetch was active exited 0 within two seconds on both hosts. While held, startup was skipped; while active, its composite signal aborted the fake fetch. Unlike the earlier blocking barrier, this test did not hold the `session_start` handler open.
- For `new_session` while held, the old startup was skipped. When the request was active, it was aborted and the new session was created without the old fixture being stored; the new runtime retained its older catalog and no replacement startup refresh was issued. But on both hosts `updateModelSnapshot` and `queueAvailabilityRefresh` ran on the old runtime after the old session's shutdown. Stock trace ([`final-stock-replace-active-v3.json`](final-stock-replace-active-v3.json)):

```text
669 old fetch-start              692 old fetch-abort / session_shutdown(new)
694 old updateModelSnapshot      696 old queueAvailabilityRefresh
698 old startup-finish aborted=true
```

In the injected 1200 ms store-delay case, the test's old-runtime write wrapper resumed after shutdown with an aborted signal; the real store call returned `AbortError`, and no write finished ([`final-stock-replace-write-v3.json`](final-stock-replace-write-v3.json), Bolt equivalent). The resumed wrapper is injected work. This observation does not establish safety for non-cooperative stores or providers, nor prove every possible in-progress write is fenced.

### Later implicit offline refresh narrowing

The optional experiment wraps only synchronous `registerProvider` and `registerVirtualModel`. While inside one such call, after the diagnostic post-start marker, an exactly shaped implicit `{ allowNetwork: false }` call is changed to `{ allowNetwork: false, providers: [registeredProvider] }` ([`pre.ts:101-110,144-149`](pre.ts)). The registration itself is not queued. No unregister, native-provider, direct login/logout, arbitrary explicit refresh or asynchronous registration path is covered; the scope/shape check is not a host provenance token.

- Registering a different virtual provider or a different ordinary provider during Synthetic's active fetch: the original global implicit refresh aborted the fetch; narrowed refresh targeted only the new provider, and Synthetic completed and stored its fixture. Both registrations remained immediately visible ([`final-stock-other-global.json`](final-stock-other-global.json), [`final-stock-other-narrow.json`](final-stock-other-narrow.json), `provider-*`, and Bolt equivalents). Narrowing also spared the different-provider trailing registration in the controlled case.
- Registering a virtual model **under Synthetic itself** canceled Synthetic's fetch during synchronous recomposition, before the subsequent implicit refresh call, regardless of narrowing. The sampled catalog remained stale on both hosts ([`final-stock-same-narrow.json`](final-stock-same-narrow.json), Bolt equivalent).
- To test changed global behavior, the isolated driver wrote a new unrelated `side-provider/side-model` entry into its temporary `models.json`, then synchronously registered an unrelated virtual provider. At the same 500 ms post-registration sample, the original global offline refresh had loaded and composed the side model, while the narrowed refresh had not ([`final-stock-config-global.json`](final-stock-config-global.json), [`final-stock-config-narrow.json`](final-stock-config-narrow.json), Bolt equivalents). The narrowed outer refresh still loads `models.json`, but stock only recomposes its selected provider (`model-runtime.js:590-599`), unlike the global rebuild. This is an observed semantic difference, not merely a timing theory; the experiment does not establish how or when a later independent global refresh would update it.

## Recommended fix

Do not ship either private prototype. The evidence supports a host-owned lifecycle boundary: Pi should explicitly finish the applicable session-start registrations and track their implicit work before initiating its existing RPC background refresh, without blocking RPC readiness on network I/O. Pi should own the startup request's original deadline and tie the operation, its continuations and publication to the owning runtime/session. Avoid starting or retrying a superseded operation without an explicit ownership and cancellation contract.

Do not silently narrow Pi's global implicit refresh in an extension. If Pi considers scoped refreshes, define and test configuration reload, availability and cross-provider side effects, along with synchronous registration and same-provider supersession semantics. A solution needs to coordinate same-provider mutation and independent refresh owners, not just filter a later offline call.

Regression coverage should drive both real binaries with isolated fake transport and assert project visibility before network completion; groups; trailing asynchronous extension handlers; tracked delayed implicit work; original deadline before and after entry; real picker Escape and open control; pre-aborted and overlapping callers; EOF; replacement before entry, during fetch and during persistence; no old-runtime mutations after shutdown; and unchanged cross-provider `models.json` behavior. Include native registration, unregister, login/logout, SDK and interactive paths if a solution claims them.

## Open questions / follow-ups

- A production-safe completion boundary or host transaction was not implemented. Other extensions, nested/asynchronous work and hangs cannot be inferred from a last diagnostic handler or a temporarily empty set of promises.
- Signal identity changes in the composite; additional cancellation by shutdown is intentional. A caller that inspects identity or requires its signal to be forwarded unchanged was not tested.
- Same-provider registration, already-aborted non-startup refreshes, later competing operations, old-runtime continuations and replacement catalog freshness remain unsolved. The explicit fixed-delay tests are adversarial scheduling experiments, not measured production durations.
- Only the two installed binary builds and the named paths were tested. No live catalog, actual credential, AOT-compiled plugin, SDK startup, reload, native registration or login/logout acceptance was attempted. The brief's explicit inert-credential isolation requirement supersedes the repository `AGENTS.md` expectation of verification on configured accounts. Earlier evidence and existing user state were not overwritten; no production files or git state were changed. All launched probe children and tmux servers were stopped, and temporary directories were removed.
