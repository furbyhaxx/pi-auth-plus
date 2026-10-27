---
document:
  type: "analysis"
  id: "flexible-templates-terminal-qa"
  title: "Live terminal QA of the quota template line and settings preview"
  description: "Pi-Bolt/tmux QA of the one-template quota line and settings preview at 36/57/80/140 columns, dark and light themes, regular and fullscreen, short heights, overflow markers and a deliberately tall template."
  status: "published"
  revision: 2
  created_at: "2026-10-26T15:54:34+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "analyst"
  updated_by: "pi"
  source: "pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/analyses/flexible-templates/qa.md"
  changelog:
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/analyses/flexible-templates/qa.md"]
---

# Live terminal QA: quota template line and settings preview

status: "qa-complete"
confidence: "high"

## Summary

- The production entrypoint `src/index.ts` loads in Pi-Bolt 1.4.0 against the seeded
  isolated agent dir. The single `lineTemplate` renders all seven providers at 36, 57, 80
  and 140 columns, with short IDs below the 100-column compact threshold, the codex reset
  badge `(1r)`, and no badge for synthetic/xai (reset count 0).
- The custom token style `{claude:id|fg=#cba6f7,bold}` paints only the Claude identity;
  adjacent percentages keep their gradient stress colours, in the line and in the settings
  preview, in dark and light themes.
- The current settings preview (full width, separate paging label) reproduces the real
  line's wrapping: 4/3/2/1 rows at 36/57/80/140 columns, paging reaches `xai` on the last
  row, and PageUp/PageDown work in list and edit mode.
- Post-fix recheck (16:05): at 36x16 the panel header and all four default quota rows are
  visible for `below-editor-first`, `below-editor-last` and `above-editor`, the preview
  reaches 4/4, and the light theme behaves the same. At 36x8 the default line collapses to
  `… /quota settings (4 rows)` with a usable editor and a reduced but complete panel frame.
- A deliberately tall template (20 segments, 2477 chars) renders 7 rows plus
  `… /quota settings (20 rows)` at 36x16, keeps the editor usable, pages the settings
  preview 1/20 to 20/20 (the preview renders the unbounded rows, so page 20 is the last
  provider row), shows all 5 rows at 140x24, and restores the marker when resized back to
  36x16.
- All four height defects are resolved on evidence. In fullscreen the header and the bottom
  hint are both visible at 36x16 and 140x24; Ctrl+PageDown/Ctrl+PageUp page the preview to
  4/4 and back in list and edit mode without changing the template text; a 20-row template
  reaches page 20/20 in fullscreen. The regular 36x8 marker behaviour still holds.
- Malformed `quotas.json`: boot warning names the file and parse error, defaults apply, and
  a save is rejected with `Cannot save …; fix the existing settings file and retry` while
  the staged change is retained and the file is left untouched.

## Environment and commands

- Pi-Bolt `1.4.0` (Pi-Bolt 1.0.3, linux-x64, JIT off), tmux `3.8`, Bun `1.4.3`.
- Agent dir `/tmp/quota-template-qa-xzWBga` (seed script `/tmp/quota-template-qa-seed.ts`),
  cwd `/tmp/quota-qa-cwd`, `inFlightUntil` set for every provider, no credentials.
- Session command, one tmux session per state:

```bash
PI_CODING_AGENT_DIR=/tmp/quota-template-qa-xzWBga pi-bolt --no-session -ne --offline \
  --no-skills --no-prompt-templates --no-context-files --no-mcp --no-approve \
  -e /mnt/Projects/furbyhaxx/pi-quotas/src/index.ts \
  --use-theme dark --tui-mode regular
```

- Captures: `tmux capture-pane -p` (plain) and `-p -e` (ANSI), kept beside this file under
  `captures/terminal/`.
