---
version: 1
id: "claude-quota-recheck-2026-10-29"
title: "Claude quota read-only recheck"
description: "One configured-account usage request after an observed rate-limit hold"
type: "analysis"
created: "2026-10-29T20:19:17+01:00"
updated: "2026-10-29T20:20:26+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Bun 1.4.3; pi-coding-agent 1.4.0; Linux x64"
sha: "8712aaac5412a9b29946ee3c85c65adbd1c91af2"
document:
  type: "analysis"
  id: "claude-quota-recheck-2026-10-29"
  title: "Claude quota read-only recheck"
  description: "One configured-account usage request after an observed rate-limit hold"
  status: "published"
  revision: 3
  created_at: "2026-10-29T20:19:17+01:00"
  updated_at: "2026-10-29T20:20:26+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 3
      reason: "record the complete shell command"
      changes: ["include private directory creation in the executed command"]
      updated_at: "2026-10-29T20:20:26+01:00"
    - revision: 2
      reason: "clarify the incomplete command result"
      changes: ["record exit status and rate-limit recovery guidance"]
      updated_at: "2026-10-29T20:20:07+01:00"
    - revision: 1
      reason: "bounded live quota recheck"
      changes: ["capture one request and engine recovery state"]
      updated_at: "2026-10-29T20:19:17+01:00"
---

# Claude quota read-only recheck

status: "qa-complete"
confidence: "high"

## Outcome

**INCOMPLETE.** Prior captured engine state was `rate-limited` (HTTP 429); its recorded hold had expired at this run. The one request returned HTTP 429; engine state after refresh was `rate-limited`. Recovery to `ok` from the prior 429 was not observed in this run. No utilization/reset comparison was possible; normalized numbers remain unverified.



## Method and limits

Used the actual registered `FAMILIES`, Pi `ModelRuntime`/`ModelRegistry`, `quotaAuthFor`, Claude quota fetcher, `QuotaEngine`, report and line renderer. The real user settings were loaded without modification. The private cache contained no endpoint leases and, when available, only the previously captured expired 429 backoff. No forced refresh or backoff bypass was used. A read-only credential store blocked writes, command credentials and OAuth refresh. An endpoint/method guard allowed only one HTTP GET, with request and process deadlines. No token counts, generation, login, key/account changes, reset operation or full test gate were run.

## Exact command and result

```sh
mkdir -p /tmp/claude-quota-recheck.ZdeEURxk/cache /tmp/claude-quota-recheck.ZdeEURxk/state; XDG_CACHE_HOME=/tmp/claude-quota-recheck.ZdeEURxk/cache XDG_STATE_HOME=/tmp/claude-quota-recheck.ZdeEURxk/state timeout 45 bun /tmp/claude-quota-recheck.ZdeEURxk/recheck.ts
```

Result: exit 1; one network request and one fetch attempt; HTTP 429 with `Retry-After: 0`;
engine state `rate-limited`. The engine error names the provider, endpoint and status and says
to retry after the hold expires. No normalization comparison or recovery to `ok` was possible.
No retry was attempted. The temporary script and private caches were removed after capture.

## Redacted evidence

The request and raw response body below were scrubbed in memory through `src/core/redact/index.ts` using known credential values and returned identity values before writing. Known-value verification found zero remaining matches. Quota-window IDs are provider metrics, not account identifiers.

```json
{
  "runtime": {
    "bun": "1.4.3",
    "node": "26.3.0",
    "platform": "linux",
    "arch": "x64",
    "package": "pi-coding-agent 1.4.0",
    "sha": "8712aaac5412a9b29946ee3c85c65adbd1c91af2"
  },
  "started": "2026-10-29T20:19:17+01:00",
  "credential": {
    "state": "oauth",
    "safeForRead": true
  },
  "prior": {
    "available": true,
    "state": "rate-limited",
    "status": 429,
    "holdUntil": 1793300025828,
    "holdExpired": true
  },
  "cache": {
    "kind": "private; only the actual prior expired backoff was restored; no leases",
    "beforeState": "unknown",
    "afterState": "rate-limited"
  },
  "endpoint": "https://api.anthropic.com/api/oauth/usage",
  "status": 429,
  "requestAttempts": 1,
  "networkRequests": 1,
  "settingsProblems": [],
  "engine": {
    "before": {
      "id": "claude",
      "title": "Claude",
      "short": "cl",
      "state": "unknown",
      "windows": []
    },
    "after": {
      "id": "claude",
      "title": "Claude",
      "short": "cl",
      "state": "rate-limited",
      "windows": [],
      "error": "claude: HTTP 429 from https://api.anthropic.com/api/oauth/usage: Claude usage; rate limited; retry after the Retry-After hold expires"
    },
    "backoff": {
      "until": 1793301617978,
      "status": 429,
      "error": "claude: HTTP 429 from https://api.anthropic.com/api/oauth/usage: Claude usage; rate limited; retry after the Retry-After hold expires"
    },
    "line": [
      "claude: 5h/err 7d/err"
    ]
  },
  "normalization": {
    "checked": 0,
    "passed": 0,
    "checks": [],
    "unverified": "No successful payload/snapshot"
  },
  "recoveryObserved": false,
  "capture": {
    "request": {
      "url": "https://api.anthropic.com/api/oauth/usage",
      "method": "GET",
      "headers": {
        "accept": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "authorization": "[redacted]",
        "user-agent": "claude-cli/2.1.306 (external, cli)"
      },
      "bodyText": null
    },
    "response": {
      "status": 429,
      "headers": {
        "cache-control": "private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0",
        "cf-ray": "a52487f15a87df5e-ZRH",
        "connection": "keep-alive",
        "content-length": "107",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "content-type": "application/json",
        "date": "Thu, 29 Oct 2026 19:19:17 GMT",
        "expires": "Thu, 01 Jan 1970 00:00:01 GMT",
        "referrer-policy": "same-origin",
        "retry-after": "0",
        "server": "cloudflare",
        "x-frame-options": "SAMEORIGIN",
        "x-robots-tag": "none"
      },
      "bodyText": "{\n  \"error\": {\n    \"type\": \"rate_limit_error\",\n    \"message\": \"Rate limited. Please try again later.\"\n  }\n}"
    }
  }
}
```
