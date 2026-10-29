#!/usr/bin/env python3
"""---
document:
  type: "analysis"
  id: "analysis-rpc-startup-delay-network"
  title: "Startup delay probe network syscall check"
  description: "Trace representative isolated RPC and picker child processes."
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
      changes: ["Check representative isolated host invocations"]
---"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--runtime", choices=["bolt", "stock"], required=True)
parser.add_argument("--picker", action="store_true")
args = parser.parse_args()
command = ["python3", str(HERE / "run.py"), "--runtime", args.runtime, "--prototype", "delay"]
if args.picker:
    command += ["--case", "none", "--mode", "picker", "--sample-ms", "4000"]
else:
    command += ["--case", "both", "--implicit-delay", "700", "--sample-ms", "2500"]
with tempfile.TemporaryDirectory(prefix="startup-delay-strace-") as scratch:
    trace = Path(scratch) / "network.log"
    result = subprocess.run(["/usr/bin/strace", "-f", "-e", "trace=network", "-o", str(trace), *command], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr[-1000:])
    capture = json.loads(result.stdout)
    if args.picker:
        assert capture["pickerFetchObserved"]
    else:
        assert capture["exit"] == 0
    lines = trace.read_text().splitlines()
    internet = [line for line in lines if "AF_INET" in line]
    connects = [line for line in lines if "connect(" in line]
    unix = [line for line in connects if "AF_UNIX" in line]
    print(f"{args.runtime} {'picker' if args.picker else 'rpc'}: IP-family network syscalls={len(internet)}, connect syscalls={len(connects)}, AF_UNIX connects={len(unix)}")
    if internet:
        raise RuntimeError("Unexpected IP-family activity")
