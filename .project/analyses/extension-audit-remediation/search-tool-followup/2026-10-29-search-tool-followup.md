---
version: 1
id: "synthetic-search-terminal-followup-2026-10-29"
title: "Synthetic search terminal follow-up"
description: "Offline live-terminal recheck of renderer corrections and request timeout."
type: "analysis"
created: "2026-10-29T21:03:57+01:00"
updated: "2026-10-29T21:04:55+01:00"
createdBy: "search-tool-terminal-qa"
updatedBy: "search-tool-terminal-qa"
document:
  type: "analysis"
  id: "synthetic-search-terminal-followup-2026-10-29"
  title: "Synthetic search terminal follow-up"
  description: "Offline live-terminal recheck of renderer corrections and request timeout."
  status: "published"
  revision: 1
  created_at: "2026-10-29T21:03:57+01:00"
  updated_at: "2026-10-29T21:04:55+01:00"
  created_by: "search-tool-terminal-qa"
  updated_by: "search-tool-terminal-qa"
  changelog:
    - revision: 1
      summary: "Record live renderer follow-up."
---

# Synthetic search terminal follow-up
status: "qa-complete"  
confidence: "high" for the exercised offline states

## Reproduction

Pi-Bolt `1.4.0 (Pi-Bolt 1.0.7)` ran in tmux with fresh private HOME, agent, XDG, cwd and dummy credentials. Each process used `env -i`, `--offline`, and `bwrap --unshare-net`. The previous faux stream/provider and injected fake fetch called production `registerWebSearch`; no live model or search endpoint was contacted. Tested source SHA: `acf5d07bd7ac8e5e2a2f9ca2e7d21c8ca341958b`. HEAD advanced to `e30a0ba189a70cbea4b3e2a98bdf5425262566c5`; relevant Synthetic, HTTP, filesystem, redaction and frame sources did not change.

Exact redacted terminal launch, send, resize and capture commands are in `captures/commands.txt`; companion and driver snapshots and private output-padding controls are alongside. Example: `tmux -S [PRIVATE_TMP]/tmux.sock resize-window -t d1-t:0 -x 36 -y 42`. Actual paths were compared in private scratch before screen path fragments were replaced with `[PATH PART]` in persistent captures.

## Test matrix and defects

All **72/72** observational checks passed; the three earlier defects did not reproduce:

- Collapsed states differed in **20/20** checks: ten truncated results showed the complete `truncated` warning and ten ordinary results did not. `captures/d1-s-collapsed-36x42.txt` and `captures/d1-t-collapsed-36x42.txt` show the narrow case.
- Expanded production `fullOutputPath` reconstructed byte-for-byte without ellipsis in **20/20** checks, for both ordinary and truncated results; see `captures/checks.json` and `captures/d1-s-expanded-36x42.txt`. Mode 0600 and complete fixture bodies are recorded in `captures/d1-s-events.jsonl`.
- Expanded HTTP 503 exposed status, endpoint and recovery in **10/10** checks; see `captures/d1-h-expanded-36x42.txt`.
- The real 60,000 ms production deadline aborted the unresolved, socket-free fixture after **60,001 ms**, returning structured `code: timeout`; `captures/timeout-events.jsonl` and `captures/timeout-expanded-80x24.txt` show the event and UI.

The full width matrix 36/57/80/140 ran with dark/padding 1 and light/padding 0; dark/padding 0 and light/padding 1 were additionally checked at 36. Padding checks passed **20/20**. At 36×8 the transcript initially hid the warning below the viewport; three PageUp presses exposed it (`captures/d1-t-collapsed-36x8-scroll3.txt`). The 36×12 warning was directly visible. There are **67 text screens, 2 ANSI screens, 13 event logs**, and `captures/checks.json`.

## Gaps and cleanup

This validates local Pi rendering and production execution against fake transport, not a live Synthetic endpoint. Theme contrast and real provider credentials were not tested; no full suite, build, install, or account operation ran. The first harness attempt failed because a bare tmux target selected the wrong session; explicit session targets fixed it before the successful run. All 13 owned tmux sessions, sandbox processes and follow-up scratch were removed. Original search-tool evidence and product source were not edited. BLOCKERS: none.
