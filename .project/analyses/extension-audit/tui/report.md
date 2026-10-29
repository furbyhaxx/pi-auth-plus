---
version: 1
id: "extension-audit-tui"
title: "Pi-auth-plus dashboard terminal QA"
description: "Offline, isolated Pi-Bolt dashboard audit covering navigation, staged editing, quotas, tokens, and terminal layouts."
type: "analysis"
created: "2026-10-29T15:16:51+01:00"
updated: "2026-10-29T15:19:38+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "analysis"
  id: "extension-audit-tui"
  title: "Pi-auth-plus dashboard terminal QA"
  description: "Offline, isolated Pi-Bolt dashboard audit covering navigation, staged editing, quotas, tokens, and terminal layouts."
  status: "published"
  revision: 1
  created_at: "2026-10-29T15:16:51+01:00"
  updated_at: "2026-10-29T15:19:38+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "terminal QA"
      changes: ["Recorded isolated Pi-Bolt captures, defects, and verification gaps"]
---

# Pi-auth-plus dashboard terminal QA

status: "qa-complete"
confidence: "high" for the captured observations; inferred implementation chains are identified below.

## Summary

The dashboard opens and its principal editors and scoped saves work in an isolated Pi-Bolt session. The highest-impact findings are silent loss of staged edits across tabs, unannounced higher-scope shadowing in three editors, a false provider-usage label in the token breakdown, an incorrect Synthetic missing-credential state, and an unsearchable large model catalog with ambiguous identities at narrow widths. Smaller defects affect terminal height, shortcuts, command feedback and editor rendering. The findings below are read-only; no project source or settings were changed.

## Environment and reproduction

- Revision: `e8b6d7e36f43`; Pi `1.4.0`, Pi-Bolt `1.0.7`, Linux x64, JIT off; tmux `3.8`.
- Working directory, `HOME`, `PI_CODING_AGENT_DIR`, `TMPDIR`, and XDG config/cache/state/data were separate temporary directories. The child received `env -i`, no API-key variables, and no copied credentials. `--no-extensions` suppressed discovery; only the explicit repository extension was loaded. `--no-session` avoided persistent transcripts.
- All Pi processes ran under `bwrap --unshare-net --ro-bind / / --bind "$D" "$D"`; only their temporary directory was writable. `connect_ex(1.1.1.1:443)` in the same kind of network namespace returned `101` (`ENETUNREACH`). `--offline` was also set. This prevents external connections, even if a component attempts one.
- Example of the actual fullscreen launch, with `$D` replacing the temporary path:

```sh
D=$(mktemp -d /tmp/pi-auth-tui-qa.XXXXXX)
mkdir -p "$D"/{home,agent,work,tmp,xdg/config,xdg/cache,xdg/state,xdg/data}
env -i HOME="$D/home" PATH=/usr/bin:/bin TERM=xterm-256color LANG=C.UTF-8 \
  tmux -S "$D/tmux.sock" new-session -d -x 80 -y 35 -s audit \
  "exec /usr/bin/bwrap --unshare-net --ro-bind / / --bind '$D' '$D' --chdir '$D/work' -- /usr/bin/env -i HOME='$D/home' XDG_CONFIG_HOME='$D/xdg/config' XDG_CACHE_HOME='$D/xdg/cache' XDG_STATE_HOME='$D/xdg/state' XDG_DATA_HOME='$D/xdg/data' PI_CODING_AGENT_DIR='$D/agent' TMPDIR='$D/tmp' LANG=C.UTF-8 TERM=xterm-256color PATH=/home/furbyhaxx/.local/bin:/usr/local/bin:/usr/bin:/bin /usr/bin/timeout --foreground 1800 /home/furbyhaxx/.local/bin/pi-bolt --offline --no-extensions --no-session --tui-mode fullscreen -e /mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts"
tmux -S "$D/tmux.sock" set-option -t audit status off
tmux -S "$D/tmux.sock" set-window-option -t audit window-size manual
tmux -S "$D/tmux.sock" send-keys -t audit:0 '/auth' Enter
tmux -S "$D/tmux.sock" resize-window -t audit:0 -x 36 -y 35
tmux -S "$D/tmux.sock" capture-pane -pt audit:0
```

Separate isolated sessions used `--use-theme light` and `--tui-mode regular` with a custom keybinding file. Captures are under `.project/analyses/extension-audit/tui/captures/`. Each stated defect was observed at least once; repeat counts were not measured.

