# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Workbench statusline segment.** With pi-workbench loaded, the quota template is
  registered as `pi-auth-plus:quotas` and rendered inside Workbench's configurable
  statusline, with the same template, coloring and coloring thresholds. Every
  `quotas.linePlacement` stays dormant while that segment owns the row, so the line never
  appears twice. Configure it in `/workbench statusline`.
- **`{in-use}` template gate.** `{in-use}`, `{in-use:short}` and `{provider:in-use}` render
  and hide output by what the session uses: the current model's provider, running
  subagents, and providers under quota pressure.

- **Model management.** `/auth models` edits ordered visibility rules and previews hidden
  models; per-model metadata overrides are saved to Pi's `models.json` with comments and
  unrelated settings preserved.
- **OpenAI response verbosity.** `/auth settings` can set low, medium or high verbosity for
  OpenAI Responses and Codex, with configurable provider scope. The default leaves requests
  unchanged.

### Fixed

- **Removed tool names in a Claude transcript.** A session that still carries tool calls to a
  tool Pi no longer registers (for example the old `Agent` subagent tool) failed every request
  with `tools "…" and "…" share a wire name`. Earlier transcript names now only fill free wire
  slots, so the live tool wins and the session continues; a collision between two live tools is
  still refused.

## [0.4.1] - 2026-10-28

### Fixed

- **Compact menus.** Dashboard tabs use only the rows their content needs, while scrolling on short terminals.

## [0.4.0] - 2026-10-28

### Added

- **Context token counts.** Each session's context is counted for the selected model:
  the last reply's provider usage plus everything after it, with the source of every
  number shown. Claude uses its `count_tokens` endpoint; Synthetic `hf:` models and
  Antigravity gpt-oss use the model's tokenizer when available. Other routes and
  unavailable counters use character estimates. Before the first reply, the request's
  contributions are counted separately.
- **Tokens tab and `/tokens`** (alias `/token`): total, context percentage, Pi's own count
  and the difference, anchor and tail, and a full-request breakdown by contribution.
- **Footer context percentage.** With `quotas.linePlacement = "below-editor-last"`, the
  fallback footer shows the counted percentage; a leading `~` marks a character estimate.
- **Token bus.** `pi-auth-plus:v1:tokens:{ready,context,query}` and the `queryTokens`,
  `onTokenContext` and `onTokensReady` helpers in `@furbyhaxx/pi-auth-plus/bus`.

### Fixed

- **Synthetic context size no longer doubles.** Synthetic repeats the uncached input as a
  cache write, so Pi's footer, context percentage and auto-compaction counted every new
  prompt twice (+100 % on the first turn). A `message_end` correction drops the duplicate;
  cost is unchanged.
- **Synthetic context size is real.** Synthetic reports input tokens in a scaled unit (0.42x
  the real count for DeepSeek models, 2.4x for gpt-oss), while its context limit applies to
  the real count, so Pi's footer and auto-compaction were far off. For `hf:` models the stored
  prompt usage is now recounted with the model's own tokenizer; output and cost are unchanged.
  The tokenizer is downloaded from Hugging Face on first use (pinned revision, hash-checked)
  into `~/.cache/pi-auth-plus/tokenizers/` and used offline after that; without it the
  provider's count stays.
- Antigravity usage never reports a negative input when the cached count exceeds the prompt.

## [0.3.2] - 2026-10-27

### Fixed

- **Named windows tolerate older cache writers.** When several windows share a period,
  a window whose id equals the name wins, so sessions still running v0.3.0 can no longer
  turn the claude 7d value into `?` through the shared cache.

## [0.3.1] - 2026-10-27

### Fixed

- **pi-quotas template carry-over uses Pi ids.** Provider names in a carried-over
  `lineTemplate` become Pi ids, so `{grok:id}` shows `xai` instead of `grok`.
- **Claude 7d line value.** The `7d_oi` ("7d overage included") rate-limit header now
  carries the scope `overage included`, so `{claude:window-7d-used-percent}` no longer
  turns into `?` once Anthropic sends that header; the variant is
  `window-7d-overage-included-used-percent`.

## [0.3.0] - 2026-10-27

### Added

- **Quota engine (preview).** Quotas for `claude`, `antigravity`, `synthetic`, `codex`
  (ChatGPT), `xai`, `openrouter` and `deepseek` refresh in the background into a cache shared
  by all Pi sessions on the host, with per-provider backoff on 403/429 and a drainage history.
  Windows a provider reports without numbers show as unknown, never as 0%. The engine stays off
  while pi-quotas is loaded; `/quota` takes over when pi-quotas is removed, in a later release.
