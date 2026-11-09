---
document:
  type: "design"
  id: "design-auth-dashboard"
  title: "/auth dashboard: frame, screens and interaction standard"
  description: "Approved wireframes and UI/UX/keyboard/mouse conventions for the tabbed /auth dashboard"
  status: "draft"
  revision: 1
  created_at: "2026-11-09T16:45:00+01:00"
  updated_at: "2026-11-09T16:45:00+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["21 wireframes at 96 columns, conventions approved by the user; standard also encoded in the extending-pi-agent and extending-pig skills"]
---

# /auth dashboard

Approved layout and interaction standard for `/auth`. The generic rules live in the `extending-pi-agent`
skill (`references/dashboard-standard.md`); this file applies them to pi-auth-plus data. Implementation is
not started; screens differ from the current dashboard in the points under "Changes from today".

## Changes from today

- One nine-line frame on every screen; fixed height while open (tallest tab, capped at terminal rows minus Pi's
  chrome). Live-transcript-style views may declare full height; none exist here.
- Tabs: Providers, Quotas, Tokens, Models, Groups, Settings (Groups becomes a tab).
- Rules use the current thinking-level color; tab bar uses theme tokens (inactive neutral background, active accent
  background plus bold, `❱` without background).
- New: provider detail screen (Enter on a provider); Quotas is a summary list with a per-provider detail.
- No single-key actions. Printable keys always type into the search line. Actions are `alt+` chords; nested editors end
  in a `✓ Apply` row; scope prompt and confirms are lists.
- Staged marker is `▲` (`●` means signed in or live).
- Model catalog, model pickers and group member pickers show only models of signed-in providers.

## Frame

```
─ {breadcrumbs} ──────────── {previous: ↑ N more} ───────────── {right status} ─
  ❱ Tab ❱«Active»❱ Tab                           tab bar
 ⌕ search / filter                               always present
                                                 blank
  body: fixed rows, scrolls inside               never changes height
─────────────── {following: ↓ N more} ───────────
 description (one line, never unique information)
 key hints (user's bindings, lowest priority dropped first, esc kept)
──────────────────────────────────────────────
```

## Conventions

- **Colors:** every `─` run uses `theme.getThinkingBorderColor(pi.getThinkingLevel())`, read at open and on
  `thinking_level_select`; fallback `border`. Text inside rules is dim. Inactive tab: neutral background token; active tab:
  accent background, contrast text, bold; `❱` no background. Theme tokens only.
- **Glyphs:** `●` signed in or live, `◐` limited or anonymous, `○` signed out, `⚠` warning, `✗` error, `◌` loading, `▲` staged,
  `[x]` `[ ]` toggles, `‹ v ›` cycled value, `+` add row, `↻` reset time, `↳` alias, `→` cursor. Color is never the only signal.
- **Rows:** cursor, fixed label column, value, right-aligned secondary value or source. Name and primary state survive truncation.
- **Numbers:** `–` for not reported, never `0`; each number names its source; bars show used allowance with `%`.
- **Keys:** `tab`/`shift+tab` or `←`/`→` switch tabs; `↑↓` `pgup/pgdn` move; `alt+↑↓` scroll a line; `enter` open or activate;
  `esc` clears filter, then cancels an edit, then goes back, then closes (asks when dirty); `ctrl+c` closes everything; `f1` help;
  `ctrl+s` save with scope prompt; `ctrl+u` clear filter; `alt+r` refresh/recount; `alt+a` refresh all; `alt+n` new; `alt+d` delete
  (asks); `alt+t` toggle; `alt+u` default value; `alt+v` rules/catalog view; `alt+h` hide/show model; `alt+i` identity; `alt+o` solo;
  `alt+p` line position; `alt+x` spend reset (asks); `shift+alt+↑↓` reorder. Hints come from the user's bindings.
- **Mouse (fullscreen only):** wheel scrolls, click selects, second click activates, tab click switches, click on `↑/↓ N more` pages,
  hover highlights without moving selection; destructive rows still confirm. Every action has a key.
- **Staging:** edits survive tab switches; leaving asks and lists where drafts are; save asks for a scope and refuses a malformed file.
- **Widths:** check 36, 57, 80, 140 and one short terminal; secondary columns go first; tab bar scrolls with `n/N` at 36.
- **Headless:** read-only text per section; interactive actions name the alternative.

## Wireframes (96 columns)

Legend: `«Tab»` active tab on the accent background, `❱ Tab ` inactive tab on a neutral background, `→` cursor.
Samples are made-up numbers.

