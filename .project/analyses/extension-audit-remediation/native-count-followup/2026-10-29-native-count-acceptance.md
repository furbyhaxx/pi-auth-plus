---
version: 1
id: "native-count-followup-acceptance"
title: "Native full-context count acceptance"
description: "Live Claude count differential, auth recovery and production Tokens terminal QA"
type: "analysis"
created: "2026-10-29T21:43:52+01:00"
updated: "2026-10-29T22:06:55+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Bun 1.4.3; pi-coding-agent 1.4.0; Pi-Bolt 1.0.7; Linux x64"
sha: "c034eae37bc67b89d1e92a488f980c9dbf89f221"
document:
  type: "analysis"
  id: "native-count-followup-acceptance"
  title: "Native full-context count acceptance"
  description: "Live Claude count differential, auth recovery and production Tokens terminal QA"
  status: "published"
  revision: 3
  created_at: "2026-10-29T21:43:52+01:00"
  updated_at: "2026-10-29T22:06:55+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 3
      reason: "Cite separate quota acceptance evidence"
      changes: ["Link the quota recheck without implying a quota call in native count acceptance"]
      updated_at: "2026-10-29T22:06:55+01:00"
    - revision: 2
      reason: "Distinguish Pi core and Pi-Bolt build versions"
      changes: ["Correct runtime labels; preserve raw captures"]
      updated_at: "2026-10-29T21:52:44+01:00"
    - revision: 1
      reason: "native count acceptance"
      changes: ["record live count differential, auth recovery, cache and terminal evidence"]
      updated_at: "2026-10-29T21:43:52+01:00"
---

# Native full-context count acceptance

status: "qa-complete"
confidence: "high"

## Summary

All four live full-context differentials matched the real Claude count endpoint and the
independently captured SDK-shaped body. Missing authentication produced labelled estimates
and actionable diagnostics without network; restoring configured auth recovered a native
count and cleared the diagnostic. Repeated identical shaped requests were memo hits.

The production Tokens command, dashboard and view were exercised in Pi-Bolt with an explicitly
offline fake transport at all requested widths and a 36×8 viewport. Count API and estimate
labels, Recovery and its full Help were reachable; no functional defect was observed. The
terminal evidence is not live endpoint evidence.

## Runtime, isolation and evidence

- Live matrix: 2026-10-29 21:32 Europe/Zurich; Bun 1.4.3 and coding-agent 1.4.0;
  checkout `c034eae37bc67b89d1e92a488f980c9dbf89f221`. The production source diff against
  requested `d8233bcc42954dbc14be35feddf590fc9dabcb96` was empty for the affected family,
  token engine, dashboard and command paths. Subsequent `a8abfb1` and `3da35fa` commits
  were documentation/test evidence changes, not changes in those production paths.
- The four-case live matrix used the configured real agent directory **read-only** for its
  auth slot and model overrides. Its credential-store wrapper refused all writes, expired-token
  refreshes and command credentials; model-store and XDG cache/state paths were private. The
  matrix process itself did not redirect `PI_CODING_AGENT_DIR`; a four-case matrix in a private
  agent was not independently repeated.
- A separate live auth-recovery check at 21:43 used a **private** `PI_CODING_AGENT_DIR`,
  private XDG and model store, and read the configured credential in memory through the same
  read-only guard. No credentials were copied to the private agent. Its one live count body
  matched the first matrix body and returned the same observed value.
- Terminal QA used Pi 1.4.0 (Pi-Bolt 1.0.7), a private agent/HOME/XDG/cwd, tmux, and
  `bwrap --unshare-net`. The companion imports the production `registerAuthCommands`,
  `TokensView` and dashboard; its composed token engine uses an in-memory auth toggle and fake
  transport returning 37. This is a UI integration exercise, not a configured-account session.
- [Live differential](2026-10-29-live-differential.md) and
  [private-agent recovery](2026-10-29-private-agent-recovery.md) contain raw request/response
  bodies, statuses, SDK payloads and normalized fields. The SDK `onPayload` capture throws
  before generation, and its fetch/preconnect handlers deny generation. No generated output
  was requested or used.

## Live differential

The approved catalog model was `claude/claude-haiku-5-5`; the user text was `Hello.`, with no
tools and no prior usage anchor. The reference body came from a separate SDK `onPayload`
capture, Claude subscription shaping and the count-endpoint field exclusions. Each reference
was sent to the same native endpoint, separately from the composed engine request.

| System text | Effective thinking | SDK capture | Engine | Native reference | Body equal |
| --- | --- | --- | --- | --- | --- |
| empty | off | reasoning option omitted; body thinking disabled | 35 | 35 | yes |
| empty | low | reasoning `low`; body adaptive, SDK effort high | 36 | 36 | yes |
| `Be concise.` | off | reasoning option omitted; body thinking disabled | 40 | 40 | yes |
| `Be concise.` | low | reasoning `low`; body adaptive, SDK effort high | 41 | 41 | yes |

