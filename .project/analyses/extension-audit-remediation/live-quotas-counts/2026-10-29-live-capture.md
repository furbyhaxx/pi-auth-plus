---
version: 1
id: "live-quotas-counts-capture"
title: "Live quota and native-count capture"
description: "Redacted request and response evidence with normalized engine results"
type: "analysis"
created: "2026-10-29T19:52:45+01:00"
updated: "2026-10-29T19:53:43+01:00"
createdBy: "pi"
updatedBy: "pi"
runtime: "Bun 1.4.3; pi-coding-agent 1.4.0"
sha: "e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60"
document:
  type: "analysis"
  id: "live-quotas-counts-capture"
  title: "Live quota and native-count capture"
  description: "Redacted live requests, responses, and normalized quota/count engine results"
  status: "published"
  revision: 2
  created_at: "2026-10-29T19:52:45+01:00"
  updated_at: "2026-10-29T19:53:43+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 2
      reason: "redact additional account identifiers and key labels"
      changes: ["mask key labels and account, workspace, organization and session identifiers"]
      updated_at: "2026-10-29T19:53:43+01:00"
    - revision: 1
      reason: "initial live acceptance"
      changes: ["record redacted requests, responses and engine projections"]
      updated_at: "2026-10-29T19:52:47+01:00"
---

# Live quota and native-count capture

Raw request/response body text is preserved apart from credential and identity redaction. Values below are live observations, not fixtures.

