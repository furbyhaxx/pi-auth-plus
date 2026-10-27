---
document:
  type: "analysis"
  id: "claude-code-cli-tracking"
  title: "Claude Code CLI tracking"
  description: "The Claude Code request surface pi-auth-plus imitates for Claude Pro/Max OAuth, where it is pinned, and how it compares with the real CLI on the wire."
  status: "published"
  revision: 3
  created_at: "2026-10-27T11:12:03+01:00"
  updated_at: "2026-10-27T11:46:20+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["claude slice live-verified; first side-by-side capture against Claude Code 2.1.310"]
    - revision: 2
      reason: "logged-in CLI captures and binary evidence"
      changes: ["Interactive and -p captures of 2.1.311 with its own login; cch gate, entrypoint, suffix input, metadata.user_id; open follow-ups resolved by the user's decision to match the CLI"]
    - revision: 3
      reason: "wire aligned with the interactive CLI"
      changes: ["Imitated surface rewritten for slice 3b; deliberate deviations listed; live-verified on both runtimes"]
---

# Claude Code CLI tracking

| field | value |
|---|---|
| pinned version | 2.1.306 (floor; an installed newer `claude` or `ANTHROPIC_CLAUDE_CODE_VERSION` wins) |
| pinned in | `src/families/anthropic/version.ts` (`PINNED_VERSION`) |
| installed / npm latest | 2.1.310 / 2.1.311 (2026-10-27) |
| last live verification | 2026-10-27, Pi 1.4.0 on Pi-Bolt and stock Pi (Node): `claude/claude-sonnet-5-5`, stored OAuth login, one turn with a `Bash` tool call, HTTP 200 on every request, after the slice 3b alignment |
| method | local logging proxy via `ANTHROPIC_BASE_URL=http://127.0.0.1:18471`, forwarding to `api.anthropic.com`; token redacted at capture |

## Imitated surface (interactive CLI, as sent since slice 3b)

- Once per process: `HEAD /api/hello`, unauthenticated, not awaited.
- `POST /v1/messages?beta=true`, `Authorization: Bearer sk-ant-oat…`, no `x-api-key`.
- `User-Agent: claude-cli/<version> (external, cli)`, `x-app: cli`,
  `x-claude-code-session-id: <Pi session UUID>`.
- `anthropic-beta`: the CLI's main-turn set in its order (`claude-code-20250219` …
  `extended-cache-ttl-2025-04-11`, see below), then Pi's own betas the body needs
  (`mid-conversation-output-config-2026-07-01`, `thinking-binding-controls-2026-08-01`).
- `system`: `[billing, identity, sanitized prompt]`. Billing is
  `x-anthropic-billing-header: cc_version=<version>.<suffix>; cc_entrypoint=cli;`; identity is
  `You are Claude Code, Anthropic's official CLI for Claude.` with Pi's `cache_control`.
- `metadata.user_id`: JSON string `{"device_id","account_uuid","session_id"}`. The device id is
  32 random bytes persisted in `<stateDir>/claude-device-id`; the account UUID comes from the
  token response (`account.uuid`) and is stored on the credential.
- Tools: bare PascalCase (`bash` → `Bash`, `web_search` → `WebSearch`), `mcp__…` names unchanged,
  Pi's placeholder sent as the CLI's `DeferredToolPlaceholder`; also inside `tool_addition` and
  `tool_removal`. Restored exactly on the way back.

Deliberate deviations: `x-stainless-*` stay Pi's SDK values (`0.129.0`, timeout `300`); the
cache TTL follows Pi's `cacheRetention` (the CLI uses `1h`); the auto-mode `safeguards` body and
its betas (`afk-mode`, `dangerous-tool-use`) and `thinking-display-updates` are not sent; Pi's
two body betas are appended. Logins stored before slice 3b send an empty `account_uuid` until
their next token refresh.

## Before slice 3b: real CLI vs pi-auth-plus (Claude Code 2.1.310, `claude -p`)

