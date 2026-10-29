#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
CASES = {
    "none": ({}, {}, True),
    "user": ({"models": {"rules": ["synthetic/race-hidden"]}}, {}, True),
    "user-group": ({"models": {"rules": ["synthetic/race-hidden"], "groups": [{"id": "race-group", "members": [{"provider": "synthetic", "id": "race-visible"}]}]}}, {}, True),
    "project-owned": ({}, {"models": {"rules": ["synthetic/race-hidden"]}}, True),
    "project-builtin": ({}, {"models": {"rules": ["openai/*"]}}, True),
    "project-both": ({}, {"models": {"rules": ["openai/*", "synthetic/race-hidden"]}}, True),
    "user-restricted": ({"models": {"rulesScope": "user", "rules": ["synthetic/race-hidden"]}}, {"models": {"rules": ["synthetic/race-visible"]}}, True),
    "project-untrusted": ({}, {"models": {"rules": ["synthetic/race-hidden"]}}, False),
    "project-same": ({"models": {"rules": ["synthetic/race-hidden"]}}, {"models": {"rules": ["synthetic/race-hidden"]}}, True),
}


def events(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().split("\n")[:-1] if line]


def wait_sample(path, process=None):
    deadline = time.monotonic() + 9
    while time.monotonic() < deadline:
        found = events(path)
        if any(event["event"] == "sample" for event in found):
            return found
        if process and process.poll() is not None:
            return found
        time.sleep(0.05)
    return events(path)


def run(case, mode, runtime, delay, offline, retry, delay_implicit, barrier):
    user, project, trusted = CASES[case]
    with tempfile.TemporaryDirectory(prefix="pi-catalog-race-") as scratch:
        tmp = Path(scratch)
        agent = tmp / "agent"
        cwd = tmp / "project"
        (cwd / ".pi").mkdir(parents=True)
        agent.mkdir()
        (agent / "auth-plus.json").write_text(json.dumps(user))
        (cwd / ".pi" / "auth-plus.json").write_text(json.dumps(project))
        trace = tmp / "trace.jsonl"
        env = {
            "HOME": scratch,
            "XDG_CONFIG_HOME": str(tmp / "config"),
            "XDG_CACHE_HOME": str(tmp / "cache"),
            "XDG_DATA_HOME": str(tmp / "data"),
            "XDG_STATE_HOME": str(tmp / "state"),
            "PI_CODING_AGENT_DIR": str(agent),
            "PATH": "/usr/bin:/bin",
            "TERM": "xterm-256color",
            "PI_SKIP_VERSION_CHECK": "1",
            "SYNTHETIC_API_KEY": "isolated-dummy-key",
            "RACE_TRACE": str(trace),
            "RACE_DELAY_MS": str(delay),
            "RACE_RESTART": "1" if retry else "0",
            "RACE_DELAY_IMPLICIT_MS": str(delay_implicit),
            "RACE_BARRIER": "1" if barrier else "0",
        }
        executable = ["/home/furbyhaxx/.local/bin/pi-bolt"] if runtime == "bolt" else ["/usr/bin/node", str(ROOT / "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js")]
        args = executable + ["--no-session", "-ne", "--approve" if trusted else "--no-approve", "-e", str(HERE / "before.ts"), "-e", str(ROOT / "src/index.ts"), "-e", str(HERE / "after.ts")]
        if offline:
            args.append("--offline")
        if mode == "rpc":
            args += ["--mode", "rpc"]
            proc = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            try:
                found = wait_sample(trace, proc)
                try:
                    out, err = proc.communicate('{"type":"get_available_models","id":"models"}\n', timeout=5)
                except subprocess.TimeoutExpired:
                    proc.terminate()
                    out, err = proc.communicate(timeout=3)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=3)
            rpc = []
            for line in out.split("\n"):
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("id") == "models":
                    ids = [item.get("id") for item in obj.get("data", {}).get("models", []) if item.get("provider") == "synthetic"]
                    rpc.append({"success": obj.get("success"), "visible": "race-visible" in ids, "hidden": "race-hidden" in ids})
            extra = {"exit": proc.returncode, "rpc": rpc, "stderr": err[-2000:]}
        else:
            socket = tmp / "tmux.sock"
            base = ["/usr/bin/tmux", "-S", str(socket)]
            command = ["/usr/bin/timeout", "12", *args]
            session_args = base + ["new-session", "-d", "-s", "race", "-x", "100", "-y", "30", "-c", str(cwd), "/usr/bin/env", "-i"] + [f"{k}={v}" for k, v in env.items()] + command
            result = subprocess.run(session_args, capture_output=True, text=True, timeout=5)
            if result.returncode != 0:
                return {"case": case, "error": result.stderr}
            try:
                found = wait_sample(trace)
                cap = subprocess.run(base + ["capture-pane", "-p", "-J", "-t", "race"], capture_output=True, text=True, timeout=3)
                subprocess.run(base + ["send-keys", "-t", "race", "C-d"], capture_output=True, timeout=3)
                extra = {"pane": cap.stdout[-2500:], "captureExit": cap.returncode}
            finally:
                subprocess.run(base + ["kill-server"], capture_output=True, timeout=3)
        if found:
            first = found[0]["at"]
            for item in found:
                item["ms"] = item.pop("at") - first
        return {"case": case, "mode": mode, "runtime": runtime, "delay_ms": delay, "offline": offline, "candidate_retry": retry, "delay_implicit_ms": delay_implicit, "barrier": barrier, "events": found, **extra}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", choices=CASES, default="project-owned")
    parser.add_argument("--mode", choices=["rpc", "tui"], default="rpc")
    parser.add_argument("--runtime", choices=["bolt", "stock"], default="bolt")
    parser.add_argument("--delay", type=int, default=0)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--retry", action="store_true")
    parser.add_argument("--delay-implicit", type=int, default=0)
    parser.add_argument("--barrier", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.case, args.mode, args.runtime, args.delay, args.offline, args.retry, args.delay_implicit, args.barrier), indent=2))


if __name__ == "__main__":
    main()
