---
version: 1
id: "extension-audit-shutdown-timer-recheck"
title: "Offline Pi-Bolt shutdown timer recheck"
description: "Recheck that settled shutdown clears its deadline before the replacement session starts"
type: "analysis"
created: "2026-10-29T20:26:12+01:00"
updated: "2026-10-29T20:26:56+01:00"
createdBy: "analyst"
updatedBy: "analyst"
document:
  type: "analysis"
  id: "extension-audit-shutdown-timer-recheck"
  title: "Offline Pi-Bolt shutdown timer recheck"
  description: "Recheck that settled shutdown clears its deadline before the replacement session starts"
  status: "published"
  revision: 2
  created_at: "2026-10-29T20:26:12+01:00"
  updated_at: "2026-10-29T20:26:56+01:00"
  created_by: "analyst"
  updated_by: "analyst"
  changelog:
    - revision: 1
      reason: "Record focused lifecycle recheck"
      changes: ["Capture three isolated Pi-Bolt session shutdown and replacement runs"]
    - revision: 2
      reason: "Clarify RPC response verification"
      changes: ["Distinguish checks performed by the runner from the raw-capture assertions"]
---

# Offline Pi-Bolt shutdown timer recheck

status: "qa-complete"
confidence: "high"

## Summary

**Pass: 3/3 live Pi-Bolt RPC runs.** No tracked 2,000 ms `src/index.ts` deadline remained immediately after settled shutdown or at replacement-session start. In every run the original session's tracked token timeout and quota interval disappeared at shutdown; fresh timers appeared in the replacement session. The process stayed alive for the following 3 s, and no tracked timer from the shutdown snapshot was present after 2.25 s.

The pre-fix capture had the unreferenced deadline at both shutdown and replacement start in 3/3 runs. Current `src/index.ts:540–551` retains and clears that deadline in a `finally` after the drain race. This recheck covers an idle session with no pending ingests; it does not independently test slow writes or all timer sources.

## Environment and reproduction

- Host `devlap05`; Bun 1.4.3; Pi-Bolt `1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`; Python 3.14.8; Europe/Zurich.
- Root moved from `a9f66e013814ff196976e3118213050646956dd3` to `cd64cd0ab82332a3d43334de14120f50299be1b5` during setup. The intervening commit changed only `.project/plans/0006-extension-audit-remediation/plan.md`; product source was identical. Both include fix `8712aaac5412a9b29946ee3c85c65adbd1c91af2`.
- Used the original `timer-wrapper.ts` and `startup.py` from `.project/analyses/extension-audit-remediation/performance/probe-scripts.txt`. The wrapper was verified byte-identical. The Python script differed only in its `SCRATCH` path, `/tmp/pi-auth-timer-recheck.lkAvmcRB`.
- The original wrapper mode loads the actual extension through a temporary instrumentation extension, sends RPC `get_commands` and `new_session`, samples after 2.25 s while the process remains alive, then closes stdin. Each process has fresh temporary HOME, agent and XDG directories, an allowlisted environment, `--offline`, and a seccomp filter denying `socket`, `connect`, `sendto`, `sendmsg` and `sendmmsg` in the child and descendants. No credentials, prompt or generation were supplied.
- Only the existing wrapper mode was rerun. Its JSON includes incidental startup and idle fields because the preserved script emits them; these were not used as new performance measurements. No render, startup benchmark, idle benchmark, transform or live-provider test was run.

The original files were extracted between their `@@ BEGIN` / `@@ END` markers in `probe-scripts.txt`, then the scratch-path literal in `startup.py` was replaced. Before execution, the following comparison passed:

```sh
python3 - <<'PY'
from pathlib import Path
p=Path('.project/analyses/extension-audit-remediation/performance/probe-scripts.txt').read_text()
d=Path('/tmp/pi-auth-timer-recheck.lkAvmcRB')
def src(n): return p.split('@@ BEGIN '+n+'\n',1)[1].split('@@ END '+n+'\n',1)[0]
assert (d/'timer-wrapper.ts').read_text()==src('timer-wrapper.ts')
assert (d/'startup.py').read_text()==src('startup.py').replace(
    "SCRATCH = '/tmp/pi-auth-perf.cE2TZvNs'", f"SCRATCH = '{d}'")
print('VERIFIED: timer-wrapper.ts identical to prior; startup.py differs only in scratch path')
PY
```

Three bounded executions, from repository root:

```sh
out=.project/analyses/extension-audit-remediation/shutdown-recheck
for n in 1 2 3; do
  timeout 60s python3 /tmp/pi-auth-timer-recheck.lkAvmcRB/startup.py wrapper >"$out/run-$n.jsonl"
done
```

All commands exited 0. Raw, unchanged probe output is in `run-1.jsonl`, `run-2.jsonl` and `run-3.jsonl` beside this report. The scratch directory was removed after collection; scripts can be recreated from the preserved marker-delimited originals, substituting the new scratch path. Use a different output directory for a new run to preserve these captures.

## Test matrix and evidence

