#!/usr/bin/env python3
"""---
document:
  type: "analysis"
  id: "analysis-rpc-catalog-retry-verifier"
  title: "Catalog retry evidence verifier"
  description: "Check captured observations for both real Pi runtimes."
  status: "published"
  revision: 2
  version: 1
  created: "2026-10-28T15:41:53+01:00"
  updated: "2026-10-28T15:46:37+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T15:41:53+01:00"
  updated_at: "2026-10-28T15:46:37+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Check recorded trace invariants"]
    - revision: 2
      reason: "picker control"
      changes: ["Verify user-controlled refresh completion"]
---"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
runs = json.loads((HERE / "evidence.json").read_text())["runs"]
pre = json.loads((HERE / "pre-aborted-evidence.json").read_text())["runs"]
picker = json.loads((HERE / "picker-wait-evidence.json").read_text())["runs"]
assert len(runs) == 38 and len(pre) == 2 and len(picker) == 2


def events(run, name):
    return [item for item in run["result"]["events"] if item["event"] == name]


def count(run, name):
    return len(events(run, name))


for run in runs:
    label, runtime = run["label"], run["runtime"]
    assert run["toolExit"] == 0, (label, runtime)
    if run["result"]["arguments"]["action"] == "picker":
        assert run["result"]["pickerFetchObserved"], (label, runtime)
    else:
        assert run["result"]["exit"] == 0 and not run["result"]["stderr"], (label, runtime)
        assert run["result"]["rpc"][0]["success"], (label, runtime)
    sample = events(run, "sample")
    if label.endswith("delayed-baseline"):
        assert not sample[0]["visible"] and not sample[0]["storedVisible"]
    elif label in {"project-delayed-retry", "group-delayed-retry", "project-normal-retry", "group-normal-retry", "ordinary-user"}:
        assert sample[0]["visible"] and not sample[0]["hidden"] and sample[0]["storedVisible"]
    if label == "project-delayed-retry":
        assert count(run, "retry-start") == 2 and count(run, "phase-abort") == 2
        assert events(run, "retry-finish")[0]["aborted"] is False
    if label == "group-delayed-retry":
        abort = events(run, "phase-abort")[0]
        assert abort["hasRegistry"] and count(run, "retry-start") == 1
    if label == "ordinary-user":
        assert count(run, "retry-start") == 0 and count(run, "fetch-start") == 1
    if label == "offline":
        assert count(run, "fetch-start") == 0 and count(run, "retry-start") == 0
    if label == "offline-trigger":
        assert count(run, "fetch-start") == 1 and count(run, "retry-start") == 1
    if label == "picker-control":
        assert count(run, "fetch-start") == 2 and count(run, "retry-start") == 0 and not sample[0]["storedVisible"]
    if label == "picker-retry":
        assert count(run, "fetch-start") == 3 and count(run, "retry-start") == 1 and sample[0]["storedVisible"]
    if label == "storm":
        assert count(run, "retry-start") == 2 and count(run, "retry-exhausted") == 1 and not sample[0]["visible"]
        assert all(not item["aborted"] and not item["errors"] for item in events(run, "retry-finish"))
    if label == "own-deadline":
        assert count(run, "retry-deadline") == 2 and count(run, "retry-start") == 2
        assert all(item["aborted"] for item in events(run, "retry-finish"))
    if label == "host-timeout":
        assert events(run, "retry-start")[0]["ms"] >= 14900 and count(run, "retry-start") == 1
    if label == "http-timeout":
        assert count(run, "retry-start") == 0 and any(item["name"] == "ProviderTimeoutError" for item in events(run, "phase-error"))
        assert events(run, "manual-refresh-finish")[0]["errors"] == ["synthetic"]
    if label == "outer-publish":
        assert events(run, "publish")[0]["accepted"] and count(run, "outer-publish-error") == 1
        assert count(run, "phase-abort") == 0 and count(run, "retry-start") == 0 and sample[0]["visible"]
    if label == "persist-publish":
        assert events(run, "publish-error")[0]["name"] == "AbortError" and count(run, "retry-start") == 1
    if label == "shutdown":
        assert events(run, "candidate-shutdown")[0]["active"] and events(run, "retry-finish")[0]["aborted"]
        assert count(run, "retry-start") == 1

for run in pre:
    assert run["toolExit"] == 0 and run["result"]["exit"] == 0
    assert events(run, "pre-aborted-refresh-finish")[0]["aborted"]
    assert count(run, "phase-abort") == 1 and not events(run, "sample")[0]["storedVisible"]

for run in picker:
    assert run["toolExit"] == 0 and run["result"]["pickerFetchObserved"]
    assert count(run, "fetch-start") == 2 and count(run, "retry-start") == 0
    assert events(run, "sample")[0]["visible"] and events(run, "sample")[0]["storedVisible"]

print(f"{len(runs) + len(pre) + len(picker)} captured runs verified; both runtimes passed all trace assertions")
