---
version: 1
id: "extension-audit-remediation-performance"
title: "Extension performance acceptance"
description: "Repeated preview, startup, idle, teardown and transform measurements without network access"
type: "analysis"
created: "2026-10-29T19:58:35+01:00"
updated: "2026-10-29T20:00:42+01:00"
createdBy: "analyst"
updatedBy: "analyst"
document:
  type: "analysis"
  id: "extension-audit-remediation-performance"
  title: "Extension performance acceptance"
  description: "Repeated preview, startup, idle, teardown and transform measurements without network access"
  status: "published"
  revision: 2
  created_at: "2026-10-29T19:58:35+01:00"
  updated_at: "2026-10-29T20:00:42+01:00"
  created_by: "analyst"
  updated_by: "analyst"
  changelog:
    - revision: 1
      reason: "Record read-only performance acceptance"
      changes: ["Record raw benchmarks, isolated runtime measurements and the bounded shutdown timer finding"]
    - revision: 2
      reason: "Record final integration state"
      changes: ["Note the subsequent documentation-only commit"]
---

# Extension performance acceptance

status: "root-caused"
confidence: "high"

## Summary

The original 555-model rules-view benchmark improved from audit medians of 5.825/16.940/37.098 ms at 10/25/50 rules to 0.070/0.099/0.100 ms, using the median of five current run medians. Unchanged frames and selection changes performed zero instrumented evaluator calls or evaluator-cache compilations. Separate full-dashboard, metadata, Help, startup, idle and request/stream samples are below.

One **minor, bounded, pre-existing lifecycle defect** remains: every empty-ingest shutdown leaves an unreferenced 2,000 ms deadline timer alive into the replacement session. Three isolated live Pi-Bolt reproductions show the timer at `src/index.ts:542`, then absent after 2.25 s. `git blame` attributes the deadline to `e026e3a`, before this remediation; this is not evidence of a new performance regression. Clear the deadline when the race settles.

## Environment and measurement scope

- Host `devlap05`, Intel Core Ultra 7 265H, Linux `7.2.9-2-cachyos` x86_64; CPU governor `powersave`. Other workloads and CPU frequency were not controlled.
- Bun 1.4.3; Pi-Bolt `1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`; Python 3.14.8. All times below are wall-clock unless explicitly called CPU.
- Original probe ran at root SHA `b8b364702d14c2cf22d58663bf7ea226a376c1b6`. Detailed probes ran at `e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60`, after unrelated integration commits; `git diff b8b3647 e38dd17 -- src/ui/dashboard/models.ts src/ui/dashboard/index.ts src/ui/dashboard/model-picker.ts src/ui/dashboard/model-detail.ts src/ui/frame/index.ts src/models/rules/match.ts` was empty. Other dashboard tabs and tests changed between those SHAs. At report verification HEAD was `fc6af03a1da687dddc257f00982550709f0d1460`; its only later change was the remediation plan. No product files were edited for these measurements.
- The audit evidence file `.project/reviews/extension-audit/evidence/performance.json` was read, never rewritten, and retained SHA-256 `6ff0249243e11ef2fba192f359f6b1a9395cd0c31d15c92b3b6b3363f6e254b3` before and after.
- Raw evidence and the verbatim scratch scripts are in `.project/analyses/extension-audit-remediation/performance/`. The scripts used synthetic inline fixtures from existing tests, with no credentials. The five original probe outputs are in `render-original.txt`; individual frame/batch samples are in the JSONL files.

## Reproduction and render results

The unchanged original command was run five times:

```sh
for run in 1 2 3 4 5; do
  printf 'run=%s\n' "$run"
  bun .project/reviews/extension-audit/evidence/render-probe.ts
done | tee .project/analyses/extension-audit-remediation/performance/render-original.jsonl
# The resulting raw transcript was renamed render-original.txt; no contents changed.
```

The original benchmark uses the same 555 models, 140 columns, 30 body rows, last rule selected, 5 warmups and 30 frames per process as the audit. Current p50 and p95 below are each the median of the five corresponding per-run statistics, not a pooled p95. Ranges are minimum–maximum across those five runs. Audit is one historical run, not a same-run control; its host/load and cache state were not recorded in the audit evidence. Current code also constructs additional per-rule effects and full-help metadata, so the implementation has changed even though the probe is unchanged.

