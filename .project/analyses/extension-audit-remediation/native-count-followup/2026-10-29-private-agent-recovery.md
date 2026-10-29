---
version: 1
id: "native-count-private-agent-recovery"
title: "Native count private-agent recovery"
description: "One real count with private agent and configured read-only authentication"
type: "analysis"
created: "2026-10-29T21:43:08+01:00"
updated: "2026-10-29T21:43:09+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Bun 1.4.3; pi-coding-agent 1.4.0"
sha: "a8abfb1d0fd34ce311c5f405eaa8703f04bd8d13"
document:
  type: "analysis"
  id: "native-count-private-agent-recovery"
  title: "Native count private-agent recovery"
  description: "Masked authentication recovery with private agent and one live count"
  status: "published"
  revision: 1
  created_at: "2026-10-29T21:43:08+01:00"
  updated_at: "2026-10-29T21:43:09+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "private agent recovery acceptance"
      changes: ["capture one live count and auth masking recovery"]
      updated_at: "2026-10-29T21:43:09+01:00"
---

# Private-agent native count recovery

The process used a private Pi agent and XDG directories, with the configured credential read only in memory through Pi's read-only store; no credentials were copied to private storage. Exactly one live request was permitted.

```json
{
  "started": "2026-10-29T21:43:08+01:00",
  "sha": "a8abfb1d0fd34ce311c5f405eaa8703f04bd8d13",
  "privateAgent": true,
  "authStore": "configured agent read-only, credentials remain in memory",
  "privateXdgAndModelStore": true,
  "networkRequests": 1,
  "blocked": false,
  "missing": {
    "name": "masked-auth",
    "networkDelta": 0,
    "count": {
      "tokens": 3,
      "source": "estimate",
      "diagnostics": [
        {
          "code": "needs-auth",
          "provider": "claude",
          "message": "Claude token counting at https://api.anthropic.com/v1/messages/count_tokens needs authentication; run /login claude."
        }
      ]
    }
  },
  "recovered": {
    "name": "real-auth-restored",
    "networkDelta": 1,
    "count": {
      "tokens": 35,
      "source": "count-endpoint"
    }
  },
  "memo": {
    "name": "authenticated-memo",
    "networkDelta": 0,
    "count": {
      "tokens": 35,
      "source": "count-endpoint"
    }
  },
  "missingAgain": {
    "name": "masked-after-memo",
    "networkDelta": 0,
    "count": {
      "tokens": 3,
      "source": "estimate",
      "diagnostics": [
        {
          "code": "needs-auth",
          "provider": "claude",
          "message": "Claude token counting at https://api.anthropic.com/v1/messages/count_tokens needs authentication; run /login claude."
        }
      ]
    }
  },
  "secondRecovery": {
    "name": "real-auth-restored-after-memo",
    "networkDelta": 0,
    "count": {
      "tokens": 35,
      "source": "count-endpoint"
    }
  },
  "priorComparison": {
    "bodyEqual": true,
    "priorCount": 35
  },
  "capture": {
    "stage": "real-auth-restored",
    "request": {
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "method": "POST",
      "headers": {
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,inline-tools-2026-09-15,advisor-tool-2026-03-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11,mid-conversation-output-config-2026-07-01,thinking-binding-controls-2026-08-01",
        "anthropic-version": "2023-06-01",
        "authorization": "[redacted]",
        "content-type": "application/json",
        "user-agent": "claude-cli/2.1.312 (external, cli)",
        "x-app": "cli",
        "x-claude-code-session-id": "[redacted]"
      },
      "bodyText": "{\"model\":\"claude-haiku-5-5\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Hello.\",\"cache_control\":{\"type\":\"ephemeral\"}}]}],\"thinking\":{\"type\":\"disabled\"},\"system\":[{\"type\":\"text\",\"text\":\"You are Claude Code, Anthropic's official CLI for Claude.\"}]}"
    },
    "response": {
      "status": 200,
      "headers": {
        "anthropic-organization-id": "[redacted]",
        "anthropic-workspace-id": "[redacted]",
        "cf-cache-status": "DYNAMIC",
        "cf-ray": "a52502c4f8c6be5f-ZRH",
        "connection": "keep-alive",
        "content-length": "19",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "content-type": "application/json",
        "date": "Thu, 29 Oct 2026 20:43:09 GMT",
        "request-id": "[redacted]",
        "server": "cloudflare",
        "server-timing": "x-originResponse;dur=49",
        "x-robots-tag": "none"
      },
      "bodyText": "{\"input_tokens\":35}"
    }
  }
}
```
