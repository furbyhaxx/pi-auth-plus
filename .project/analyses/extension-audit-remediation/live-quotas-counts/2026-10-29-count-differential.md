---
version: 1
id: "live-claude-count-differential"
title: "Claude full-context native-count differential"
description: "Real endpoint full request counts compared with the composed token engine"
type: "analysis"
created: "2026-10-29T19:56:31+01:00"
updated: "2026-10-29T19:56:32+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Bun 1.4.3; pi-coding-agent 1.4.0"
sha: "e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60"
document:
  type: "analysis"
  id: "live-claude-count-differential"
  title: "Claude full-context native-count differential"
  description: "Live full-request native counts and composed engine comparisons"
  status: "published"
  revision: 1
  created_at: "2026-10-29T19:56:31+01:00"
  updated_at: "2026-10-29T19:56:32+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "confirm live full-context discrepancy"
      changes: ["capture provider reference and token engine counts"]
      updated_at: "2026-10-29T19:56:32+01:00"
---

# Claude full-context native-count differential

The reference is a native count request containing the actual shaped identity, optional system text and user message, with billing and metadata omitted per the project count-endpoint research.

```json
{
  "started": "2026-10-29T19:56:31+01:00",
  "sha": "e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60",
  "runtime": {
    "bun": "1.4.3",
    "modelRuntime": "pi-coding-agent 1.4.0 read-only CredentialStore and registered FAMILIES"
  },
  "results": [
    {
      "system": "",
      "engine": {
        "tokens": 4,
        "source": "count-endpoint"
      },
      "referenceInputTokens": 36,
      "referenceStatus": 200
    },
    {
      "system": "Be concise.",
      "engine": {
        "tokens": 9,
        "source": "count-endpoint"
      },
      "referenceInputTokens": 41,
      "referenceStatus": 200
    }
  ],
  "requests": [
    {
      "stage": "engine-empty-system",
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "method": "POST",
      "request": {
        "headers": {
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,inline-tools-2026-09-15,advisor-tool-2026-03-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11",
          "anthropic-version": "2023-06-01",
          "authorization": "[redacted]",
          "content-type": "application/json",
          "user-agent": "claude-cli/2.1.312 (external, cli)",
          "x-app": "cli",
          "x-claude-code-session-id": "[redacted]"
        },
        "bodyText": "{\"model\":\"claude-haiku-5-5\",\"system\":[{\"type\":\"text\",\"text\":\"You are Claude Code, Anthropic's official CLI for Claude.\"}],\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"x\"}]}]}"
      },
      "response": {
        "status": 200,
        "headers": {
          "anthropic-organization-id": "[redacted]",
          "anthropic-workspace-id": "[redacted]",
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a5246696ceae444c-ZRH",
          "connection": "keep-alive",
          "content-length": "19",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:56:31 GMT",
          "request-id": "req_011CgX3CUoagwSaRpNinuvio",
          "server": "cloudflare",
          "server-timing": "x-originResponse;dur=62",
          "x-robots-tag": "none"
        },
        "bodyText": "{\"input_tokens\":33}"
      }
    },
    {
      "stage": "engine-empty-system",
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "method": "POST",
      "request": {
        "headers": {
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,inline-tools-2026-09-15,advisor-tool-2026-03-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11",
          "anthropic-version": "2023-06-01",
          "authorization": "[redacted]",
          "content-type": "application/json",
          "user-agent": "claude-cli/2.1.312 (external, cli)",
          "x-app": "cli",
          "x-claude-code-session-id": "[redacted]"
        },
        "bodyText": "{\"model\":\"claude-haiku-5-5\",\"system\":[{\"type\":\"text\",\"text\":\"You are Claude Code, Anthropic's official CLI for Claude.\"}],\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Hello.\"}]}]}"
      },
      "response": {
        "status": 200,
        "headers": {
          "anthropic-organization-id": "[redacted]",
          "anthropic-workspace-id": "[redacted]",
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a5246697e952444c-ZRH",
          "connection": "keep-alive",
          "content-length": "19",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:56:32 GMT",
          "request-id": "req_011CgX3CVYy4bptaq8Uze1P2",
          "server": "cloudflare",
          "server-timing": "x-originResponse;dur=54",
          "x-robots-tag": "none"
        },
        "bodyText": "{\"input_tokens\":36}"
      }
    },
    {
      "stage": "full-empty-system",
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "method": "POST",
      "request": {
        "headers": {
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,inline-tools-2026-09-15,advisor-tool-2026-03-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11",
          "anthropic-version": "2023-06-01",
          "authorization": "[redacted]",
          "content-type": "application/json",
          "user-agent": "claude-cli/2.1.312 (external, cli)",
          "x-app": "cli",
          "x-claude-code-session-id": "[redacted]"
        },
        "bodyText": "{\"model\":\"claude-haiku-5-5\",\"system\":[{\"type\":\"text\",\"text\":\"You are Claude Code, Anthropic's official CLI for Claude.\"}],\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Hello.\"}]}]}"
      },
      "response": {
        "status": 200,
        "headers": {
          "anthropic-organization-id": "[redacted]",
          "anthropic-workspace-id": "[redacted]",
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a52466990bff444c-ZRH",
          "connection": "keep-alive",
          "content-length": "19",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:56:32 GMT",
          "request-id": "req_011CgX3CWLc4MNowCUBkVDRz",
          "server": "cloudflare",
          "server-timing": "x-originResponse;dur=62",
          "x-robots-tag": "none"
        },
        "bodyText": "{\"input_tokens\":36}"
      }
    },
    {
      "stage": "engine-nonempty-system",
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "method": "POST",
      "request": {
        "headers": {
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,inline-tools-2026-09-15,advisor-tool-2026-03-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11",
          "anthropic-version": "2023-06-01",
          "authorization": "[redacted]",
          "content-type": "application/json",
          "user-agent": "claude-cli/2.1.312 (external, cli)",
          "x-app": "cli",
          "x-claude-code-session-id": "[redacted]"
        },
        "bodyText": "{\"model\":\"claude-haiku-5-5\",\"system\":[{\"type\":\"text\",\"text\":\"You are Claude Code, Anthropic's official CLI for Claude.\"}],\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Be concise.\"}]}]}"
      },
      "response": {
        "status": 200,
        "headers": {
          "anthropic-organization-id": "[redacted]",
          "anthropic-workspace-id": "[redacted]",
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a524669a1f07444c-ZRH",
          "connection": "keep-alive",
          "content-length": "19",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:56:32 GMT",
          "request-id": "req_011CgX3CX6FYiJE2mTyLn9wg",
          "server": "cloudflare",
          "server-timing": "x-originResponse;dur=60",
          "x-robots-tag": "none"
        },
        "bodyText": "{\"input_tokens\":37}"
      }
    },
    {
      "stage": "full-nonempty-system",
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "method": "POST",
      "request": {
        "headers": {
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,inline-tools-2026-09-15,advisor-tool-2026-03-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11",
          "anthropic-version": "2023-06-01",
          "authorization": "[redacted]",
          "content-type": "application/json",
          "user-agent": "claude-cli/2.1.312 (external, cli)",
          "x-app": "cli",
          "x-claude-code-session-id": "[redacted]"
        },
        "bodyText": "{\"model\":\"claude-haiku-5-5\",\"system\":[{\"type\":\"text\",\"text\":\"You are Claude Code, Anthropic's official CLI for Claude.\"},{\"type\":\"text\",\"text\":\"Be concise.\"}],\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Hello.\"}]}]}"
      },
      "response": {
        "status": 200,
        "headers": {
          "anthropic-organization-id": "[redacted]",
          "anthropic-workspace-id": "[redacted]",
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a524669b2948444c-ZRH",
          "connection": "keep-alive",
          "content-length": "19",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:56:32 GMT",
          "request-id": "req_011CgX3CXrNrtfamaghv3RkJ",
          "server": "cloudflare",
          "server-timing": "x-originResponse;dur=60",
          "x-robots-tag": "none"
        },
        "bodyText": "{\"input_tokens\":41}"
      }
    }
  ]
}
```
