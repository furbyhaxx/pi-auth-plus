---
document:
  type: "plan"
  id: "plan-0007-auth-dashboard-frame"
  title: "/auth dashboard: nine-line frame, fixed height, chord keys"
  description: "Implementation slices that bring the dashboard to the approved design"
  status: "draft"
  revision: 1
  created_at: "2026-11-09T17:00:00+01:00"
  updated_at: "2026-11-09T17:00:00+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["slices S1-S8 derived from design-auth-dashboard and the current src/ui code"]
---

# Plan 0007: /auth dashboard frame

Design: `../../designs/auth-dashboard/design.md`. Standard: `extending-pi-agent/references/dashboard-standard.md`.

## Current state (measured)

- `src/ui/frame/index.ts`: 5-row frame with a compact mode, height follows the terminal budget per render (`layoutFor`);
  rules use `border`/`borderAccent`, not the thinking-level color.
- 46 single-letter key branches in 8 files (`quotas`, `models`, `model-detail`, `model-picker`, `alias-detail`, `groups`,
  `group-detail`, `settings`): violates the no-single-key rule.
- No `handleMouse`. Groups is already a tab. No provider detail screen. Scope prompt and confirms use letters.

## Slices (each ends with `just check`, captures at 36/57/80/140 and a commit)

| Slice | Outcome | Test that must fail when it breaks |
|---|---|---|
| S1 Frame | Nine-line frame: top rule with breadcrumbs/right status/`↑ N more`, tab bar, search line, blank, body, middle rule with `↓ N more`, description, hints, bottom rule. Fixed height computed on open and resize; short terminal shortens body only. | height equal across tabs/filters/drill-ins; every line fits 36/57/80/140; hints drop from the end, `esc` kept |
| S2 Colors | Rules painted with `getThinkingBorderColor(level)` read on open and `thinking_level_select`, fallback `border`; tab bar tokens: inactive neutral background, active accent background + bold, `❱` unpainted; contrast text from accent lightness. | painter changes with level; active tab distinguishable without color (bold) |
| S3 Key model | Frame owns printable keys: feeds the filter unless a screen reports an inline input open. Replace the 46 letter branches with chords (`alt+n/d/t/u/v/h/i/o/p/x/r/a`, `shift+alt+↑↓`); scope prompt, confirms and nested editors (`✓ Apply` row) become lists. Hints from user bindings. | every printable ASCII key sent to the frame and each screen triggers no action |
| S4 Screens | Provider detail (new), Quotas summary + detail, Models rules/catalog/detail/alias, Groups list/detail/picker, Settings editors, save scope, discard confirm, help, all in the new frame. Signed-in-only catalogs with an omitted-count line. | rendered-line snapshots per screen at 4 widths |
| S5 Mouse | `handleMouse`: wheel, click, double click, tab click, `↑/↓ N more` paging, hover without moving selection; destructive rows still confirm. | event table tests on the hit map of the last render |
| S6 Config | Remove `maxBodyRows`/density settings that the fixed height replaces, with a reader for old settings (stored formats change only with a reader). | old settings files still load |
| S7 Docs | `docs/commands.md` keys table, `docs/configuration.md`, `CHANGELOG.md` Unreleased, `AGENTS.md` "Not yet aligned" line removed when done. | n/a |
| S8 Live | Captures at 36/57/80/140 + short terminal, two thinking levels, fullscreen and regular; `pi-bolt -e ./src/index.ts`, `just rpc-verify`. | evidence under `.project/analyses/auth-dashboard/captures/` |

## Order and risk

S1 and S2 first (everything renders through them), then S3 (largest edit, touches all eight screen files), then S4, S5, S6.
Risk: chord availability on the user's terminal; hint rows must name a working alternative. Open: confirm S6 (dropping
`maxBodyRows`/density) with the user before it lands, since it removes two settings.