### 1. Providers
```
── Auth › Providers ─────────────────────────────────────────────── 9 providers · 7 signed in ──
  ❱«Providers»❱ Quotas ❱ Tokens ❱ Models ❱ Groups ❱ Settings
 ⌕ Type to filter…

→ Claude          ● subscription · Max 20x · expires in 6h 12m      5h 6% · 7d 58%
  Antigravity     ● subscription · expires in 41m                   gem 59% · arg 35%
  OpenAI Codex    ● subscription (openai-codex) · expires in 9d     5h 12% · 7d 31%
  Synthetic       ● API key                                         66% of pack
  OpenCode Zen    ◐ anonymous · free models only · /login opencode
  OpenCode Go     ○ not signed in · /login opencode-go
  xAI             ● API key from XAI_API_KEY                        $12.40 left
  OpenRouter      ● API key                                         $29.35 left
  DeepSeek        ● API key                                         $20.41 left

────────────────────────────────────────────────────────────────────────────────────────────────
 Sign-in state, plan, expiry and headline quota per provider. Sign in with /login <provider>.
 ↑↓ move · enter details · tab/shift+tab tab · type to filter · f1 help · esc close
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 2. Provider detail (Enter on a provider)
```
── Auth › Providers › Claude ────────────────────────────────────────────── claude · alias cl ──
  ❱«Providers»❱ Quotas ❱ Tokens ❱ Models ❱ Groups ❱ Settings
 ⌕ Filter fields…

  Provider       claude (Claude subscription) · alias cl
  Credential     ● OAuth in auth.json · expires in 6h 12m · refreshes on next request
  Plan           Max 20x
  Logout         /logout claude
  Models         4 listed · 0 hidden · 1 alias                         → open in Models
  Quota          5h 6% · 7d 58% · Fable 18% · $250 cap 100%            → open in Quotas
  Tokens         native count endpoint (count_tokens)
  Wire identity  Claude Code CLI <pinned version> · installed newer wins
  Settings       cacheRetention long · 2 prompt rules                  → open in Settings

────────────────────────────────────────────────────────────────────────────────────────────────
 Everything pi-auth-plus knows about one provider. Read-only; jumps open the owning tab.
 ↑↓ move · enter open · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 3. Quotas (one summary row per provider; Enter opens the detail)
```
── Auth › Quotas ─────────────────────────────────────── refreshed 2m ago · line below editor ──
  ❱ Providers ❱«Quotas»❱ Tokens ❱ Models ❱ Groups ❱ Settings
 ⌕ Type to filter…

→ Claude         5h  ▕█░░░░░░▏  6% ↻4h16m · 7d ▕████░░░▏ 58% ↻4d2h          2m ago
  Antigravity    gem ▕████░░░▏ 59% ↻21h54m · arg ▕██░░░░░▏ 35% ↻6d19h        54s ago
  OpenAI Codex   5h  ▕█░░░░░░▏ 12% ↻3h02m · 7d ▕██░░░░░▏ 31% ↻5d1h · 1 reset  1m ago
  Synthetic      pack ▕█████░░▏ 66% ↻ monthly                                 3m ago
  OpenRouter     credits $29.35 left                                          1m ago
  DeepSeek       credits $20.41 left                                          1m ago
  xAI            credits $12.40 left · ⚠ low                                  1m ago
  OpenCode Go    ○ not signed in · /login opencode-go
  OpenCode Zen   – no quota endpoint (anonymous)

────────────────────────────────────────────────────────────────────────────────────────────────
 Usage windows and credits per provider; each provider's own numbers, unknown stays unknown.
 ↑↓ move · enter details · alt+r refresh · alt+a all · alt+o solo · alt+p line · alt+x reset
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 4. Quota detail
```
── Auth › Quotas › Claude ─────────────────────────────────────────────── fetched 2m ago · ok ──
  ❱ Providers ❱«Quotas»❱ Tokens ❱ Models ❱ Groups ❱ Settings
 ⌕ Filter windows…

  5h session   ▕██░░░░░░░░░░░░░░▏   6% used · ↻ 4h 16m
               10.6%/h window · 10.6%/h 1h · 10.6%/h 24h · resets before empty
  7d weekly    ▕█████████░░░░░░░▏  58% used · ↻ 4d 2h
               3.2%/h window · 2.4%/h 1h · 3.2%/h 24h · empty in 12h 58m
  7d Fable     ▕███░░░░░░░░░░░░░▏  18% used · ↻ 4d 2h
               1.3%/h window · 1.2%/h 1h · 1.3%/h 24h · empty in 2d 15h
  $250 cap     ▕████████████████▏ 100% used ($250.22 / $250) · ↻ 8d 16h
               0.0%/h · source: api.anthropic.com/api/oauth/usage · HTTP 200


