#!/usr/bin/env python3
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
PI_INSTALL = "/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64"
RULES = ["fixture/*", "!fixture/keep", "!fixture/third"]

def model(mid):
    return {"id": mid, "name": mid, "reasoning": False, "input": ["text"], "contextWindow": 8192, "maxTokens": 1024}

def main():
    with tempfile.TemporaryDirectory(prefix="pi-filter-probe-") as tmp_name:
        tmp = Path(tmp_name)
        for item in ("home", "agent", "config", "cache", "data", "state", "runtime", "tmp", "project", "project/.pi", "pi-install"):
            (tmp / item).mkdir(parents=True, exist_ok=True)
        agent = tmp / "agent"
        (agent / "models.json").write_text(json.dumps({"providers": {"fixture": {"baseUrl": "https://fixture.invalid/v1", "apiKey": "$PROBE_KEY", "api": "openai-completions", "models": [model("hide"), model("keep"), model("third")]}}}))
        (agent / "filter-probe.json").write_text(json.dumps({"rules": RULES}))
        (tmp / "project/.pi/settings.json").write_text(json.dumps({"defaultThinkingLevel": "high"}))
        env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp / "home"), "PI_CODING_AGENT_DIR": str(agent), "XDG_CONFIG_HOME": str(tmp / "config"), "XDG_CACHE_HOME": str(tmp / "cache"), "XDG_DATA_HOME": str(tmp / "data"), "XDG_STATE_HOME": str(tmp / "state"), "XDG_RUNTIME_DIR": str(tmp / "runtime"), "TMPDIR": str(tmp / "tmp"), "TERM": "xterm-256color", "LC_ALL": "C", "PROBE_KEY": "dummy", "PI_OFFLINE": "1", "PI_SKIP_VERSION_CHECK": "1"}
        pi = str(tmp / "pi-install/pi")
        sandbox = ["bwrap", "--unshare-net", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--bind", str(tmp), str(tmp), "--ro-bind", PI_INSTALL, str(tmp / "pi-install"), "--tmpfs", "/home/furbyhaxx", "--chdir", str(tmp / "project"), "--"]
        print(f"# Temp root: {tmp}")
        print(f"# Base environment (env -i equivalent): {shlex.join([f'{k}={v}' for k, v in env.items()])}")
        print(f"# Sandbox prefix: {shlex.join(sandbox)}")
        network_check = sandbox + ["/usr/bin/python3", "-c", "import os; print('host-pi-state-visible=' + str(os.path.exists('/home/furbyhaxx/.pi'))); print('net-namespace=' + os.readlink('/proc/self/ns/net')); print(open('/proc/net/route').read(), end='')"]
        print("$ " + shlex.join(network_check))
        print(subprocess.run(network_check, env=env, check=True, text=True, capture_output=True, timeout=5).stdout)
        print(f"# models.json: {(agent / 'models.json').read_text()}")
        print(f"# filter-probe.json: {(agent / 'filter-probe.json').read_text()}")
        print(f"# project/.pi/settings.json: {(tmp / 'project/.pi/settings.json').read_text()}")
        def settings(provider="fixture", model_id="keep"):
            data = {"defaultProvider": provider, "defaultModel": model_id, "theme": "dark"}
            (agent / "settings.json").write_text(json.dumps(data))
            print(f"# settings.json: {json.dumps(data, sort_keys=True)}")
        def cmd(label, action, args, exts=("probe.ts",), openai=False, stdin=None, extra_env=None):
            run_env = dict(env, PROBE_ACTION=action)
            if openai:
                run_env["OPENAI_API_KEY"] = "dummy"
            if extra_env:
                run_env.update(extra_env)
            command = sandbox + [pi, "--offline", "--no-extensions"]
            for ext in exts:
                command += ["-e", str(HERE / ext)]
            command += list(args)
            print(f"\n## {label}")
            print(f"$ PROBE_ACTION={shlex.quote(action)}" + (" OPENAI_API_KEY=dummy" if openai else "") + (" " + shlex.join([f'{k}={v}' for k, v in extra_env.items()]) if extra_env else "") + " " + shlex.join(command))
            if stdin is not None:
                print(f"stdin: {stdin!r}")
            result = subprocess.run(command, env=run_env, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=25)
            print(f"exit: {result.returncode}\nstdout:\n{result.stdout}stderr:\n{result.stderr}")
            return result
        settings()
        discover = cmd("discover baseline", "discover", ["--list-models", "fixture"], openai=True)
        found = re.search(r"builtin-target=([^ ]+)", discover.stderr)
        if not found:
            raise RuntimeError("Discovery failed")
        target = found.group(1)
        extra_targets = json.loads(re.search(r"extra-targets=(\{.*\})", discover.stderr).group(1))
        cmd("builtin baseline", "discover", ["--list-models", target], openai=True)
        for provider, key in [("anthropic", "ANTHROPIC_API_KEY"), ("openrouter", "OPENROUTER_API_KEY")]:
            cmd(f"{provider} baseline", "discover", ["--list-models", extra_targets[provider]], extra_env={key:"dummy"})
            cmd(f"{provider} named config", "named", ["--list-models", extra_targets[provider]], extra_env={key:"dummy"})
        cmd("named config builtin", "named", ["--list-models", target], openai=True)
        cmd("named config models.json", "named", ["--list-models", "fixture"])
        cmd("extension-registered baseline", "discover", ["--list-models", "ephemeral"], exts=("ext-provider.ts", "probe.ts"))
        cmd("named config extension-registered", "named", ["--list-models", "ephemeral"], exts=("ext-provider.ts", "probe.ts"))
        cmd("native builtin", "native-builtin", ["--list-models", target], openai=True)
        cmd("native builtin filterAllModels only", "native-all-only", ["--list-models", target], openai=True)
        cmd("native custom", "native-custom", ["--list-models", "fixture"])
        cmd("native custom virtuals", "native-custom-virtual", ["--list-models", "virtual-hide"])
        cmd("native builtin virtuals", "native-builtin-virtual", ["--list-models", "virtual-hide"], openai=True)
        cmd("virtual register then unregister", "discover", ["--list-models", "virtual-extra"], exts=("virtual-register.ts", "virtual-remove.ts"))
        cmd("virtual unregister then register", "discover", ["--list-models", "virtual-extra"], exts=("virtual-remove.ts", "virtual-register.ts"))
        rpc = "\n".join(json.dumps(x) for x in [
            {"type":"get_state", "id":"state"},
            {"type":"set_model", "provider":"fixture", "modelId":"hide", "id":"set-hidden"},
            {"type":"cycle_model", "id":"cycle-1"},
            {"type":"cycle_model", "id":"cycle-2"},
            {"type":"cycle_model", "id":"cycle-3"},
        ]) + "\n"
        cmd("native custom RPC keep default, set hidden, cycle", "native-custom", ["--no-approve", "--no-session", "--mode", "rpc"], stdin=rpc)
        state = json.dumps({"type":"get_state", "id":"state"}) + "\n"
        cmd("native custom virtual filterAllModels", "native-custom-virtual", ["--no-approve", "--no-session", "--mode", "rpc"], stdin=state)
        cmd("native builtin filterAllModels only RPC", "native-all-only", ["--no-approve", "--no-session", "--mode", "rpc"], openai=True, stdin=state)
        settings("fixture", "hide")
        cmd("native custom hidden saved default", "native-custom", ["--no-approve", "--no-session", "--mode", "rpc"], stdin=state)
        cmd("catalog removed saved default", "discover", ["--no-approve", "--no-session", "--mode", "rpc"], exts=("ext-override.ts", "probe.ts"), stdin=state)
        settings()
        cmd("catalog removed explicit --model", "discover", ["--no-approve", "--no-session", "--mode", "rpc", "--model", "fixture/hide"], exts=("ext-override.ts", "probe.ts"), stdin=state)
        cmd("native custom hidden --model", "native-custom", ["--no-approve", "--no-session", "--mode", "rpc", "--model", "fixture/hide"], stdin=state)
        cmd("native builtin hidden --model", "native-builtin", ["--no-approve", "--no-session", "--mode", "rpc", "--model", f"openai/{target}"], openai=True, stdin=state)
        cmd("trust implicit pre-trust list", "discover", ["--list-models", "fixture"])
        cmd("trust approved", "discover", ["--approve", "--no-session", "--mode", "rpc"], stdin=state)
        cmd("trust rejected", "discover", ["--no-approve", "--no-session", "--mode", "rpc"], stdin=state)
        cmd("native order A then B", "discover", ["--list-models", "fixture"], exts=("ext-a.ts", "ext-b.ts"))
        cmd("native order B then A", "discover", ["--list-models", "fixture"], exts=("ext-b.ts", "ext-a.ts"))
        cmd("named override baseline", "discover", ["--list-models", "fixture"], exts=("ext-override.ts",))
        cmd("named override then native", "discover", ["--list-models", "fixture"], exts=("ext-override.ts", "ext-a.ts"))
        cmd("native then named override", "discover", ["--list-models", "fixture"], exts=("ext-a.ts", "ext-override.ts"))
        tui_env = dict(env, PROBE_ACTION="native-custom-virtual", TMUX_TMPDIR=str(tmp / "tmp"))
        sock = str(tmp / "tmux.sock")
        pi_command = sandbox + [pi, "--offline", "--no-extensions", "-e", str(HERE / "probe.ts"), "--no-approve", "--no-session"]
        terminal_command = ["tmux", "-S", sock]
        launch = terminal_command + ["new-session", "-d", "-x", "100", "-y", "30", "exec " + shlex.join(["timeout", "20"] + pi_command)]
        def tmux(*args):
            return subprocess.run(terminal_command + list(args), env=tui_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5, check=True).stdout
        print("\n## real TUI: /model and Ctrl+P")
        print("$ PROBE_ACTION=native-custom-virtual " + shlex.join(launch))
        try:
            subprocess.run(launch, env=tui_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5, check=True)
            time.sleep(1)
            print("$ tmux send-keys -l /model; tmux send-keys Enter")
            tmux("send-keys", "-l", "/model")
            tmux("send-keys", "Enter")
            time.sleep(1)
            print("--- pane /model ---\n" + tmux("capture-pane", "-p", "-S", "-100"))
            print("$ tmux send-keys Escape; wait; tmux send-keys C-p")
            tmux("send-keys", "Escape")
            time.sleep(0.5)
            tmux("send-keys", "C-p")
            time.sleep(0.5)
            print("--- pane after cycle ---\n" + tmux("capture-pane", "-p", "-S", "-100"))
        finally:
            subprocess.run(terminal_command + ["kill-server"], env=tui_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        builtin_env = dict(env, PROBE_ACTION="native-builtin", OPENAI_API_KEY="dummy", TMUX_TMPDIR=str(tmp / "tmp"))
        builtin_command = sandbox + [pi, "--offline", "--no-extensions", "-e", str(HERE / "probe.ts"), "--no-approve", "--no-session"]
        launch_builtin = terminal_command + ["new-session", "-d", "-x", "100", "-y", "30", "exec " + shlex.join(["timeout", "20"] + builtin_command)]
        print("\n## real TUI: builtin filtered /model")
        print("$ PROBE_ACTION=native-builtin OPENAI_API_KEY=dummy " + shlex.join(launch_builtin))
        try:
            subprocess.run(launch_builtin, env=builtin_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5, check=True)
            time.sleep(1)
            print(f"$ tmux send-keys -l /model; tmux send-keys Enter; wait; tmux send-keys -l {target}")
            subprocess.run(terminal_command + ["send-keys", "-l", "/model"], env=builtin_env, check=True, timeout=5)
            subprocess.run(terminal_command + ["send-keys", "Enter"], env=builtin_env, check=True, timeout=5)
            time.sleep(1)
            subprocess.run(terminal_command + ["send-keys", "-l", target], env=builtin_env, check=True, timeout=5)
            time.sleep(0.5)
            screen = subprocess.run(terminal_command + ["capture-pane", "-p", "-S", "-100"], env=builtin_env, check=True, timeout=5, text=True, stdout=subprocess.PIPE).stdout
            print("--- pane builtin /model ---\n" + screen)
        finally:
            subprocess.run(terminal_command + ["kill-server"], env=builtin_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        print(f"# cleanup: tmux servers stopped; temporary directory {tmp} removed by TemporaryDirectory")

if __name__ == "__main__":
    main()
