---
document:
  type: "analysis"
  id: "analysis-rpc-catalog-coordinator-probe"
  title: "Private catalog coordinator feasibility"
  description: "Real-runtime probes of in-flight refresh observation, cancellation, registration ordering, and session shutdown."
  status: "published"
  revision: 1
  version: 1
  created: "2026-10-28T16:43:15+01:00"
  updated: "2026-10-28T16:43:15+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T16:43:15+01:00"
  updated_at: "2026-10-28T16:43:15+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Record controlled private-runtime coordinator experiments and limitations"]
---

# Private catalog coordinator feasibility

status: "root-caused"
confidence: "high"

## Summary

A `session_start`-only scan of the tested private runtime does not identify every already-running refresh. In an observed natural RPC schedule on both hosts, and in a separately gated schedule after config load, the original caller was still pending while the underlying provider-controller map was empty. Once a provider controller exists, it is a different signal from the original caller's. No existing top-level promise or caller signal was found in the tested runtime object.

Patching the host `ModelRuntime.prototype.refresh` **before** RPC starts did capture the actual original promise and signal on both tested binaries. Waiting for that promise preserved its original fetch and 15-second deadline in the controlled startup race. That is a useful primitive, not a verified safe coordinator: a blocking barrier delays RPC readiness and shutdown, while deferring the app's lifecycle handlers exposed project-hidden models to an early RPC request. A later registration-triggered offline refresh still canceled another caller's network request.

An additional observed limitation is session replacement: the old Pi startup request wrote the shared model store after its session's `session_shutdown`, while the new runtime continued to expose its older in-memory catalog. This occurred with the ordinary app, not only with deferred handlers. A production solution meeting all stated properties has not been demonstrated. The most direct design to investigate is a host-owned startup/lifecycle coordinator described below; do not deploy either probe as a fix.

## Reproduction

Environment: Linux checkout `34d074955b315e75b0bb23b200c314641f37ee1f`, Bun 1.4.3, Node 26.11.1, stock Pi 1.4.0, Pi-Bolt 1.0.7 / Pi 1.4.0. Each invocation launches a real RPC process with temporary HOME, XDG directories, agent directory and project. The only API keys are inert dummy strings. `retry-probe/pre.ts` replaces JavaScript `fetch`: a fake Synthetic catalog responds with `race-visible` and `race-hidden` after 800 ms by default, and other fetches get 503. A fresh temporary store contains neither model. No live credentials or real remote catalog were used. This probe did not trace network syscalls; fake `fetch` is not a claim of process-wide offline enforcement.

[`pre.ts`](pre.ts) dynamically imports the host class during the extension factory, patches its prototype in the isolated child only, records each original refresh promise and signal in a `WeakMap` by runtime, and optionally delays the call into `Models.refresh`. Its `session_start` observer shows what was already pending. The early patch itself is the reason the original promise and signal are known; they were **not** recovered from the late runtime scan. [`deferred-app.ts`](deferred-app.ts) is an intentionally incomplete experiment that queues this extension's startup handlers and abandons not-yet-started handlers on shutdown. [`queue-driver.ts`](queue-driver.ts) tests an explicit two-operation ordering, not a production coordinator. [`registration-driver.ts`](registration-driver.ts) contrasts the immediate and artificially delayed synchronous registration contract. All wrappers are test instrumentation, including the artificial delays.

The captured JSON files contain arguments, event timelines, RPC results and child exit status. Reproduce the asserted matrix with the following commands; each row below runs once per runtime. Existing captures were run concurrently in batches, so individual milliseconds can vary. The runner stops any child it starts and removes its temporary directories.

