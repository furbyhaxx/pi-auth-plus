#!/usr/bin/env python3
"""---
document:
  type: "analysis"
  id: "analysis-rpc-startup-delay-runner"
  title: "RPC startup delay isolated runner"
  description: "Drive actual hosts with isolated project state, fake transport and PTY."
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
      changes: ["Run isolated startup and picker scenarios"]
---"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
spec = importlib.util.spec_from_file_location("retry_runner", HERE.parent / "retry-probe/run.py")
retry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retry)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", choices=["bolt", "stock"], required=True)
    parser.add_argument("--case", choices=["none", "both", "group"], default="both")
    parser.add_argument("--mode", choices=["rpc", "picker"], default="rpc")
    parser.add_argument("--prototype", choices=["observe", "delay", "control"], default="observe")
    parser.add_argument("--action", choices=["none", "pre-aborted", "overlap", "manual", "cancel", "later-other", "later-same", "later-provider", "later-error", "later-config", "early-other", "early-same"], default="none")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--implicit-delay", type=int, default=0)
    parser.add_argument("--release-delay", type=int, default=0)
    parser.add_argument("--trailing-delay", type=int, default=0)
    parser.add_argument("--fetch-delay", type=int, default=800)
    parser.add_argument("--sample-ms", type=int, default=2000)
    parser.add_argument("--early-models", action="store_true")
    parser.add_argument("--eof", choices=["none", "waiting", "active"], default="none")
    parser.add_argument("--replace", choices=["none", "waiting", "active", "write"], default="none")
    parser.add_argument("--store-delay", type=int, default=0)
    parser.add_argument("--narrow", action="store_true")
    parser.add_argument("--prepatched", action="store_true")
    parser.add_argument("--keep-picker-open", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="pi-startup-delay-") as scratch:
        tmp = Path(scratch)
        agent, cwd = tmp / "agent", tmp / "project"
        agent.mkdir()
        (cwd / ".pi").mkdir(parents=True)
        user = {"models": {"rules": ["synthetic/race-hidden"], "groups": [{"id": "race-group", "members": [{"provider": "synthetic", "id": "race-visible"}]}]}} if args.case == "group" else {}
        project = {"models": {"rules": ["openai/*", "synthetic/race-hidden"]}} if args.case == "both" else {}
        (agent / "auth-plus.json").write_text(json.dumps(user))
        (cwd / ".pi/auth-plus.json").write_text(json.dumps(project))
        trace = tmp / "trace.jsonl"
        env = {
            "HOME": scratch, "XDG_CONFIG_HOME": str(tmp / "config"), "XDG_CACHE_HOME": str(tmp / "cache"),
            "XDG_DATA_HOME": str(tmp / "data"), "XDG_STATE_HOME": str(tmp / "state"),
            "PI_CODING_AGENT_DIR": str(agent), "PATH": "/usr/bin:/bin", "TERM": "xterm-256color",
            "PI_SKIP_VERSION_CHECK": "1", "SYNTHETIC_API_KEY": "isolated-dummy-key", "OPENAI_API_KEY": "isolated-dummy-key", "RACE_TRACE": str(trace),
            "PROTOTYPE": args.prototype, "ACTION": args.action, "FETCH_DELAY_MS": str(args.fetch_delay),
            "SAMPLE_MS": str(args.sample_ms), "DELAY_IMPLICIT_MS": str(args.implicit_delay),
            "RELEASE_DELAY_MS": str(args.release_delay), "TRAILING_DELAY_MS": str(args.trailing_delay),
            "NARROW": "1" if args.narrow else "0", "FAIL_FIRST": "1" if args.mode == "picker" else "0",
            "STORE_DELAY_MS": str(args.store_delay),
        }
        exe = ["/home/furbyhaxx/.local/bin/pi-bolt"] if args.runtime == "bolt" else ["/usr/bin/node", str(ROOT / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js")]
        cmd = exe + ["--no-session", "-ne", "--approve"]
        if args.prepatched:
            cmd += ["-e", str(HERE / "prepatch.ts")]
        cmd += ["-e", str(HERE / "pre.ts"), "-e", str(ROOT / "src/index.ts"), "-e", str(HERE / "post.ts")]
        if args.trailing_delay:
            cmd += ["-e", str(HERE / "trailing.ts")]
        if args.offline:
            cmd += ["--offline"]
        extra = {}
        if args.mode == "picker":
            base = ["/usr/bin/tmux", "-S", str(tmp / "tmux.sock")]
            start = base + ["new-session", "-d", "-s", "probe", "-x", "100", "-y", "30", "-c", str(cwd), "/usr/bin/env", "-i"] + [f"{k}={v}" for k, v in env.items()] + ["/usr/bin/timeout", "25", *cmd]
            result = subprocess.run(start, capture_output=True, text=True, timeout=5)
            if result.returncode:
                raise RuntimeError(result.stderr)
            try:
                retry.wait_for(trace, lambda e: any(x["event"] == "fetch-fail" for x in e), 8)
                retry.wait_for(trace, lambda e: any(x["event"] == "refresh-finish" for x in e), 8)
                subprocess.run(base + ["send-keys", "-t", "probe", "/model", "Enter"], check=True, timeout=3)
                before = retry.wait_for(trace, lambda e: sum(x["event"] == "fetch-start" for x in e) >= 2, 5)
                extra["pickerFetchObserved"] = sum(x["event"] == "fetch-start" for x in before) >= 2
                extra["pickerPane"] = subprocess.run(base + ["capture-pane", "-p", "-J", "-t", "probe"], capture_output=True, text=True, timeout=3).stdout[-1800:]
                if not args.keep_picker_open:
                    subprocess.run(base + ["send-keys", "-t", "probe", "Escape"], check=True, timeout=3)
                found = retry.wait_for(trace, lambda e: any(x["event"] == "sample" for x in e), 10)
                extra["closedPane"] = subprocess.run(base + ["capture-pane", "-p", "-J", "-t", "probe"], capture_output=True, text=True, timeout=3).stdout[-1200:]
            finally:
                subprocess.run(base + ["kill-server"], capture_output=True, timeout=3)
        else:
            cmd += ["--mode", "rpc"]
            proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            try:
                if args.eof != "none" or args.replace != "none":
                    timing = args.eof if args.eof != "none" else args.replace
                    event = "startup-held" if timing == "waiting" else "store-write-start" if timing == "write" else "fetch-start"
                    seen = retry.wait_for(trace, lambda e: any(x["event"] == event for x in e), 8, proc)
                    extra["triggerObserved"] = any(x["event"] == event for x in seen)
                if args.eof != "none":
                    proc.stdin.close()
                    proc.stdin = None
                    try:
                        out, err = proc.communicate(timeout=2)
                        extra["eofWithin2s"] = True
                    except subprocess.TimeoutExpired:
                        extra["eofWithin2s"] = False
                        proc.terminate()
                        out, err = proc.communicate(timeout=3)
                else:
                    if args.early_models or args.replace != "none":
                        if args.replace == "none":
                            retry.wait_for(trace, lambda e: any(x["event"] == "post-session" for x in e), 8, proc)
                        if args.early_models:
                            proc.stdin.write('{"type":"get_available_models","id":"early"}\n')
                        if args.replace != "none":
                            proc.stdin.write('{"type":"new_session","id":"replace"}\n')
                        proc.stdin.flush()
                    retry.wait_for(trace, lambda e: any(x["event"] == "sample" for x in e), args.sample_ms / 1000 + 10, proc)
                    try:
                        out, err = proc.communicate('{"type":"get_available_models","id":"models"}\n', timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.terminate()
                        out, err = proc.communicate(timeout=3)
                found = retry.read_events(trace)
                extra.update(exit=proc.returncode, stderr=err[-2000:])
                rpc = []
                for line in out.splitlines():
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("id") in ("models", "early"):
                        models = obj.get("data", {}).get("models", [])
                        ids = [m.get("id") for m in models if m.get("provider") == "synthetic"]
                        rpc.append({"id": obj.get("id"), "success": obj.get("success"), "visible": "race-visible" in ids, "hidden": "race-hidden" in ids, "openaiCount": sum(m.get("provider") == "openai" for m in models)})
                    elif obj.get("id") == "replace":
                        extra["replace"] = {"success": obj.get("success"), "data": obj.get("data"), "error": obj.get("error")}
                extra["rpc"] = rpc
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=3)
        if found:
            first = found[0]["at"]
            for item in found:
                item["ms"] = item.pop("at") - first
        print(json.dumps({"arguments": vars(args), "events": found, **extra}, indent=2))


if __name__ == "__main__":
    main()
