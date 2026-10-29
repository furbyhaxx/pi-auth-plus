---
version: 1
id: "native-count-short-help"
title: "Native count short-viewport Help"
description: "Complete recovery feedback at 36 columns by 8 rows"
type: "analysis"
created: "2026-10-29T21:38:17+01:00"
updated: "2026-10-29T21:52:44+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Pi 1.4.0; Pi-Bolt 1.0.7; tmux; network-isolated bwrap"
sha: "a8abfb1d0fd34ce311c5f405eaa8703f04bd8d13"
document:
  type: "analysis"
  id: "native-count-short-help"
  title: "Native count short-viewport Help"
  description: "Every scroll position of offline injected recovery Help"
  status: "published"
  revision: 2
  created_at: "2026-10-29T21:38:17+01:00"
  updated_at: "2026-10-29T21:52:44+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 2
      reason: "Distinguish Pi core and Pi-Bolt build versions"
      changes: ["Correct runtime labels; preserve raw captures"]
      updated_at: "2026-10-29T21:52:44+01:00"
    - revision: 1
      reason: "complete short-viewport capture"
      changes: ["capture every one-line Help scroll position"]
      updated_at: "2026-10-29T21:38:23+01:00"
---

# Native count short-viewport Help

The production Tokens UI ran in Pi-Bolt using an offline injected missing-auth tracker; no live credential or network was available to that process.

Checks: `{"screenCount":12,"provider":true,"endpoint":true,"login":true,"allScreensFit":true}`

```sh
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Escape
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 /qa-missing Enter
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 /tokens Enter
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 36 -y 8
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
```

## Scroll position 0

```text
 Offline QA: missing auth

── Auth › Help ────────────── ↓11 ──
 Description
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 1

```text
 Offline QA: missing auth

── Auth › Help ──────────── ↑1↓10 ──
 Live session context counts and
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 2

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑2↓9 ──
 sources.
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 3

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑3↓8 ──
 Feedback
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 4

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑4↓7 ──
 claude: Claude token counting at
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 5

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑5↓6 ──
 https://api.anthropic.com/v1/messag
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 6

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑6↓5 ──
 es/count_tokens needs
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 7

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑7↓4 ──
 authentication; run /login claude.
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 8

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑8↓3 ──
 Keys
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 9

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑9↓2 ──
 tab switch
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 10

```text
 Offline QA: missing auth

── Auth › Help ──────────── ↑10↓1 ──
 ↑/↓ scroll
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 11

```text
 Offline QA: missing auth

── Auth › Help ────────────── ↑11 ──
 esc close
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```