- **Quota line.** The pi-quotas status line, with the same template grammar, keyed by Pi ids
  (`{codex:pct}`; `{openai:pct}`, `{cl:pct}` and other aliases still resolve). Placements
  `above-editor`, `below-editor-first`, `below-editor-last` (pi-workbench's footer when it runs,
  else a footer of its own) and `off`; short ids below `quotas.compactWidthCols`. Settings:
  `quotas.linePlacement`, `percentDisplay`, `compactWidthCols`, `alwaysShortIds`,
  `creditHealthyUsd`, `creditCriticalUsd`, `lineTemplate` in `auth-plus.json`.
- **`/auth quotas` and `/quotas [provider]`.** Live quota detail per provider: bars, reset
  countdowns, drainage, sign-in hints; `r`/`R` refresh, `a` solo, `p` moves the line.
- **`/auth settings`.** Edit every pi-auth-plus setting with staged changes, save to user,
  project or this session (`ctrl+s`), a live line-template preview, and JSON editing for
  list and rule settings.
- **Quota updates from responses.** A claude or ChatGPT turn updates that provider's windows
  from its response headers, without an extra request.
- **Quotas bus.** Extensions can query and refresh quotas and watch snapshots and
  auth/rate-limit events on `pi-auth-plus:v1:quotas:*`; provider names accept aliases.
- **Quota resets.** A codex (ChatGPT) reset credit can be spent with `x` in the Quotas tab or
  `/quotas reset [provider]`, always behind a dialog whose first choice keeps the credit. The
  consume request is sent once and never retried. Other extensions can list credits on the bus
  (`resets`) and request one (`reset`); the user still confirms in the session, and without a
  UI nothing is spent.
- **`--quotas-json [provider]` and `--quotas-list [provider]`.** Print the quota report as JSON
  or a table and exit before Pi starts. Credentials resolve through Pi, so OAuth refresh works
  as in a session; only user-scope settings apply. Exit 0 all ok, 1 a provider not ok,
  2 usage error. There is no CLI reset.
- Quota aliases from pi-quotas: `cl` and `cc` for claude, `ag` for antigravity.
- **ChatGPT quota as `codex`, with `/quota codex login [--device|--browser]`.** Pi's `openai`
  login ("Sign in with ChatGPT") is rejected by ChatGPT's usage endpoints, so the `codex`
  quota reads Pi's `openai-codex` login, else pi-quotas' `quotas-codex-auth.json`. The
  command writes that file without adding models to the picker; refreshes run under a file
  lock. `openai`, `openai-codex`, `chatgpt`, `cx`, `cox` and `oai` are aliases. The Providers
  tab and the Quotas tab show the codex login commands instead of `/login codex`.
- **pi-quotas carry-over.** On the first start without pi-quotas, its settings fill unset
  `quotas.*` keys and its drainage history merges into the host cache, once per source;
  nothing already set is overwritten, and a malformed source is retried on the next start.
- **`@furbyhaxx/pi-auth-plus/bus`.** A typed client for the quotas bus: `queryQuotas`,
  `refreshQuotas`, `listQuotaResets`, `requestQuotaReset` and `subscribeQuota*`, with
  validated replies and request timeouts.
- Quota reports and `--quotas-list` show available on-demand reset credits.
- **Antigravity login carry-over.** On the first session start, a pi-antigravity-auth login
  stored under Pi's `google` slot is copied into an empty `antigravity` slot, under the same
  file lock Pi's `/login` takes. The `google` slot is left untouched. On failure a warning
  points to `/login antigravity`.

### Changed

- `just rpc-verify` runs against a throwaway agent dir.
- **pi-quotas cutover.** `/quota [provider]` now shares `/quotas` routing, completions and
  reset commands. pi-quotas is reported as a conflict with a removal hint; remove it to enable
  the quota engine. Keeping both packages loaded lets Pi rename duplicate `/quota` commands
  to `/quota:1` and `/quota:2`.

### Fixed

- Two sessions writing the quota cache in the same millisecond no longer lose one write.
- **Antigravity turns never hang.** A turn fails with `RESPONSE_TIMEOUT` when no response
  headers arrive, and with `STREAM_STALLED` when the stream sends nothing, each after 180 s or
  Pi's `timeoutMs`.
- **Antigravity request hooks.** `before_provider_request` and `after_provider_response`
  extensions now see Antigravity turns, and a payload they return is what gets sent.

## [0.2.0] - 2026-10-27

### Added

- **OpenCode Zen.** Pi's builtin `opencode` and `opencode-go` get the opencode 2.1.2 CLI
  identity, so anonymous free models (`opencode/big-pickle` and others) answer without a key.
  The anonymous key is used only when no `OPENCODE_API_KEY`, stored login or models.json key
  exists, and it is registered at startup, so `--model opencode/...` and session restore work.
