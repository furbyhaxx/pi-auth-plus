---
document:
  type: "analysis"
  id: "claude-code-cli-tracking"
  title: "Claude Code CLI tracking"
  description: "The Claude Code request surface pi-auth-plus imitates for Claude Pro/Max OAuth, where it is pinned, and how it compares with the real CLI on the wire."
  status: "published"
  revision: 1
  created_at: "2026-10-27T11:12:03+01:00"
  updated_at: "2026-10-27T11:12:03+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["claude slice live-verified; first side-by-side capture against Claude Code 2.1.310"]
---

# Claude Code CLI tracking

| field | value |
|---|---|
| pinned version | 2.1.306 (floor; an installed newer `claude` or `ANTHROPIC_CLAUDE_CODE_VERSION` wins) |
| pinned in | `src/families/anthropic/version.ts` (`PINNED_VERSION`) |
| installed / npm latest | 2.1.310 / 2.1.311 (2026-10-27) |
| last live verification | 2026-10-27, Pi 1.4.0 on Pi-Bolt and stock Pi (Node): `claude/claude-sonnet-5-5`, stored OAuth login, one turn with a `bash` tool call, HTTP 200 on every request |
| method | local logging proxy via `ANTHROPIC_BASE_URL=http://127.0.0.1:18471`, forwarding to `api.anthropic.com`; token redacted at capture |

## Imitated surface (as sent on 2026-10-27)

- `POST /v1/messages?beta=true`, `Authorization: Bearer sk-ant-oat…`, no `x-api-key`.
- `User-Agent: claude-cli/<version> (external, cli)`, `x-app: cli`.
- `anthropic-beta`: `oauth-2025-04-20`, `interleaved-thinking-2025-05-14`, then Pi's own betas
  for the request (`mid-conversation-output-config-2026-07-01`,
  `thinking-binding-controls-2026-08-01`, `inline-tools-2026-09-15` on Claude 5.5).
- `system`: `[billing, identity, sanitized prompt]`; billing is
  `x-anthropic-billing-header: cc_version=<version>.<suffix>; cc_entrypoint=sdk-cli; cch=<cch>;`.
- Tools renamed `mcp_` + upper-case first letter (`mcp_Bash`); restored on the way back.

## Real CLI vs pi-auth-plus (Claude Code 2.1.310, `claude -p`, same token, same proxy)

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

## Open follow-ups (not in the absorb scope)

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