**Driver error:** While testing completion, an incorrectly cleared prompt was accidentally submitted as `/tokeclaude/quota claude`, which Pi treated as chat. The screen reported `Connection error` and retries (`captures/accidental-request-blocked.txt`). It ran in the no-network namespace described above, with no credentials, and therefore made no external connection. Subsequent `/token` inspection exposed finding 3.

## Test matrix

- **Providers, quotas, tokens, settings:** inspected at 36, 57, 80 and 140 columns with live resize; see `captures/{providers,quotas,tokens,settings}-<width>.txt`.
- **Models/catalog and groups:** inspected at 36, 57, 80 and 140 columns; `captures/catalog-<width>.txt`, `captures/groups-<width>.txt`. Group detail, model override, alias and scope prompts were also exercised.
- **Height:** 80×12, 36×12, 80×8 and resizing back were exercised; screen clipping is finding 8.
- **Themes/mode:** default dark fullscreen and light fullscreen were launched; color-bearing captures `captures/dark-settings-80.ansi` and `captures/light-settings-80.ansi` use different SGR colors. A regular-mode session with rebound navigation worked. These captures do not independently establish visual contrast.
- **Navigation and commands:** Tab/Shift+Tab, arrows, the rebound Ctrl+T/Ctrl+P/Ctrl+N/Ctrl+F, Enter, Ctrl+S, Escape and Ctrl+C were exercised. `/auth`, `/auth settings`, `/auth models`, `/auth groups`, `/auth quotas claude`, `/token`, and `/quota claude` opened their respective surfaces. Quota solo/show-all worked. Unknown section `/auth setings` gave a useful suggestion (`captures/unknown-section.txt`).
- **Settings saves:** user save `60 → 61` persisted; runtime `62` left the user file at `61`; a user save shadowed by runtime reported the warning correctly. A later project save was accepted in this trusted scratch project. The unknown JSON key survived, and malformed JSON blocked a save and remained unchanged (`captures/settings-save-{user,runtime,shadowed,project}.txt`, `captures/settings-malformed-save.txt`, `captures/scope-file-checks.txt`).
- **Models/groups:** a runtime alias was added; a model reasoning override was saved to the isolated `models.json`; a group was validated, staged and saved to runtime. An incomplete group and a noncatalog member were rejected. A group display name `Zürich 東京` saved and rendered (`captures/group-unicode-{80,36}.txt`).
- **Cancellation:** Pi's JSON editor cancel returned to the settings row; Ctrl+C closed an unstaged root panel. The staged-close failures are finding 1.
- No full suite or gate was run, as requested. All three owned tmux sessions and their Pi-Bolt processes were stopped; the temporary workspace was removed and its absence verified.

## Defects

### 1. Major — staged edits are discarded without confirmation, including across tabs

Repro: `/auth settings`, Right on quota refresh interval (`60 → 61`), then Escape. The panel immediately restores `60` and prints `Discarded staged changes`, without a confirmation. Alternatively, stage the same change, press Tab to Providers and Escape: the entire dashboard closes without any indication of the inactive staged edit; reopening Settings shows `60`. Evidence: `captures/settings-staged.txt`, `captures/settings-escape-discard.txt`, `captures/settings-stage-tab{,-close,-reopen}.txt`. Group detail likewise discards an `audit` ID on one Escape (`captures/group-{before,after}-escape.txt`). A staged model reasoning override disappears on one Escape and is back to its original value on reopening (`captures/model-override-{staged,escape,reopen}.txt`).

Expected: ask before discarding and account for staged edits in every tab when the dashboard closes. `src/ui/dashboard/settings.ts:114-118`, `src/ui/dashboard/groups.ts:107-110`, `src/ui/dashboard/models.ts:165-168`, `src/ui/dashboard/group-detail.ts:245-250`, and `src/ui/dashboard/model-detail.ts:190` directly discard/close; `src/ui/dashboard/index.ts:119-125` asks only the active view before closing. The docs currently describe direct discard, but project and pi-workbench panel conventions require confirmation. Regression: stage in each view, cancel the prompt, and close from another tab without losing the draft.

### 2. Major — lower-scope saves report success without warning when runtime still wins

