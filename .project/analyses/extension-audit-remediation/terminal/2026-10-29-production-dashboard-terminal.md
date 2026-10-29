---
version: 1
id: "production-dashboard-terminal-2026-10-29"
title: "Production dashboard terminal acceptance"
description: "Live isolated Pi-Bolt acceptance of the integrated auth dashboard."
type: "analysis"
created: "2026-10-29T19:53:25+01:00"
updated: "2026-10-29T19:53:25+01:00"
createdBy: "production-terminal-acceptance"
updatedBy: "production-terminal-acceptance"
document:
  type: "analysis"
  id: "production-dashboard-terminal-2026-10-29"
  title: "Production dashboard terminal acceptance"
  description: "Live isolated Pi-Bolt acceptance of the integrated auth dashboard."
  status: "published"
  revision: 1
  created_at: "2026-10-29T19:53:25+01:00"
  updated_at: "2026-10-29T19:53:25+01:00"
  created_by: "production-terminal-acceptance"
  updated_by: "production-terminal-acceptance"
  changelog:
    - revision: 1
      summary: "Record isolated production terminal acceptance."
---

# Production dashboard terminal acceptance

status: qa-complete  
confidence: high for the observed offline UI interactions

## Summary

No defects were observed in the requested offline terminal pass. Settings, the shared model picker,
nested editors, scoped saves, recovery feedback, rebinding and cross-tab draft confirmation were
exercised as interactive Pi-Bolt users. The unavailable-member and unknown-quota best-effort states
were both observed. Captures are terminal text, not mocked renderer output. They do not establish live
provider endpoint or model availability.

## Environment and reproduction

- Started with HEAD `cdace1751accdd724b9a6da281152849c5fb0cb3`; production source was clean
  against that commit. During the pass another agent advanced HEAD to
  `e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60`, changing only four test files. At completion,
  `git diff cdace1751accdd724b9a6da281152849c5fb0cb3 -- src` was empty, so the tested production
  source remained the requested version. The concurrently modified plan and untracked `.pi/` and
  other analysis artifacts were not touched.
- Pi-Bolt `1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`; Bun `1.4.3`; tmux `3.8`.
- Separate private `mktemp` roots supplied empty working directories and private `HOME`,
  `PI_CODING_AGENT_DIR`, and XDG cache/config/state/data directories. No real credentials or Pi
  settings were copied. Each process was bounded by `timeout` and launched inside a uniquely
  owned tmux server/session. The command shape, with actual private paths substituted, was:

  ```sh
  timeout 1800s env -i HOME="$scratch/home" PATH="$PATH" TERM=xterm-256color \
    PI_CODING_AGENT_DIR="$scratch/agent" XDG_CACHE_HOME="$scratch/cache" \
    XDG_CONFIG_HOME="$scratch/config" XDG_STATE_HOME="$scratch/state" \
    XDG_DATA_HOME="$scratch/data" pi-bolt --no-session -ne --offline \
    --use-theme dark -e /mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts
  ```

  The light invocation used `--use-theme light` and a separate private agent directory and empty
  cwd. An additional fresh dark invocation used the same flags and `timeout 900s` to verify
  applying the appearance preferences. No preview implementation was loaded.
- Private `keybindings.json` placed rebound keys first, retaining defaults as secondary keys:
  up `alt+k`/`up`, down `alt+j`/`down`, page up `alt+u`/`pageUp`, page down
  `alt+d`/`pageDown`, confirm `ctrl+g`/`enter`, cancel `ctrl+x`/`escape`, tab `ctrl+t`/`tab`.
  Commands were typed with `tmux send-keys`; sizes changed with `tmux resize-window -x W -y H`;
  screens were read using `tmux capture-pane -p`. `F1` was the displayed global Help key.
- Capture output was sanitized in memory before writing: private scratch paths replaced with
  `[PRIVATE_TMP]` and common credential-shaped fields/tokens redacted. The process environment
  had no copied credentials. Plain-text evidence is in `captures/`. ANSI SGR values were also
  compared in memory: the Settings capture had dark foreground `38;5;145m` and light foreground
  `38;5;60m`, confirming the two runtime themes differed. These values are not a contrast audit.
- Both sets of private tmux sessions and scratch directories were stopped and removed. No
  process or server was left running. Pi's accidental temporary external editor was exited
  without saving, and its own temporary directory was gone after exit.

## Test matrix

