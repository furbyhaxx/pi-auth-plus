---
version: 1
id: "native-count-terminal-captures"
title: "Native count Tokens terminal captures"
description: "Real Pi-Bolt Tokens UI with an offline injected tracker and fake count transport"
type: "analysis"
created: "2026-10-29T21:36:54+01:00"
updated: "2026-10-29T21:52:44+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Pi 1.4.0; Pi-Bolt 1.0.7; tmux; network-isolated bwrap"
sha: "c034eae37bc67b89d1e92a488f980c9dbf89f221"
document:
  type: "analysis"
  id: "native-count-terminal-captures"
  title: "Native count Tokens terminal captures"
  description: "Actual production dashboard with offline injected count and missing-auth states"
  status: "published"
  revision: 2
  created_at: "2026-10-29T21:36:54+01:00"
  updated_at: "2026-10-29T21:52:44+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 2
      reason: "Distinguish Pi core and Pi-Bolt build versions"
      changes: ["Correct runtime labels; preserve raw captures"]
      updated_at: "2026-10-29T21:52:44+01:00"
    - revision: 1
      reason: "terminal acceptance"
      changes: ["capture count, estimate and full recovery Help at requested sizes"]
      updated_at: "2026-10-29T21:37:14+01:00"
---

# Native count Tokens terminal captures

The companion imports the production `registerAuthCommands`, `TokensView` and dashboard through their normal command path. Its token engine uses an offline, fake transport returning 37 and an in-memory fake auth toggle; this is UI evidence, not live provider evidence. Pi-Bolt runs inside a private agent/HOME/XDG and a network-isolated bubblewrap namespace.

Checks: `{"countWide":true,"missingWide":true,"narrowHelpProvider":true,"narrowHelpEndpoint":true,"narrowHelpLogin":true,"recovered":true,"allScreensFit":true,"screenCount":29}`

## Commands

```sh
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 140 -y 40
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 80 -y 24
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 57 -y 18
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 36 -y 12
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 36 -y 8
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 140 -y 40
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 140 -y 40
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Escape
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 /qa-missing Enter
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 /tokens Enter
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 140 -y 40
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 80 -y 24
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 57 -y 18
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 36 -y 12
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 36 -y 8
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Down Down Down Down Down Down Down Down
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 140 -y 40
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 80 -y 24
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 57 -y 18
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 36 -y 12
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 36 -y 8
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 j j
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 F1
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock resize-window -t ncf:0 -x 140 -y 40
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 Escape
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 /qa-count Enter
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock send-keys -t ncf:0 /tokens Enter
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock capture-pane -p -t ncf:0
```

## Captures

### count-140x40 (140×40)

```text

 ▀▀█  v1.4.0
 █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more
 Press ctrl+o to show full startup help and loaded resources.

 Pi-Bolt can explain its own features and look up its docs. Ask it how to use or extend Pi-Bolt.

[Extensions]
  tui-companion.ts


 Warning: No models available. Use /login to log into a provider via OAuth or API key. See:
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/providers.md
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md

 Offline QA: count API (fake calls 1)




── Auth › Tokens ──────────────────────────────────────────────────────────────────────────────────────────────────── 9 providers F1 help ──
  Providers   Quotas  ▸Tokens   Models   Groups   Settings
 Provider   claude
 Model      claude-haiku-5-5
 Total      37 · count API
 Context    0.0% of 1M
 Pi         unknown
 Delta      unknown
 Anchor     No provider usage yet
 Tail       1 message · 37 · count API
 Breakdown  Full request
 system     1 · estimate · 1 item
 tools      none · 0 items
 user       1 · estimate · 1 item
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Live session context counts and sources.
 tab switch · esc close
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                                                                                                        unknown
```

### count-80x24 (80×24)

```text
 API key. See:
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/providers.md
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md

 Offline QA: count API (fake calls 1)

── Auth › Tokens ──────────────────────────────────────── 9 providers F1 help ──
  Providers   Quotas  ▸Tokens   Models   Groups   Settings
 Provider   claude
 Model      claude-haiku-5-5
 Total      37 · count API
 Context    0.0% of 1M
 Pi         unknown
 Delta      unknown
 Anchor     No provider usage yet
 Tail       1 message · 37 · count API
 Breakdown  Full request
 system     1 · estimate · 1 item
─────────────────────────────────── ↓ 2 more ───────────────────────────────────
 Live session context counts and sources.
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                                            unknown
```

### count-57x18 (57×18)

```text

 /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.
 md

 Offline QA: count API (fake calls 1)

── Auth › Tokens ───────────────── 9 providers F1 help ──
  Providers Quotas▸Tokens Models Groups Settings
 Provider   claude
 Model      claude-haiku-5-5
 Total      37 · count API
 Context    0.0% of 1M
─────────────────────── ↓ 8 more ────────────────────────
 Live session context counts and sources.
 tab switch · ↑/↓ scroll · esc close
─────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                     unknown
```