All eight matrix requests returned HTTP 200. Values and differences are only these observed
payloads; no fixed offset or general reasoning cost is inferred. The old 36/41 historical
fixture used earlier request shapes and is not treated as an identical current SDK request.
No generation was made to compare against billed usage.

Additional observations from the same composed engine:

- With auth masked, `Hello.` returned `3 · estimate` and `needs-auth` naming Claude, the count
  endpoint and `/login claude`, with **zero** network calls. Unmasking used the configured
  account, produced `35 · count-endpoint` and cleared the diagnostic.
- The unchanged authenticated shape was a memo hit with **zero** extra requests. Masking auth
  after that memo again returned the estimate/diagnostic with zero calls; restoring auth
  recovered the cached `35 · count-endpoint`, with no diagnostic and no call.
- Missing thinking level on the reasoning model fell back to `4 · estimate`; two live native
  segment requests were observed, not a complete-request native result. Breakdown user/system
  contributions were labelled estimates, including the baseline-subtracted user segment.
- A separately labelled, offline-injected usage-anchor fixture retained its `provider` anchor
  and labelled its post-anchor tail as an estimate, with zero network calls. Its numeric usage
  is a fixture, not an observed generation.
- The private-agent supplementary recovery made one live request, HTTP 200: masked estimate
  and diagnostic → `35 · count-endpoint`; repeat, re-mask and re-recovery made zero additional
  requests. Its full request body matched the first live matrix case.

Across the matrix, fallback/breakdown and private-agent check, **12** count endpoint requests
returned 200. No Claude quota or other provider endpoint was queried, and no credential refresh,
login, key/account mutation, reset consumption or generation was performed.

## Tokens terminal matrix

The [terminal capture](2026-10-29-terminal-captures.md) records 29 screens at 140×40, 80×24,
57×18, 36×12 and 36×8. The [36×8 Help](2026-10-29-short-help.md) and
[36×8 rows](2026-10-29-short-rows.md) record every one-line scroll position; the
[57×18 Help](2026-10-29-help-57.md) records the remaining feedback scroll positions.
All 60 captured screens fit their terminal widths.

- The count state showed `count API`; breakdown contributions showed `estimate`.
- The missing-auth state showed `estimate` and `Recovery`. F1 Help retained the complete
  provider, endpoint and login guidance at all sizes, including through scrolling at 36×8.
- Restoring the offline injected auth cleared Recovery and returned the `count API` label.
- In the count-API state F1 Help showed the generic Tokens description and key bindings; it
  did not provide a separate expanded explanation of the source labels. The source labels
  themselves were verified in the Tokens rows.

## Commands and results

The temporary scripts and private directories named below were removed after collection.
The full `tmux send-keys`, resize and capture commands are embedded in the terminal artifacts.