```sh
D=/mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/rpc-catalog-race/coordinator-probe
R="$D/run.py"
for rt in bolt stock; do
  python3 "$R" --runtime "$rt" > "$D/$rt-control.json"
  python3 "$R" --runtime "$rt" --barrier > "$D/$rt-barrier.json"
  python3 "$R" --runtime "$rt" --gate-ms 700 --wait-gate --barrier > "$D/$rt-gate.json"
  python3 "$R" --runtime "$rt" --case none --late-ms 150 --barrier > "$D/$rt-late.json"
  python3 "$R" --runtime "$rt" --case group --barrier > "$D/$rt-group.json"
  python3 "$R" --runtime "$rt" --offline --barrier > "$D/$rt-offline.json"
  python3 "$R" --runtime "$rt" --case none --barrier --action cancel > "$D/$rt-cancel.json"
  python3 "$R" --runtime "$rt" --barrier --action manual --delay-implicit-ms 700 > "$D/$rt-implicit2.json"
  python3 "$R" --runtime "$rt" --case none --barrier --fetch-ms 20000 > "$D/$rt-deadline.json"
  python3 "$R" --runtime "$rt" --case none --barrier --fetch-ms 20000 --early-eof > "$D/$rt-eof.json"
  python3 "$R" --runtime "$rt" --defer-app --early-models > "$D/$rt-deferred.json"
  python3 "$R" --runtime "$rt" --defer-app --case none --fetch-ms 20000 --early-eof > "$D/$rt-deferred-eof.json"
  python3 "$R" --runtime "$rt" --case none --fetch-ms 3000 --sample-ms 5000 --replace > "$D/$rt-replace-control.json"
  python3 "$R" --runtime "$rt" --case none --barrier --queue-cancel waiting > "$D/$rt-queue-waiting.json"
  python3 "$R" --runtime "$rt" --case none --barrier --queue-cancel active > "$D/$rt-queue-active.json"
  python3 "$R" --runtime "$rt" --case none --barrier --queue-cancel deadline > "$D/$rt-queue-deadline.json"
  python3 "$R" --runtime "$rt" --case none --barrier --registration immediate > "$D/$rt-registration-immediate.json"
  python3 "$R" --runtime "$rt" --case none --barrier --registration deferred > "$D/$rt-registration-deferred.json"
done
python3 "$D/verify.py"
```

Verification output in this run:

```text
36 captured runs verified; both runtimes passed all evidence assertions
```

Each case above was observed once per runtime; this is not a statistical reliability estimate. See the [original race](../2026-10-28-rpc-catalog-race.md) and [retry probe](../retry-probe/2026-10-28-retry-probe.md) for repeated race and real picker tests. No project source or user state was changed, and no files were staged.

## Root cause and available information

1. Stock Pi starts `modelRuntime.refresh({ signal })` before entering RPC mode, with a controller aborted after 15 seconds (`node_modules/@earendil-works/pi-coding-agent/dist/main.js:765-776`). It keeps the refresh promise only in that caller's expression. The first await inside `ModelRuntime.refresh` loads `models.json`; provider recomposition and `models.refresh(options)` happen afterwards (`dist/core/model-runtime.js:590-607`).
2. The runtime has a private `models` field, not an active-runtime-refresh promise registry (`dist/core/model-runtime.d.ts:36-55`). In stock Pi, `ModelsImpl.refreshControllers` is populated only when `Models.refresh` begins each provider operation (`node_modules/@earendil-works/pi-ai/dist/models.js:37-45,127-141,180-190`). It holds provider-generation controllers, not the original caller controller. The caller signal and provider signal are combined with `AbortSignal.any`; the provider controller signal observed in the late probe had a different identity from the original caller signal.
3. `setProvider`, deletion and clearing supersede provider generations and abort the old provider controller (`pi-ai/dist/models.js:52-65,127-140`). Provider and virtual-model registration recompose synchronously and start an unawaited global offline refresh (`dist/core/model-runtime.js:665-725`). A later `ModelRuntime.refresh` also recomposes before it forwards its signal, including an already-aborted signal. Login/logout synchronization uses another recomposition and direct `models.refresh` path (`model-runtime.js:393-413`), so intercepting only the outer method is not general serialization.
4. Stock `session_start` handlers are awaited serially (`dist/core/extensions/runner.js:813-835`), and RPC binds the session before installing its input-end and signal handlers (`dist/modes/rpc/rpc-mode.js:287,575-645`). Pi-auth-plus loads project settings and applies model rules in its first startup handler (`src/index.ts:160-170`); groups are updated in a later startup handler (`src/index.ts:337-345`). Delaying those handlers changes readiness and visibility.
5. On new-session replacement the host emits shutdown and disposes the old session, then creates a new runtime (`dist/core/agent-session-runtime.js:100-115,149-170`). The startup controller in `main.js` is not exposed to the session shutdown handler. The probes confirm an old-runtime store write after replacement; they do not prove every host refresh has the same ownership or that aborting arbitrary caller signals would be appropriate.

The installed stock source explains the mechanism; Pi-Bolt's equivalent behavior is observed through the actual binary and runtime object. The prototype and private fields are not stable extension APIs. These observations do not prove that every imaginable private extension technique is impossible.

## Evidence and experiments

### Observing the in-flight startup operation

Representative stock control timeline, milliseconds from this probe's first event ([`stock-control.json`](stock-control.json)):