- **Synthetic.** The `synthetic` provider logs in through `/login synthetic` or
  `SYNTHETIC_API_KEY`. Its catalog has real prices and limits, refreshes in the background,
  and is never fetched at startup.
- **Synthetic web search.** The opt-in `synthetic_web_search` tool, enabled by
  `"synthetic": { "webSearch": true }` in `auth-plus.json` or `--synthetic-web-search` for one
  run. It returns each result's relevant passages and saves the full page text to a file, and
  it keeps results without a publication date, which pi-synthetic-auth dropped.
- **Claude Pro/Max.** The `claude` provider logs in through `/login claude` (Claude Pro/Max
  OAuth with a pasted code, or an API key typed in, created from the console, or taken from
  `ANTHROPIC_API_KEY`). Subscription turns look like the interactive Claude Code CLI on the
  wire: its identity and billing blocks, beta set, session header, request metadata and bare
  tool names (`Bash`, `WebSearch`, restored in streamed and JSON responses), at zero cost.
  API-key turns use Pi's Anthropic path unchanged. Logins stored by pi-claude-auth carry over.
  Compared with pi-claude-auth, the `mcp_` tool prefix and the `cch` billing field are gone,
  since the real CLI sends neither.
- **Claude version.** The reported Claude Code version is the newest of the pinned 2.1.306 and
  the installed `claude`, overridable by `ANTHROPIC_CLAUDE_CODE_VERSION`. The `claude --version`
  probe now runs on the first request instead of at startup.
- **Claude replace patterns.** `"claude": { "replacePatterns": [{ "match": "...",
  "replacement": "..." }] }` in `auth-plus.json` rewrites system-prompt text; without
  `replacement` the paragraph is dropped.
- **Antigravity.** The `antigravity` provider logs in through
  `/login antigravity` with Google OAuth and the agy 1.4.8 CLI identity. It offers one model per
  family (`gemini-4-argon`, `gemini-3.8-flash`, `claude-opus-5-5`, `claude-sonnet-5-5`,
  `gpt-oss-120b`); Pi's thinking level picks the wire level, so `/model` lists five entries
  instead of one per level. The catalog refreshes from the account's entitlements, with a
  bundled snapshot for the first run. Turns cost zero. Compared with pi-antigravity-auth: provider
  id `antigravity` instead of `google`, one account (no pool), no Claustrum vault, no
  `@cortexkit/*` packages, plain `fetch` instead of the raw TLS client, and the project id is
  looked up per session instead of being packed into the stored refresh token.
- **Settings file.** `<agentDir>/auth-plus.json` and, in trusted projects, `.pi/auth-plus.json`;
  invalid values warn and fall back to the inherited value.
- **Providers tab.** Shows environment, models.json and anonymous credentials beside stored
  logins.

### Known limits

- pi-claude-auth's replace patterns in Pi's `settings.json` are not read yet; move them to
  `claude.replacePatterns` in `auth-plus.json`.
- pi-synthetic-auth's `websearch.synthetic` setting and `SYNTHETIC_WEB_SEARCH` variable are
  not read yet; set `synthetic.webSearch` in `auth-plus.json` instead.
- pi-antigravity-auth logins under Pi's `google` slot are not carried over yet, because Pi
  gives extensions no credential-store write; run `/login antigravity` once.
- Anonymous OpenCode Zen works from Pi-Bolt only. Zen refuses stock Pi's Node HTTP client with
  `429 FreeUsageLimitError` regardless of headers. Keyed Zen requests are untested.

## [0.1.0] - 2026-10-27

### Added

- **Package scaffold.** Bun, TypeScript and Biome tooling with an isolated test setup; the
  extension loads but registers no providers yet.
- **`/auth` dashboard.** Providers, Quotas, Tokens and Settings tabs in one panel; `/quota`,
  `/quotas` and `/tokens` open their tab. Without a TUI the dashboard prints as text. Tabs are
  empty until provider families land.
- **Absorbed-package warning.** Loading pi-claude-auth, pi-opencode-auth, pi-synthetic-auth,
  pi-antigravity-auth or pi-quotas next to pi-auth-plus warns once and names the command that
  removes each.

[Unreleased]: https://github.com/furbyhaxx/pi-auth-plus/compare/v0.3.2...dev
[0.3.2]: https://github.com/furbyhaxx/pi-auth-plus/releases/tag/v0.3.2
[0.3.1]: https://github.com/furbyhaxx/pi-auth-plus/releases/tag/v0.3.1
[0.3.0]: https://github.com/furbyhaxx/pi-auth-plus/releases/tag/v0.3.0
[0.2.0]: https://github.com/furbyhaxx/pi-auth-plus/releases/tag/v0.2.0
[0.1.0]: https://github.com/furbyhaxx/pi-auth-plus/releases/tag/v0.1.0
