---
version: 1
id: "search-tool-terminal-2026-10-29"
title: "Search terminal QA"
description: "Offline Synthetic renderer acceptance."
type: "analysis"
created: "2026-10-29T20:22:26+01:00"
updated: "2026-10-29T20:23:56+01:00"
createdBy: "search-tool-terminal-qa"
updatedBy: "search-tool-terminal-qa"
document:
  type: "analysis"
  id: "search-tool-terminal-2026-10-29"
  title: "Search terminal QA"
  description: "Offline Synthetic renderer acceptance."
  status: "published"
  revision: 1
  created_at: "2026-10-29T20:22:26+01:00"
  updated_at: "2026-10-29T20:23:56+01:00"
  created_by: "search-tool-terminal-qa"
  updated_by: "search-tool-terminal-qa"
  changelog:
    - revision: 1
      summary: "Record terminal acceptance."
---

# Search terminal QA
status: "qa-complete"  
confidence: "high"

## Reproduction and matrix

Pi-Bolt 1.4.0; fresh HOME/agent/XDG/cwd, `env -i`, `bwrap --unshare-net`. Faux stream/transport invoke production execute/renderer. [Commands](captures/commands.txt), [fixture](captures/fixture.ts.txt), [screens/events](captures/).

`tmux -S [PRIVATE_TMP]/tmux.sock resize-window -t normal:0 -x 80 -y 36`

Production membership off→on→off; flag on. Running, three results/0600, empty, 503, parse/network/auth/disabled, Escape abort; dark/light, 36/57/80/140, short rows, collapsed/expanded.

## Defects

1. **Minor, truncation:** At 36, [ordinary](captures/dark-new-collapsed-36x12.txt) and [truncated](captures/truncate-new-collapsed-36x12.txt) collapsed rows match; warning disappears. `src/families/synthetic/search-renderer.ts:90-117`. Prioritize warning; test both.
2. **Minor, path:** Expand at 80: [path](captures/fullpath-normal-80x36.txt) is ellipsized; expected copyable full path. `src/families/synthetic/search-renderer.ts:224-230`. Wrap; test widths.
3. **Minor, endpoint:** Expanded [503](captures/http-expanded-140x36-confirmed.txt) omits endpoint despite [content](captures/http-new-events.jsonl). `src/families/synthetic/search-renderer.ts:161-185`. Show endpoint; test both states.

## Gaps / cleanup

No live endpoint, timeout or contrast test. Preliminary `pi-bolt --help` ran unsandboxed; effects unverified. Scratch and owned processes removed; search source unchanged. BLOCKERS: none.