────────────────────────────────────────────────────────────────────────────────────────────────
 Every window the provider exposes, with burn rate and projected exhaustion.
 ↑↓ scroll · alt+r refresh · alt+x reset · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 5. Quota reset confirmation (alt+x)
```
── Auth › Quotas › OpenAI Codex › Reset ─────────────────────────────────────── 1 credit left ──
  ❱ Providers ❱«Quotas»❱ Tokens ❱ Models ❱ Groups ❱ Settings
 ⌕ 

  Spend one OpenAI Codex rate-limit reset?

  Credits     1 of 1 available · next grant in 12d
  Applies to  the windows OpenAI resets (shown after the reset, not guessed)

→ No, keep the credit
  Yes, spend 1 reset



────────────────────────────────────────────────────────────────────────────────────────────────
 Resets are irreversible and spend a limited credit.
 ↑↓ move · enter choose · esc cancel
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 6. Quota line position (alt+p)
```
── Auth › Quotas › Line position ─────────────────────────────── current: below editor, first ──
  ❱ Providers ❱«Quotas»❱ Tokens ❱ Models ❱ Groups ❱ Settings
 ⌕ 

→ Below editor, first      ● current
  Below editor, last
  Above editor
  Footer status
  Hidden

  Preview  cl: 5h/6% 7d/58% · ag: gem/59% arg/35% · syn: 66% · or: $29.35



────────────────────────────────────────────────────────────────────────────────────────────────
 Where the quota line renders. Saving asks for a scope.
 ↑↓ move · enter choose · ctrl+s save · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 7. Tokens
```
── Auth › Tokens ────────────────────────────────────────────── claude/claude-opus-5-5 · high ──
  ❱ Providers ❱ Quotas ❱«Tokens»❱ Models ❱ Groups ❱ Settings
 ⌕ Filter breakdown…

  Context     ▕████░░░░░░░░░░░░▏ 24.1% of 200K · 48,211 tokens
  Source      ● provider usage (authoritative)
  Pi          46,980 · Δ +1,231 vs Pi estimate
  Anchor      assistant usage 2 turns ago · tail 1,402 estimated

  Breakdown   full request · native count endpoint
  system      7,204   ▕██░░░░░░▏ 15%   3 blocks
  tools       12,880  ▕███░░░░░▏ 27%   41 tools
  messages    28,127  ▕█████░░░▏ 58%   86 messages

────────────────────────────────────────────────────────────────────────────────────────────────
 Live session context count, where it came from, and what fills it.
 ↑↓ scroll · alt+r recount · esc close
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 8. Models: rules
```
── Auth › Models › Rules ──────────────────────────────────── 3 rules · 212 hidden · ▲ staged ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱«Models»❱ Groups ❱ Settings
 ⌕ Type to filter…