```text
 76  original runtime refresh entered, caller signal 1
 77  session_start snapshot: tracked=1, provider controllers=0
 78  original Models.refresh entered, caller signal 1
 80  fake Synthetic fetch started
 95  fetch aborted by registration/offline recomposition
 99  original outer refresh finished: aborted=false
1724 sample: visible=false, storedVisible=false
```

The same empty controller map occurred naturally on Pi-Bolt. The original promise and signal in this trace were recorded earlier by the prototype patch. The top-level instance-field scan found no Promise or AbortSignal fields on either runtime; that scan does not rule out arbitrary hidden or nested implementation state. Thus `controllers.size === 0` cannot be used as an idle barrier. In the injected 700 ms gate ([`stock-gate.json`](stock-gate.json), [`bolt-gate.json`](bolt-gate.json)), `models-gate` precedes the snapshot: config loading and provider recomposition have already completed, `Models.refresh` has not begun, and the map remains empty despite the active original call. With the original promise captured early, a blocking barrier waited for that call to resolve and the RPC registry contained the new visible model, excluded the hidden model, and had stored the fresh catalog. This also worked for the group case.

At a 150 ms late observation point the Synthetic provider controller was present but its signal ID differed from the original signal ([`stock-late.json`](stock-late.json), [`bolt-late.json`](bolt-late.json)). Polling controller deletion could observe that particular provider drain, but does not recover the caller signal, the full outer refresh promise, or a refresh still before provider-controller creation. `result.aborted === false` is not evidence of publication; the control and delayed-implicit experiments show otherwise.

### Cancellation, deadline and offline behavior

- The early tracker kept the original startup `AbortSignal` object from outer refresh to `Models.refresh`; there was one fake fetch and no retry. With a 20-second fake response, the original host signal aborted at approximately 15 seconds, the fetch aborted, and the barrier released with no second request ([`stock-deadline.json`](stock-deadline.json), [`bolt-deadline.json`](bolt-deadline.json)). This demonstrates deadline preservation for this wait, not a strict wall-clock guarantee for arbitrary host operations.
- In the two-operation queue experiment, canceling the waiting caller prevented its offline refresh from being invoked; the independently active forced refresh completed. A 150 ms `AbortSignal.timeout` also expired while queued without invoking it. Canceling the active caller aborted its fetch, after which the independent queued offline refresh ran. No retry was started. See `*-queue-waiting.json`, `*-queue-deadline.json`, and `*-queue-active.json`. These are synthetic caller-cancellation tests; the real `/model` picker was not re-exercised in this run.
- `--offline` showed no Synthetic fetch and zero tracked startup network refreshes in either tested RPC process. The fake transport can still receive unrelated quota requests; this is not a process-wide offline assertion.
- A 700 ms **injected** delay on a registration-triggered offline refresh interrupted a different caller's later forced Synthetic request on both hosts; its result still reported `aborted=false` ([`stock-implicit2.json`](stock-implicit2.json), [`bolt-implicit2.json`](bolt-implicit2.json)). The startup-only barrier does not serialize later traffic or implicit work.

### Synchronous registration and readiness

Immediate `registerVirtualModel` returned `undefined` and the model was immediately visible through `ctx.modelRegistry.find` on both hosts. Replacing its private runtime method with a 200 ms deferred call still returned `undefined` but the model was absent immediately and present later (`*-registration-immediate.json`, `*-registration-deferred.json`). A global wrapper that queues synchronous registration silently changes its contract and delays validation/errors. An extension can instead explicitly await before *its own* registration, but that does not control unrelated callers.

Waiting for the original network refresh directly in `session_start` preserved the catalog in the controlled case but blocked RPC input and delayed other lifecycle handlers. With a 20-second fake fetch, closing RPC stdin did not exit in two seconds; the runner sent SIGTERM to its own child, which exited `-15`, with no `session_shutdown` event (`*-eof.json`). This is an unacceptable shutdown/readiness tradeoff for a general fix.

The nonblocking deferred-handler experiment exited promptly on EOF and skipped not-yet-started app handlers. It also allowed an early `get_available_models` request to see 42 OpenAI models despite the trusted project rule `openai/*`; after the queued handler ran, the same request saw zero and the fresh Synthetic fixture was filtered correctly (`*-deferred.json`). This demonstrates the changed startup ordering. The experiment does not prove shutdown safety for an async handler that has already started, nor for other extensions, reload, interactive mode or asynchronous registrations.