| Rules | Audit p50 / p95 ms | Current p50 / p95 ms | Current p50 range ms | Current p95 range ms |
|---:|---:|---:|---:|---:|
| 1 | 0.433 / 2.003 | 0.0581 / 0.1081 | 0.0553–0.0631 | 0.1055–0.1175 |
| 10 | 5.825 / 8.473 | 0.0704 / 0.1068 | 0.0644–0.0780 | 0.0960–0.2672 |
| 25 | 16.940 / 19.253 | 0.0988 / 0.1268 | 0.0802–0.1358 | 0.0976–0.2034 |
| 50 | 37.098 / 42.210 | 0.1004 / 0.2143 | 0.0766–0.1036 | 0.1337–0.2373 |

The original probe counts compilation only in its injected, production-shaped single-reference evaluator cache. It reports 0 per warmed frame in all five runs versus the audit's 1,111. It does **not** instrument the separate internal effect compiler at `src/ui/dashboard/models.ts:321`, so these are evaluator-cache counts, not total compiler calls.

A second probe samples original `ModelsView` state changes with the same catalog, rule strings and dimensions. It returns winning-rule indices like the production evaluator. Each row pools 3 processes × 30 measured frames, using the upper middle ordered sample for p50 and nearest-rank p95. Key presses and catalog mutations occur immediately before, outside the timed render. Counts are per frame and are measured in the injected evaluator; they exclude internal compilation:

| Rules | Phase | p50 / p95 ms | Evaluations / evaluator compilations per frame |
|---:|---|---:|---:|
| 10 | repeat / selection | 0.114 / 0.167; 0.073 / 0.152 | 0 / 0 |
| 10 | rule toggle / catalog name change | 0.348 / 0.721; 0.433 / 1.056 | 555 / 1; 555 / 0 |
| 25 | repeat / selection | 0.117 / 0.149; 0.104 / 0.242 | 0 / 0 |
| 25 | rule toggle / catalog name change | 0.586 / 1.507; 0.693 / 1.631 | 555 / 1; 555 / 0 |
| 50 | repeat / selection | 0.126 / 0.289; 0.137 / 0.271 | 0 / 0 |
| 50 | rule toggle / catalog name change | 0.930 / 2.224; 0.855 / 1.907 | 555 / 1; 555 / 0 |

The first frame of each view performed 555 evaluations and one evaluator-cache compilation. The separate effect compiler executes when the preview is rebuilt, by inspection of `src/ui/dashboard/models.ts:307–321`; it was not counted by these probes. The measured zero evaluations on repeat and navigation frames is independent evidence of cache reuse. Metadata-only catalog changes invalidate the preview in this implementation and were intentionally measured as a separate state change.

The complete `AuthDashboard` was also rendered with real frame/Help code, both metadata preferences enabled, one alias, 140 columns and an actual 30-row body. Checks verified visible provenance and winning-rule labels, selected-rule Help and catalog Help identity/alias text. Three processes × 30 samples, pooled p50 / nearest-rank p95 in ms:

| Rules | Rules dashboard | Rules full Help | Catalog metadata | Catalog full Help |
|---:|---:|---:|---:|---:|
| 10 | 0.453 / 1.217 | 0.363 / 1.160 | 0.862 / 1.856 | 0.904 / 2.045 |
| 25 | 0.485 / 1.396 | 0.474 / 0.772 | 0.826 / 1.974 | 0.786 / 3.024 |
| 50 | 0.615 / 3.251 | 0.478 / 3.678 | 1.013 / 6.339 | 0.936 / 4.637 |

This measures a whole dashboard render with different inputs and fake theme, not the historical component benchmark. The 50-rule catalog/Help sample has high tails, including a 27.550 ms metadata maximum. To characterize them, an additional 3-process run warmed each phase 50 times, then measured 300 consecutive frames per process with `process.cpuUsage()` instrumentation: 900 pooled 50-rule metadata frames had p50 0.563, p95 1.273, max 3.012 ms; full Help p50 0.492, p95 1.209, max 1.816 ms. Neither had a frame over 4 ms in this second run. Its timing instrumentation, longer warmup and continuously rendered workload differ; the cause of the initial outliers and real terminal latency are not established. No earlier full-dashboard baseline exists here, so no regression is claimed.

Detailed probe commands, run from the repository root:

