#!/usr/bin/env python3
"""---
document:
  type: "analysis"
  id: "catalog-coordinator-probe-runner"
  title: "Catalog coordinator isolated runner"
  description: "Run private runtime instrumentation in temporary agent directories."
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
      changes: ["Exercise startup barrier and event timing"]
---"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]

def events(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]

def wait_for(path, predicate, timeout, process):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        found = events(path)
        if predicate(found) or process.poll() is not None:
            return found
        time.sleep(0.02)
    return events(path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", choices=["bolt", "stock"], default="bolt")
    parser.add_argument("--case", choices=["both", "group", "none"], default="both")
    parser.add_argument("--barrier", action="store_true")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--gate-ms", type=int, default=0)
    parser.add_argument("--wait-gate", action="store_true")
    parser.add_argument("--late-ms", type=int, default=0)
    parser.add_argument("--delay-implicit-ms", type=int, default=0)
    parser.add_argument("--action", choices=["none", "cancel", "manual"], default="none")
    parser.add_argument("--fetch-ms", type=int, default=800)
    parser.add_argument("--sample-ms", type=int, default=1600)
    parser.add_argument("--early-eof", action="store_true")
    parser.add_argument("--defer-app", action="store_true")
    parser.add_argument("--early-models", action="store_true")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--queue-cancel", choices=["none", "waiting", "active", "deadline"], default="none")
    parser.add_argument("--registration", choices=["none", "immediate", "deferred"], default="none")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="pi-coordinator-probe-") as scratch:
        tmp = Path(scratch)
        agent, cwd = tmp / "agent", tmp / "project"
        agent.mkdir()
        (cwd / ".pi").mkdir(parents=True)
        user = {"models": {"rules": ["synthetic/race-hidden"], "groups": [{"id": "race-group", "members": [{"provider": "synthetic", "id": "race-visible"}]}]}} if args.case == "group" else {}
        project = {"models": {"rules": ["openai/*", "synthetic/race-hidden"]}} if args.case == "both" else {}
        (agent / "auth-plus.json").write_text(json.dumps(user))
        (cwd / ".pi" / "auth-plus.json").write_text(json.dumps(project))
        trace = tmp / "trace.jsonl"
        env = {
            "HOME": scratch, "XDG_CONFIG_HOME": str(tmp / "config"), "XDG_CACHE_HOME": str(tmp / "cache"),
            "XDG_DATA_HOME": str(tmp / "data"), "XDG_STATE_HOME": str(tmp / "state"),
            "PI_CODING_AGENT_DIR": str(agent), "PATH": "/usr/bin:/bin", "TERM": "xterm-256color",
            "PI_SKIP_VERSION_CHECK": "1", "SYNTHETIC_API_KEY": "isolated-dummy-key", "RACE_TRACE": str(trace),
            "COORD_BARRIER": "1" if args.barrier else "0", "COORD_GATE_MS": str(args.gate_ms),
            "COORD_WAIT_GATE": "1" if args.wait_gate else "0", "COORD_LATE_MS": str(args.late_ms),
            "COORD_DELAY_IMPLICIT_MS": str(args.delay_implicit_ms), "ACTION": args.action,
            "QUEUE_CANCEL": args.queue_cancel, "REGISTRATION": args.registration,
            "FETCH_DELAY_MS": str(args.fetch_ms), "SAMPLE_MS": str(args.sample_ms),
        }
        if args.early_models:
            env["OPENAI_API_KEY"] = "isolated-dummy-key"
        exe = ["/home/furbyhaxx/.local/bin/pi-bolt"] if args.runtime == "bolt" else ["/usr/bin/node", str(ROOT / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js")]
        app = HERE / "deferred-app.ts" if args.defer_app else ROOT / "src/index.ts"
        driver = HERE / "queue-driver.ts" if args.queue_cancel != "none" else HERE / "registration-driver.ts" if args.registration != "none" else HERE.parent / "retry-probe/driver.ts"
        command = exe + ["--no-session", "-ne", "--approve", "-e", str(HERE / "pre.ts"), "-e", str(app), "-e", str(driver), "--mode", "rpc"]
        if args.offline:
            command.append("--offline")
        process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        extra = {}
        try:
            if args.early_eof:
                wait_event = "app-queued" if args.defer_app else "barrier-start"
                wait_for(trace, lambda e: any(i["event"] == wait_event for i in e), 8, process)
                process.stdin.close()
                process.stdin = None
                try:
                    out, err = process.communicate(timeout=2)
                    extra["eofWithin2s"] = True
                except subprocess.TimeoutExpired:
                    extra["eofWithin2s"] = False
                    process.terminate()
                    out, err = process.communicate(timeout=3)
            else:
                if args.early_models or args.replace:
                    start_event = "app-queued" if args.defer_app else "driver-session"
                    wait_for(trace, lambda e: any(i["event"] == start_event for i in e), 8, process)
                    if args.early_models:
                        process.stdin.write('{"type":"get_available_models","id":"early"}\n')
                    if args.replace:
                        process.stdin.write('{"type":"new_session","id":"replace"}\n')
                    process.stdin.flush()
                wait_for(trace, lambda e: any(i["event"] == "sample" for i in e), 25, process)
                try:
                    out, err = process.communicate('{"type":"get_available_models","id":"models"}\n', timeout=5)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    out, err = process.communicate(timeout=3)
            found = events(trace)
            if found:
                start = found[0]["at"]
                for item in found:
                    item["ms"] = item.pop("at") - start
            rpc = []
            for line in out.splitlines():
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("id") in ("models", "early"):
                    models = obj.get("data", {}).get("models", [])
                    ids = [item.get("id") for item in models if item.get("provider") == "synthetic"]
                    rpc.append({"id": obj.get("id"), "success": obj.get("success"), "visible": "race-visible" in ids, "hidden": "race-hidden" in ids, "openaiCount": sum(1 for item in models if item.get("provider") == "openai")})
                elif obj.get("id") == "replace":
                    extra["replace"] = {"success": obj.get("success"), "data": obj.get("data"), "error": obj.get("error")}
            extra.update(exit=process.returncode, stderr=err[-1500:], rpc=rpc)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=3)
        print(json.dumps({"arguments": vars(args), "events": found, **extra}, indent=2))

if __name__ == "__main__":
    main()