### Session replacement and late storage

The control below uses the normal app and no startup barrier. `new_session` succeeds while the initial 3-second fake fetch is in flight. On stock Pi, relative milliseconds from [`stock-replace-control.json`](stock-replace-control.json):

```text
  93  original caller on runtime 1
 121  session_shutdown reason=new
 142  new session sees runtime 2
3100  runtime 1 fetch resolves; runtime 1 store write starts
3101  runtime 1 store write finishes
3103  runtime 1 outer refresh finishes aborted=false
5149  runtime 2 sample: storedVisible=true, visible=false
```

The same ordering occurred on Pi-Bolt. The write is captured at the underlying old runtime's `modelsStore.write`, not inferred solely from final file content. The new in-memory registry remained stale in this schedule. An early-prototype tracker can still hold the old promise, but its parent controller belongs to Pi and the captured signal cannot itself be aborted. The nonblocking deferred-app replacement experiment showed the same old-store write; it also skipped queued old-session handlers. A shutdown guarantee for extension-owned queued work alone does not make the host's old startup operation session-scoped.

## Recommended fix / design boundary

The narrow experimental mechanism that worked for an already-running original is: install guarded interception **before** the host invokes refresh, retain each original promise plus its exact original signal keyed by runtime, and wait for the original operation rather than aborting or retrying it. For a new queued operation, wait with its original signal/deadline, check cancellation and session lifetime before invoking any Pi refresh, and never reissue the request. The queue tests exercise these pieces. They do not establish a complete private extension-only design.

For a design that retains RPC readiness, synchronous registration visibility and session safety, investigate a Pi-owned coordinator:

1. At startup, perform and track synchronous registrations and their implicit offline refreshes during `session_start`; wait for that offline work before starting Pi's existing background RPC network refresh. Start the original caller's timeout at its actual operation start, preserve `--offline`, and keep network work off the RPC readiness path. This avoids creating an RPC startup operation that must later be replayed.
2. Expose awaitable, cancellation-aware mutation/refresh transactions for later changes. Queue before recomposition, propagate the caller's **same** signal and remaining budget, reject/return the defined aborted result without entering Pi when already canceled, and track implicit work until settled. Preserve synchronous registration semantics or change them explicitly in the host contract; a transparent asynchronous shim is insufficient.
3. Tie Pi-owned startup work to the lifetime of the session/runtime that owns it, and fence all late store and in-memory publications after replacement or shutdown. Do not abort or restart unrelated callers without an explicit ownership contract. Coordinate all host paths that recompose or directly refresh, including login/logout, not only the public registry method.
4. Guard any private interception against unsupported shapes, duplicated host modules, pre-existing patches and runtime replacement. If the guarantees cannot be established, leave the prior/bundled catalog and report that automatic repair is unavailable; do not start an unowned retry.

This is a recommended architectural direction, **not** a tested implementation or proof that a full host transaction can preserve every existing synchronous behavior. The brief approves investigating a guarded private coordinator; no host or product patch was made. The existing project rule against internal Pi patching is superseded for this investigation by the brief's approval of a guarded runtime coordinator, but any actual host modification remains a separate integration decision. The project's `scripts/aot-verify.ts` allows literal dynamic imports, but no Pi-Bolt compiled-plugin/AOT acceptance was run for this diagnostic prototype.

A regression suite should drive real stock Pi and Pi-Bolt with a fake abort-aware catalog and assert: project rules and groups; startup before/after provider-controller creation; stored and live publication; early RPC visibility; original 15-second deadline; queued and active abort; already-aborted signals; real picker Escape; concurrent manual refresh versus delayed implicit registration; offline; early EOF; session replacement after request start; and no post-shutdown writes. Include login/logout and SDK/interactive paths if the coordinator claims them.

## Open questions / follow-ups

- A fully guarded, cancellation-safe, nonblocking extension-only coordinator was not implemented or verified. A late scan alone lacks the demonstrated startup handle, and the two straightforward early-tracking variants fail readiness or visibility.
- Whether a host-level mutation transaction can retain immediate registration semantics under all concurrent provider changes remains unverified. Per-provider and cross-provider publication ordering, nested refreshes, hung providers, and other extensions need explicit contracts.
- Only real RPC mode was exercised in this run. The original picker report is separate evidence; SDK, interactive startup, AOT-compiled Pi-Bolt extension behavior and unsupported Pi versions were not tested here.
- All probe children and temporary directories were cleaned up. The analysis directory contains only probe code, captures, assertions and this report.
