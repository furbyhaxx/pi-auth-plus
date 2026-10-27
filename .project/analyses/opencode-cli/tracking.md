---
document:
  type: "analysis"
  id: "opencode-cli-tracking"
  title: "OpenCode CLI tracking"
  description: "The OpenCode CLI surface pi-auth-plus imitates for OpenCode Zen, where it is pinned and when it was last verified live."
  status: "published"
  revision: 1
  created_at: "2026-10-27T10:42:48+01:00"
  updated_at: "2026-10-27T10:42:48+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["2.1.2 pinned after the free-tier gate refused the 1.18.18 identity"]
---

# OpenCode CLI tracking

| field | value |
|---|---|
| pinned version | 2.1.2 |
| pinned in | `src/families/opencode/identity.ts` (`CLI_VERSION`, `CLI_USER_AGENT`) |
| last live verification | 2026-10-27, Pi 1.4.0 on Pi-Bolt 1.0.5: `opencode/big-pickle` and `opencode/nemotron-3.5-lightning-free` answer anonymously |
| evidence | `2.1.2/report.md`, `2.1.2/captures/` |

## Imitated surface

- `User-Agent: opencode/latest/2.1.2/cli`; Zen only checks the `opencode/` prefix.
- `x-opencode-client: cli`; Pi's own `pi` is refused.
- `x-opencode-session`, `x-opencode-session-id`, `x-session-affinity`, `X-Session-Id`: one
  `ses_` descending-ULID per Pi session. Zen checks `x-session-affinity` or `X-Session-Id`.
- `x-opencode-project: global`, as the CLI sends outside a git repository. Not checked.
- An `<env>` block with `Working directory:` in the system message of chat-completions payloads.
  This is checked; all free models speak chat completions.
- `Authorization: Bearer public` when no key is configured (Zen's anonymous bearer).

## Known limits

- Zen also gates on the HTTP/TLS client: Bun's fetch passes, while Node's undici and curl are refused
  for identical content. Anonymous free models therefore work from Pi-Bolt, not from stock Pi.

## History

| date | version | change |
|---|---|---|
| 2026-10-27 | 2.1.2 | affinity headers and `<env>` block added; 1.18.18 headers alone got 429 |
| before 2026-10-27 | 1.18.18 | user agent plus `x-opencode-*` headers (pi-opencode-auth) |