Repro group: create and save `audit-group` with strategy `sticky` to runtime; edit it to `failover`, stage it, and save to user. Screen says `Saved to user scope` but shows `sticky`; the user file actually contains `failover`. Repro rules: save `synthetic/*` to runtime, then add `claude/*` and save to user. The list returns to only `synthetic/*` with `Saved to user scope`, while both rules are in the user file. Repro alias: save alias `audit-alias` to runtime, give it display name `friendly audit`, and save to user; the editor returns without a warning and the visible alias lacks that name. Evidence: `captures/group-shadow-{edit,save}.txt`, `captures/rules-{save-runtime,shadow-save}.txt`, `captures/alias-shadow-save.txt`, `captures/scope-file-checks.txt`.

Expected: warn that the save is shadowed and identify the higher scope, as Settings already does. `src/ui/dashboard/groups.ts:68-82` and `src/ui/dashboard/models.ts:106-120` only emit generic success; `src/ui/dashboard/alias-detail.ts:93-103` immediately closes. Compare `src/ui/dashboard/settings.ts:69-77`, which calls `store.shadowed`. Regression: save each collection to user while runtime overrides it and assert both the persisted value and visible warning.

### 3. Major — empty assistant breakdown claims provider-reported usage

Repro: after the sandbox-blocked failed chat attempt described above, open `/token`. It simultaneously says `Anchor No provider usage yet` and `assistant 0 · exact (usage) · 1 item` (`captures/token-command.txt`). No provider response was received. Expected: an empty contribution may be zero, but it must not be attributed to provider usage when none was received.

Source inference: `src/tokens/engine/index.ts:159-173,255-265` counts the message's segments; `src/tokens/types.ts:35-42` assigns `source: "provider"` to an empty sum; `src/ui/dashboard/tokens.ts:21-25` renders that source as `exact (usage)`. Distinguish an exact empty sum from a provider usage source or omit the empty contribution. Regression: a failed/empty assistant message must not produce an `exact (usage)` breakdown without provider usage.

### 4. Major — missing Synthetic credentials look like a failed request while the footer stays loading

Repro: with an empty agent directory and no `SYNTHETIC_API_KEY`, open `/auth quotas synthetic`. At 220 columns the panel says `API key auth failed ... Failed to resolve API key ... SYNTHETIC_API_KEY`; unlike other missing-credential providers, it does not show `/login synthetic`. The quota line simultaneously says `synthetic: …`, even after the error (`captures/synthetic-error-220.txt`; at 80 columns the error itself is clipped in `captures/quotas-80.txt`). Expected: a needs-auth state with a recovery action, and an error/login state in the line rather than indefinite pending.

Source inference: `src/quotas/auth.ts:11` awaits Pi's credential resolver; its exception prevents `src/families/synthetic/quota.ts:114-125` from reaching its `needsAuth` branch. `src/quotas/engine.ts:311-330` records a backoff error; `src/quotas/report.ts:70-81` shows that error while `src/quotas/line/template.ts:120-125` renders `…` whenever there is no snapshot, without considering backoff. Regression: simulate Pi's missing-env credential error and assert both actionable panel and non-pending footer states.

### 5. Major — a 1,600-plus model catalog has no search or page navigation

Repro: `/auth models`, `v` to catalog; at 80 columns the frame reports `↓ 1659 more`. Press `/` or PageDown: the captured screen is byte-identical to the original (`captures/models-catalog-80.txt`, `captures/models-search-slash.txt`, `captures/models-pagedown.txt`; both `cmp -s` returned 0). A user must navigate model-by-model. Adding a group member also requires an exact provider/model ID with no catalog picker or suggestions; a prefix produces only `Member not in catalog` (`captures/group-member-no-picker.txt`).

Expected: searchable/filterable, pageable model selection, consistent with the pi-workbench menu. `src/ui/dashboard/models.ts:191-225` only handles single-step movement and `v`; `src/ui/dashboard/group-detail.ts:145-156` requires an exact typed catalog match. Workbench's `src/core/menu.ts:180-220,560-610` claims page keys and implements fuzzy filtering. Regression: filter a large catalog and pick a group member by search, including after resize.

### 6. Major — distinct model identities become indistinguishable before editing at 36 columns

Repro: in the catalog select the two adjacent Synthetic DeepSeek entries individually and open detail at 36 columns. Both show `synthetic/hf:deepseek-ai/DeepSeek-…` and the same clipped name (`captures/model-identity-{a,b}-36.txt`). At 140 columns their IDs are `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` and `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash` (`captures/model-identity-{a,b}-140.txt`). The narrow detail provides no way to reveal the full ID, so a user can edit or alias the wrong model. Expected: preserve or reveal full provider/model identity before editing, for example via wrapping or a detail screen.

