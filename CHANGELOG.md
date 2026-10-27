# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Package scaffold.** Bun, TypeScript and Biome tooling with an isolated test setup; the
  extension loads but registers no providers yet.
- **`/auth` dashboard.** Providers, Quotas, Tokens and Settings tabs in one panel; `/quota`,
  `/quotas` and `/tokens` open their tab. Without a TUI the dashboard prints as text. Tabs are
  empty until provider families land.
- **Absorbed-package warning.** Loading pi-claude-auth, pi-opencode-auth, pi-synthetic-auth,
  pi-antigravity-auth or pi-quotas next to pi-auth-plus warns once and names the command that
  removes each.
