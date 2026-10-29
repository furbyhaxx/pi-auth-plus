#!/usr/bin/env python3
"""---
document:
  type: "analysis"
  id: "catalog-coordinator-probe-verify"
  title: "Catalog coordinator evidence assertions"
  description: "Assert recorded timelines and outcomes across both tested runtimes."
  status: "published"
  revision: 1
  version: 1
  created: "2026-10-28T16:32:57+01:00"
  updated: "2026-10-28T16:32:57+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T16:32:57+01:00"
  updated_at: "2026-10-28T16:32:57+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Check evidence for ordering, signals, visibility, and shutdown"]
---"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
count = 0

def load(runtime, scenario):
    global count
    count += 1
    path = HERE / f"{runtime}-{scenario}.json"
    data = json.loads(path.read_text())
    assert data.get("stderr", "") == "", path
    assert data["exit"] == (-15 if scenario == "eof" else 0), path
    return data

def ev(data, name):
    return [event for event in data["events"] if event["event"] == name]

def one(data, name):
    found = ev(data, name)
    assert len(found) == 1, (name, found)
    return found[0]

for runtime in ("bolt", "stock"):
    control = load(runtime, "control")
    snap = one(control, "session-snapshot")
    assert snap["samePrototype"] and snap["tracked"] == 1 and snap["controllers"] == 0
    assert snap["promiseFields"] == [] and snap["signalFields"] == []
    assert len(ev(control, "fetch-abort")) == 1 and not control["rpc"][0]["visible"]

    barrier = load(runtime, "barrier")
    assert one(barrier, "outer-start")["signal"] == one(barrier, "models-enter")["signal"]
    assert len(ev(barrier, "fetch-start")) == 1 and not ev(barrier, "fetch-abort")
    assert one(barrier, "fetch-resolve")["ms"] <= one(barrier, "barrier-done")["ms"]
    assert barrier["rpc"][0]["visible"] and not barrier["rpc"][0]["hidden"]
    assert one(barrier, "sample")["storedVisible"]

    gate = load(runtime, "gate")
    assert one(gate, "models-gate")["ms"] <= one(gate, "session-snapshot")["ms"]
    assert one(gate, "session-snapshot")["controllers"] == 0
    assert one(gate, "session-snapshot")["tracked"] == 1
    assert one(gate, "session-snapshot")["promiseFields"] == []
    assert one(gate, "session-snapshot")["signalFields"] == []
    assert one(gate, "models-gate-release")["ms"] <= one(gate, "fetch-start")["ms"]
    assert gate["rpc"][0]["visible"] and not gate["rpc"][0]["hidden"]

    late = load(runtime, "late")
    snap = one(late, "session-snapshot")
    assert snap["syntheticController"] and snap["syntheticControllerSignal"] != snap["signalIds"][0]

    group = load(runtime, "group")
    assert group["rpc"][0]["visible"] and not group["rpc"][0]["hidden"]
    assert not ev(group, "fetch-abort")

    offline = load(runtime, "offline")
    assert not ev(offline, "fetch-start") and one(offline, "session-snapshot")["tracked"] == 0

    cancel = load(runtime, "cancel")
    assert len(ev(cancel, "fetch-start")) == 2 and one(cancel, "fetch-abort")["number"] == 2
    assert one(cancel, "user-refresh-finish")["aborted"]

    implicit = load(runtime, "implicit2")
    assert any(event["sameRuntime"] for event in ev(implicit, "delay-implicit"))
    assert one(implicit, "fetch-abort")["number"] == 2
    assert not one(implicit, "manual-refresh-finish")["aborted"]
    assert one(implicit, "manual-refresh-start")["ms"] < one(implicit, "fetch-abort")["ms"]

    deadline = load(runtime, "deadline")
    assert len(ev(deadline, "fetch-start")) == 1 and one(deadline, "outer-finish")["aborted"]
    assert one(deadline, "outer-signal-abort")["ms"] - one(deadline, "outer-start")["ms"] >= 14900
    assert one(deadline, "outer-finish")["ms"] <= one(deadline, "barrier-done")["ms"]

    eof = load(runtime, "eof")
    assert eof["eofWithin2s"] is False and not ev(eof, "pre-shutdown")

    deferred = load(runtime, "deferred")
    assert deferred["rpc"][0]["id"] == "early" and deferred["rpc"][0]["openaiCount"] > 0
    assert deferred["rpc"][1]["openaiCount"] == 0 and deferred["rpc"][1]["visible"]
    assert one(deferred, "fetch-resolve")["ms"] <= ev(deferred, "app-run")[0]["ms"]

    deferred_eof = load(runtime, "deferred-eof")
    assert deferred_eof["eofWithin2s"] is True and not ev(deferred_eof, "app-run")
    assert one(deferred_eof, "pre-shutdown")["reason"] == "quit"

    replacement = load(runtime, "replace-control")
    assert replacement["replace"]["success"]
    old = ev(replacement, "session-snapshot")[0]["runtime"]
    new = ev(replacement, "session-snapshot")[1]["runtime"]
    assert old != new and one(replacement, "outer-finish")["runtime"] == old
    assert ev(replacement, "pre-shutdown")[0]["reason"] == "new"
    assert ev(replacement, "pre-shutdown")[0]["ms"] < one(replacement, "fetch-resolve")["ms"]
    assert one(replacement, "store-write-finish")["runtime"] == old
    assert ev(replacement, "pre-shutdown")[0]["ms"] < one(replacement, "store-write-finish")["ms"]
    assert one(replacement, "outer-finish")["ms"] < ev(replacement, "sample")[0]["ms"]
    assert ev(replacement, "sample")[0]["storedVisible"] and not ev(replacement, "sample")[0]["visible"]

    queued = load(runtime, "queue-waiting")
    assert one(queued, "queue-cancel-waiting")["ms"] <= one(queued, "queue-wait-aborted")["ms"]
    assert not ev(queued, "queue-offline-start") and not ev(queued, "fetch-abort")
    assert len(ev(queued, "fetch-resolve")) == 2 and not one(queued, "queue-active-finish")["aborted"]

    active = load(runtime, "queue-active")
    assert one(active, "queue-active-finish")["aborted"] and one(active, "fetch-abort")["number"] == 2
    assert one(active, "queue-active-finish")["ms"] <= one(active, "queue-offline-start")["ms"]
    assert len(ev(active, "fetch-start")) == 2

    waiting_deadline = load(runtime, "queue-deadline")
    assert one(waiting_deadline, "queue-wait-deadline")["reason"] == "TimeoutError"
    assert one(waiting_deadline, "queue-wait-deadline")["ms"] - one(waiting_deadline, "queue-wait-start")["ms"] >= 145
    assert not ev(waiting_deadline, "queue-offline-start") and not ev(waiting_deadline, "fetch-abort")
    assert len(ev(waiting_deadline, "fetch-resolve")) == 2

    immediate = load(runtime, "registration-immediate")
    deferred_reg = load(runtime, "registration-deferred")
    assert one(immediate, "registration-return")["visible"]
    assert not one(deferred_reg, "registration-return")["visible"]
    assert one(deferred_reg, "registration-later")["visible"]

print(f"{count} captured runs verified; both runtimes passed all evidence assertions")