```json
{
  "started": "2026-10-29T19:52:45+01:00",
  "sha": "e38dd17c8e9c375509ff1ca06730e3a7a7e2eb60",
  "runtime": {
    "bun": "1.4.3",
    "node": "26.3.0",
    "platform": "linux",
    "arch": "x64",
    "modelRuntime": "@earendil-works/pi-coding-agent 1.4.0 with read-only CredentialStore; actual models.json; no model network",
    "cache": "private temporary quota, models and XDG caches",
    "authorization": "[redacted]"
  },
  "credentials": {
    "claude": "oauth:valid-over-5m",
    "antigravity": "oauth:valid-over-5m",
    "synthetic": "api_key:stored",
    "openai": "oauth:valid-over-5m",
    "openai-codex": "missing",
    "xai": "oauth:valid-over-5m",
    "openrouter": "api_key:stored",
    "deepseek": "api_key:stored"
  },
  "codexLegacy": "oauth:valid-over-2m",
  "legacyUnsafe": false,
  "configuredProviders": [
    "openrouter",
    "deepseek",
    "codex",
    "claude",
    "antigravity",
    "synthetic",
    "xai"
  ],
  "configProblems": [],
  "quotaIds": [
    "synthetic",
    "claude",
    "antigravity",
    "codex",
    "xai",
    "openrouter",
    "deepseek"
  ],
  "snapshots": [
    {
      "id": "synthetic",
      "snapshot": {
        "provider": "synthetic",
        "fetchedAt": 1793299965797,
        "source": "endpoint",
        "windows": [
          {
            "id": "subscription",
            "shortLabel": "sub",
            "label": "Subscription requests",
            "important": true,
            "usedFraction": 0,
            "valueText": "0/500 used",
            "resetAtMs": 1793317966083
          },
          {
            "id": "7d",
            "shortLabel": "7d",
            "label": "7d plan budget",
            "period": "7d",
            "usedFraction": 0.3704545627424447,
            "valueText": "62.95% left",
            "resetAtMs": 1793308528000,
            "important": true
          },
          {
            "id": "search-1h",
            "shortLabel": "srch",
            "label": "1h search requests",
            "period": "1h",
            "scope": "search",
            "important": false,
            "usedFraction": 0,
            "valueText": "0/250 used",
            "resetAtMs": 1793303566084
          }
        ]
      }
    },
    {
      "id": "claude",
      "backoff": {
        "until": 1793300025828,
        "status": 429,
        "error": "claude: HTTP 429 from https://api.anthropic.com/api/oauth/usage: Claude usage; rate limited; retry after the Retry-After hold expires"
      }
    },
    {
      "id": "antigravity",
      "snapshot": {
        "provider": "antigravity",
        "fetchedAt": 1793299966704,
        "source": "endpoint",
        "windows": [
          {
            "id": "gemini-weekly",
            "shortLabel": "gem",
            "label": "Gemini Models (7d)",
            "usedFraction": 0.09448860000000003,
            "resetAtMs": 1793799491000,
            "important": true,
            "group": "Gemini Models",
            "period": "7d",
            "scope": "gemini"
          },
          {
            "id": "gemini-5h",
            "shortLabel": "gem:5h",
            "label": "Gemini Models (5h)",
            "usedFraction": 0,
            "resetAtMs": 1793317966000,
            "important": false,
            "group": "Gemini Models",
            "period": "5h",
            "scope": "gemini"
          },
          {
            "id": "3p-weekly",
            "shortLabel": "3p",
            "label": "Claude and GPT models (7d)",
            "usedFraction": 0.0820592,
            "resetAtMs": 1793377230000,
            "important": true,
            "group": "Claude and GPT models",
            "period": "7d",
            "scope": "3p"
          },
          {
            "id": "3p-5h",
            "shortLabel": "3p:5h",
            "label": "Claude and GPT models (5h)",
            "usedFraction": 0.0008000000000000229,
            "resetAtMs": 1793316771000,
            "important": false,
            "group": "Claude and GPT models",
            "period": "5h",
            "scope": "3p"
          },
          {
            "id": "gemini-argon-wtu-weekly",
            "shortLabel": "arg",
            "label": "Gemini 4 Argon (7d)",
            "usedFraction": 0.994404,
            "resetAtMs": 1793705083000,
            "important": true,
            "group": "Gemini 4 Argon",
            "period": "7d",
            "scope": "gemini-4-argon"
          }
        ]
      }
    },
    {
      "id": "codex",
      "snapshot": {
        "provider": "codex",
        "fetchedAt": 1793299965801,
        "source": "endpoint",
        "tier": "pro",
        "windows": [
          {
            "id": "primary",
            "shortLabel": "7d",
            "label": "Plan (7d window)",
            "period": "7d",
            "usedFraction": 0.56,
            "resetAtMs": 1793774130000,
            "important": true
          }
        ],
        "resetCredits": 1
      }
    },
    {
      "id": "xai",
      "snapshot": {
        "provider": "xai",
        "fetchedAt": 1793299965810,
        "source": "endpoint",
        "tier": "unified",
        "windows": [
          {
            "id": "7d",
            "shortLabel": "7d",
            "label": "7d weekly quota",
            "period": "7d",
            "usedFraction": 0.44,
            "resetAtMs": 1793708589952,
            "important": true
          }
        ]
      }
    },
    {
      "id": "openrouter",
      "snapshot": {
        "provider": "openrouter",
        "fetchedAt": 1793299965835,
        "source": "endpoint",
        "credits": {
          "remaining": 17.6340302840008,
          "total": 4142.6,
          "used": 4124.965969716,
          "currency": "$",
          "detailText": "day $27.90 · wk $70.37 · mo $194.47"
        },
        "windows": [
          {
            "id": "credits",
            "shortLabel": "cred",
            "label": "Account credits",
            "usedFraction": 0.9957432457191134,
            "valueText": "$17.63 left of $4142.60",
            "important": true
          }
        ]
      }
    },
    {
      "id": "deepseek",
      "snapshot": {
        "provider": "deepseek",
        "fetchedAt": 1793299966093,
        "source": "endpoint",
        "credits": {
          "remaining": 11.59,
          "currency": "$",
          "detailText": "granted $0.00 · topped-up $11.59"
        },
        "windows": []
      }
    }
  ],
  "report": {
    "v": 1,
    "generatedAt": 1793299966739,
    "providers": [
      {
        "id": "synthetic",
        "title": "Synthetic",
        "short": "syn",
        "state": "ok",
        "windows": [
          {
            "id": "subscription",
            "shortLabel": "sub",
            "label": "Subscription requests",
            "important": true,
            "usedFraction": 0,
            "valueText": "0/500 used",
            "resetAtMs": 1793317966083,
            "usedPercent": 0,
            "remainingPercent": 100,
            "resetAt": 1793317966083,
            "resetInSec": 17999.344,
            "drainage": {
              "observedAt": 1793299965797
            }
          },
          {
            "id": "7d",
            "shortLabel": "7d",
            "label": "7d plan budget",
            "period": "7d",
            "usedFraction": 0.3704545627424447,
            "valueText": "62.95% left",
            "resetAtMs": 1793308528000,
            "important": true,
            "usedPercent": 37.04545627424447,
            "remainingPercent": 62.95454372575553,
            "resetAt": 1793308528000,
            "resetInSec": 8561.261,
            "drainage": {
              "observedAt": 1793299965797
            }
          },
          {
            "id": "search-1h",
            "shortLabel": "srch",
            "label": "1h search requests",
            "period": "1h",
            "scope": "search",
            "important": false,
            "usedFraction": 0,
            "valueText": "0/250 used",
            "resetAtMs": 1793303566084,
            "usedPercent": 0,
            "remainingPercent": 100,
            "resetAt": 1793303566084,
            "resetInSec": 3599.345,
            "drainage": {
              "observedAt": 1793299965797
            }
          }
        ],
        "fetchedAt": 1793299965797,
        "ageSec": 1,
        "source": "endpoint"
      },
      {
        "id": "claude",
        "title": "Claude",
        "short": "cl",
        "state": "rate-limited",
        "windows": [],
        "error": "claude: HTTP 429 from https://api.anthropic.com/api/oauth/usage: Claude usage; rate limited; retry after the Retry-After hold expires"
      },
      {
        "id": "antigravity",
        "title": "Antigravity",
        "short": "ag",
        "state": "ok",
        "windows": [
          {
            "id": "gemini-weekly",
            "shortLabel": "gem",
            "label": "Gemini Models (7d)",
            "usedFraction": 0.09448860000000003,
            "resetAtMs": 1793799491000,
            "important": true,
            "group": "Gemini Models",
            "period": "7d",
            "scope": "gemini",
            "usedPercent": 9.448860000000003,
            "remainingPercent": 90.55114,
            "resetAt": 1793799491000,
            "resetInSec": 499524.261,
            "drainage": {
              "observedAt": 1793299966704
            }
          },
          {
            "id": "gemini-5h",
            "shortLabel": "gem:5h",
            "label": "Gemini Models (5h)",
            "usedFraction": 0,
            "resetAtMs": 1793317966000,
            "important": false,
            "group": "Gemini Models",
            "period": "5h",
            "scope": "gemini",
            "usedPercent": 0,
            "remainingPercent": 100,
            "resetAt": 1793317966000,
            "resetInSec": 17999.261,
            "drainage": {
              "observedAt": 1793299966704
            }
          },
          {
            "id": "3p-weekly",
            "shortLabel": "3p",
            "label": "Claude and GPT models (7d)",
            "usedFraction": 0.0820592,
            "resetAtMs": 1793377230000,
            "important": true,
            "group": "Claude and GPT models",
            "period": "7d",
            "scope": "3p",
            "usedPercent": 8.205919999999999,
            "remainingPercent": 91.79408,
            "resetAt": 1793377230000,
            "resetInSec": 77263.261,
            "drainage": {
              "observedAt": 1793299966704
            }
          },
          {
            "id": "3p-5h",
            "shortLabel": "3p:5h",
            "label": "Claude and GPT models (5h)",
            "usedFraction": 0.0008000000000000229,
            "resetAtMs": 1793316771000,
            "important": false,
            "group": "Claude and GPT models",
            "period": "5h",
            "scope": "3p",
            "usedPercent": 0.08000000000000229,
            "remainingPercent": 99.92,
            "resetAt": 1793316771000,
            "resetInSec": 16804.261,
            "drainage": {
              "observedAt": 1793299966704
            }
          },
          {
            "id": "gemini-argon-wtu-weekly",
            "shortLabel": "arg",
            "label": "Gemini 4 Argon (7d)",
            "usedFraction": 0.994404,
            "resetAtMs": 1793705083000,
            "important": true,
            "group": "Gemini 4 Argon",
            "period": "7d",
            "scope": "gemini-4-argon",
            "usedPercent": 99.4404,
            "remainingPercent": 0.5596000000000045,
            "resetAt": 1793705083000,
            "resetInSec": 405116.261,
            "drainage": {
              "observedAt": 1793299966704
            }
          }
        ],
        "fetchedAt": 1793299966704,
        "ageSec": 0,
        "source": "endpoint"
      },
      {
        "id": "codex",
        "title": "OpenAI Codex",
        "short": "cox",
        "state": "ok",
        "tier": "pro",
        "loginHint": "/quota codex login or /login openai-codex",
        "windows": [
          {
            "id": "primary",
            "shortLabel": "7d",
            "label": "Plan (7d window)",
            "period": "7d",
            "usedFraction": 0.56,
            "resetAtMs": 1793774130000,
            "important": true,
            "usedPercent": 56.00000000000001,
            "remainingPercent": 43.99999999999999,
            "resetAt": 1793774130000,
            "resetInSec": 474163.261,
            "drainage": {
              "observedAt": 1793299965801
            }
          }
        ],
        "resets": {
          "available": 1
        },
        "fetchedAt": 1793299965801,
        "ageSec": 1,
        "source": "endpoint"
      },
      {
        "id": "xai",
        "title": "xAI",
        "short": "xai",
        "state": "ok",
        "tier": "unified",
        "windows": [
          {
            "id": "7d",
            "shortLabel": "7d",
            "label": "7d weekly quota",
            "period": "7d",
            "usedFraction": 0.44,
            "resetAtMs": 1793708589952,
            "important": true,
            "usedPercent": 44,
            "remainingPercent": 56.00000000000001,
            "resetAt": 1793708589952,
            "resetInSec": 408623.213,
            "drainage": {
              "observedAt": 1793299965810
            }
          }
        ],
        "fetchedAt": 1793299965810,
        "ageSec": 1,
        "source": "endpoint"
      },
      {
        "id": "openrouter",
        "title": "OpenRouter",
        "short": "or",
        "state": "ok",
        "credits": {
          "remaining": 17.6340302840008,
          "total": 4142.6,
          "used": 4124.965969716,
          "currency": "$",
          "detailText": "day $27.90 · wk $70.37 · mo $194.47",
          "drainage": {
            "observedAt": 1793299965835
          }
        },
        "windows": [
          {
            "id": "credits",
            "shortLabel": "cred",
            "label": "Account credits",
            "usedFraction": 0.9957432457191134,
            "valueText": "$17.63 left of $4142.60",
            "important": true,
            "usedPercent": 99.57432457191135,
            "remainingPercent": 0.42567542808865655,
            "drainage": {
              "observedAt": 1793299965835
            }
          }
        ],
        "fetchedAt": 1793299965835,
        "ageSec": 1,
        "source": "endpoint"
      },
      {
        "id": "deepseek",
        "title": "DeepSeek",
        "short": "ds",
        "state": "ok",
        "credits": {
          "remaining": 11.59,
          "currency": "$",
          "detailText": "granted $0.00 · topped-up $11.59",
          "drainage": {
            "observedAt": 1793299966093
          }
        },
        "windows": [],
        "fetchedAt": 1793299966093,
        "ageSec": 1,
        "source": "endpoint"
      }
    ]
  },
  "configuredLine": [
    "openrouter: 17.63$ · deepseek: 11.59$ · codex: 56% (1r) · claude: 5h/err 7d/err · antigravity: gem/9% arg/99% · synthetic: 37% · xai: 44%"
  ],
  "syntheticRecovery": {
    "missing": {
      "report": {
        "id": "synthetic",
        "title": "Synthetic",
        "short": "syn",
        "state": "needs-auth",
        "needsAuth": true,
        "windows": [],
        "fetchedAt": 1793299966744,
        "ageSec": 0,
        "source": "endpoint",
        "error": "Synthetic quotas: credentials missing; check the Synthetic API key or /login synthetic"
      },
      "line": [
        "synthetic: login"
      ]
    },
    "restored": {
      "report": {
        "id": "synthetic",
        "title": "Synthetic",
        "short": "syn",
        "state": "ok",
        "windows": [
          {
            "id": "subscription",
            "shortLabel": "sub",
            "label": "Subscription requests",
            "important": true,
            "usedFraction": 0,
            "valueText": "0/500 used",
            "resetAtMs": 1793317966812,
            "usedPercent": 0,
            "remainingPercent": 100,
            "resetAt": 1793317966812,
            "resetInSec": 17999.95,
            "drainage": {
              "observedAt": 1793299966746
            }
          },
          {
            "id": "7d",
            "shortLabel": "7d",
            "label": "7d plan budget",
            "period": "7d",
            "usedFraction": 0.3704545627424447,
            "valueText": "62.95% left",
            "resetAtMs": 1793308528000,
            "important": true,
            "usedPercent": 37.04545627424447,
            "remainingPercent": 62.95454372575553,
            "resetAt": 1793308528000,
            "resetInSec": 8561.138,
            "drainage": {
              "observedAt": 1793299966746
            }
          },
          {
            "id": "search-1h",
            "shortLabel": "srch",
            "label": "1h search requests",
            "period": "1h",
            "scope": "search",
            "important": false,
            "usedFraction": 0,
            "valueText": "0/250 used",
            "resetAtMs": 1793303566813,
            "usedPercent": 0,
            "remainingPercent": 100,
            "resetAt": 1793303566813,
            "resetInSec": 3599.951,
            "drainage": {
              "observedAt": 1793299966746
            }
          }
        ],
        "fetchedAt": 1793299966746,
        "ageSec": 0,
        "source": "endpoint"
      },
      "line": [
        "synthetic: 37%"
      ]
    }
  },
  "nativeCount": {
    "model": {
      "provider": "claude",
      "id": "claude-haiku-5-5"
    },
    "context": {
      "provider": "claude",
      "model": "claude-haiku-5-5",
      "tokens": {
        "tokens": 4,
        "source": "count-endpoint"
      },
      "tail": "[circular]",
      "tailMessages": 1,
      "computedAt": 1793299967331
    },
    "counterId": "count_tokens:claude:claude-haiku-5-5",
    "toolCount": {
      "tokens": 342,
      "source": "count-endpoint"
    },
    "counters": {
      "claude": "count_tokens:claude:claude-haiku-5-5",
      "synthetic": "estimate:synthetic:4/3",
      "openai": "estimate:openai:4.19/3.51",
      "xai": "estimate:xai:4.17/3.31",
      "openrouter": "estimate:default:4/3",
      "deepseek": "estimate:default:4/3"
    }
  },
  "requests": [
    {
      "stage": "quota-configured",
      "url": "https://api.synthetic.new/v2/quotas",
      "request": {
        "method": "GET",
        "headers": {
          "accept": "application/json",
          "authorization": "[redacted]"
        },
        "bodyText": null
      },
      "response": {
        "status": 200,
        "headers": {
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-origin": "*",
          "connection": "keep-alive",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:46 GMT",
          "strict-transport-security": "max-age=31536000; includeSubDomains",
          "transfer-encoding": "chunked",
          "vary": "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Access-Control-Request-Headers",
          "x-clerk-auth-message": "Invalid JWT form. A JWT consists of three parts separated by dots. (reason=token-invalid, token-carrier=header)",
          "x-clerk-auth-reason": "token-invalid",
          "x-clerk-auth-status": "signed-out",
          "x-frame-options": "SAMEORIGIN",
          "x-middleware-rewrite": "/api/v2/quotas"
        },
        "bodyText": "{\"subscription\":{\"limit\":500,\"requests\":0,\"renewsAt\":\"2026-10-29T23:52:46.083Z\"},\"search\":{\"hourly\":{\"limit\":250,\"requests\":0,\"renewsAt\":\"2026-10-29T19:52:46.084Z\"}},\"planWeeklyLimit\":{\"nextRegenAt\":\"2026-10-29T21:15:28.000Z\",\"percentRemaining\":62.95454372575553,\"nextRegenPercent\":2}}"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://api.anthropic.com/api/oauth/usage",
      "request": {
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
          "cf-ray": "a52461126e2dbaad-ZRH",
          "connection": "keep-alive",
          "content-length": "107",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:45 GMT",
          "expires": "Thu, 01 Jan 1970 00:00:01 GMT",
          "referrer-policy": "same-origin",
          "retry-after": "0",
          "server": "cloudflare",
          "x-frame-options": "SAMEORIGIN",
          "x-robots-tag": "none"
        },
        "bodyText": "{\n  \"error\": {\n    \"type\": \"rate_limit_error\",\n    \"message\": \"Rate limited. Please try again later.\"\n  }\n}"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "request": {
        "method": "POST",
        "headers": {
          "accept-encoding": "gzip",
          "authorization": "[redacted]",
          "content-type": "application/json",
          "user-agent": "antigravity/cli/1.4.8 (aidev_client; os_type=linux; arch=amd64; cl=1007749967; auth_method=consumer)"
        },
        "bodyText": "{\"metadata\":{\"ideType\":\"ANTIGRAVITY\"}}"
      },
      "response": {
        "status": 200,
        "headers": {
          "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
          "content-encoding": "gzip",
          "content-type": "application/json; charset=UTF-8",
          "date": "Thu, 29 Oct 2026 18:52:46 GMT",
          "server": "ESF",
          "server-timing": "gfet5t7;dur=330, gfet4t7; dur=367",
          "transfer-encoding": "chunked",
          "vary": "Origin, X-Origin, Referer",
          "x-cloudaicompanion-trace-id": "6ece25519a5c926d",
          "x-content-type-options": "nosniff",
          "x-frame-options": "SAMEORIGIN",
          "x-xss-protection": "0"
        },
        "bodyText": "{\n  \"currentTier\": {\n    \"id\": \"free-tier\",\n    \"name\": \"Antigravity\",\n    \"description\": \"Gemini-powered code suggestions and chat in multiple IDEs\",\n    \"privacyNotice\": {\n      \"showNotice\": true,\n      \"noticeText\": \"This notice and our Privacy Policy - https://policies.google.com/privacy - describe how Gemini Code Assist for individuals handles your data. Please read them carefully.\\n\\nWhen you use Gemini Code Assist for individuals, Google collects your prompts, related code, generated output, code edits, related feature usage information, and your feedback to provide, improve, and develop Google products and services and machine learning technologies.\\n\\nTo help with quality and improve our products (such as generative machine-learning models), human reviewers may read, annotate, and process the data collected above. We take steps to protect your privacy as part of this process. This includes disconnecting the data from your Google Account before reviewers see or annotate it, and storing those disconnected copies for up to 18 months. Please don't submit confidential information or any data you wouldn't want a reviewer to see or Google to use to improve our products, services, and machine-learning technologies.\\n\\nIf you don't want this data used to improve Google's machine learning models, you can opt out below.\"\n    },\n    \"upgradeSubscriptionUri\": \"https://accounts.google.com/AccountChooser?Email=furbyhaxx%40gmail.com&continue=https%3A%2F%2Fone.google.com%2Fai\",\n    \"upgradeSubscriptionText\": \"Upgrade to get 1,500 model requests per day with Gemini CLI and Gemini Code Assist's agent mode with Google AI Pro.\",\n    \"upgradeSubscriptionType\": \"GOOGLE_ONE\"\n  },\n  \"allowedTiers\": [\n    {\n      \"id\": \"free-tier\",\n      \"name\": \"Antigravity\",\n      \"description\": \"Gemini-powered code suggestions and chat in multiple IDEs\",\n      \"privacyNotice\": {\n        \"showNotice\": true,\n        \"noticeText\": \"This notice and our Privacy Policy - https://policies.google.com/privacy - describe how Gemini Code Assist for individuals handles your data. Please read them carefully.\\n\\nWhen you use Gemini Code Assist for individuals, Google collects your prompts, related code, generated output, code edits, related feature usage information, and your feedback to provide, improve, and develop Google products and services and machine learning technologies.\\n\\nTo help with quality and improve our products (such as generative machine-learning models), human reviewers may read, annotate, and process the data collected above. We take steps to protect your privacy as part of this process. This includes disconnecting the data from your Google Account before reviewers see or annotate it, and storing those disconnected copies for up to 18 months. Please don't submit confidential information or any data you wouldn't want a reviewer to see or Google to use to improve our products, services, and machine-learning technologies.\\n\\nIf you don't want this data used to improve Google's machine learning models, you can opt out below.\"\n      },\n      \"isDefault\": true\n    },\n    {\n      \"id\": \"standard-tier\",\n      \"name\": \"Antigravity\",\n      \"description\": \"Unlimited coding assistant with the most powerful Gemini models\",\n      \"userDefinedCloudaicompanionProject\": true,\n      \"privacyNotice\": {},\n      \"usesGcpTos\": true\n    }\n  ],\n  \"cloudaicompanionProject\": \"[redacted]\",\n  \"gcpManaged\": false,\n  \"upgradeSubscriptionUri\": \"https://codeassist.google.com/upgrade\",\n  \"paidTier\": {\n    \"id\": \"g1-pro-tier\",\n    \"name\": \"Google AI Pro\",\n    \"description\": \"Google AI Pro\",\n    \"upgradeSubscriptionUri\": \"https://antigravity.google/g1-upgrade\",\n    \"upgradeSubscriptionText\": \"You can upgrade to a Google AI Ultra plan to receive higher rate limits.\",\n    \"availableCredits\": [\n      {\n        \"creditType\": \"GOOGLE_ONE_AI\",\n        \"minimumCreditAmountForUsage\": \"50\"\n      }\n    ]\n  }\n}\n"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://chatgpt.com/backend-api/wham/usage",
      "request": {
        "method": "GET",
        "headers": {
          "accept": "application/json",
          "authorization": "[redacted]",
          "chatgpt-account-id": "[redacted]",
          "originator": "codex_cli_rs",
          "user-agent": "codex_cli_rs/0.60.0"
        },
        "bodyText": null
      },
      "response": {
        "status": 200,
        "headers": {
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a52461126d08565e-ZRH",
          "connection": "keep-alive",
          "content-encoding": "br",
          "content-type": "application/json",
          "cross-origin-opener-policy": "same-origin-allow-popups",
          "date": "Thu, 29 Oct 2026 18:52:46 GMT",
          "nel": "{\"report_to\":\"cf-nel\",\"success_fraction\":0.01,\"max_age\":604800}",
          "referrer-policy": "strict-origin-when-cross-origin",
          "report-to": "{\"group\":\"cf-nel\",\"max_age\":604800,\"endpoints\":[{\"url\":\"https://a.nel.cloudflare.com/report/v4?s=snQzf9pf07udHkeRHCSXD2UCNM8Lv4rXNrgqrEyVe6QHdDTGhsWQ844zhKnbjS7fAfILDPdAp7HHR1XVMTit6xo%2Ba%2Fci%2Bcu4Z2DWsNliK5wAILL0y0TZkK3ma4ib\"}]}",
          "server": "cloudflare",
          "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
          "transfer-encoding": "chunked",
          "x-content-type-options": "nosniff",
          "x-oai-request-id": "777b36b3-ad82-4722-a8e7-f8685b161284",
          "x-openai-proxy-wasm": "v0.1",
          "set-cookie": "[redacted]"
        },
        "bodyText": "{\n  \"user_id\": \"user-0InQm55Bkaiqn2DXMgV7T4o4\",\n  \"account_id\": \"[redacted]\",\n  \"email\": \"[redacted]\",\n  \"plan_type\": \"pro\",\n  \"rate_limit\": {\n    \"allowed\": true,\n    \"limit_reached\": false,\n    \"primary_window\": {\n      \"used_percent\": 56,\n      \"limit_window_seconds\": 604800,\n      \"reset_after_seconds\": 474164,\n      \"reset_at\": 1793774130\n    },\n    \"secondary_window\": null\n  },\n  \"code_review_rate_limit\": null,\n  \"additional_rate_limits\": null,\n  \"model_usage\": {\n    \"gpt-6-astra\": {\n      \"available\": true,\n      \"available_at\": null,\n      \"credits_would_enable\": false\n    }\n  },\n  \"credits\": {\n    \"has_credits\": false,\n    \"unlimited\": false,\n    \"overage_limit_reached\": false,\n    \"balance\": \"0\",\n    \"approx_local_messages\": [\n      0,\n      0\n    ],\n    \"approx_cloud_messages\": [\n      0,\n      0\n    ]\n  },\n  \"spend_control\": {\n    \"reached\": false,\n    \"individual_limit\": null\n  },\n  \"rate_limit_reached_type\": null,\n  \"promo\": null,\n  \"rate_limit_reset_credits\": {\n    \"available_count\": 1,\n    \"applicable_available_count\": 0\n  }\n}"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://openrouter.ai/api/v1/credits",
      "request": {
        "method": "GET",
        "headers": {
          "accept": "application/json",
          "authorization": "[redacted]"
        },
        "bodyText": null
      },
      "response": {
        "status": 200,
        "headers": {
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "X-Generation-Id,X-Provider-Name,request-id,cf-ray",
          "alt-svc": "h3=\":443\"; ma=86400",
          "cache-control": "private, no-store",
          "cf-ray": "a52461126c780395-ZRH",
          "connection": "keep-alive",
          "content-encoding": "gzip",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:45 GMT",
          "permissions-policy": "payment=(self \"https://checkout.stripe.com\" \"https://connect-js.stripe.com\" \"https://js.stripe.com\" \"https://*.js.stripe.com\" \"https://hooks.stripe.com\")",
          "referrer-policy": "no-referrer, strict-origin-when-cross-origin",
          "server": "cloudflare",
          "transfer-encoding": "chunked",
          "x-content-type-options": "nosniff",
          "set-cookie": "[redacted]"
        },
        "bodyText": "{\"data\":{\"total_credits\":4142.6,\"total_usage\":4124.965969716}}"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://openrouter.ai/api/v1/key",
      "request": {
        "method": "GET",
        "headers": {
          "accept": "application/json",
          "authorization": "[redacted]"
        },
        "bodyText": null
      },
      "response": {
        "status": 200,
        "headers": {
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "X-Generation-Id,X-Provider-Name,request-id,cf-ray",
          "alt-svc": "h3=\":443\"; ma=86400",
          "cache-control": "private, no-store",
          "cf-ray": "a524611268ffb671-ZRH",
          "connection": "keep-alive",
          "content-encoding": "gzip",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:45 GMT",
          "permissions-policy": "payment=(self \"https://checkout.stripe.com\" \"https://connect-js.stripe.com\" \"https://js.stripe.com\" \"https://*.js.stripe.com\" \"https://hooks.stripe.com\")",
          "referrer-policy": "no-referrer, strict-origin-when-cross-origin",
          "server": "cloudflare",
          "transfer-encoding": "chunked",
          "x-content-type-options": "nosniff",
          "set-cookie": "[redacted]"
        },
        "bodyText": "{\"data\":{\"label\":\"[redacted]\",\"is_management_key\":false,\"is_provisioning_key\":false,\"limit\":null,\"limit_reset\":null,\"limit_remaining\":null,\"include_byok_in_limit\":false,\"budgets\":[],\"effective_budget\":null,\"usage\":212.225589316,\"usage_daily\":27.900372387,\"usage_weekly\":70.366484749,\"usage_monthly\":194.473940971,\"byok_usage\":27.340951625,\"byok_usage_daily\":0,\"byok_usage_weekly\":3.547958125,\"byok_usage_monthly\":11.554893125,\"is_free_tier\":false,\"expires_at\":null,\"creator_user_id\":\"[redacted]\",\"organization_id\":null,\"workspace_id\":\"[redacted]\",\"allowed_data_regions\":[\"global\"],\"free_model_daily_requests\":{\"used\":0,\"limit\":1000,\"remaining\":1000},\"rate_limit\":{\"requests\":-1,\"interval\":\"10s\",\"note\":\"This field is deprecated and safe to ignore.\"}}}"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://api.deepseek.com/user/balance",
      "request": {
        "method": "GET",
        "headers": {
          "accept": "application/json",
          "authorization": "[redacted]"
        },
        "bodyText": null
      },
      "response": {
        "status": 200,
        "headers": {
          "access-control-allow-credentials": "true",
          "connection": "keep-alive",
          "content-encoding": "zstd",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:46 GMT",
          "server": "elb",
          "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
          "transfer-encoding": "chunked",
          "vary": "accept-encoding, origin, access-control-request-method, access-control-request-headers",
          "via": "1.1 16a83c328ec1b5af4d0dc28e1e3a8198.cloudfront.net (CloudFront)",
          "x-amz-cf-id": "Utstqdpkey7CpT46snbeaXlemdJ0PMoqvoWyDc7heUJM5dwuhlslTg==",
          "x-amz-cf-pop": "ZRH52-P1",
          "x-cache": "Miss from cloudfront",
          "x-content-type-options": "nosniff",
          "x-ds-trace-id": "6eb8acec2559ee303cd1472d0c520b8d"
        },
        "bodyText": "{\"is_available\":true,\"balance_infos\":[{\"currency\":\"USD\",\"total_balance\":\"11.59\",\"granted_balance\":\"0.00\",\"topped_up_balance\":\"11.59\"}]}"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
      "request": {
        "method": "GET",
        "headers": {
          "accept": "application/json",
          "authorization": "[redacted]"
        },
        "bodyText": null
      },
      "response": {
        "status": 200,
        "headers": {
          "alt-svc": "h3=\":443\"; ma=86400",
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a52461126b760d51-ZRH",
          "connection": "keep-alive",
          "content-encoding": "gzip",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:45 GMT",
          "server": "cloudflare",
          "speculation-rules": "\"/cdn-cgi/speculation\"",
          "strict-transport-security": "max-age=31536000; includeSubDomains",
          "transfer-encoding": "chunked",
          "vary": "origin, access-control-request-method, access-control-request-headers",
          "set-cookie": "[redacted]"
        },
        "bodyText": "{\"config\":{\"currentPeriod\":{\"type\":\"USAGE_PERIOD_TYPE_WEEKLY\",\"start\":\"2026-10-27T12:23:09.952398+00:00\",\"end\":\"2026-11-03T12:23:09.952398+00:00\"},\"creditUsagePercent\":44.0,\"onDemandCap\":{\"val\":0},\"onDemandUsed\":{\"val\":0},\"productUsage\":[{\"product\":\"GrokBuild\",\"usagePercent\":44.0}],\"isUnifiedBillingUser\":true,\"prepaidBalance\":{\"val\":0},\"topUpMethod\":\"TOP_UP_METHOD_SAVED_PAYMENT_METHOD\",\"billingPeriodStart\":\"2026-10-27T12:23:09.952398+00:00\",\"billingPeriodEnd\":\"2026-11-03T12:23:09.952398+00:00\"}}"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://cli-chat-proxy.grok.com/v1/billing",
      "request": {
        "method": "GET",
        "headers": {
          "accept": "application/json",
          "authorization": "[redacted]"
        },
        "bodyText": null
      },
      "response": {
        "status": 200,
        "headers": {
          "alt-svc": "h3=\":443\"; ma=86400",
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a5246112681603b1-ZRH",
          "connection": "keep-alive",
          "content-encoding": "gzip",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:46 GMT",
          "server": "cloudflare",
          "speculation-rules": "\"/cdn-cgi/speculation\"",
          "strict-transport-security": "max-age=31536000; includeSubDomains",
          "transfer-encoding": "chunked",
          "vary": "origin, access-control-request-method, access-control-request-headers",
          "set-cookie": "[redacted]"
        },
        "bodyText": "{\"config\":{\"monthlyLimit\":{\"val\":0},\"used\":{\"val\":43},\"onDemandCap\":{\"val\":0},\"billingPeriodStart\":\"2026-10-01T00:00:00+00:00\",\"billingPeriodEnd\":\"2026-11-01T00:00:00+00:00\",\"history\":[{\"billingCycle\":{\"year\":2026,\"month\":9},\"includedUsed\":{\"val\":0},\"onDemandUsed\":{\"val\":0},\"totalUsed\":{\"val\":0}},{\"billingCycle\":{\"year\":2026,\"month\":8},\"includedUsed\":{\"val\":0},\"onDemandUsed\":{\"val\":0},\"totalUsed\":{\"val\":0}},{\"billingCycle\":{\"year\":2026,\"month\":7},\"includedUsed\":{\"val\":0},\"onDemandUsed\":{\"val\":0},\"totalUsed\":{\"val\":0}}]}}"
      }
    },
    {
      "stage": "quota-configured",
      "url": "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
      "request": {
        "method": "POST",
        "headers": {
          "accept-encoding": "gzip",
          "authorization": "[redacted]",
          "content-type": "application/json",
          "user-agent": "antigravity/cli/1.4.8 (aidev_client; os_type=linux; arch=amd64; cl=1007749967; auth_method=consumer)"
        },
        "bodyText": "{\"project\":\"[redacted]\"}"
      },
      "response": {
        "status": 200,
        "headers": {
          "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
          "content-encoding": "gzip",
          "content-type": "application/json; charset=UTF-8",
          "date": "Thu, 29 Oct 2026 18:52:46 GMT",
          "server": "ESF",
          "server-timing": "gfet4t7; dur=496",
          "transfer-encoding": "chunked",
          "vary": "Origin, X-Origin, Referer",
          "x-cloudaicompanion-trace-id": "cdd0090bdb58551c",
          "x-content-type-options": "nosniff",
          "x-frame-options": "SAMEORIGIN",
          "x-xss-protection": "0"
        },
        "bodyText": "{\n  \"groups\": [\n    {\n      \"buckets\": [\n        {\n          \"bucketId\": \"gemini-weekly\",\n          \"displayName\": \"Weekly Limit Remaining\",\n          \"window\": \"weekly\",\n          \"resetTime\": \"2026-11-04T13:38:11Z\",\n          \"description\": \"You have used some of your weekly limit, it will fully refresh in 5 days, 18 hours.\",\n          \"remainingFraction\": 0.9055114\n        },\n        {\n          \"bucketId\": \"gemini-5h\",\n          \"displayName\": \"Five Hour Limit Remaining\",\n          \"window\": \"5h\",\n          \"resetTime\": \"2026-10-29T23:52:46Z\",\n          \"remainingFraction\": 1\n        }\n      ],\n      \"displayName\": \"Gemini Models\",\n      \"description\": \"Models within this group: Gemini Flash, Gemini Pro\"\n    },\n    {\n      \"buckets\": [\n        {\n          \"bucketId\": \"3p-weekly\",\n          \"displayName\": \"Weekly Limit Remaining\",\n          \"window\": \"weekly\",\n          \"resetTime\": \"2026-10-30T16:20:30Z\",\n          \"description\": \"You have used some of your weekly limit, it will fully refresh in 21 hours, 27 minutes.\",\n          \"remainingFraction\": 0.9179408\n        },\n        {\n          \"bucketId\": \"3p-5h\",\n          \"displayName\": \"Five Hour Limit Remaining\",\n          \"window\": \"5h\",\n          \"resetTime\": \"2026-10-29T23:32:51Z\",\n          \"description\": \"You have used some of your 5-hour limit, it will fully refresh in 4 hours, 40 minutes.\",\n          \"remainingFraction\": 0.9992\n        }\n      ],\n      \"displayName\": \"Claude and GPT models\",\n      \"description\": \"Models within this group: Claude Opus, Claude Sonnet, GPT-OSS\"\n    },\n    {\n      \"buckets\": [\n        {\n          \"bucketId\": \"gemini-argon-wtu-weekly\",\n          \"displayName\": \"Gemini 4 Argon Weekly Limit\",\n          \"window\": \"weekly\",\n          \"resetTime\": \"2026-11-03T11:24:43Z\",\n          \"description\": \"You have used some of your weekly limit, it will fully refresh in 4 days, 16 hours.\",\n          \"remainingFraction\": 0.005596\n        }\n      ],\n      \"displayName\": \"Gemini 4 Argon\",\n      \"description\": \"For paid Pro plans, Argon quota is separate. Higher Argon quota (included as part of the larger Gemini quota bucket) is available on Ultra plans.\"\n    }\n  ],\n  \"description\": \"Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. The 5-hour limit smooths out aggregate demand to fairly distribute global capacity across all users, while your weekly limit is tied directly to your individual tier.\"\n}\n"
      }
    },
    {
      "stage": "synthetic-recovery",
      "url": "https://api.synthetic.new/v2/quotas",
      "request": {
        "method": "GET",
        "headers": {
          "accept": "application/json",
          "authorization": "[redacted]"
        },
        "bodyText": null
      },
      "response": {
        "status": 200,
        "headers": {
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-origin": "*",
          "connection": "keep-alive",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:46 GMT",
          "strict-transport-security": "max-age=31536000; includeSubDomains",
          "transfer-encoding": "chunked",
          "vary": "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Access-Control-Request-Headers",
          "x-clerk-auth-message": "Invalid JWT form. A JWT consists of three parts separated by dots. (reason=token-invalid, token-carrier=header)",
          "x-clerk-auth-reason": "token-invalid",
          "x-clerk-auth-status": "signed-out",
          "x-frame-options": "SAMEORIGIN",
          "x-middleware-rewrite": "/api/v2/quotas"
        },
        "bodyText": "{\"subscription\":{\"limit\":500,\"requests\":0,\"renewsAt\":\"2026-10-29T23:52:46.812Z\"},\"search\":{\"hourly\":{\"limit\":250,\"requests\":0,\"renewsAt\":\"2026-10-29T19:52:46.813Z\"}},\"planWeeklyLimit\":{\"nextRegenAt\":\"2026-10-29T21:15:28.000Z\",\"percentRemaining\":62.95454372575553,\"nextRegenPercent\":2}}"
      }
    },
    {
      "stage": "native-count",
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "request": {
        "method": "POST",
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
          "cf-ray": "a52461199dd7baad-ZRH",
          "connection": "keep-alive",
          "content-length": "19",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:47 GMT",
          "request-id": "req_011CgX2uudqX6ubQ3ZkNFrCK",
          "server": "cloudflare",
          "server-timing": "x-originResponse;dur=75",
          "x-robots-tag": "none"
        },
        "bodyText": "{\"input_tokens\":33}"
      }
    },
    {
      "stage": "native-count",
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "request": {
        "method": "POST",
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
          "cf-ray": "a524611acf4abaad-ZRH",
          "connection": "keep-alive",
          "content-length": "19",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:47 GMT",
          "request-id": "req_011CgX2uvNVjB8PSk82FhXyA",
          "server": "cloudflare",
          "server-timing": "x-originResponse;dur=58",
          "x-robots-tag": "none"
        },
        "bodyText": "{\"input_tokens\":36}"
      }
    },
    {
      "stage": "native-count",
      "url": "https://api.anthropic.com/v1/messages/count_tokens",
      "request": {
        "method": "POST",
        "headers": {
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,inline-tools-2026-09-15,advisor-tool-2026-03-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11",
          "anthropic-version": "2023-06-01",
          "authorization": "[redacted]",
          "content-type": "application/json",
          "user-agent": "claude-cli/2.1.312 (external, cli)",
          "x-app": "cli",
          "x-claude-code-session-id": "[redacted]"
        },
        "bodyText": "{\"model\":\"claude-haiku-5-5\",\"system\":[{\"type\":\"text\",\"text\":\"You are Claude Code, Anthropic's official CLI for Claude.\"}],\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"x\"}]}],\"tools\":[{\"name\":\"Echo\",\"description\":\"Return text\",\"input_schema\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}}}}]}"
      },
      "response": {
        "status": 200,
        "headers": {
          "anthropic-organization-id": "[redacted]",
          "anthropic-workspace-id": "[redacted]",
          "cf-cache-status": "DYNAMIC",
          "cf-ray": "a524611bd882baad-ZRH",
          "connection": "keep-alive",
          "content-length": "20",
          "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
          "content-type": "application/json",
          "date": "Thu, 29 Oct 2026 18:52:47 GMT",
          "request-id": "req_011CgX2uw6f7GQeNJ4ctzbLn",
          "server": "cloudflare",
          "server-timing": "x-originResponse;dur=55",
          "x-robots-tag": "none"
        },
        "bodyText": "{\"input_tokens\":375}"
      }
    }
  ]
}
```