| Check | Prior baseline | Recheck |
|---|---|---|
| Initial token 250 ms timeout and quota 5,000 ms interval tracked | Present | Present in 3/3 |
| Settled session shutdown | 2,000 ms `src/index.ts` timeout remained in 3/3 | `PERF_TIMER_SHUTDOWN []` in 3/3 |
| Replacement session start | Same old deadline remained in 3/3 | No `src/index.ts` 2,000 ms deadline in 3/3 |
| Timers surviving from shutdown snapshot at +2.25 s | `[]` in 3/3, after the deadline expired | `[]` in 3/3 |
| Host live after replacement | 3 s | 3 s in 3/3 |
| EOF shutdown | Process exited 0 | `PERF_TIMER_SHUTDOWN []` and exit 0 in 3/3 |

Representative marker sequence, identical in all three current runs apart from JSON whitespace:

```text
PERF_TIMER_START [{"id":2,"kind":"timeout","delay":250,"site":"src/tokens/tracker/index.ts:96:23)","referenced":false},{"id":3,"kind":"interval","delay":5000,"site":"src/quotas/engine.ts:282:29)","referenced":false}]
PERF_TIMER_SHUTDOWN []
PERF_TIMER_START [{"id":5,"kind":"timeout","delay":250,"site":"src/tokens/tracker/index.ts:96:23)","referenced":false},{"id":6,"kind":"interval","delay":5000,"site":"src/quotas/engine.ts:282:29)","referenced":false}]
PERF_TIMER_START [{"id":7,"kind":"timeout","delay":250,"site":"src/tokens/tracker/index.ts:96:23)","referenced":false},{"id":8,"kind":"interval","delay":5000,"site":"src/quotas/engine.ts:282:29)","referenced":false}]
PERF_TIMER_2_25S_AFTER []
PERF_TIMER_SHUTDOWN []
```

The original runner refuses a missing or unsuccessful `new_session` RPC response and samples `/proc` before and after the 3 s hold. The verification command checked successful extension loading and the completed hold; required at least two starts, two shutdowns and the delayed observation; confirmed tracking of the original 250 ms and 5,000 ms timers; and rejected a source-attributed 2,000 ms `src/index.ts` timeout in shutdown or replacement-start snapshots. It also required the delayed snapshot to be empty:

```sh
python3 - <<'PY'
from pathlib import Path
import json
p=Path('.project/analyses/extension-audit-remediation/shutdown-recheck')
for n in range(1,4):
 r=json.loads((p/f'run-{n}.jsonl').read_text()); markers=[]
 for line in r['stderr'].splitlines():
  if line.startswith('PERF_TIMER_'):
   key,value=line.split(' ',1); markers.append((key,json.loads(value)))
 starts=[v for k,v in markers if k=='PERF_TIMER_START']
 shuts=[v for k,v in markers if k=='PERF_TIMER_SHUTDOWN']
 later=[v for k,v in markers if k=='PERF_TIMER_2_25S_AFTER']
 assert r['returncode']==0 and r['extensionCommandPresent'] is True and r['idle']['seconds']==3
 assert len(starts)>=2 and len(shuts)>=2 and len(later)>=1
 assert any(x['kind']=='timeout' and x['delay']==250 and x['site'].startswith('src/tokens/tracker/') for x in starts[0])
 assert any(x['kind']=='interval' and x['delay']==5000 and x['site'].startswith('src/quotas/engine.ts:') for x in starts[0])
 is_deadline=lambda x:x['kind']=='timeout' and x['delay']==2000 and x['site'].startswith('src/index.ts:')
 assert all(not any(map(is_deadline,v)) for v in shuts)
 assert all(not any(map(is_deadline,v)) for v in starts[1:])
 assert all(v==[] for v in later)
 print(f'run {n}: initial timers observed; shutdown deadline absent; replacement deadline absent; 2.25s old timers []; live for 3s; exit 0: PASS')
print('3/3 PASS')
PY
```

Output is preserved in `assertions.txt`:

```text
run 1: initial timers observed; shutdown deadline absent; replacement deadline absent; 2.25s old timers []; live for 3s; exit 0: PASS
run 2: initial timers observed; shutdown deadline absent; replacement deadline absent; 2.25s old timers []; live for 3s; exit 0: PASS
run 3: initial timers observed; shutdown deadline absent; replacement deadline absent; 2.25s old timers []; live for 3s; exit 0: PASS
3/3 PASS
```

## Defects, gaps and preserved baseline

No defect was observed in the requested idle shutdown/replacement flow. The wrapper observes global timers whose stacks identify `src/` in the loaded extension; it does not establish absence of native or unattributed timers, or behavior during in-flight requests/login. The 2-second slow-ingest deadline behavior was not exercised in this narrow follow-up.

No product file, previous performance report or raw baseline was changed. Before and after, the previous report SHA-256 was `114e873ce87c8fe0cdb556cfb59532bb57f5ded5142a73f0b1580238dbbe662a`, the preserved probe script SHA-256 was `55fbcde3b10b3f84769e0b6b8d7fa5d00cd1adf0290549e4dedc1c06509dfd6f`, and audit `performance.json` was `6ff0249243e11ef2fba192f359f6b1a9395cd0c31d15c92b3b6b3363f6e254b3`. All three previous timer capture digests also matched. No scratch files or probe processes remained.