| Surface / scenario | Observed result | Captures |
|---|---|---|
| Providers at 140x40, 80x24, 57x12, 36x12 and 36x8, dark and light | Rendered and resized at every specified size; primary provider state remained reachable. | `01`–`05`, `116`–`120` |
| Settings, dark/light; rebound movement and confirm | Inline number `0 → 2` and a provenance toggle staged; light Settings also resized at the four widths. | `06`–`10`, `121`–`126` |
| Settings collection editors | Quota provider list toggled two choices and applied to Settings. A literal rewrite was entered as `Alpha → Beta` and applied. | `11`–`23` |
| Appearance settings applied | Staged density Compact, provenance on and matched-rule on; saved runtime. Compact chrome changed, the catalog displayed `hidden · rule 1`, and model detail displayed source/default and matched-rule data. Saving maximum body rows `2` changed the panel to the configured short body. | `159`–`165` |
| Wide Settings label and short text edit | At 140 columns the full 29-character `Refresh quotas after requests` label appeared without ellipsis while a short `QA Short` quota-template string was being edited. Cancel restored the old text. | `131`–`134` |
| Models | Added `opencode/*` rule; preview reported 83 hidden; `v` opened catalog. Rebound `alt+d` advanced 1–25 to 26–50. Search by the exact catalog identity shown in `28`; at 36x12 `?` displayed the wrapped identity and `F1` Help showed the remainder and rebound keys. | `24`–`35` |
| Model override and alias drafts | Opened physical model detail, staged name `QA short`, opened a new alias and staged ID `qa-short`. `ctrl+c` opened global discard; `ctrl+x` kept alias. Local discard of alias left the override staged; local discard of override returned to the catalog with the rule retained. | `36`–`48` |
| Groups physical picker and member editor | Added `qa-route`, chose the searched catalog model through the shared picker, used `?` and `F1`, edited tier `2`, cost `included` and map `low=high`, then staged. Without credentials the synthetic member was shown unavailable, not routable. | `49`–`56` |
| Unknown quota | Added `qa-best-effort` with the first anonymous OpenCode free model from the local picker and staged it. The group displayed `1 unknown` and `unknown · best-effort`; this observes UI classification, not an actual routed request. | `135`–`142`, `154` |
| Cross-tab Escape/Ctrl+C and local discard | With Settings, model rule and group staged, Escape opened `Discard all & exit?`; Help exposed `ctrl+g discard`/`ctrl+x keep`. Keeping preserved all three. Confirming global discard and reopening showed no rule, no group and the shown Settings values reset to their defaults. Quota scope separately survived global keep and local keep, then discarded locally without losing the other tabs. | `57`–`62`, `79`–`84`, `104`–`106`, `143`–`148`, `154`–`157` |
| Quotas placement/scopes and shadowing | `p` opened placement; changing it and confirming opened the runtime/user/project chooser. Saved a runtime value, then a different value to user: `Saved to user scope; shadowed by higher scope: quotas.linePlacement`. At 36x12 Help exposed the complete feedback. | `85`–`99`, `149`–`153` |
| Save failure / retained draft | In the private agent directory only, replaced its own saved `auth-plus.json` with invalid JSON, then saved a staged density change to user. The UI retained `Compact · staged` and displayed `Cannot save … file is not valid JSON; fix it and retry`. At 36x12 F1 Help exposed the full recovery. | `107`–`115` |
| Full Help at 36x12 | Model identity wraps over pages. Help exposes rebound movement/page/confirm/cancel, Settings save and scope keys, discard/keep keys, full long validation feedback and recovery, and the shadow warning. The picker's `?` inspection and global `F1` remained distinct. | `30`–`35`, `58`–`60`, `70`–`78`, `89`–`90`, `109`–`113`, `149`–`153` |
| Tokens/report | Tokens displayed context totals and full-request breakdown; at 57x12 rebound down scrolled from Provider/Model/Total to Model/Total/Context. | `100`–`103` |

For the relation-validation recovery, Settings `Critical credit (USD)` was staged as `55` while
healthy remained `50`, followed by `ctrl+s`, `r`. Help showed both setting keys and `critical must
be strictly less than healthy; adjust them and retry` (`74`–`77`). This also confirmed that rejected
runtime saving kept the staged value. Shrink-wrapped panel height is intentional and is not a
finding.

## Defect list

None observed in the exercised scenarios.

## Open questions / follow-ups

- No full test suite, live provider call, authenticated model request, quota endpoint refresh or
  count endpoint probe was performed. Those are outside this offline UI pass.
- The project scope was displayed as a choice, but a trusted-project save was not performed; the
  working directories were deliberately empty and isolated. Runtime and user saves were exercised.
- Theme contrast was not measured, and captured text has no color attributes. The runtime SGR
  comparison above establishes that both theme selections took effect, not that every color meets
  an accessibility contrast target.