```sh
# Model metadata lookup; configured auth status was also checked for type and validity only.
XDG_CACHE_HOME=/tmp/native-count-followup.vgetbzyD/cache MODELS_DEV_CACHE_DIR=/tmp/native-count-followup.vgetbzyD/cache timeout 25 /home/furbyhaxx/.pi/agent/skills/models-dev/scripts/models.dev --summary --no-color 'claude-haiku-5-5'
bun build --target=bun --external '*' /tmp/native-count-followup.vgetbzyD/live.ts --outfile /tmp/native-count-followup.vgetbzyD/live-checked.js
mkdir -p /tmp/native-count-followup.vgetbzyD/cache /tmp/native-count-followup.vgetbzyD/state; TZ=Europe/Zurich XDG_CACHE_HOME=/tmp/native-count-followup.vgetbzyD/cache XDG_STATE_HOME=/tmp/native-count-followup.vgetbzyD/state timeout 150 bun /tmp/native-count-followup.vgetbzyD/live.ts
bwrap --unshare-net --ro-bind / / --dev /dev --proc /proc /usr/bin/true
mkdir -p /tmp/native-count-followup.vgetbzyD/{home,agent,terminal-cwd,ui-cache,ui-config,ui-state,ui-data}
env -i HOME=/tmp/native-count-followup.vgetbzyD/home PATH="$PATH" TERM=xterm-256color tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock new-session -d -s ncf -x 140 -y 40 -c /tmp/native-count-followup.vgetbzyD/terminal-cwd 'timeout --foreground 600s env -i HOME=/tmp/native-count-followup.vgetbzyD/home PATH=/usr/bin:/bin TERM=xterm-256color PI_CODING_AGENT_DIR=/tmp/native-count-followup.vgetbzyD/agent XDG_CACHE_HOME=/tmp/native-count-followup.vgetbzyD/ui-cache XDG_CONFIG_HOME=/tmp/native-count-followup.vgetbzyD/ui-config XDG_STATE_HOME=/tmp/native-count-followup.vgetbzyD/ui-state XDG_DATA_HOME=/tmp/native-count-followup.vgetbzyD/ui-data bwrap --unshare-net --ro-bind / / --bind /tmp/native-count-followup.vgetbzyD /tmp/native-count-followup.vgetbzyD --dev /dev --proc /proc /home/furbyhaxx/.local/bin/pi-bolt --no-session -ne --offline --use-theme dark -e /tmp/native-count-followup.vgetbzyD/tui-companion.ts'
TZ=Europe/Zurich timeout 90 bun /tmp/native-count-followup.vgetbzyD/tui-driver.ts
TZ=Europe/Zurich timeout 40 bun /tmp/native-count-followup.vgetbzyD/short-help.ts
TZ=Europe/Zurich timeout 30 bun /tmp/native-count-followup.vgetbzyD/short-rows.ts
tmux -S /tmp/native-count-followup.vgetbzyD/tmux.sock kill-server
env -i HOME=/tmp/native-count-followup.vgetbzyD/home PATH="$PATH" TERM=xterm-256color tmux -S /tmp/native-count-followup.vgetbzyD/tmux57.sock new-session -d -s ncf57 -x 57 -y 18 -c /tmp/native-count-followup.vgetbzyD/terminal-cwd 'timeout --foreground 300s env -i HOME=/tmp/native-count-followup.vgetbzyD/home PATH=/usr/bin:/bin TERM=xterm-256color PI_CODING_AGENT_DIR=/tmp/native-count-followup.vgetbzyD/agent XDG_CACHE_HOME=/tmp/native-count-followup.vgetbzyD/ui-cache XDG_CONFIG_HOME=/tmp/native-count-followup.vgetbzyD/ui-config XDG_STATE_HOME=/tmp/native-count-followup.vgetbzyD/ui-state XDG_DATA_HOME=/tmp/native-count-followup.vgetbzyD/ui-data bwrap --unshare-net --ro-bind / / --bind /tmp/native-count-followup.vgetbzyD /tmp/native-count-followup.vgetbzyD --dev /dev --proc /proc /home/furbyhaxx/.local/bin/pi-bolt --no-session -ne --offline --use-theme dark -e /tmp/native-count-followup.vgetbzyD/tui-companion.ts'
TZ=Europe/Zurich timeout 30 bun /tmp/native-count-followup.vgetbzyD/help57.ts
tmux -S /tmp/native-count-followup.vgetbzyD/tmux57.sock kill-server
mkdir -p /tmp/native-count-followup.vgetbzyD/live-agent /tmp/native-count-followup.vgetbzyD/private-cache /tmp/native-count-followup.vgetbzyD/private-state; TZ=Europe/Zurich PI_CODING_AGENT_DIR=/tmp/native-count-followup.vgetbzyD/live-agent XDG_CACHE_HOME=/tmp/native-count-followup.vgetbzyD/private-cache XDG_STATE_HOME=/tmp/native-count-followup.vgetbzyD/private-state timeout 45 bun /tmp/native-count-followup.vgetbzyD/private-recovery.ts
timeout 20 bun /tmp/native-count-followup.vgetbzyD/verify.ts
```

All listed checks exited 0. The live script reported four matching bodies/counts, 11 HTTP 200
requests and zero SDK generation-fetch attempts; the private-agent supplement reported one
HTTP 200 and all five missing/recovery/memo checks true. Terminal drivers reported all screen,
width and recovery checks true. The final in-memory secret/identifier verification reported
zero exact configured-credential matches, zero recognized complete or abbreviated credential
patterns, and zero unredacted sensitive fields. The first terminal launch used ordinary
`timeout`, which left the TUI stopped awaiting foreground terminal access; it was terminated
and relaunched with `timeout --foreground` before acceptance. No source or tests were changed.

## Limits and cleanup

The configured-account matrix was not run inside a private Pi agent, as detailed above; only
the supplemental recovery case had that isolation. The TUI's fake provider cannot prove a live
count or real-session tracker wiring. No live generation, billing comparison, full suite or
Claude quota retry was run. The integrator separately reported `just check` passing at
`c034eae`; that gate was not rerun here. P1bn2c remains open for successful Claude quota
recovery; the separate [quota recheck](../claude-quota-recheck/2026-10-29-claude-quota-recheck.md)
still returned HTTP 429. No quota call was made in this follow-up.
The owned tmux servers and Pi-Bolt/sandbox children were stopped, and the owned scratch
scripts, private caches and agent directories were removed after evidence collection.