### count-36x12 (36×12)

```text

 Offline QA: count API (fake calls
 1)

── Tokens ─ 9 provide… ↓9 F1 help ──
 Provider   claude
 Model      claude-haiku-5-5
 Total      37 · count API
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### count-36x8 (36×8)

```text
 1)

── Tokens ─ 9 provid… ↓11 F1 help ──
 Provider   claude
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### count-36x8-scrolled (36×8)

```text
 1)

── Tokens ─ 9 provi… ↑2↓9 F1 help ──
 Total      37 · count API
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### count-help-140x40 (140×40)

```text

 ▀▀█  v1.4.0
 █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more
 Press ctrl+o to show full startup help and loaded resources.

 Pi-Bolt can explain its own features and look up its docs. Ask it how to use or extend Pi-Bolt.

[Extensions]
  tui-companion.ts


 Warning: No models available. Use /login to log into a provider via OAuth or API key. See:
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/providers.md
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md

 Offline QA: count API (fake calls 1)














── Auth › Help ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Description
 Live session context counts and sources.
 Keys
 tab switch
 esc close
 j/k scroll · F1 back
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                                                                                                        unknown
```

### missing-140x40 (140×40)

```text

 ▀▀█  v1.4.0
 █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more
 Press ctrl+o to show full startup help and loaded resources.

 Pi-Bolt can explain its own features and look up its docs. Ask it how to use or extend Pi-Bolt.

[Extensions]
  tui-companion.ts


 Warning: No models available. Use /login to log into a provider via OAuth or API key. See:
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/providers.md
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md

 Offline QA: missing auth



── Auth › Tokens ──────────────────────────────────────────────────────────────────────────────────────────────────── 9 providers F1 help ──
  Providers   Quotas  ▸Tokens   Models   Groups   Settings
 Provider   claude
 Model      claude-haiku-5-5
 Total      8 · estimate
 Context    0.0% of 1M
 Pi         unknown
 Delta      unknown
 Anchor     No provider usage yet
 Tail       1 message · 8 · estimate
 Recovery   claude: Claude token counting at https://api.anthropic.com/v1/messages/count_tokens needs authentication; run /login claude.
 Breakdown  Full request
 system     5 · estimate · 1 item
 tools      none · 0 items
 user       3 · estimate · 1 item
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Live session context counts and sources.
 tab switch · esc close
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                                                                                                        unknown
```

### missing-80x24 (80×24)

```text
 API key. See:
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/providers.md
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md

 Offline QA: missing auth

── Auth › Tokens ──────────────────────────────────────── 9 providers F1 help ──
  Providers   Quotas  ▸Tokens   Models   Groups   Settings
 Provider   claude
 Model      claude-haiku-5-5
 Total      8 · estimate
 Context    0.0% of 1M
 Pi         unknown
 Delta      unknown
 Anchor     No provider usage yet
 Tail       1 message · 8 · estimate
 Recovery   claude: Claude token counting at https://api.anthropic.com/v1/messa…
 Breakdown  Full request
─────────────────────────────────── ↓ 3 more ───────────────────────────────────
 Live session context counts and sources.
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                                            unknown
```

### missing-57x18 (57×18)

```text

 /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.
 md

 Offline QA: missing auth

── Auth › Tokens ───────────────── 9 providers F1 help ──
  Providers Quotas▸Tokens Models Groups Settings
 Provider   claude
 Model      claude-haiku-5-5
 Total      8 · estimate
 Context    0.0% of 1M
─────────────────────── ↓ 9 more ────────────────────────
 Live session context counts and sources.
 tab switch · ↑/↓ scroll · esc close
─────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                     unknown
```

### missing-36x12 (36×12)

```text
 inux-x64/docs/models.md

 Offline QA: missing auth

── Tokens ─ 9 provid… ↓10 F1 help ──
 Provider   claude
 Model      claude-haiku-5-5
 Total      8 · estimate
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-36x8 (36×8)

```text
 Offline QA: missing auth

── Tokens ─ 9 provid… ↓12 F1 help ──
 Provider   claude
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-36x8-recovery-row (36×8)

```text
 Offline QA: missing auth

── Tokens ─ 9 provi… ↑8↓4 F1 help ──
 Recovery   claude: Claude token co…
 tab switch · ↑/↓ scroll · esc close
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-140x40-top (140×40)

