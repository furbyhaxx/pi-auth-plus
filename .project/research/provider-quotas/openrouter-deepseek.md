---
document:
  type: "research"
  id: "research-provider-quota-openrouter-deepseek"
  title: "OpenRouter and DeepSeek quota, credit and rate-limit endpoints"
  description: "Verified endpoints, auth, response schemas and units for querying remaining quota on OpenRouter and DeepSeek"
  status: "published"
  revision: 2
  created_at: "2026-10-21T14:25:00+02:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "researcher"
  updated_by: "pi"
  source: "pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/research/provider-quota-openrouter-deepseek.md"
  changelog:
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/research/provider-quota-openrouter-deepseek.md"]
---

# OpenRouter and DeepSeek quota, credit and rate-limit endpoints

**Checked:** 2026-10-21. Vendor documentation was preferred. Statements below are marked as official documentation unless otherwise indicated. No authenticated live API calls were made, so these findings verify published contracts, not live-account values.

## TL;DR

- OpenRouter `GET /api/v1/key` returns the calling key's spend cap and cumulative/UTC-window usage. Use `Authorization: Bearer <API key>`. `limit: null` and `limit_remaining: null` mean no per-key credit cap; neither is the account balance. [1][2]
- OpenRouter `GET /api/v1/credits` returns account-level `total_credits` and `total_usage`. Its response has no `remaining` field; remaining credits can be derived from the two totals. [3][4]
  - **Live correction (2026-10-21):** the documentation reading that this route requires a Management API key did not hold. Called with the account's ordinary OAuth-issued key it returned HTTP 200 (`{"data":{"total_credits":3967.6,"total_usage":3847.523143035}}`), and the same key reported `is_management_key: false` via `/api/v1/key`. Do not gate the call on key type; attempt it and fall back on 401/403.
- OpenRouter reports platform `X-RateLimit-*` headers on platform-generated inference 429 errors, not successful inference responses. Current docs publish free-model request ceilings and note model-specific/upstream limits, but no general live per-model quota lookup. Header value formats/units are not specified in the docs read. [1]
- DeepSeek `GET https://api.deepseek.com/user/balance` returns account-level balance, as decimal strings tagged `CNY` or `USD`; only CNY is shown in the sample, and the schema does not say both currencies always appear. [5]
- DeepSeek documents model-specific account concurrency ceilings (`deepseek-flash`: 2,500; `deepseek-v4-pro`: 500). 429 can also mean requests sent too quickly or a concurrency/QPS limit; no QPS values, live concurrency endpoint, or 429 response headers were documented. [6][7]
- Confidence: high for documented endpoint paths, field names, auth, and stated limits; medium for OpenRouter OAuth authentication because its guide and generated API reference conflict; low/unverified for OpenRouter generation retention duration and unlisted header formats.

## OpenRouter

### Endpoint table

| Need | Method and URL | Authentication | Contract / use |
|---|---|---|---|
| This API key's spend cap and usage | `GET https://openrouter.ai/api/v1/key` | `Authorization: Bearer <the API key being inspected>` | Returns `{ "data": { ... } }`; current key metadata includes per-key spend cap, remaining cap, usage windows, BYOK usage, daily free-model request counter, and applicable budgets. This is the practical endpoint for inspecting the credential that made the call. [1][2] |
| Account-level credits purchased and used | `GET https://openrouter.ai/api/v1/credits` | `Authorization: Bearer <API key>` | Returns `{ "data": { "total_credits": number, "total_usage": number } }`. Docs describe a Management API key requirement, but a live call with an ordinary key succeeded (see the live correction above). No `remaining` field is returned. [3][4] |
| Exchange PKCE authorization code | `POST https://openrouter.ai/api/v1/auth/keys` | OAuth guide's request has no `Authorization` header; see authentication conflict below | JSON request contains `code` and optionally `code_verifier` / `code_challenge_method`. Documented success response is `{ "key": string, "user_id": string | null }`; it does not include credit or limit fields. [9][10] |
| Cost and metadata for one generation | `GET https://openrouter.ai/api/v1/generation?id=<gen-id>` | `Authorization: Bearer <API key>` | Returns `{ "data": { ... } }`; query `id` is a generation ID matching `gen-...`. Cost fields include `total_cost`, `usage`, `upstream_inference_cost`, and `cache_discount`. [11] |

### Credits and key response fields

`GET /credits` uses JSON numbers (`double` in the OpenAPI schema), with an example containing decimal values. It reports `total_credits` (purchased) and `total_usage` (used), not a percentage or fractional quota. The endpoint calls these amounts “credits”; the key endpoint and limits documentation explicitly describe comparable OpenRouter credit/spend amounts as USD. Treat these as USD-denominated credit amounts, while noting that the `/credits` schema itself does not declare a currency property. Remaining account credits are derivable as `total_credits - total_usage`; there is no explicit `remaining` field. [1][3]

