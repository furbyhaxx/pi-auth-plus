# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Quota engine (preview).** Quotas for `claude`, `antigravity`, `synthetic`, `openai`
  (ChatGPT), `xai`, `openrouter` and `deepseek` refresh in the background into a cache shared
  by all Pi sessions on the host, with per-provider backoff on 403/429 and a drainage history.
  Windows a provider reports without numbers show as unknown, never as 0%. The engine stays off
  while pi-quotas is loaded; the status line and `/quota` arrive in later releases.
- Quota aliases from pi-quotas: `cl` and `cc` for claude, `ag` for antigravity.
- **Antigravity login carry-over.** On the first session start, a pi-antigravity-auth login
  stored under Pi's `google` slot is copied into an empty `antigravity` slot, under the same
  file lock Pi's `/login` takes. The `google` slot is left untouched. On failure a warning
  points to `/login antigravity`.

### Changed

- `just rpc-verify` runs against a throwaway agent dir.
- pi-quotas is no longer reported as a conflict, and `/quota`, `/quotas` and `/tokens` are not
  registered until the quota and token engines land, so pi-quotas keeps its `/quota` (Pi
  renamed both to `/quota:1` and `/quota:2`). Use `/auth quotas` for the tab.

### Fixed

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

[Unreleased]: https://github.com/furbyhaxx/pi-auth-plus/compare/v0.2.0...dev
[0.2.0]: https://github.com/furbyhaxx/pi-auth-plus/releases/tag/v0.2.0
[0.1.0]: https://github.com/furbyhaxx/pi-auth-plus/releases/tag/v0.1.0