```sh
bun /tmp/pi-auth-perf.cE2TZvNs/render-detail.ts > .project/analyses/extension-audit-remediation/performance/render-detail.jsonl
for n in 2 3; do bun /tmp/pi-auth-perf.cE2TZvNs/render-detail.ts > .project/analyses/extension-audit-remediation/performance/render-detail-$n.jsonl; done
for n in 1 2 3; do bun /tmp/pi-auth-perf.cE2TZvNs/render-tail.ts > .project/analyses/extension-audit-remediation/performance/render-tail-$n.jsonl; done
```

## Factory startup, idle and teardown

The startup probe starts real Pi-Bolt RPC in an empty temporary working directory, with a fresh `HOME`, `PI_CODING_AGENT_DIR` and XDG dirs for each process. Environment variables are allowlisted; no provider credentials are inherited. The child and its descendants inherit a seccomp filter returning `ENETUNREACH` for `socket`, `connect`, `sendto`, `sendmsg` and `sendmmsg`. The CLI also uses `--offline`; no prompt or generation is sent. A separate `strace -f -e trace=network` run for each mode showed no network syscall attempts. `unshare -n` was unavailable (`Operation not permitted`); seccomp enforced the restriction instead.

Each condition had one warmup and ten fresh processes, alternating condition order within each pair. Startup wall time runs from process creation to the `get_commands` RPC response, including module loading, factory, session startup and IPC. All returned exit code 0; baseline exposed 0 extension commands and the extension exposed 5, including `auth`.

| Mode | Startup median / nearest-rank p95 ms | Range ms | EOF-to-exit median / range ms |
|---|---:|---:|---:|
| No extension | 21.493 / 22.381 | 18.759–22.381 | 3.227 / 3.188–3.318 |
| Raw `-e src/index.ts` | 1903.779 / 2157.492 | 1806.690–2157.492 | 15.337 / 7.264–15.510 |

The median paired startup difference was 1882.941 ms (range 1785.174–2135.891). With `PI_TIMING=1`, extension **module import** was 1765–2113 ms, median 1862 ms, and the async **factory** was 9–10 ms, median 9.5 ms; these are Pi's integer-ms stage timings, distinct from end-to-end startup. This loads the raw development TypeScript with `-e` while built-in extensions are disabled; installed/AOT-compiled startup was not measured and the historical audit supplies no factory or startup baseline. Do not treat the 1.9 s number as compiled-install overhead or as an established regression.

One separate 5-second idle observation per mode: baseline RSS 75,712→75,692 KiB, 0 CPU ticks; extension RSS 200,812→176,940 KiB, 1 CPU tick. The kernel tick rate was 100 Hz, so the extension sample corresponds to about 10 ms of process CPU, quantized to 10 ms. Both had 8 file descriptors and 0 sockets before/after; thread counts were baseline 5→6 and extension 6→6. This is a small uncontrolled sample, not a general memory or idle budget. EOF exit times do not prove all timers are absent: RPC can terminate the process explicitly.

Exact commands:

```sh
python3 /tmp/pi-auth-perf.cE2TZvNs/startup.py sample > .project/analyses/extension-audit-remediation/performance/startup-raw.jsonl
python3 /tmp/pi-auth-perf.cE2TZvNs/startup.py idle > .project/analyses/extension-audit-remediation/performance/idle-raw.jsonl
python3 /tmp/pi-auth-perf.cE2TZvNs/startup.py trace > .project/analyses/extension-audit-remediation/performance/network-trace.jsonl
python3 /tmp/pi-auth-perf.cE2TZvNs/startup.py wrapper > .project/analyses/extension-audit-remediation/performance/teardown-instrumented.jsonl
for n in 2 3; do python3 /tmp/pi-auth-perf.cE2TZvNs/startup.py wrapper > .project/analyses/extension-audit-remediation/performance/teardown-instrumented-$n.jsonl; done
```

Underlying Pi command was `/home/furbyhaxx/.local/bin/pi-bolt --mode rpc --no-session --no-extensions --offline --no-skills --no-prompt-templates --no-themes --no-context-files --no-mcp --no-approve`, optionally followed by `-e /mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts`. `network-baseline.txt` and `network-extension.txt` are the actual strace outputs; the separate trace run is not used for timing.

### Timer root cause and fix

The instrumented extension wrapper tracks global timeouts/intervals and their source stack. It loads the actual extension, sends `get_commands`, then `new_session`, leaves the host running 3 s and finally closes stdin. At first session start it sees the unreferenced token 250 ms timer and quota 5,000 ms interval; at shutdown the only tracked source timer is:

```text
PERF_TIMER_SHUTDOWN [{"id":4,"kind":"timeout","delay":2000,"site":"src/index.ts:542:40)","referenced":false}]
PERF_TIMER_2_25S_AFTER []
```

This occurred on all 3/3 runs. The first session's debounce and quota interval were no longer in the snapshot, and the same deadline was visible when the next session started. At `src/index.ts:537–543`, `Promise.race` creates the unreferenced timeout even when `pendingIngests` is empty; `Promise.allSettled` then wins without clearing the losing timeout. The timer remains allocated until its callback fires, without preventing process exit. Retain the deadline handle and clear it in a `finally` after the race, preserving the 2-second bound for slow pending writes. Regression test: start and shut down an idle session with instrumented/fake timers; assert its deadline is cleared when writes settle early and that a genuinely slow write still receives the bounded wait. The tracker covers global timer APIs with source-attributed stacks during this offline idle/switch flow; it does not prove absence of native timers, unattributed timers, login or in-flight request resources.

## Request and stream transform samples

Three fresh Bun processes extract the existing inline request fixture from the first case in `tests/families/anthropic/request.test.ts` and the SSE fixture from `tests/families/anthropic/response.test.ts`. The probes assert mapped tool names, the replacement, and byte-exact restored/passthrough responses. They invoke `shapeBody` (`src/families/anthropic/request.ts:70`) and `restoreToolNames` (`src/families/anthropic/response.ts:187`) locally, without fetch. Request baseline is `JSON.parse` plus `JSON.stringify`; stream baseline constructs and fully reads the same untransformed `Response`. Batch order alternates. The table reports pooled 90 **batch-average** samples, not p95 of individual request/chunk latency; request batches contain 200 operations and response batches 20. The overhead is the paired batch-average difference, so it can be negative under noise.

| Fixture | Baseline p50 / p95 ms per op | Transform p50 / p95 ms per op | Paired overhead p50 / p95 ms per op |
|---|---:|---:|---:|
| 1,713-byte shaped request | 0.00410 / 0.00648 | 0.01166 / 0.01735 | 0.00749 / 0.01292 |
| 384-byte SSE, 1 chunk | 0.00277 / 0.00827 | 0.01891 / 0.03908 | 0.01661 / 0.03163 |
| Same SSE, 12 × ≤32-byte chunks | 0.00480 / 0.00808 | 0.02863 / 0.06091 | 0.02399 / 0.05699 |
| Same SSE, 384 single-byte chunks | 0.04705 / 0.10158 | 0.31843 / 0.43376 | 0.27030 / 0.37909 |

Each request mode had 200 warmup operations; each stream mode had 15. Per-process and per-batch samples are retained. These small synthetic fixtures characterize local transform cost, not provider throughput, network latency, or all request/stream shapes; no historical transform baseline was available.

```sh
bun /tmp/pi-auth-perf.cE2TZvNs/transforms.ts > .project/analyses/extension-audit-remediation/performance/transforms-raw.jsonl
for n in 2 3; do bun /tmp/pi-auth-perf.cE2TZvNs/transforms.ts > .project/analyses/extension-audit-remediation/performance/transforms-raw-$n.jsonl; done
```

## Evidence and reproduction files

`render-detail*.jsonl`, `render-tail-*.jsonl`, `startup-raw.jsonl`, `idle-raw.jsonl`, `teardown-instrumented*.jsonl`, `network-*.txt`, `network-trace.jsonl` and `transforms-raw*.jsonl` preserve raw observations. `probe-scripts.txt` contains the exact scripts that were executed from `/tmp`; the scratch directory was removed after collection. To recreate the scripts at their original absolute paths on this host, ensure that path is unused, then run:

```sh
d=/tmp/pi-auth-perf.cE2TZvNs; mkdir "$d"
for name in render-detail.ts render-tail.ts startup.py timer-wrapper.ts transforms.ts; do
  awk -v a="@@ BEGIN $name" -v b="@@ END $name" '$0==a {p=1;next} $0==b {p=0} p' \
    .project/analyses/extension-audit-remediation/performance/probe-scripts.txt > "$d/$name"
done
```

The scripts embed this checkout's absolute path and do not write source. The standalone original audited probe remains at its original path. No broad test suite, live provider call, paid generation, installed AOT comparison or real terminal latency test was run; those are outside this performance unit.
