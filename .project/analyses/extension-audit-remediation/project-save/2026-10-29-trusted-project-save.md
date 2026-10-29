---
version: 1
id: "trusted-project-save-2026-10-29"
title: "Trusted project save live acceptance"
description: "Isolated Pi-Bolt terminal acceptance of project-scoped settings persistence and trust."
type: "analysis"
created: "2026-10-29T20:09:19+01:00"
updated: "2026-10-29T20:22:59+01:00"
createdBy: "production-terminal-acceptance"
updatedBy: "production-terminal-acceptance"
document:
  type: "analysis"
  id: "trusted-project-save-2026-10-29"
  title: "Trusted project save live acceptance"
  description: "Isolated Pi-Bolt terminal acceptance of project-scoped settings persistence and trust."
  status: "published"
  revision: 2
  created_at: "2026-10-29T20:09:19+01:00"
  updated_at: "2026-10-29T20:22:59+01:00"
  created_by: "production-terminal-acceptance"
  updated_by: "production-terminal-acceptance"
  changelog:
    - revision: 1
      summary: "Record trusted-project terminal acceptance."
    - revision: 2
      summary: "Record the concurrent post-run token display change."
---

# Trusted project save live acceptance

status: "qa-complete"  
confidence: "high" for the observed isolated terminal interactions

## Summary

No defect was observed. Pi's `/trust` UI saved trust for exactly the private project, after which
an explicit project-scope save wrote the intended setting. A runtime override remained effective
and the project-save feedback reported shadowing. The non-default project value was restored after
process restart while the distinct user-scope file remained byte-for-byte unchanged. An explicitly
untrusted private project rejected the same operation and created no project settings file.

## Environment and exact launch

- Pi-Bolt `1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`, Bun `1.4.3`, tmux `3.8`.
- The initial workspace HEAD was `fc6af03a1da687dddc257f00982550709f0d1460`. Concurrent
  integration advanced it to `8712aaa` at 20:18:16 and `070353b114e0fc0e009a55402807603686cace46`
  at 20:19:53 Europe/Zurich. Initial trust/untrusted captures preceded the first advance; the first
  project-save captures used the intermediate source. The rejection, runtime-shadow/project-save,
  and post-restart checks were then repeated from a fresh process on `070353b`; HEAD was recorded
  as `070353b` immediately before and after that repeat. The intervening changes were the shutdown
  deadline and an optional token-count type boundary, respectively; no source was changed by this
  QA run. After the repeat completed, HEAD advanced again to
  `a9f66e013814ff196976e3118213050646956dd3` at 20:21:46, changing token types and the Tokens
  dashboard. The project-save flow was not rerun on that later commit.
- A private `mktemp -d /tmp/projectsave-qa-XXXXXX` root contained separate empty
  `cwd-trusted` and `cwd-untrusted`, plus private `agent`, `home`, `cache`, `config`, `state`,
  and `data` directories, all mode 0700. No credentials or existing Pi settings were copied.
- The trusted process was launched in an owned tmux session with cwd set to `cwd-trusted`:

  ```sh
  timeout 1200s env -i HOME="$scratch/home" PATH="$PATH" TERM=xterm-256color \
    PI_CODING_AGENT_DIR="$scratch/agent" XDG_CACHE_HOME="$scratch/cache" \
    XDG_CONFIG_HOME="$scratch/config" XDG_STATE_HOME="$scratch/state" \
    XDG_DATA_HOME="$scratch/data" pi-bolt --no-session -ne --offline \
    --use-theme dark -e /mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts
  ```

  The untrusted process used the same command with `--no-approve` and cwd `cwd-untrusted`.
  Each restart created a new Pi-Bolt process with the same private agent and trusted cwd.
- Private `keybindings.json` used up `alt+k`/`up`, down `alt+j`/`down`, page up
  `alt+u`/`pageUp`, page down `alt+d`/`pageDown`, confirm `ctrl+g`/`enter`, cancel
  `ctrl+x`/`escape`, and tab `ctrl+t`/`tab`. `tmux send-keys`, `resize-window -x W -y H`,
  and `capture-pane -p` drove the real TUI. Private paths and credential-shaped strings were
  sanitized in memory before writing the terminal captures under `captures/`.

## Test matrix and observed results

| Scenario | Exact interaction and evidence | Result |
|---|---|---|
| Explicit untrusted rejection | Start with `--no-approve`; `/auth`, `ctrl+t`, `p`, move to Above editor, `ctrl+g`, `p`. | `Save failed: Project settings are unavailable until the project is trusted`; the project file remained absent. Repeated on `070353b`: `46`–`47`. Initial run: `03`–`09`. |
| Trust only the private project | In the trusted cwd enter `/trust`, select `Trust` rather than `Trust parent folder`, and press `ctrl+g`; restart. | `/trust` reported `Saved decision: trusted ([PRIVATE_TMP]/cwd-trusted)` and `Current session: trusted`. Private `trust.json` had only that cwd mapped to `true`: `11`–`13`, `34`, `56`. |
| Establish lower user layer | `/auth`, `ctrl+t`, `p`, move to Below editor, last, `ctrl+g`, `u`. | User file contained `quotas.linePlacement = below-editor-last`: `14`–`15`, `56`. A private byte copy was retained for comparison. |
| Save project layer | With the user value active, `p`, select Above editor, `ctrl+g`, `p`. | `Saved to project scope`; private `.pi/auth-plus.json` contained `quotas.linePlacement = above-editor`. User file was byte-identical to the copy: `16`–`23`. |
| Higher runtime shadow | From the project value, `p`, select Off, `ctrl+g`, `r`. Then use `p` to save Below editor, first to project and later Above editor to project. | The live placement remained `off`; feedback said `Saved to project scope; shadowed by higher scope: quotas.linePlacement`. `F1` exposed the full feedback at 36 columns. Repeated on `070353b`: `48`–`51`. Earlier width/Help captures: `24`–`33`, `40`–`41`. |
| Process restart | Stop only the owned trusted session and start a new process with the same private cwd/agent; `/auth`, switch to Settings, select Quota line placement. | Settings showed `Above editor` with source `project`, distinct from default `below-editor-first` and user `below-editor-last`. Project file was byte-identical before/after restart; the user file remained byte-identical since before the project save: `52`–`56`. |
| Widths and rebound keys | Resize the project scope chooser, shadow feedback, and post-restart Settings using 140x40, 80x24, 57x12, 36x12. | Each size was observed live. The chooser remained operable with the rebound keys; at 36x12 `F1` exposed the entire shadow warning: `17`–`20`, `27`–`32`, `52`–`55`. |

The final private file-state checks, captured after the latest-source restart, were:

```text
project auth-plus.json: {"quotas": {"linePlacement": "above-editor"}}
user auth-plus.json: {"quotas": {"linePlacement": "below-editor-last"}}
private trust.json: {"[PRIVATE_TMP]/cwd-trusted": true}
project byte-for-byte unchanged after restart: True
user byte-for-byte unchanged since before project save: True
untrusted project file absent: True
```

## Defect list

None observed in the exercised scenarios.

## Open questions / follow-ups

- The rejection case used Pi's explicit `--no-approve` mode. An interactive decline of a startup
  trust prompt was not separately exercised.
- The post-run `a9f66e0` token display change was not rerun in this project-save QA unit. This was
  an offline UI and persistence check; no live provider call, credential use or full test suite was
  performed. Terminal colors and contrast were not assessed.
- All owned tmux sessions and timeout processes were stopped; the private scratch root, including
  its trust decision and settings, was removed. The existing repository `.pi`, real agent state,
  previous terminal report, source and test files were not modified by this run.
