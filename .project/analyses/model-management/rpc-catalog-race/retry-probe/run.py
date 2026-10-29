#!/usr/bin/env python3
"""---
document:
  type: "analysis"
  id: "analysis-rpc-catalog-retry-runner"
  title: "RPC catalog retry experiment runner"
  description: "Run real stock Pi or Pi-Bolt in isolated directories without network or credentials."
  status: "published"
  revision: 3
  version: 1
  created: "2026-10-28T15:32:19+01:00"
  updated: "2026-10-28T15:46:37+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T15:32:19+01:00"
  updated_at: "2026-10-28T15:46:37+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Run isolated retries against both runtimes"]
    - revision: 2
      reason: "probe refinement"
      changes: ["Expose additional probe scenarios"]
    - revision: 3
      reason: "picker control"
      changes: ["Allow the user-controlled picker refresh to finish"]
---"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
CASES = {
    "none": ({}, {}),
    "user": ({"models": {"rules": ["synthetic/race-hidden"]}}, {}),
    "user-group": ({"models": {"rules": ["synthetic/race-hidden"], "groups": [{"id": "race-group", "members": [{"provider": "synthetic", "id": "race-visible"}]}]}}, {}),
    "project-both": ({}, {"models": {"rules": ["openai/*", "synthetic/race-hidden"]}}),
}


def read_events(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def wait_for(path, predicate, seconds, proc=None):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        events = read_events(path)
        if predicate(events) or (proc and proc.poll() is not None):
            return events
        time.sleep(0.03)
    return read_events(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", choices=CASES, default="project-both")
    parser.add_argument("--runtime", choices=["bolt", "stock"], default="bolt")
    parser.add_argument("--candidate", action="store_true")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--delay-implicit", type=int, default=0)
    parser.add_argument("--action", choices=["none", "cancel", "manual", "overlap", "storm", "offline-kick", "offline-trigger", "pre-aborted", "publish-race", "persist-race", "picker"], default="none")
    parser.add_argument("--fail-first", action="store_true")
    parser.add_argument("--keep-picker-open", action="store_true")
    parser.add_argument("--fetch-delay", type=int, default=800)
    parser.add_argument("--sample-ms", type=int, default=2200)
    parser.add_argument("--retry-timeout", type=int, default=15000)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--early-exit-ms", type=int, default=0)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="pi-retry-probe-") as scratch:
        tmp = Path(scratch)
        agent, cwd = tmp / "agent", tmp / "project"
        agent.mkdir()
        (cwd / ".pi").mkdir(parents=True)
        user, project = CASES[args.case]
        (agent / "auth-plus.json").write_text(json.dumps(user))
        (cwd / ".pi" / "auth-plus.json").write_text(json.dumps(project))
        trace = tmp / "trace.jsonl"
        env = {
            "HOME": scratch, "XDG_CONFIG_HOME": str(tmp / "config"), "XDG_CACHE_HOME": str(tmp / "cache"),
            "XDG_DATA_HOME": str(tmp / "data"), "XDG_STATE_HOME": str(tmp / "state"),
            "PI_CODING_AGENT_DIR": str(agent), "PATH": "/usr/bin:/bin", "TERM": "xterm-256color",
            "PI_SKIP_VERSION_CHECK": "1", "SYNTHETIC_API_KEY": "isolated-dummy-key", "RACE_TRACE": str(trace),
            "CANDIDATE": "1" if args.candidate else "0", "ACTION": args.action,
            "DELAY_IMPLICIT_MS": str(args.delay_implicit), "FAIL_FIRST": "1" if args.fail_first else "0",
            "FETCH_DELAY_MS": str(args.fetch_delay), "SAMPLE_MS": str(args.sample_ms),
            "RETRY_TIMEOUT_MS": str(args.retry_timeout), "MAX_ATTEMPTS": str(args.max_attempts),
        }
        executable = ["/home/furbyhaxx/.local/bin/pi-bolt"] if args.runtime == "bolt" else ["/usr/bin/node", str(ROOT / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js")]
        command = executable + ["--no-session", "-ne", "--approve", "-e", str(HERE / "pre.ts"), "-e", str(HERE / "probe.ts"), "-e", str(HERE / "driver.ts")]
        if args.offline:
            command.append("--offline")
        extra = {}
        if args.action == "picker":
            base = ["/usr/bin/tmux", "-S", str(tmp / "tmux.sock")]
            start = base + ["new-session", "-d", "-s", "probe", "-x", "100", "-y", "30", "-c", str(cwd), "/usr/bin/env", "-i"] + [f"{key}={value}" for key, value in env.items()] + ["/usr/bin/timeout", "25", *command]
            started = subprocess.run(start, capture_output=True, text=True, timeout=5)
            if started.returncode:
                raise RuntimeError(started.stderr)
            try:
                wait_for(trace, lambda e: any(i["event"] == "fetch-fail" for i in e), 8)
                subprocess.run(base + ["send-keys", "-t", "probe", "/model", "Enter"], check=True, timeout=3)
                before_cancel = wait_for(trace, lambda e: sum(i["event"] == "fetch-start" for i in e) >= 2, 5)
                extra["pickerFetchObserved"] = sum(i["event"] == "fetch-start" for i in before_cancel) >= 2
                extra["pickerPane"] = subprocess.run(base + ["capture-pane", "-p", "-J", "-t", "probe"], capture_output=True, text=True, timeout=3).stdout[-1800:]
                if not args.keep_picker_open:
                    subprocess.run(base + ["send-keys", "-t", "probe", "Escape"], check=True, timeout=3)
                found = wait_for(trace, lambda e: any(i["event"] == "sample" for i in e), 8)
                extra["closedPane"] = subprocess.run(base + ["capture-pane", "-p", "-J", "-t", "probe"], capture_output=True, text=True, timeout=3).stdout[-1200:]
            finally:
                subprocess.run(base + ["kill-server"], capture_output=True, timeout=3)
        else:
            command += ["--mode", "rpc"]
            proc = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            try:
                if args.early_exit_ms:
                    wait_for(trace, lambda e: any(i["event"] == "retry-start" for i in e), 5, proc)
                    time.sleep(args.early_exit_ms / 1000)
                else:
                    wait_for(trace, lambda e: any(i["event"] == "sample" for i in e), args.sample_ms / 1000 + 8, proc)
                try:
                    out, err = proc.communicate('{"type":"get_available_models","id":"models"}\n', timeout=5)
                except subprocess.TimeoutExpired:
                    proc.terminate()
                    out, err = proc.communicate(timeout=3)
                extra.update(exit=proc.returncode, stderr=err[-2000:])
                rpc = []
                for line in out.splitlines():
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("id") == "models":
                        ids = [item.get("id") for item in obj.get("data", {}).get("models", []) if item.get("provider") == "synthetic"]
                        rpc.append({"success": obj.get("success"), "visible": "race-visible" in ids, "hidden": "race-hidden" in ids})
                extra["rpc"] = rpc
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=3)
            found = read_events(trace)
        if found:
            start = found[0]["at"]
            for item in found:
                item["ms"] = item.pop("at") - start
        print(json.dumps({"arguments": vars(args), "events": found, **extra}, indent=2))


if __name__ == "__main__":
    main()