| aspect | Claude Code 2.1.310 | pi-auth-plus (= pi-claude-auth 0.2.2) |
|---|---|---|
| user agent | `claude-cli/2.1.310 (external, sdk-cli)` | `claude-cli/2.1.310 (external, cli)` |
| billing block | `cc_version=2.1.310.e47; cc_entrypoint=sdk-cli;` (no `cch`) | `…; cc_entrypoint=sdk-cli; cch=c6f40;` |
| tool names | bare PascalCase: `Bash`, `Read`, `Edit`, `Write`, `Agent`, `Skill`, `ToolSearch`, … | `mcp_Bash`, `mcp_Read`, … |
| deferred placeholder | `DeferredToolPlaceholder` | `mcp___pi_deferred_placeholder__` (Pi's name, prefixed) |
| `claude-code-20250219` beta | sent, first | not sent |
| other betas | `thinking-token-count-2026-05-13`, `context-management-2025-06-27`, `per-turn-control-2026-07-01`, `mid-conversation-tool-changes-2026-07-01`, `inline-tools-2026-09-15`, `advisor-tool-2026-03-01`, `advanced-tool-use-2025-11-20`, `effort-2025-11-24`, `extended-cache-ttl-2025-04-11` | Pi's per-request betas only |
| `x-claude-code-session-id` | a UUID per session | not sent |
| `x-stainless-package-version` / `-timeout` | `0.128.0` / `600` | `0.129.0` / `300` (Pi's SDK) |
| system prompt | Claude Code's own, user context as `<system-reminder>` and a mid-conversation `system` message | Pi's prompt with harness paragraphs removed; user-authored `AGENTS.md`/`SYSTEM.md` text that names Pi is kept |
| preflight | `HEAD /api/hello` twice | none |

Anthropic accepted every request in both columns. Which of these differences Anthropic checks is
unknown; none is refused today.

## Logged-in CLI captures (Claude Code 2.1.311, 2026-10-27)

Same proxy, the CLI's own `claude.ai` login, `apiProvider: firstParty`.

| aspect | `claude -p` | interactive `claude` |
|---|---|---|
| preflight | `HEAD /api/hello`, no auth, Bun's UA | same |
| user agent | `claude-cli/2.1.311 (external, sdk-cli)` | `claude-cli/2.1.311 (external, cli)` |
| billing block | `cc_version=2.1.311.ccc; cc_entrypoint=sdk-cli;` | `cc_version=2.1.311.ccc; cc_entrypoint=cli;` |
| `cch` | absent | absent |
| `x-app` | `cli` | `cli` |
| session | `x-claude-code-session-id: <uuid>` | same; the same UUID is `session_id` in `metadata.user_id` |
| `metadata.user_id` | JSON string `{"device_id":<64 hex>,"account_uuid":<uuid>,"session_id":<uuid>}` | same |
| identity block | `cache_control: {ephemeral, ttl: 1h}`; billing block has none | same |

Interactive main-turn betas, in order: `claude-code-20250219`, `oauth-2025-04-20`,
`interleaved-thinking-2025-05-14`, `context-management-2025-06-27`, `per-turn-control-2026-07-01`,
`mid-conversation-tool-changes-2026-07-01`, `inline-tools-2026-09-15`, `advisor-tool-2026-03-01`,
`thinking-token-count-2026-05-13`, `advanced-tool-use-2025-11-20`, `effort-2025-11-24`,
`dangerous-tool-use-2026-09-03`, `thinking-display-updates-2026-08-18`, `afk-mode-2026-01-31`,
`extended-cache-ttl-2025-04-11`. The last three before the TTL beta come with auto mode
(`safeguards` body field) and `thinking.display: "updates"`. Side requests differ: a
`max_tokens: 1` quota probe sends only the first five, the title request adds
`redact-thinking-2026-02-12` and `structured-outputs-2025-12-15`.

Tools: 15 bare PascalCase names (`Agent`, `Bash`, `Edit`, `Read`, `Write`, `Skill`, `ToolSearch`,
…) plus `DeferredToolPlaceholder` with `defer_loading: true`, description `Reserved placeholder
that keeps deferred tool loading active; never call this tool.` and schema
`{type: object, properties: {}}`.

Binary evidence (2.1.310 builder `Y2o`): ` cch=00000;` is appended only when
`provider === "firstParty" && Ci()` or on Vertex, where
`Ci() = CLAUDE_CODE_ARTIFACT_PRESENCE ?? flag("tengu_brass_plover", false)`. It is a remote
feature flag, off for this account. The same gate adds `cc_prev_req`, `cc_prompt_id`,
`cc_turn_origin` and `cc_prompt_index`/`cc_turn_index`. The entrypoint is
`CLAUDE_CODE_ENTRYPOINT`, default `cli`, `sdk-cli` in `-p` mode. The version suffix hashes
characters 4, 7 and 20 of the first non-meta user message (the typed prompt, before the CLI
prepends its `<system-reminder>` blocks); pi-auth-plus' algorithm reproduces both observed
suffixes (`ccc`, `033`).

## Former follow-ups

The user decided on 2026-10-27 to match the real CLI fully; slice 3b of
`.project/plans/0002-m1-providers/plan.md` resolved all four:

- Map Pi's `__pi_deferred_placeholder__` to `DeferredToolPlaceholder`: Claude Code sends the
  same mechanism under that name, and the current wire name carries a literal `pi`.
- Decide whether to align the user agent (`sdk-cli` vs `cli`) with the billing entrypoint; the
  current mix matches neither real CLI mode.
- Decide whether `cch` stays: 2.1.310 in `-p` mode does not send it.
- Decide between `mcp_`-prefixed and bare tool names. Bare names are what the CLI sends for its
  built-ins; the prefix makes Pi's tools look like MCP tools instead.

## History

| date | version | change |
|---|---|---|
| 2026-10-27 | 2.1.306 floor, 2.1.310 detected | absorbed into pi-auth-plus; probe moved to first request; replace patterns moved to `auth-plus.json` |
| 2026-10-27 | 2.1.311 detected | slice 3b: wire aligned with the interactive CLI (tool names, identity, betas, session, metadata, preflight; `cch` dropped) |