→ 1  openrouter/*                       hides 198
  2  !openrouter/google/*               shows 11
  3  synthetic/hf:example/*             hides 25
  4  # xai/grok-4.7                     disabled

  Catalog  412 models from 7 signed-in providers · 200 listed · 212 hidden
  Not shown: 2 signed-out providers (opencode-go, …)



────────────────────────────────────────────────────────────────────────────────────────────────
 Last matching rule wins; ! shows, # disables. shift+alt+↑↓ reorders.
 ↑↓ move · enter edit · alt+n new · alt+t toggle · alt+d delete · alt+v catalog · ctrl+s save
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 9. Models: catalog (search active)
```
── Auth › Models › Catalog ──────────────────────────────────────── 1–8 of 23 matching "opus" ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱«Models»❱ Groups ❱ Settings
 ⌕ opus▏

→ claude/claude-opus-5-5             Claude Opus 5.5              listed
  claude/claude-fable-5-1            Claude Fable 5.1             listed · rule 2
  antigravity/claude-opus-5-5        Claude Opus 5.5 (AG)         listed
  openrouter/anthropic/claude-opus…  Claude Opus 5.5              hidden · rule 1
  openrouter/anthropic/claude-opus…  Claude Opus 5.1              hidden · rule 1
  openrouter/anthropic/claude-fabl…  Claude Fable 5.1             hidden · rule 1
  claude/opus                        alias of claude-opus-5-5     listed
  claude/opus-long                   alias · 1M context           listed


────────────────────────────────────────── ↓ 15 more ───────────────────────────────────────────
 Only models from signed-in providers. Enter edits overrides; alt+h appends a hide/show rule.
 ↑↓ move · pgup/pgdn page · enter details · alt+h hide/show · alt+i identity · alt+v rules
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 10. Model detail
```
── Auth › Models › claude/claude-opus-5-5 ─────────────────────────────── listed · ▲ 1 staged ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱«Models»❱ Groups ❱ Settings
 ⌕ Filter fields…

→ Name               Claude Opus 5.5                       provider
  Context window     200,000 → ▲ 1,000,000                 staged
  Max tokens         64,000                                provider
  Reasoning          on                                    provider
  Input              text, image                           provider
  Cost in / out      $0 / $0 per 1M (subscription)         provider
  Response verbosity –                                     n/a
  Visibility         listed · no matching rule
  Aliases            opus, opus-long                       → enter to manage
  + New alias
────────────────────────────────────────────────────────────────────────────────────────────────
 Overrides apply on top of the provider's catalog; user scope only.
 ↑↓ move · enter edit · alt+u default · ctrl+s save · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 11. Alias detail
```
── Auth › Models › claude/claude-opus-5-5 › opus-long ────────────────────── alias · ▲ staged ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱«Models»❱ Groups ❱ Settings
 ⌕ Filter fields…

→ Alias ID           opus-long
  Source             claude/claude-opus-5-5
  Display name       Claude Opus 5.5 (1M)
  Context window     1,000,000
  Max tokens         64,000

  Remove alias       asks first



────────────────────────────────────────────────────────────────────────────────────────────────
 An alias is a second selectable id for the same physical model.
 ↑↓ move · enter edit · alt+d remove · ctrl+s save · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 12. Groups
```
── Auth › Groups ─────────────────────────────────────────────────────────────────── 2 groups ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱ Models ❱«Groups»❱ Settings
 ⌕ Type to filter…

→ group/smart     failover · 3 members · 200K   ● claude/claude-opus-5-5 selected
  group/cheap     balance  · 2 members · 128K   ● synthetic/hf:…/DeepSeek-V4.1-Flash

  + New group






────────────────────────────────────────────────────────────────────────────────────────────────
 Virtual models that route to members and fail over on rate limit, quota or auth errors.
 ↑↓ move · enter edit · alt+n new · alt+d delete · ctrl+s save · esc close
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 13. Group detail
```
── Auth › Groups › smart ──────────────────────────────────────────────── failover · ▲ staged ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱ Models ❱«Groups»❱ Settings
 ⌕ Filter fields…

→ Group ID          smart
  Display name      Smart
  Strategy          ‹ failover ›   sticky · failover · balance · random
  Triggers          [x] rate-limit  [x] quota  [ ] auth
  Context window    200,000 (smallest member 200,000)
  Member 1          claude/claude-opus-5-5          ● 5h 6% · 7d 58%
  Member 2          antigravity/claude-opus-5-5     ● arg 35%
  Member 3          openai-codex/gpt-6.1-sol        ● 7d 31%
  + Add member

────────────────────────────────────────────────────────────────────────────────────────────────
 Members are tried in order; quota state decides balance and failover.
 ↑↓ move · ←→ change · enter edit · shift+alt+↑↓ order · alt+d remove · ctrl+s save · esc
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 14. Group member picker
```
── Auth › Groups › smart › Add member ──────────────────────────────────────────── 1–8 of 200 ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱ Models ❱«Groups»❱ Settings
 ⌕ Search signed-in models…

→ claude/claude-sonnet-5-5           Claude Sonnet 5.5
  claude/claude-haiku-5-5            Claude Haiku 5.5
  antigravity/gemini-4-argon         Gemini 4 Argon
  openai-codex/gpt-6-luna            GPT-6 Luna
  synthetic/hf:…/DeepSeek-V4.1-Flash DeepSeek V4.1 Flash
  xai/grok-4.7                       Grok 4.7
  openrouter/google/gemini-4-argon   Gemini 4 Argon
  claude/claude-fable-5-1            Claude Fable 5.1


────────────────────────────────────────── ↓ 192 more ──────────────────────────────────────────
 Only models from signed-in providers that are not already members.
 ↑↓ move · pgup/pgdn page · enter add · alt+i identity · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 15. Settings
```
── Auth › Settings ───────────────────────────────────────────────── 29 settings · ▲ 1 staged ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱ Models ❱ Groups ❱«Settings»
 ⌕ Type to filter…

  Quotas
→   Refresh interval          ▲ 120 s                          staged → user
    Refresh after requests      on                             default
    Providers                   all sources                    user
    Line placement              Below editor, first            user
    Line template               {claude:id}: {claude:5h}…      project
  Claude
    Cache retention             long                           user
    Prompt rules                2 rules                        user
  Synthetic
────────────────────────────────────────── ↓ 19 more ───────────────────────────────────────────
 Seconds between endpoint refreshes; provider polling floors still apply.
 ↑↓ move · ←→ change · enter edit · alt+u default · ctrl+s save · esc close
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 16. Settings: quota provider list
```
── Auth › Settings › Quota providers ──────────────────────────────────── empty = all sources ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱ Models ❱ Groups ❱«Settings»
 ⌕ Filter providers…

→ [x] claude          Claude
  [x] antigravity     Antigravity
  [x] codex           OpenAI Codex
  [ ] synthetic       Synthetic
  [x] openrouter      OpenRouter
  [ ] xai             xAI
  [ ] deepseek        DeepSeek
  ⚠ zai               unknown id · alt+d removes it
  + Custom ID
  ✓ Apply to Settings
────────────────────────────────────────────────────────────────────────────────────────────────
 Toggle providers or add a custom ID. Apply stages the list back into Settings.
 ↑↓ move · enter toggle · alt+n custom · alt+d remove · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 17. Settings: Claude prompt rules
```
── Auth › Settings › Claude prompt rules ──────────────────────────────────────────── 2 rules ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱ Models ❱ Groups ❱«Settings»
 ⌕ Filter rules…

→ 1 rewrite  match   "You are Pi, a coding agent"
             replace "You are Claude Code, Anthropic's official CLI"
  2 drop     match   "Pi documentation (read only when"

  + Rewrite rule
  + Drop rule
  ✓ Apply to Settings



────────────────────────────────────────────────────────────────────────────────────────────────
 Literal match; an omitted replacement drops matching paragraphs.
 ↑↓ move · enter edit · alt+n new · shift+alt+↑↓ order · alt+d delete · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 18. Settings: quota line template
```
── Auth › Settings › Quota line template ──────────────────────────── valid · 1 ignored token ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱ Models ❱ Groups ❱«Settings»
 ⌕ 

  Template
→ {claude:id}: {claude:5h}/{claude:7d} · {antigravity:id}: {antigravity:gem}▏

  Preview at 96 cols
  cl: 5h/6% 7d/58% · ag: gem/59%
  Preview at 57 cols
  cl: 5h/6% 7d/58% · ag: gem/59%

  ⚠ {xai:credits-left} ignored: xai is not in quota providers

────────────────────────────────────────────────────────────────────────────────────────────────
 Tokens are {provider:field}; the preview updates live.
 enter stage · pgup/pgdn page preview · esc cancel
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 19. Save scope prompt (ctrl+s)
```
── Auth › Settings › Save ──────────────────────────────────────────────────────── ▲ 3 staged ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱ Models ❱ Groups ❱«Settings»
 ⌕ 

  Save 3 staged values to:

→ User      ~/.pig/agent/auth-plus.json                      2 values
  Project   .pig/auth-plus.json · trusted project            1 value
  Session   this session only · not written to disk

  ⚠ quotas.refreshIntervalSec stays overridden by project scope after a user save



────────────────────────────────────────────────────────────────────────────────────────────────
 Saving keeps unknown keys, refuses a malformed file and reports keys still overridden above.
 ↑↓ move · enter save · esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 20. Discard confirmation (esc with staged edits)
```
── Auth › Models › Rules ───────────────────────────────────────────────────────── ▲ 2 staged ──
  ❱ Providers ❱ Quotas ❱ Tokens ❱«Models»❱ Groups ❱ Settings
 ⌕ 

  Discard 2 staged changes?

    Models     1 rule edited
    Settings   1 value

→ Keep editing
  Discard and close



────────────────────────────────────────────────────────────────────────────────────────────────
 Staged edits are lost; saved values are unchanged.
 ↑↓ move · enter choose · esc keep editing
────────────────────────────────────────────────────────────────────────────────────────────────
```

### 21. Help (f1)
```
── Auth › Help ──────────────────────────────────────────────────────────────────── Providers ──
  ❱«Providers»❱ Quotas ❱ Tokens ❱ Models ❱ Groups ❱ Settings
 ⌕ Filter help…

  Navigation
    tab / shift+tab     next / previous tab
    ↑↓                  move · alt+↑↓ scroll a line
    enter               open · esc clear filter, back, then close
    printable keys      always type into the filter; actions use alt+…
  Editing
    ctrl+s              save staged values, then pick a scope
    alt+u               stage the default value for a field
  Providers
    Sign in with /login <provider>; pi-auth-plus never logs in.
────────────────────────────────────────── ↓ 24 more ───────────────────────────────────────────
 Full descriptions and bindings; drafts are kept.
 ↑↓ scroll · f1/esc back
────────────────────────────────────────────────────────────────────────────────────────────────
```
