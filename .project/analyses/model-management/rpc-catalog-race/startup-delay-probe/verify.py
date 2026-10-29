#!/usr/bin/env python3
"""---
document:
  type: "analysis"
  id: "analysis-rpc-startup-delay-verifier"
  title: "Startup delay evidence assertions"
  description: "Check captured lifecycle, deadline, picker, registration and isolation outcomes."
  status: "published"
  revision: 1
  version: 1
  created: "2026-10-28T16:51:56+01:00"
  updated: "2026-10-28T17:01:32+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T16:51:56+01:00"
  updated_at: "2026-10-28T17:01:32+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Verify captured startup-delay experiments"]
---"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
count = 0


def load(runtime, name):
    global count
    path = HERE / f"final-{runtime}-{name}.json"
    data = json.loads(path.read_text())
    assert data["arguments"]["runtime"] == runtime, path
    if "exit" in data:
        assert data["exit"] == 0 and data["stderr"] == "", path
    count += 1
    return data


def events(data, name):
    return [item for item in data["events"] if item["event"] == name]


def one(data, name):
    found = events(data, name)
    assert found, (data["arguments"], name)
    return found[0]


def check_sample(data, visible, hidden=False):
    sample = one(data, "sample")
    assert sample["visible"] == visible and sample["hidden"] == hidden, (data["arguments"], sample)
    assert sample["storedVisible"] == visible, (data["arguments"], sample)


for rt in ("bolt", "stock"):
    data = load(rt, "observe")
    one(data, "fetch-abort")
    check_sample(data, False)
    data = load(rt, "base-v3")
    assert len(events(data, "startup-held")) == len(events(data, "startup-enter")) == len(events(data, "fetch-start")) == 1
    assert not one(data, "startup-enter")["sameSignal"]
    assert data["rpc"][0] == {"id": "early", "success": True, "visible": False, "hidden": False, "openaiCount": 0}
    assert data["rpc"][1]["visible"] and not data["rpc"][1]["hidden"]
    check_sample(data, True)
    data = load(rt, "group-v2")
    assert one(data, "post-session")["groupVisible"]
    check_sample(data, True)
    data = load(rt, "implicit-v2")
    one(data, "startup-drain")
    assert one(data, "startup-enter")["ms"] - one(data, "implicit-delay")["ms"] >= 650
    check_sample(data, True)
    data = load(rt, "trailing")
    assert one(data, "trailing-start")["ms"] <= one(data, "startup-enter")["ms"] < one(data, "trailing-registered")["ms"]
    one(data, "fetch-abort")
    check_sample(data, False)
    data = load(rt, "trailing-narrow")
    assert any(x["provider"] == "trailing-probe" and x["narrowed"] for x in events(data, "registration-implicit"))
    check_sample(data, True, True)
    data = load(rt, "guard")
    one(data, "guard-rejected")
    assert not events(data, "startup-held")
    one(data, "fetch-abort")
    data = load(rt, "offline")
    assert not events(data, "startup-held") and not events(data, "fetch-start")
    data = load(rt, "deadline-wait")
    elapsed = one(data, "startup-caller-abort")["ms"] - one(data, "startup-held")["ms"]
    assert 14800 <= elapsed <= 18000 and not events(data, "startup-enter") and not events(data, "fetch-start")
    assert one(data, "startup-skipped")["reason"] == "aborted-in-delay"
    data = load(rt, "deadline-active")
    elapsed = one(data, "startup-caller-abort")["ms"] - one(data, "startup-held")["ms"]
    assert 14800 <= elapsed <= 18000
    one(data, "fetch-abort")
    assert one(data, "startup-finish")["aborted"]
    data = load(rt, "eof-wait")
    assert data["eofWithin2s"] and data["triggerObserved"] and not events(data, "startup-enter")
    data = load(rt, "eof-active-v3")
    assert data["eofWithin2s"] and data["triggerObserved"]
    assert {x["method"] for x in events(data, "post-shutdown-runtime-work")} == {"updateModelSnapshot", "queueAvailabilityRefresh"}
    data = load(rt, "replace-wait-v2")
    assert data["replace"]["success"] and not events(data, "startup-enter")
    assert any(x.get("reused") for x in events(data, "probe-install"))
    assert one(data, "startup-skipped")["reason"] == "aborted-in-delay"
    data = load(rt, "replace-active-v3")
    assert data["replace"]["success"]
    one(data, "fetch-abort")
    assert not events(data, "store-write-finish")
    assert {x["method"] for x in events(data, "post-shutdown-runtime-work")} == {"updateModelSnapshot", "queueAvailabilityRefresh"}
    check_sample(data, False)
    data = load(rt, "replace-write-v3")
    assert data["replace"]["success"]
    assert one(data, "store-write-resume")["stopped"] and one(data, "store-write-resume")["aborted"]
    assert one(data, "store-write-error")["name"] == "AbortError" and not events(data, "store-write-finish")
    data = load(rt, "preabort")
    assert one(data, "pre-aborted-refresh-finish")["aborted"]
    one(data, "fetch-abort")
    assert not one(data, "startup-finish")["aborted"]
    data = load(rt, "preabort-wait")
    assert one(data, "startup-skipped")["reason"] == "overlap"
    assert not events(data, "startup-enter") and not events(data, "fetch-start")
    data = load(rt, "lookalike")
    assert any(x["keys"] == ["signal"] and x["seenSession"] and not x["candidate"] for x in events(data, "refresh-call"))
    assert one(data, "startup-skipped")["reason"] == "overlap"
    check_sample(data, True, True)
    data = load(rt, "cancel")
    assert one(data, "user-refresh-finish")["aborted"]
    assert len(events(data, "fetch-start")) == len(events(data, "fetch-abort")) == 2
    data = load(rt, "picker-v2")
    assert data["pickerFetchObserved"] and len(events(data, "fetch-start")) == 2
    assert one(data, "fetch-abort")["number"] == 2
    assert not events(data, "startup-held")
    check_sample(data, False)
    data = load(rt, "picker-open-v2")
    assert data["pickerFetchObserved"] and len(events(data, "fetch-start")) == 2
    assert one(data, "fetch-resolve")["number"] == 2
    check_sample(data, True, True)
    for kind in ("other", "provider"):
        data = load(rt, f"{kind}-global")
        assert one(data, "registration-return")["visible"] and one(data, "registration-return")["returnedUndefined"]
        one(data, "fetch-abort")
        check_sample(data, False)
        data = load(rt, f"{kind}-narrow")
        assert one(data, "registration-return")["visible"] and one(data, "registration-return")["returnedUndefined"]
        assert any(x["narrowed"] for x in events(data, "registration-implicit"))
        check_sample(data, True, True)
    for suffix in ("global", "narrow"):
        data = load(rt, f"same-{suffix}")
        assert one(data, "registration-return")["visible"]
        assert one(data, "fetch-abort")["ms"] <= next(x for x in events(data, "registration-implicit") if x["provider"] == "synthetic" and x["ms"] > one(data, "fetch-start")["ms"])["ms"]
        check_sample(data, False)
    data = load(rt, "error-narrow")
    assert one(data, "registration-error-check")["threw"]
    data = load(rt, "config-global")
    assert one(data, "config-sample")["sideVisible"]
    data = load(rt, "config-narrow")
    assert not one(data, "config-sample")["sideVisible"]
    for kind in ("rpc", "picker"):
        result = (HERE / f"{rt}-{kind}-network.txt").read_text()
        assert "IP-family network syscalls=0" in result

print(f"{count} captured runs verified; both runtimes passed evidence assertions; four representative network traces passed")