`src/ui/dashboard/models.ts:289-304` constructs the catalog row and `src/ui/dashboard/model-detail.ts:275-281,338-341` clips the identity along with other rows. Regression: visually distinguish similar IDs at every required width.

### 7. Minor — narrow widths drop the only hints for primary actions

At 36 columns, empty Groups shows `ctrl+s save · esc close`, but not `a` to add a first group (`captures/groups-36.txt`). Settings shows only save/close, omitting edit, move and tab switch (`captures/settings-36.txt`); Quotas omits provider selection, solo, refresh and position (`captures/quotas-36.txt`). The keys still work when known, but primary actions are undiscoverable. Expected: prioritize actionable hints, use a compact/rotating help affordance or another reachable help surface. `src/ui/frame/index.ts:114-136` drops hints by priority; priorities are supplied at `src/ui/dashboard/{groups,settings,quotas}.ts`. Regression: verify a first-time user can discover add/edit/navigation at 36 columns.

### 8. Minor — short terminals clip the panel footer and sometimes Pi's footer

Resize an open Models panel to 36×12: its hint line and bottom rule disappear, while quota lines consume several rows (`captures/models-36x12.txt`). At 80×8 the description and hints also disappear (`captures/models-80x8.txt`). A settings save prompt at 36×12 loses its hint row and truncates `r session` (`captures/settings-save-36x12.txt`). Expected: budget actual surrounding rows and keep essential confirm/cancel and scope information visible when possible. `src/ui/frame/index.ts:19-26` forces at least four body rows regardless of available height; `src/ui/dashboard/index.ts:82-102` draws the frame in addition to Pi's variable-height quota/footer lines. Regression: resize staged and modal views at short heights and retain usable controls.

### 9. Minor — group text fields display internal fake-cursor markers

Repro: `/auth groups`, `a`, Enter on Group ID, type `audit`. The input visibly contains `audit _pi:fc   _pi:/fc …` (`captures/group-id-cursor-artifacts.txt`). The same appears while entering a member (`captures/group-member-no-picker.txt`). A model-name editor does not display those markers (`captures/model-name-edit.txt`). Expected: show user text and cursor only.

`src/ui/dashboard/group-detail.ts:43,317-318` preserves only the old cursor marker while sanitizing Pi's rendered Input; the installed pi-tui also emits fake-cursor markers (`node_modules/@earendil-works/pi-tui/dist/tui.js:69-74`). Do not sanitize the Input component's own terminal markup as untrusted user text. Regression: render focused group text inputs with current Pi fake-cursor sequences.

### 10. Minor — group/model detail hints lie after rebinding and quota hints concatenate keys

Repro: configure `tui.editor.cursorLeft=ctrl+b`, `tui.editor.cursorRight=ctrl+f`, `tui.select.up=ctrl+p`, `tui.select.down=ctrl+n`, `tui.input.tab=ctrl+t`. In Group detail, the hint still says `←/→ change`; Right does nothing, while Ctrl+F changes `sticky` to `failover` (`captures/custom-group-detail{,-changed}.txt`, `captures/custom-group-right-noop.txt`). Model detail has the same literal arrow hint. Quotas displays `ctrl+pctrl+n provider` without a separator (`captures/unknown-quota-provider.txt`). Settings correctly reports its rebound keys (`captures/custom-settings-bindings.txt`). Expected: display actual bindings legibly. Sources: `src/ui/dashboard/group-detail.ts:281-282,361`, `src/ui/dashboard/model-detail.ts:231-232,371`, `src/ui/dashboard/quotas.ts:239-244`. Regression: test hints and actions with rebound multi-character keys.

### 11. Minor — invalid section targets silently open a different view

Repro: `/auth quotas claud` opens the unfiltered quota list on Synthetic, with no typo warning; `/auth quotas claude` correctly opens only Claude (`captures/unknown-quota-provider.txt`, `captures/known-quota-provider.txt`). `/auth settings synthetic.webSearc` silently selects the first quota setting instead of reporting an unknown key (`captures/unknown-setting-target.txt`). Expected: reject unknown targets and suggest valid names. The known unfiltered quota fallback is documented in `docs/commands.md`, but conflicts with project command UX. `src/ui/commands/index.ts:136-144,185-186,260-261` maps an unresolved quota target to `undefined`; `src/ui/dashboard/settings.ts:38-40` silently ignores an unknown setting. Regression: typo/extra-argument cases for both entry points.

### 12. Minor — `/auth quotas` does not complete its provider argument