- Revisions used. Line evidence comes from `src/render/line.ts` sha256 `add0e153…` and
  `src/render/template.ts` `7fad83e8…` (unchanged from 15:21/15:40). Panel and preview
  evidence comes from `src/ui/settings.ts` sha256 `562de31c…` (mtime 15:47:04) and
  `src/ui/panel.ts` `7e709f41…` (mtime 15:50:45). The `panel.ts` delta against the build
  used for the height sweeps only wraps the `p` placement save in `.catch`; `bodyHeight()`
  and `render()` are unchanged, so the height results carry over. Sessions started before
  15:47:04 are not used for preview or panel claims.

## Post-fix recheck (16:05)

Revision: `src/runtime.ts` `f49b24c4…` (15:58:56), `src/render/line.ts` `04380ad8…`
(15:58:46), `src/ui/panel.ts` `c9c9dd92…` (15:59:12), `src/ui/settings.ts` `500414af…`
(15:59:51). Height budget now: `limitQuotaRows` (`src/render/line.ts:8-20`) caps the widget
at `terminalRows - 8` rows and replaces the tail with `… /quota settings (N rows)`;
`QuotaInteractivePanel.availableHeight` (`src/ui/panel.ts:115-118`) subtracts the mounted
quota row count plus 2 footer rows; `QuotaSettings.render` (`src/ui/settings.ts:238,289-291`)
treats that as the exact total and drops the description below 7 rows and the bottom rule
below 6.

| Recheck | Result | Evidence |
| --- | --- | --- |
| 36x16 below-editor-first: header, 4 quota rows, preview 4/4 | pass | `postfix-36x16-belowfirst-settings.txt`, `postfix-36x16-belowfirst-preview-4of4.txt` |
| 36x16 above-editor: header, 4 quota rows, preview 4/4 | pass | `postfix-36x16-above-line.txt`, `postfix-36x16-above-settings.txt`, `postfix-36x16-above-preview-4of4.txt` |
| 36x16 below-editor-last: header, 4 quota rows, preview 4/4 | pass | `postfix-36x16-belowlast-settings.txt`, `postfix-36x16-belowlast-preview-4of4.txt` |
| 36x16 light: header, 4 quota rows, preview 4/4 | pass | `postfix-light-36x16-line.txt`, `postfix-light-36x16-settings.txt`, `postfix-light-36x16-preview-4of4.txt` |
| 36x8 default: single marker, editor usable, panel reduced but complete | pass | `postfix-36x8-line-marker.txt`, `postfix-36x8-settings.txt` |
| 36x16 fullscreen line | pass | `postfix-fullscreen-36x16-line.txt` |
| Fullscreen panel (36x16 and 140x24) | pass (after the fullscreen fix, see below) | `postfix2-fullscreen-36x16-settings.txt`, `postfix2-fullscreen-140x24-settings.txt` |
| Tall template 36x16: 7 rows + `(20 rows)` marker, editor accepts text | pass | `postfix-tall-36x16-line.txt`, `postfix-tall-36x16-editor-typed.txt` |
| Tall template preview 1/20 to 20/20, final page is the 20th provider row | pass | `postfix-tall-36x16-settings.txt`, `postfix-tall-36x16-preview-20of20.txt` |
| Tall template 36x16 -> 140x24 -> 36x16: 5 rows, no marker, then marker back | pass | `postfix-tall-140x24-line.txt`, `postfix-tall-back-36x16-line.txt` |

Gate evidence read in this session: `/tmp/quota-templates-final-check.log` (`144 pass,
0 fail, 553 expect() calls`, 20 files), `/tmp/quota-templates-final-rpc.log`
(`"success":true`, `/quota` registered), `git diff --check` exit 0. Docs updated for the
fullscreen keys (`docs/configuration.md:175`, `CHANGELOG.md:41`).

## Pre-fix test matrix