Current documented `/key` `data` fields are below. Monetary values are USD; `usage*` windows are UTC. Fields in the OpenAPI schema are required unless noted otherwise; nullable values are literal JSON `null`, not omitted percentages. [1][2]

| Field(s) | Type / unit | Meaning and null semantics |
|---|---|---|
| `label` | string | Human-readable key label. |
| `limit` | number or `null`, USD | Optional spending cap for this key. `null` means unlimited. |
| `limit_remaining` | number or `null`, USD | Remaining amount of the key's spending cap. `null` means unlimited; it is not the account's overall credit balance. |
| `limit_reset` | string or `null` | Key limit reset period (daily, weekly, or monthly); `null` means it never resets. |
| `usage` | number, USD | Total OpenRouter credit usage for this API key, all time. |
| `usage_daily`, `usage_weekly`, `usage_monthly` | number, USD | Key usage in current UTC day, Monday–Sunday UTC week, and UTC month. |
| `byok_usage` | number, USD | Total external bring-your-own-key usage for this key. |
| `byok_usage_daily`, `byok_usage_weekly`, `byok_usage_monthly` | number, USD | External BYOK usage in the current UTC day, Monday–Sunday UTC week, and UTC month. |
| `include_byok_in_limit` | boolean | Whether external BYOK spend is included in this key's credit limit. |
| `is_free_tier` | boolean | Whether the key/account is marked free-tier. Do not use this boolean alone to infer the applicable free-model daily ceiling: the limits page says the free-model daily tier is determined by lifetime credits purchased independently of this field. |
| `free_model_daily_requests` | object: integer `used`, `limit`, `remaining` | Account's current UTC-day counter and free-model request ceiling; counter resets at UTC midnight. This does not expose its per-minute counter. |
| `budgets` | array of budget objects | Applicable guardrail/workspace/key spending budgets, in enforcement order. Each has `scope`, nullable `guardrail_id`/`budget_id`, `limit_usd`, `spend_usd`, `remaining_usd`, nullable `reset_interval`/`resets_at`, and `include_byok`. Lifetime budgets use null reset fields. |
| `effective_budget` | budget object or `null` | Budget layer that will block first; `null` if no budget applies. |
| `is_management_key` | boolean | Whether the current key is a Management API key. |
| `is_provisioning_key` | boolean | Deprecated field; current schema still lists it. |
| `creator_user_id` | string or `null` | User who created the key. |
| `organization_id` | string or `null` | Owning organization; null for individually owned keys. |
| `workspace_id` | string or `null` | Workspace to which spend is attributed; null when no active workspace resolves. |
| `expires_at` | string or `null` | Optional ISO-8601 UTC expiry; null when there is no expiration. |
| `allowed_data_regions` | string array | Data regions allowed by applicable policy. |
| `rate_limit` | object (deprecated) | Legacy rate-limit data; the schema says it is safe to ignore and always returns `-1`. It is not a useful current quota reading. The response example still shows `requests: 1000`, so the example and field description disagree; do not rely on this field. |

For applicable budget objects, `limit_usd`, `spend_usd`, and `remaining_usd` are monetary USD amounts. `reset_interval` is `daily`, `weekly`, `monthly`, or `null`; `resets_at` is an ISO-8601 UTC timestamp or `null` for a lifetime budget. `limit`/`limit_remaining` continue to describe only the key's own cap, not an organization guardrail or workspace budget. [1]

### Rate limits and headers

OpenRouter's current limits documentation distinguishes credit/spending limits, organization/workspace budget limits, and request-rate limits. Its published platform-level free-model limits are 20 requests/minute and 50 requests/day for accounts below the credits-purchased threshold, or 20/minute and 1,000/day at/above the documented $10 threshold. The same page notes the higher daily ceiling currently starts one credit below the table threshold due to rounding/top-up fees; it also says the threshold is independent of `is_free_tier`. `free_model_daily_requests` reports daily use/limit/remaining only. These limits apply to `:free` model variants. Paid models do not have this platform-level request cap, but upstream model/provider rate limits still apply; OpenRouter says limits can differ among models and additional API keys do not increase global capacity. [1]

On successful inference responses OpenRouter documents **no** `X-RateLimit-*` headers. When OpenRouter itself rejects an inference request for a platform rate limit, its 429 response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. The docs describe them as information about the limit hit, but do not specify whether reset is a duration, timestamp, or its exact wire units. A `Retry-After` header is documented on relevant transient cases (including an exhausted in-flight spending budget, and when all attempted providers return a retry hint); this is not a universal quota snapshot. Upstream-provider 429s can also reach the client. [1]