Typing `/auth quotas c` shows no provider choices, while `/quota c` offers `claude`, `codex` and Codex login variants (`captures/completion-auth-quota-target.txt`, `captures/completion-quota-target.txt`). Expected: complete providers and relevant aliases after the dashboard section. `src/ui/commands/index.ts:148-155,300` filters only tab names using the whole prefix; the standalone quota command has its own provider completion at `:343-355`. Regression: complete both section and provider tokens through `/auth`.

### 13. Minor — list settings use raw JSON and leave the staged panel

Repro: `/auth settings`, select Quota providers, Enter. The dashboard closes and opens a `Quota providers (JSON)` editor containing `[]` (`captures/settings-list-json-editor.txt`); cancelling reopens the dashboard (`captures/settings-json-cancel.txt`). This is currently documented in `docs/commands.md`, but conflicts with the specifically requested settings-panel design-system convention: type-appropriate controls and a single staged flow rather than asking users to edit JSON. `src/ui/dashboard/settings.ts:149-154` closes the dashboard, and `src/ui/commands/index.ts:203-230` opens the raw JSON editor and separate save selector. Regression: exercise list add/remove and cancellation without JSON or premature persistence.

### 14. Minor — tab changes make the frame jump vertically

At unchanged 80×35 size, the top rule appears on screen row 17 for Providers, row 24 for empty Models rules, and row 5 for the model catalog (`captures/providers-80.txt`, `captures/models-rules-80.txt`, `captures/models-catalog-80.txt`). The pi-workbench convention reserves a stable body height across tabs, so this displacement loses spatial context. `src/ui/frame/index.ts:149-173` slices but does not pad the body; compare the padding in pi-workbench `src/core/menu.ts:242-249`. Regression: switch between short and long tabs without moving the frame and hints.

### 15. Minor — settings labels truncate even at 140 columns

At 140 columns, the setting label appears as `Refresh quotas after reques…` despite a very large empty value column (`captures/settings-140.txt`); its full label is `Refresh quotas after requests` (`src/core/config/catalog.ts:26`). `src/ui/dashboard/settings.ts:187` caps labels at 28 columns irrespective of available space. Expected: use space for the complete label before leaving excess blank space. Regression: check full labels at wide widths and stable column alignment.

### 16. Minor — provider login instructions cannot be recovered at 36 columns

In Providers at 36 columns, every missing-provider row cuts its login command to `/log…`; Codex is cut to `/quo…` (`captures/providers-36.txt`). The description also truncates, and the view has scrolling but no per-provider detail to reveal the complete command. At 80 columns the commands are visible (`captures/providers-80.txt`). Expected: preserve or reveal the actionable provider-specific login instruction at narrow widths. `src/ui/dashboard/rows.ts:12-26` allocates label/value columns and `src/ui/dashboard/tabs.ts:87-110` embeds the recovery action after status. Regression: confirm every provider's login command can be read at 36 columns.

### 17. Cosmetic — model text editor shows a truncation ellipsis for short values

Repro: in a model detail press Enter on the short Name value `infinite:small:vision` at 80 columns. The edit row ends with `…` after a long run of padding even though the value fits (`captures/model-name-edit.txt`). Expected: no ellipsis unless text is actually hidden. `src/ui/dashboard/model-detail.ts:289-311` renders an input sized `width - 5` before adding its label, separators and source; final row truncation adds the ellipsis. `src/ui/dashboard/alias-detail.ts:172-174` uses the same width pattern. Regression: short and long edits at narrow and wide widths.

## Open questions and gaps

- No real credentials, provider traffic, live quota windows/bars/credits, reset-credit actions or OAuth flows were tested. The audit cannot establish live-provider correctness.
- Project save was exercised in a trusted scratch project; untrusted-project rejection was not exercised. Full settings-catalog coverage belongs to the parallel reviewer.
- Theme color codes were captured but contrast was not assessed on physical dark/light terminals. Mouse, screen readers, CJK ambiguous-width locales, concurrent sessions saving the same file, network interruption during a real refresh, and very long user-authored configuration were not tested.
- Review and fixes for the separate `synthetic_web_search` tool renderer are owned by the parent and are outside this report's dashboard focus.
- The project's `AGENTS.md` says “Live verification is authorized and expected” on configured accounts and “`just check` ... is the required gate.” This read-only brief explicitly required offline/no-real-credentials QA and assigned gates to the parent, so those instructions were not followed here. The `extending-pi-agent` skill's example validation and the absent terminal-testing skill were not run/available; no source was changed.
