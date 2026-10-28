#!/usr/bin/env python3
from pathlib import Path
import json
import re

raw = (Path(__file__).resolve().parent / "raw-output-final.txt").read_text()
parts = re.split(r"^## (.+)$", raw, flags=re.MULTILINE)
sections = dict(zip(parts[1::2], parts[2::2]))
checks = []
def check(name, result):
    checks.append((name, bool(result)))

def has_row(section, provider, model):
    return bool(re.search(rf"^{re.escape(provider)}\s+{re.escape(model)}\s+", sections[section], re.MULTILINE))

first = re.search(r"builtin-target=([^ ]+)", sections["discover baseline"]).group(1)
extra = json.loads(re.search(r"extra-targets=(\{.*\})", sections["discover baseline"]).group(1))
check("all CLI commands exit zero", len(re.findall(r"^exit: 0$", raw, re.MULTILINE)) == 33 and not re.search(r"^exit: [1-9]|Traceback", raw, re.MULTILINE))
check("builtin baseline visible", has_row("builtin baseline", "openai", first))
check("named builtin hook ignored", has_row("named config builtin", "openai", first) and "NAMED-openai-chat received" not in sections["named config builtin"])
for provider in ("anthropic", "openrouter"):
    check(f"{provider} builtin named hook ignored", has_row(f"{provider} baseline", provider, extra[provider]) and has_row(f"{provider} named config", provider, extra[provider]) and f"NAMED-{provider}-chat received" not in sections[f"{provider} named config"])
check("named models.json hook ignored", has_row("named config models.json", "fixture", "hide") and "NAMED-fixture-chat received" not in sections["named config models.json"])
check("named extension hook ignored", has_row("named config extension-registered", "ephemeral", "hide") and "NAMED-ephemeral-chat received" not in sections["named config extension-registered"])
check("native builtin filters listing", not has_row("native builtin", "openai", first) and "NATIVE-openai-chat received=" in sections["native builtin"])
check("filterAllModels alone does not filter chat listing", has_row("native builtin filterAllModels only", "openai", first) and "available-target=true alltypes-target=false" in sections["native builtin filterAllModels only RPC"])
check("ordered native rules hide and restore", not has_row("native custom", "fixture", "hide") and has_row("native custom", "fixture", "keep") and has_row("native custom", "fixture", "third"))
check("native virtual rules are bypassed", has_row("native custom virtuals", "fixture", "virtual-hide") and has_row("native builtin virtuals", "openai", "virtual-hide"))
check("all-types hook also bypasses virtual", "fixture-alltypes=keep,third,virtual-hide" in sections["native custom virtual filterAllModels"])
check("unregister virtual ordering matters", not has_row("virtual register then unregister", "virtual-extra", "hidden") and has_row("virtual unregister then register", "virtual-extra", "hidden"))
check("RPC set denies filtered, cycle excludes it", '"id":"set-hidden","type":"response","command":"set_model","success":false' in sections["native custom RPC keep default, set hidden, cycle"] and '"id":"cycle-1","type":"response","command":"cycle_model","success":true,"data":{"model":{"id":"third"' in sections["native custom RPC keep default, set hidden, cycle"])
check("hidden saved default still selected", "selected=fixture/hide" in sections["native custom hidden saved default"])
check("hidden custom --model still selected", "selected=fixture/hide" in sections["native custom hidden --model"])
check("hidden builtin --model still selected", f"selected=openai/{first}" in sections["native builtin hidden --model"])
check("removed default falls back", "selected=fixture/extension-only" in sections["catalog removed saved default"])
check("removed explicit ID reconstructed", "selected=fixture/hide" in sections["catalog removed explicit --model"] and "Using custom model id" in sections["catalog removed explicit --model"])
check("factory cannot read context", "typeof-isProjectTrusted=undefined" in sections["trust approved"] and "Extension runtime not initialized" in sections["trust approved"])
check("trust differs in session", "SESSION trusted=true" in sections["trust approved"] and "SESSION trusted=false" in sections["trust rejected"])
check("native last writer wins", has_row("native order A then B", "fixture", "hide") and not has_row("native order A then B", "fixture", "keep") and not has_row("native order B then A", "fixture", "hide") and has_row("native order B then A", "fixture", "keep"))
check("native loses named provider settings in either order", has_row("named override baseline", "fixture", "extension-only") and not has_row("named override then native", "fixture", "extension-only") and not has_row("native then named override", "fixture", "extension-only"))
tui = sections["real TUI: /model and Ctrl+P"]
check("TUI selector and Ctrl+P", "virtual-hide [fixture]" in tui and "third [fixture]" in tui and not re.search(r"^\s*hide \[fixture\]", tui, re.MULTILINE) and "Switched to third" in tui)
builtin_tui = sections["real TUI: builtin filtered /model"]
check("builtin TUI omits exact target", "[openai]" in builtin_tui and not re.search(rf"^\s*(?:→\s*)?(?:✓\s*)?{re.escape(first)}\s+\[openai\]", builtin_tui, re.MULTILINE))
failed = [name for name, passed in checks if not passed]
for name, passed in checks:
    print(("PASS " if passed else "FAIL ") + name)
print(f"{len(checks) - len(failed)}/{len(checks)} assertions passed")
if failed:
    raise SystemExit(1)