| Check | Result | Evidence |
| --- | --- | --- |
| 140x24 dark, all providers, full IDs | pass | `line-140x24-dark.txt/.ansi` |
| 57x24 and 80x24 dark, short IDs, all providers | pass | `line-resize140-57-dark.txt`, `line-resize140-80-dark.txt` |
| 36x24 dark, 4 wrapped rows, all providers, no ellipsis | pass | `line-resize140-36-dark.txt/.ansi` |
| 140 -> 36 -> 57 -> 80 -> 140 on one instance | pass | `line-resize140-36/57/80-dark.txt`, `line-resize36-140-dark.txt` |
| 16 rows: 36x16 (4 rows) and 140x16 (1 row) | pass | `line-36x16-dark.txt`, `line-140x16-dark.txt` |
| Light theme 140 and 36 | pass | `line-140x24-light.*`, `line-36x24-light.*` |
| Fullscreen 80x24 and 36x16 | pass | `line-80x24-fullscreen.txt`, `line-36x16-fullscreen.txt` |
| Compact-style identity only, values keep stress colour | pass | `line-36x16-dark.ansi`, `line-140x24-light.ansi` |
| Reset badge only where resetCredits > 0 (codex `(1r)`) | pass | all line captures |
| 9x `j` selects the last field (Line template) with preview | pass | `settings-140x16-belowfirst.txt` |
| Preview paging reaches xai (36: 1/4..4/4; 57: 3/3; 80: 2/2; 140: 1/1) | pass | `settings-36x16-preview-1of4.txt`, `-4of4`, `settings-57x16-belowfirst.txt`, `-80x16-`, `-140x24-preview-1of1.*` |
| PageDown/PageUp while editing the template (36: 1/4 -> 3/4 -> 2/4) | pass | `settings-36x16-preview-2of4-editing.txt`, `settings-36x16-edit-pgdn-3of4.txt`, `settings-36x16-edit-pgup-2of4.txt` |
| Edit input cursor visible and typed text visible at 36 | pass | `settings-36x16-edit-cursor.ansi` (reverse video at end of a 17-col window) |
| Invalid token diagnostic without saving | pass | `settings-36x16-invalid-syntax.txt/.ansi` (`⚠ ignored: {bogus:id}`), quotas.json md5 unchanged |
| Malformed config: boot warning, defaults, save rejected | pass | `settings-malformed-config-boot-warning.txt`, `settings-malformed-save-error.txt` |

Layout sanity: every captured pane row measured with `Bun.stringWidth` is at most the pane
width (36/57/80/140); no row overflows.

## Defect 1 (resolved post-fix): settings header clipped at 36 columns

Repro (pre-fix revision, 15:47):

```bash
PI_CODING_AGENT_DIR=/tmp/quota-template-qa-xzWBga pi-bolt ... --use-theme dark \
  --tui-mode regular        # tmux -x 36 -y 16
# type: /quota settings ; then j x9
```

Expected: panel frame starts with the header rule
`── Provider Quotas  Quotas · Settings … below-editor-first ──`.
Actual: the panel starts at the field list; the header rule is gone. The description,
`preview 1/4 PgUp/PgDn`, preview row, second rule and hint row are visible; all 10 fields
stay reachable by `j`/`k`. Evidence `settings-36x16-belowfirst.txt` (line 1 is
`Always shor… off user`), `sweep-belowfirst-36x{16,18,22,24,26}.txt`. Same for
`below-editor-last` (`settings-36x16-belowlast.txt`, `sweep-belowlast-36x*`). At 36x28 the
header returns (`sweep-belowfirst-36x28.txt`). The same panel is complete at 16 rows for
`below-editor-last` at 57/80/140 columns (`settings-belowlast-57/80/140x16.txt`).

Resolved on evidence at 16:05: `postfix-36x16-belowfirst-settings.txt` and
`postfix-36x16-belowlast-settings.txt` start with the header rule, and
`postfix-36x16-belowfirst-preview-4of4.txt` reaches the last preview row.

## Defect 2 (resolved post-fix): first quota row clipped with `above-editor`

At 36x16 with the panel open, the widget shows only `cox`, `ag`, `xai` rows; the
`or: 120.08$ · ds: 0.00$` row is missing and cannot be reached without closing the panel.
Evidence `settings-36x16-above.txt`, `line-36x16-above.txt` (line-only state shows all four
rows). The row returns at 36x28 (`sweep-above-36x28.txt`). At 57/80/140 columns and 16 rows
the widget is complete (`settings-57x16-above.txt`, `-80x16-`, `-140x16-`).