The key endpoint's `rate_limit` object is deprecated and not a substitute for these headers. There is no documented general endpoint that reports current per-model or upstream concurrency remaining. OpenRouter's API references do not publish separate request-rate ceilings for `GET /key`, `GET /credits`, or PKCE exchange; that absence does not prove unlimited endpoint capacity. [1][2][3][9][10]

### PKCE response and authentication documentation discrepancy

The consumer-facing OAuth PKCE guide shows a `POST` with `Content-Type: application/json` and a JSON body, but no bearer header. The success payload contains only `key` and `user_id`; there are no limits or credit fields. In contrast, the generated API reference applies a global Bearer security scheme and lists a 403 “Only management keys can perform this operation” response for `/auth/keys`. These official pages conflict on authentication. The explicit PKCE guide's unauthenticated request is the documented user-consent flow, but the generated reference discrepancy means authentication should be verified against a live test account before treating this as an unambiguous contract. [9][10]

### Per-generation cost and retention

`GET /api/v1/generation?id=<gen-id>` returns a `data` object. `total_cost` is documented as total generation cost in USD; `usage` is usage amount in USD; `upstream_inference_cost` is upstream-provider cost in USD and can be null; `cache_discount` is a USD discount and can be null. `tokens_prompt` and `tokens_completion` are token counts and may be null. The generation metadata schema includes `created_at`, `model`, provider, latency, and status fields. [11]

The current generation API reference does not state how long generation metadata or records remain available. I could not verify an official retention duration; avoid promising a fixed lookback period based on this research. The API reference does expose a separate `/generation/content` route for stored prompt/completion/error data, but that route's schema likewise does not establish a retention period. [11][12]

## DeepSeek

### Endpoint table

| Need | Method and URL | Authentication | Contract / use |
|---|---|---|---|
| Account balance | `GET https://api.deepseek.com/user/balance` | `Authorization: Bearer <DeepSeek API key>` | Returns `is_available` and `balance_infos[]`. Balance fields are decimal strings in the currency named by `currency`. [5][13] |
| Model catalog/context limits | `GET https://api.deepseek.com/models` | DeepSeek API key; API uses Bearer authentication | Returns model metadata including integer `context_window` and `max_output_tokens`; this is model-level metadata, not per-account remaining quota. [13][14] |
| Per-request usage | `POST https://api.deepseek.com/chat/completions` | `Authorization: Bearer <DeepSeek API key>` | Successful completion response includes `usage` token counters; streaming response sends final usage in its last chunk. [8][13] |

### Balance response shape and units

The official balance endpoint documents this shape (sample values shown by DeepSeek):

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

`is_available` is a boolean indicating whether balance is sufficient for API calls. `balance_infos` is an array. `currency` has schema values `CNY` and `USD`; the published example shows CNY only, and the docs do not promise that both entries are always returned. `total_balance` is available balance including granted and topped-up balance; `granted_balance` is unexpired granted balance; `topped_up_balance` is topped-up balance. The amounts are JSON strings, not floating-point JSON numbers; the sample uses two decimal places. The schema does not declare a fixed precision/rounding guarantee. This is an account balance, not a per-key budget or token quota. [5]

### Rate limiting, concurrency and headers

The current DeepSeek “Rate Limit & Isolation” page documents account-level concurrent connection limits by model: `deepseek-flash` = 2,500 and `deepseek-v4-pro` = 500. A request counts as concurrent from submission until its response completes; keys on one account share the limit. Exceeding the limit returns HTTP 429. The page permits requesting capacity expansion and notes per-`user_id` limits for users with increased concurrency quotas. [6]

DeepSeek's error-code page describes 429 as requests sent too quickly or an exceeded concurrency/QPS limit. It does not publish a numeric QPS ceiling or list any 429 response headers such as `Retry-After` or `X-RateLimit-*`; the documented 429 behavior supplies no basis to depend on such headers. A 503 is documented separately for server overload. Thus “no hard rate limit” is incomplete against current docs: there are stated concurrency ceilings, plus unspecified request-speed/QPS enforcement. There is no documented endpoint/header that reports current in-use or remaining concurrency before a request; the documented observation is the 429 on over-limit requests. [6][7]

### Usage fields and model context metadata

The current chat-completion schema's `usage` object contains these integer token counts: [8]