```text

 ▀▀█  v1.4.0
 █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more
 Press ctrl+o to show full startup help and loaded resources.

 Pi-Bolt can explain its own features and look up its docs. Ask it how to use or extend Pi-Bolt.

[Extensions]
  tui-companion.ts


 Warning: No models available. Use /login to log into a provider via OAuth or API key. See:
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/providers.md
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md

 Offline QA: missing auth












── Auth › Help ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Description
 Live session context counts and sources.
 Feedback
 claude: Claude token counting at https://api.anthropic.com/v1/messages/count_tokens needs authentication; run /login claude.
 Keys
 tab switch
 esc close
 j/k scroll · F1 back
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                                                                                                        unknown
```

### missing-help-80x24-top (80×24)

```text


 Warning: No models available. Use /login to log into a provider via OAuth or
 API key. See:
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/providers.md
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md

 Offline QA: missing auth

── Auth › Help ─────────────────────────────────────────────────────────────────
 Description
 Live session context counts and sources.
 Feedback
 claude: Claude token counting at
 https://api.anthropic.com/v1/messages/count_tokens needs authentication; run
 /login claude.
 Keys
 tab switch
 ↑/↓ scroll
 esc close
 j/k scroll · F1 back
────────────────────────────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                                            unknown
```

### missing-help-57x18-top (57×18)

```text

 /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/provide
 rs.md

 /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.
 md

 Offline QA: missing auth

── Auth › Help ──────────────────────────────────── ↓6 ──
 Description
 Live session context counts and sources.
 Feedback
 claude: Claude token counting at
 j/k scroll · F1 back
─────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                     unknown
```

### missing-help-36x12-top (36×12)

```text
 inux-x64/docs/models.md

 Offline QA: missing auth

── Auth › Help ─────────────── ↓9 ──
 Description
 Live session context counts and
 sources.
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x12-scroll-1 (36×12)

```text
 inux-x64/docs/models.md

 Offline QA: missing auth

── Auth › Help ───────────── ↑2↓7 ──
 sources.
 Feedback
 claude: Claude token counting at
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x12-scroll-2 (36×12)

```text
 inux-x64/docs/models.md

 Offline QA: missing auth

── Auth › Help ───────────── ↑4↓5 ──
 claude: Claude token counting at
 https://api.anthropic.com/v1/messag
 es/count_tokens needs
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x12-scroll-3 (36×12)

```text
 inux-x64/docs/models.md

 Offline QA: missing auth

── Auth › Help ───────────── ↑6↓3 ──
 es/count_tokens needs
 authentication; run /login claude.
 Keys
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x12-scroll-4 (36×12)

```text
 inux-x64/docs/models.md

 Offline QA: missing auth

── Auth › Help ───────────── ↑8↓1 ──
 Keys
 tab switch
 ↑/↓ scroll
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x12-scroll-5 (36×12)

```text
 inux-x64/docs/models.md

 Offline QA: missing auth

── Auth › Help ─────────────── ↑9 ──
 tab switch
 ↑/↓ scroll
 esc close
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x8-top (36×8)

```text
 Offline QA: missing auth

── Auth › Help ────────────── ↓11 ──
 Description
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x8-scroll-1 (36×8)

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑2↓9 ──
 sources.
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x8-scroll-2 (36×8)

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑4↓7 ──
 claude: Claude token counting at
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x8-scroll-3 (36×8)

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑6↓5 ──
 es/count_tokens needs
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x8-scroll-4 (36×8)

```text
 Offline QA: missing auth

── Auth › Help ───────────── ↑8↓3 ──
 Keys
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### missing-help-36x8-scroll-5 (36×8)

```text
 Offline QA: missing auth

── Auth › Help ──────────── ↑10↓1 ──
 ↑/↓ scroll
 j/k scroll · F1 back
────────────────────────────────────
[PRIVATE_TMP]
0.0%/0 (auto)                unknown
```

### recovered-count-140x40 (140×40)

```text

 ▀▀█  v1.4.0
 █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more
 Press ctrl+o to show full startup help and loaded resources.

 Pi-Bolt can explain its own features and look up its docs. Ask it how to use or extend Pi-Bolt.

[Extensions]
  tui-companion.ts


 Warning: No models available. Use /login to log into a provider via OAuth or API key. See:
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/providers.md
   /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/models.md

 Offline QA: count API (fake calls 4)




── Auth › Tokens ──────────────────────────────────────────────────────────────────────────────────────────────────── 9 providers F1 help ──
  Providers   Quotas  ▸Tokens   Models   Groups   Settings
 Provider   claude
 Model      claude-haiku-5-5
 Total      37 · count API
 Context    0.0% of 1M
 Pi         unknown
 Delta      unknown
 Anchor     No provider usage yet
 Tail       1 message · 37 · count API
 Breakdown  Full request
 system     1 · estimate · 1 item
 tools      none · 0 items
 user       1 · estimate · 1 item
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Live session context counts and sources.
 tab switch · esc close
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
[PRIVATE_TMP]/terminal-cwd
0.0%/0 (auto)                                                                                                                        unknown
```