Resolved on evidence at 16:05: `postfix-36x16-above-settings.txt` shows the four quota rows
above the panel header, and `postfix-36x16-above-preview-4of4.txt` reaches the last row.

## Root cause (pre-fix)

`src/ui/panel.ts:114-117` sizes the panel body as `max(8, min(18, termRows - 8))`, but
`src/ui/settings.ts:289-332` adds the header rule, description, two preview lines, rule and
hint outside that body. Rendered height is therefore `body + 4`, while Pi allots the panel
`termRows - quotaRows - 2` (footer). At 36 columns the quota block is 4 rows, so the panel
is 2 lines over budget at every height until the 18-row cap applies (26 rows) and the frame
fits (28 rows). At 57/80/140 the block is 3/2/1 rows and the 16-row screen fits exactly.
The compositor drops the missing lines from the top of the frame, which removes the header
for `below-editor-*` and the widget's first row for `above-editor`. `off` mounts no rows
and is unaffected (`settings-off-36x16.txt`, header and preview visible at 36x16).

## Fix applied and fullscreen resolution

Applied: the runtime caps the widget with `limitQuotaRows` (`src/render/line.ts:8-20`); the
panel subtracts the displayed quota rows and the footer (`2` rows regular, `3` fullscreen,
from public `tui.mode`, `src/ui/panel.ts:115-118`); the settings renderer takes an explicit
total height and follows both `tui.select.*` and `tui.editor.*` page bindings
(`src/ui/settings.ts:58-68,119-124`); the preview label and the bottom hint name the first
page binding that fullscreen does not shadow (`ctrl+PgUp`/`ctrl+PgDn` with default
bindings).

Fullscreen recheck (settings.ts `b4c5da8e…` 16:15:37, panel.ts `9ac32afc…` 16:13:17):

| Check | Result | Evidence |
| --- | --- | --- |
| 36x16 fullscreen: header + bottom hint + 4 quota rows | pass | `postfix2-fullscreen-36x16-settings.txt` |
| List mode: Ctrl+PgDn 1/4 -> 2/4 -> 3/4 -> 4/4, Ctrl+PgUp -> 3/4 | pass | `postfix2-fullscreen-36x16-preview-4of4-list.txt`, `-preview-3of4-after-pgup.txt` |
| Edit mode: Ctrl+PgDn 3/4 -> 4/4, Ctrl+PgUp -> 3/4, input unchanged, no staged change | pass | `postfix2-fullscreen-36x16-edit-start.txt`, `-edit-preview-4of4.txt`, `-edit-preview-3of4.txt`, `-edit-cancelled.txt` |
| 140x24 fullscreen: header + corrected hint `ctrl+PgUp/ctrl+PgDn preview` | pass | `postfix2-fullscreen-140x24-settings.txt` |
| Tall 20-row template at 36x16 fullscreen: 7 rows + marker, preview 1/20 -> 20/20 | pass | `postfix2-fullscreen-tall-36x16-line.txt`, `-settings.txt`, `-preview-20of20.txt` |
| Regular 36x8 guard: marker line, panel header and hint intact | pass | `postfix2-regular-36x8-line.txt`, `postfix2-regular-36x8-settings.txt` |

The edit-mode input row was byte-identical before and after the page keys (empty `diff`),
the panel showed no staged marker afterwards, and `quotas.json` kept its seeded md5
`b22b0fb0…`. The tall-template fullscreen capture predates the hint-text-only change at
16:15:37; navigation and layout evidence is unaffected.

## Open questions / follow-ups

- The reported height and paging defects are resolved in the exercised regular and
  fullscreen states; no residual defect was observed.
- Preview paging was stepped through every row at 36 columns for the default and the tall
  template; at 57/80/140 the last row was reached by clamping after a single PageDown, not
  by stepping each row.
- The pre-15:47 preview (breakpoint at `width - 18`) is fixed in the analysed revision; no
  action needed.
