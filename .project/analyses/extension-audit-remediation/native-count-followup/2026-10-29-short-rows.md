---
version: 1
id: "native-count-short-rows"
title: "Native count short-viewport rows"
description: "Tokens estimate and recovery rows at 36 columns by 8 rows"
type: "analysis"
created: "2026-10-29T21:39:39+01:00"
updated: "2026-10-29T21:52:44+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Pi 1.4.0; Pi-Bolt 1.0.7; tmux; network-isolated bwrap"
sha: "a8abfb1d0fd34ce311c5f405eaa8703f04bd8d13"
document:
  type: "analysis"
  id: "native-count-short-rows"
  title: "Native count short-viewport rows"
  description: "Every visible scroll position with offline missing-auth count"
  status: "published"
  revision: 2
  created_at: "2026-10-29T21:39:39+01:00"
  updated_at: "2026-10-29T21:52:44+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 2
      reason: "Distinguish Pi core and Pi-Bolt build versions"
      changes: ["Correct runtime labels; preserve raw captures"]
      updated_at: "2026-10-29T21:52:44+01:00"
    - revision: 1
      reason: "capture short-viewport estimate and recovery"
      changes: ["capture scrolled Tokens rows"]
      updated_at: "2026-10-29T21:39:42+01:00"
---

# Short-viewport Tokens rows

Offline fake transport and in-memory missing auth; this is UI evidence only.

Checks: `{"screenCount":11,"estimate":true,"recovery":true,"provider":true,"allScreensFit":true}`

```sh
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
```

## Scroll position 0

```text
 Offline QA: missing auth

── Tokens ─ 9 provid… ↓12 F1 help ──
 Provider   claude
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 1

```text
 Offline QA: missing auth

── Tokens ─ 9 prov… ↑1↓11 F1 help ──
 Model      claude-haiku-5-5
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 2

```text
 Offline QA: missing auth

── Tokens ─ 9 prov… ↑2↓10 F1 help ──
 Total      8 · estimate
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 3

```text
 Offline QA: missing auth

── Tokens ─ 9 provi… ↑3↓9 F1 help ──
 Context    0.0% of 1M
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 4

```text
 Offline QA: missing auth

── Tokens ─ 9 provi… ↑4↓8 F1 help ──
 Pi         unknown
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 5

```text
 Offline QA: missing auth

── Tokens ─ 9 provi… ↑5↓7 F1 help ──
 Delta      unknown
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 6

```text
 Offline QA: missing auth

── Tokens ─ 9 provi… ↑6↓6 F1 help ──
 Anchor     No provider usage yet
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 7

```text
 Offline QA: missing auth

── Tokens ─ 9 provi… ↑7↓5 F1 help ──
 Tail       1 message · 8 · estimate
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 8

```text
 Offline QA: missing auth

── Tokens ─ 9 provi… ↑8↓4 F1 help ──
 Recovery   claude: Claude token co…
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 9

```text
 Offline QA: missing auth

── Tokens ─ 9 provi… ↑9↓3 F1 help ──
 Breakdown  Full request
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

## Scroll position 10

```text
 Offline QA: missing auth

── Tokens ─ 9 prov… ↑10↓2 F1 help ──
 system     5 · estimate · 1 item
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```
