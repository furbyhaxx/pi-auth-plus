#!/usr/bin/env python3
"""---
document:
  type: "analysis"
  id: "analysis-rpc-catalog-retry-network-trace"
  title: "Catalog retry network trace"
  description: "Check representative isolated runs for IP socket activity."
  status: "published"
  revision: 2
  version: 1
  created: "2026-10-28T15:41:53+01:00"
  updated: "2026-10-28T15:45:36+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T15:41:53+01:00"
  updated_at: "2026-10-28T15:45:36+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Trace representative runs for IP activity"]
    - revision: 2
      reason: "probe refinement"
      changes: ["Classify local Unix-socket connections"]
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
probe = ["python3", str(HERE / "run.py"), "--runtime", args.runtime]
if args.picker:
    probe += ["--case", "none", "--candidate", "--action", "picker", "--fail-first", "--sample-ms", "3500"]
else:
    probe += ["--case", "project-both", "--candidate", "--delay-implicit", "200"]
with tempfile.TemporaryDirectory(prefix="retry-strace-") as scratch:
    trace = Path(scratch) / "network.log"
    result = subprocess.run(["/usr/bin/strace", "-f", "-e", "trace=network", "-o", str(trace), *probe], capture_output=True, text=True, timeout=20)
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
