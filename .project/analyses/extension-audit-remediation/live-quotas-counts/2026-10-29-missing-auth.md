---
version: 1
id: "live-quotas-missing-auth"
title: "Quota engine missing-auth states"
description: "Isolated missing-credential engine and line behavior"
type: "analysis"
created: "2026-10-29T19:54:36+01:00"
updated: "2026-10-29T19:54:36+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Bun 1.4.3; pi-coding-agent 1.4.0"
sha: "e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60"
document:
  type: "analysis"
  id: "live-quotas-missing-auth"
  title: "Quota engine missing-auth states"
  description: "Engine and line results with credentials deliberately absent"
  status: "published"
  revision: 1
  created_at: "2026-10-29T19:54:36+01:00"
  updated_at: "2026-10-29T19:54:36+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "initial missing-auth acceptance"
      changes: ["record real registry engine and line states without credentials"]
      updated_at: "2026-10-29T19:54:36+01:00"
---

# Isolated missing-auth states

All credentials were deliberately removed from this separate in-memory run; the configured-account results are in the live capture.

```json
{
  "mode": "no credentials injected; empty agent directory for Codex fallback; no network",
  "networkCalls": 0,
  "report": {
    "v": 1,
    "generatedAt": 1793300076046,
    "providers": [
      {
        "id": "synthetic",
        "title": "Synthetic",
        "short": "syn",
        "state": "needs-auth",
        "needsAuth": true,
        "windows": [],
        "fetchedAt": 1793300076040,
        "ageSec": 0,
        "source": "endpoint",
        "error": "Synthetic quotas: credentials missing; check the Synthetic API key or /login synthetic"
      },
      {
        "id": "claude",
        "title": "Claude",
        "short": "cl",
        "state": "needs-auth",
        "needsAuth": true,
        "windows": [],
        "fetchedAt": 1793300076041,
        "ageSec": 0,
        "source": "endpoint",
        "error": "Claude: no credential configured; run /login claude"
      },
      {
        "id": "antigravity",
        "title": "Antigravity",
        "short": "ag",
        "state": "needs-auth",
        "needsAuth": true,
        "windows": [],
        "fetchedAt": 1793300076042,
        "ageSec": 0,
        "source": "endpoint",
        "error": "antigravity: no login; run /login antigravity"
      },
      {
        "id": "codex",
        "title": "OpenAI Codex",
        "short": "cox",
        "state": "needs-auth",
        "needsAuth": true,
        "loginHint": "/quota codex login or /login openai-codex",
        "windows": [],
        "fetchedAt": 1793300076043,
        "ageSec": 0,
        "source": "endpoint",
        "error": "codex: no credential configured; run /quota codex login or /login openai-codex"
      },
      {
        "id": "xai",
        "title": "xAI",
        "short": "xai",
        "state": "needs-auth",
        "needsAuth": true,
        "windows": [],
        "fetchedAt": 1793300076043,
        "ageSec": 0,
        "source": "endpoint",
        "error": "No credential configured; run /login xai"
      },
      {
        "id": "openrouter",
        "title": "OpenRouter",
        "short": "or",
        "state": "needs-auth",
        "needsAuth": true,
        "windows": [],
        "fetchedAt": 1793300076043,
        "ageSec": 0,
        "source": "endpoint",
        "error": "OpenRouter: no credential configured; use /login openrouter"
      },
      {
        "id": "deepseek",
        "title": "DeepSeek",
        "short": "ds",
        "state": "needs-auth",
        "needsAuth": true,
        "windows": [],
        "fetchedAt": 1793300076044,
        "ageSec": 0,
        "source": "endpoint",
        "error": "deepseek: no credential configured; use /login deepseek"
      }
    ]
  },
  "rows": [
    "openrouter: login · deepseek: login · codex: login · claude: 5h/login 7d/login · antigravity: gem/login arg/login · synthetic: login",
    "xai: login"
  ]
}
```