| Field | Unit / meaning |
|---|---|
| `prompt_tokens` | Prompt tokens; schema states this equals cache-hit plus cache-miss tokens. |
| `completion_tokens` | Generated completion tokens. |
| `prompt_cache_hit_tokens` | Prompt tokens served from context cache. |
| `prompt_cache_miss_tokens` | Prompt tokens not served from context cache. |
| `total_tokens` | Prompt plus completion token count. |
| `prompt_tokens_details.cached_tokens` | Cached token count detail; schema says same as `prompt_cache_hit_tokens`. |
| `completion_tokens_details.reasoning_tokens` | Reasoning-token count. |

For streaming chat completion, usage is attached to the final chunk before `[DONE]`; `stream_options.include_usage: true` includes `usage: null` on non-final chunks and usage on the last chunk. [8]

`GET /models` reports per-model `context_window` (total input-plus-output token capacity) and `max_output_tokens`. The response is the current catalog's model capability metadata; it is not an account quota endpoint. DeepSeek does not document a separate account-level token allowance or a query route for remaining prompt tokens. The balance route is the documented account-financial-availability check. [5][14]

## Risks, caveats and open questions

- OpenRouter account balance and OpenRouter key-level spending limits are separate. A normal per-inference API key can inspect itself via `/key`, and a live test showed it can also read the aggregate credits route. A client should still not embed a management key in distributed software. [2][3][4]
- OpenRouter published PKCE guide and generated API reference disagree on whether `/auth/keys` needs a bearer credential; the guide's explicit request omits it. Confirm behavior live before encoding auth assumptions. [9][10]
- OpenRouter does not specify `X-RateLimit-Reset` wire units in the limits page, and the key endpoint's deprecated `rate_limit` example conflicts with its declared “always -1” description. [1][2]
- OpenRouter generation-record retention duration and administrative-endpoint request-rate quotas were not verified in official docs. Do not claim a 30-day (or other) retention period. [2][3][10][11]
- DeepSeek documents concurrency caps but not exact QPS/TPM quotas, concurrent-use counters, or 429 response headers. Values in the concurrency table are documentation values retrieved on 2026-10-21 and could change. [6][7]
- DeepSeek's balance schema allows `CNY` and `USD`, but only CNY appears in its sample; actual currency array contents are account-dependent or otherwise unspecified by the schema. [5]

## Sources

[1] OpenRouter, “Limits” — https://openrouter.ai/docs/api_reference/limits.md (accessed 2026-10-21; live documentation as retrieved that date).

[2] OpenRouter, “Get current API key” — https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key.md (accessed 2026-10-21; OpenAPI API key response schema retrieved that date).

[3] OpenRouter, “Get remaining credits” — https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits.md (accessed 2026-10-21; OpenAPI credits response schema retrieved that date).

[4] OpenRouter, “Management API Keys” — https://openrouter.ai/docs/guides/overview/auth/management-api-keys (accessed 2026-10-21; current management-key permissions and route list retrieved that date).

[5] DeepSeek, “Get User Balance” — https://api-docs.deepseek.com/api/get-user-balance (accessed 2026-10-21; response schema and example retrieved that date).

[6] DeepSeek, “Rate Limit & Isolation” — https://api-docs.deepseek.com/quick_start/rate_limit (accessed 2026-10-21; model-specific concurrency documentation retrieved that date).

[7] DeepSeek, “Error Codes” — https://api-docs.deepseek.com/quick_start/error_codes (accessed 2026-10-21; current 429 and 503 descriptions retrieved that date).

[8] DeepSeek, “Chat Completions API” — https://api-docs.deepseek.com/api/create-chat-completion (accessed 2026-10-21; completion `usage` and streaming response schema retrieved that date).

[9] OpenRouter, “OAuth PKCE” — https://openrouter.ai/docs/guides/overview/auth/oauth (accessed 2026-10-21; consumer authorization flow and unauthenticated exchange example retrieved that date).

[10] OpenRouter, “Exchange authorization code for API key” — https://openrouter.ai/docs/api/api-reference/oauth/exchange-authorization-code-for-api-key.md (accessed 2026-10-21; OpenAPI request/response and auth metadata retrieved that date).

[11] OpenRouter, “Get request & usage metadata for a generation” — https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation.md (accessed 2026-10-21; current generation cost schema retrieved that date).

[12] OpenRouter, “Get stored prompt, completion, and error content for a generation” — https://openrouter.ai/docs/api/api-reference/generations/get-stored-prompt-completion-and-error-content-for-a-generation.md (accessed 2026-10-21; content endpoint schema retrieved that date).

[13] DeepSeek, “Your First API Call” — https://api-docs.deepseek.com/quick_start/api_key (accessed 2026-10-21; base URL and Bearer API-key example retrieved that date).

[14] DeepSeek, “Lists Models” — https://api-docs.deepseek.com/api/list-models (accessed 2026-10-21; current model metadata/context schema retrieved that date).
