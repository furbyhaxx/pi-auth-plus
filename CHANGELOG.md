# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  `ANTHROPIC_API_KEY`). Subscription turns carry Claude Code's identity and billing block, the
  `mcp_` tool names (restored in streamed and JSON responses), and zero cost; API-key turns use
  Pi's Anthropic path unchanged. Logins stored by pi-claude-auth carry over.
- **Claude version.** The reported Claude Code version is the newest of the pinned 2.1.306 and
  the installed `claude`, overridable by `ANTHROPIC_CLAUDE_CODE_VERSION`. The `claude --version`
  probe now runs on the first request instead of at startup.
- **Claude replace patterns.** `"claude": { "replacePatterns": [{ "match": "...",
  "replacement": "..." }] }` in `auth-plus.json` rewrites system-prompt text; without
  `replacement` the paragraph is dropped.
- **Settings file.** `<agentDir>/auth-plus.json` and, in trusted projects, `.pi/auth-plus.json`;
  invalid values warn and fall back to the inherited value.
- **Providers tab.** Shows environment, models.json and anonymous credentials beside stored
  logins.

### Known limits

- pi-claude-auth's replace patterns in Pi's `settings.json` are not read yet; move them to
  `claude.replacePatterns` in `auth-plus.json`.
- pi-synthetic-auth's `websearch.synthetic` setting and `SYNTHETIC_WEB_SEARCH` variable are
  not read yet; set `synthetic.webSearch` in `auth-plus.json` instead.
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

[Unreleased]: https://github.com/furbyhaxx/pi-auth-plus/compare/v0.1.0...dev
[0.1.0]: https://github.com/furbyhaxx/pi-auth-plus/releases/tag/v0.1.0
