---
document:
  type: "research"
  id: "research-provider-quota-credits-reporting"
  title: "Quota, credit and rate-limit reporting endpoints for seven subscription providers"
  description: "Endpoint, auth, response schema, windows, units and reset semantics for querying remaining quota and credits on OpenRouter, Google Antigravity, Claude Code, Synthetic, xAI Grok, OpenAI ChatGPT/Codex and DeepSeek"
  status: "published"
  revision: 2
  created_at: "2026-10-21T14:31:00+02:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "orchestrator"
  updated_by: "pi"
  source: "pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/research/provider-quota-credits-reporting.md"
  changelog:
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/research/provider-quota-credits-reporting.md"]
---

# Quota, credit and rate-limit reporting for seven providers

**Checked:** 2026-10-21, Europe/Zurich.

Evidence grades used throughout:

- **[LIVE]** — request executed in this session against the real endpoint with the real credential; response captured verbatim.
- **[CODE]** — read from a reference implementation in this workspace.
- **[DOCS]** — from vendor documentation only.

Reference implementations consulted: `.references/oh-my-pi/packages/ai/src/usage/` (per-provider usage fetchers), `.references/pi-claude-auth`, `.references/pi-synthetic-auth`, the `@cortexkit/antigravity-auth-core` package, and the installed Claude binary `/home/furbyhaxx/.local/share/claude/versions/2.1.306`. Companion file for the two providers not covered by reference code: `.project/research/provider-quota-openrouter-deepseek.md`.

## 1. Summary

| Provider | Endpoint | Auth | Windows | Units of the primary number | Reset format |
|---|---|---|---|---|---|
| OpenRouter | `GET /api/v1/key` | Bearer API key | UTC day / week / month | USD float | none needed (rolling) |
| OpenRouter | `GET /api/v1/credits` | Bearer | account lifetime | USD float | none |
| Google Antigravity | `POST /v1internal:retrieveUserQuotaSummary` | Bearer OAuth | 5h + weekly, per model group | **fraction remaining** 0..1 | ISO 8601 `Z` |
| Claude Code | `GET /api/oauth/usage` | Bearer OAuth + `anthropic-beta` | 5h + 7d + monthly + model-scoped weekly | **percent used** 0..100 | ISO 8601 `+00:00` |
| Synthetic | `GET /v2/quotas` | Bearer | weekly tokens + rolling 5h + hourly search | mixed: counts, % remaining, `"$48.00"` strings | ISO 8601 `Z` |
| xAI Grok | `GET /v1/billing[?format=credits]` | Bearer OAuth | weekly **or** monthly (one shape, not both) | percent used **or** `{val}` amounts | ISO 8601 `+00:00` |
| OpenAI ChatGPT/Codex | `GET /wham/usage` **or** `/api/codex/usage`, plus `x-codex-*` headers on inference | Bearer OAuth **issued to the first-party Codex client** + `ChatGPT-Account-Id` | 1–2 windows, duration from `limit_window_seconds` / `window-minutes` | **percent used** 0..100 | unix seconds |
| DeepSeek | `GET /user/balance` | Bearer API key | none (balance + `is_available`) | decimal **string** | none |

Three facts dominate any implementation:

1. **Four different conventions for the headline number.** Antigravity reports *remaining fraction*, Claude and Codex report *percent used*, Synthetic reports *percent remaining* plus credit strings, xAI flips between percent-used and absolute amounts depending on account shape, DeepSeek has no percentage at all. Normalizing this is the single largest piece of work.
2. **Window vocabularies do not line up.** Nobody shares a window naming scheme. Antigravity uses `"5h"`/`"weekly"`; Claude uses `five_hour`/`seven_day` plus opaque per-model keys; Codex uses `primary`/`secondary` and only tells you the real duration via `limit_window_seconds`; xAI has a weekly *or* monthly period per account.
3. **One counter is inverted from the others.** Antigravity's `remainingFraction` is why a naive "used = value" assumption produces a completely wrong quota display with no error.

## 2. OpenRouter

### 2.1 Per-key state — `GET https://openrouter.ai/api/v1/key` [LIVE]

`Authorization: Bearer <key>`. No other headers required. Captured response:

```json
{"data":{"label":"sk-or-v1-329...691","is_management_key":false,"is_provisioning_key":false,
 "limit":null,"limit_reset":null,"limit_remaining":null,"include_byok_in_limit":false,
 "budgets":[],"effective_budget":null,
 "usage":29.644296858,"usage_daily":19.856475045,"usage_weekly":29.644296858,"usage_monthly":29.644296858,
 "byok_usage":0,"byok_usage_daily":0,"byok_usage_weekly":0,"byok_usage_monthly":0,
 "is_free_tier":false,"expires_at":null,"creator_user_id":"user_...","organization_id":null,
 "workspace_id":"08ef0494-c719-5b51-9551-52493e318389","allowed_data_regions":["global"],
 "free_model_daily_requests":{"used":0,"limit":1000,"remaining":1000},
 "rate_limit":{"requests":-1,"interval":"10s","note":"This field is deprecated and safe to ignore."}}}
```

- All monetary values are **dollars as floats**, not credits or cents.
- `limit: null` + `limit_remaining: null` means *no per-key spend cap*, not *exhausted*. Treating null as zero is the obvious trap here.
- `limit_reset` is the reset scheme for a key-level cap (`null` when uncapped).
- `usage_daily`/`usage_weekly`/`usage_monthly` are the only windowed numbers in the whole set; they are rolling UTC windows per [DOCS].
- `free_model_daily_requests` is a real quota object and the only place with an explicit `remaining` field.
- `rate_limit` is **deprecated and documented as ignorable** — an explicit signal that OpenRouter does not expose a live per-model request budget here.

### 2.2 Account credits — `GET https://openrouter.ai/api/v1/credits` [LIVE]

`Authorization: Bearer <key>`. Captured response:

```json
{"data":{"total_credits":3967.6,"total_usage":3847.523143035}}
```

- Remaining balance is **derived**: `total_credits - total_usage` (here ≈ 120.08 USD).
- No `remaining` field exists; no window and no reset.
- **Correction to the companion research file:** that file states `/credits` requires a Management API key `[DOCS]`. In this session the call returned **HTTP 200 with the account's ordinary OAuth-issued key**, and `is_management_key` was `false` on the same key via `/api/v1/key`. Do not gate the call on key type; attempt it and fall back on 401/403.

### 2.3 Other surfaces

- Per-generation cost: `GET /api/v1/generation?id=<id>` — USD floats [DOCS]. Retention period unverified.
- Rate limiting on inference: platform 429s carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` [DOCS]. Successful responses do not, so header ingestion only yields data on failure — the opposite of the Codex pattern in §7.
- OAuth PKCE exchange: `POST https://openrouter.ai/api/v1/auth/keys` (`code`, `code_verifier`, `code_challenge_method`). Returns the key, not a quota report [CODE: `.references/pi/packages/ai/src/auth/oauth/openrouter.ts:20`].

## 3. Google Antigravity (the `google` credential)

Two calls: discover the project, then read the quota. Both are free of charge and do not consume model quota.

### 3.1 Project discovery — `POST https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` [LIVE]

```json
{"metadata":{"ideType":"ANTIGRAVITY"}}
```

Returns `cloudaicompanionProject` (here the literal string `"aicode-consumers"` for a free tier), plus `currentTier`, `allowedTiers`, `paidTier`, `gcpManaged`, `upgradeSubscriptionUri`. The value may be a bare string or an object with an `id`; handle both [CODE: `@cortexkit/antigravity-auth-core/dist/project.js:43-53`].

The tier object is the only plan/subscription metadata this provider exposes: `currentTier.id` was `"free-tier"`, `currentTier.name` `"Antigravity"`, with `upgradeSubscriptionText` advertising "1,500 model requests per day" for AI Pro.

### 3.2 Quota — `POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` [LIVE]

```json
{"project":"aicode-consumers"}
```

Headers that matter: `Authorization: Bearer <oauth>`, `Content-Type: application/json`, and a pinned client User-Agent:

```
antigravity/hub/2.19.1 (aidev_client; os_type=darwin; arch=arm64; cl=963137146)
```

The version gates model availability server-side; `cl` is not validated [CODE: `.references/oh-my-pi/packages/catalog/src/wire/gemini-headers.ts:111-120`]. Pin `os_type=darwin`, `arch=arm64` as captured — do not send the host platform.

Captured response (trimmed to two of three groups):

```json
{"groups":[
 {"buckets":[
   {"bucketId":"gemini-weekly","displayName":"Weekly Limit Remaining","window":"weekly",
    "resetTime":"2026-10-28T12:19:09Z","remainingFraction":1},
   {"bucketId":"gemini-5h","displayName":"Five Hour Limit Remaining","window":"5h",
    "resetTime":"2026-10-21T17:19:09Z","remainingFraction":1}],
  "displayName":"Gemini Models","description":"Models within this group: Gemini Flash, Gemini Pro"},
 {"buckets":[
   {"bucketId":"3p-weekly","window":"weekly","resetTime":"2026-10-28T12:19:09Z","remainingFraction":1},
   {"bucketId":"3p-5h","window":"5h","resetTime":"2026-10-21T17:19:09Z","remainingFraction":1}],
  "displayName":"Claude and GPT models",
  "description":"Models within this group: Claude Opus, Claude Sonnet, GPT-OSS"},
 {"buckets":[
   {"bucketId":"gemini-argon-wtu-weekly","displayName":"Gemini 4 Argon Weekly Limit","window":"weekly",
    "resetTime":"2026-10-26T13:39:05Z","remainingFraction":0,
    "description":"You have hit your weekly limit, it refreshes in 5 days, 1 hour. ..."}],
  "displayName":"Gemini 4 Argon"}],
 "description":"Within each group, models share a weekly limit and a 5-hour limit. ..."}
```

- **`remainingFraction` is 0..1 remaining, not used.** `1` = untouched, `0` = exhausted. This is the one provider in this set that reports remaining as its primary number.
- Windows are `"5h"` and `"weekly"` only, and they are **per model group**, not per account. Group identity comes from the `bucketId` prefix: `gemini-*` → Gemini pool, `3p-*` → third-party (Claude/GPT-OSS) pool. Buckets with any other prefix must be ignored for pool derivation, but do surface as their own group (the `gemini-argon-wtu-weekly` case above shows a model-specific cap that is already exhausted while the general pools are full).
- `description` carries a human "you have hit your limit" string when a bucket is exhausted; there is no machine-readable severity field.
- Within a group the most-constrained window (lowest `remainingFraction`) is the binding one [CODE: `@cortexkit/antigravity-auth-core/dist/quota-manager.js:487-540`].

**2026-10-26 live update:** this account now receives only `gemini-weekly` and
`3p-weekly`; the model listing marks Argon unavailable for its tier. Do not infer an
Argon allowance or a five-hour window when absent. The parser assigns stable scopes
`gemini`, `3p` and `gemini-4-argon` from bucket IDs, independently of display names.
Captured current and historical responses are exercised by
`tests/providers/antigravity.test.ts`; diagnosis and sanitized endpoint captures are in
`.project/analyses/flexible-templates/2026-10-26-antigravity-argon-and-claude-absent.md`.

### 3.3 Fallbacks and failure modes [CODE]

- Legacy fallback: `v1internal:fetchAvailableModels`, same body/headers. Only used when `retrieveUserQuotaSummary` is unavailable.
- Endpoint failover list: `daily-cloudcode-pa.googleapis.com` → `daily-cloudcode-pa.sandbox.googleapis.com`, falling through on 429/5xx.
- On **403** with the managed project id, retry once with the regular project id; a transient failure must **not** trigger that retry, because the fallback project can return another project's quota.
- A missing project id means no request at all; there is no global quota read.

## 4. Claude Code (the `claude` credential)

### 4.1 Usage — `GET https://api.anthropic.com/api/oauth/usage` [LIVE]

Headers:

```
Authorization: Bearer <oauth>
anthropic-beta: oauth-2025-04-20
user-agent: claude-cli/2.1.306 (external, cli)
accept: application/json
accept-encoding: gzip, compress, deflate, br
```

Captured response (structure preserved, repeated null buckets collapsed):

```json
{"five_hour":{"utilization":20.0,"resets_at":"2026-10-21T15:59:59.703740+00:00",
              "limit_dollars":null,"used_dollars":null,"remaining_dollars":null,"locked_reason":null},
 "seven_day":{"utilization":24.0,"resets_at":"2026-10-24T17:59:59.703767+00:00",
              "limit_dollars":null,"used_dollars":null,"remaining_dollars":null,"locked_reason":null},
 "seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,
 "seven_day_omelette":null,
 "iguana_necktie":{"utilization":100.0,"resets_at":"2026-11-05T07:59:00+00:00",
                   "limit_dollars":250,"used_dollars":250.219152,"remaining_dollars":0.0,"locked_reason":null},
 "tangelo":null,"omelette_promotional":null,"nimbus_quill":null,"cinder_cove":null,"copper_kite":null,
 "brass_thimble":null,"harbor_lantern":null,"wattle_ember":null,"amber_ladder":null,"granite_teacup":null,
 "amber_cistern":null,"juniper_tide":null,"cedar_ember":null,"starry_waterfall":null,"amber_gauge":null,
 "extra_usage":{"is_enabled":false,"monthly_limit":10000,"used_credits":0.0,"utilization":0.0,
                "currency":"USD","decimal_places":2,"disabled_reason":"out_of_credits",
                "user_disabled":false,"spend_limit_reached":false,"credits_ever_enabled":true,
                "daily":null,"weekly":null},
 "limits":[
   {"kind":"session","group":"session","percent":20,"severity":"normal",
    "resets_at":"2026-10-21T15:59:59.703740+00:00","scope":null,"is_active":false},
   {"kind":"weekly_all","group":"weekly","percent":24,"severity":"normal",
    "resets_at":"2026-10-24T17:59:59.703767+00:00","scope":null,"is_active":true},
   {"kind":"weekly_scoped","group":"weekly","percent":0,"severity":"normal",
    "resets_at":"2026-10-24T18:00:00+00:00",
    "scope":{"model":{"id":null,"display_name":"Fable"},"surface":null},"is_active":false}],
 "spend":{"used":{"amount_minor":0,"currency":"USD","exponent":2},
          "limit":{"amount_minor":10000,"currency":"USD","exponent":2},
          "percent":0,"severity":"normal","enabled":false,"disabled_reason":"out_of_credits",
          "cap":{"money":null,"credits":{"amount_minor":10000,"exponent":2}},
          "balance":null,"auto_reload":null,"can_purchase_credits":false,"can_toggle":false},
 "member_dashboard_available":false,
 "seven_day_breakdown":{"as_of":"2026-10-21T12:19:12.755947+00:00",
   "window_started_at":"2026-10-17T17:59:59.703767+00:00",
   "rows":[{"key":"claude_code","display_name":"Claude Code","percent":100},
           {"key":"chat","display_name":"Chats","percent":0},
           {"key":"cowork","display_name":"Cowork","percent":0}]},
 "weekly_scoped_shares":[{"limit_index":2,"used_percent_of_weekly":0,"allowance_percent_of_weekly":50}]}
```

Reading it correctly:

- `utilization` and `percent` are **percent used, 0..100**, and can exceed 100 for overage. Not a fraction.
- `resets_at` is ISO 8601 with a `+00:00` offset. Parse leniently; the offset form differs from Antigravity's `Z`.
- `limits[]` is the **normalized, forward-looking view** and should be preferred over the legacy top-level buckets: `kind` is `session` | `weekly_all` | `weekly_scoped`, `group` is `session` | `weekly` | `monthly`, and `severity` is the machine-readable status field (`normal` here; the interesting values are the exhausted/warning states). `is_active` marks the row that the account's current spend maps onto — it is not "the exhausted one".
- `weekly_scoped` entries carry `scope.model.display_name` but `scope.model.id` was **null**, so a scoped limit cannot be joined to a model id. `weekly_scoped_shares` gives the allowance this scope consumes from the shared weekly pool (`allowance_percent_of_weekly: 50`).
- **The named top-level buckets are opaque and per-account.** `iguana_necktie` is a dollar-denominated cap that this account has fully consumed: `utilization: 100`, `limit_dollars: 250`, `used_dollars: 250.219152`, `remaining_dollars: 0`, resetting `2026-11-05` — a ~15-day horizon, so it is neither the 5-hour nor the 7-day window and its exact period is not labelled anywhere in the payload. There were 20 such keys, 19 null. Do not hardcode names — treat any non-null bucket as a real limit and derive its label from `limits[]` where possible.
- `seven_day_opus` / `seven_day_sonnet` are permanently null as of 2026-07-02; model-scoped weekly caps moved into `limits[]` as `weekly_scoped` [CODE: `.references/oh-my-pi/packages/ai/src/usage/claude.ts:123-125`].
- `extra_usage` is the paid-credits block: `monthly_limit` and `used_credits` are in **minor units (cents)** — 10000 = $100.00 — while `utilization` is a percent. The field is named `monthly_limit` regardless of actual period. `disabled_reason: "out_of_credits"` with `is_enabled: false` describes a credits product that is turned off, **not** an exhausted plan.
- `seven_day_breakdown.rows[].percent: 100` for `claude_code` is a share breakdown (Codex-style per-surface attribution), not a quota percentage. Reading it as quota is a real hazard.

### 4.2 Plan identity — `GET https://api.anthropic.com/api/oauth/profile` [LIVE]

Same headers. Captured:

```json
{"account":{"uuid":"...","email":"...","has_claude_max":true,"has_claude_pro":false},
 "organization":{"name":"...","organization_type":"claude_max","billing_type":"stripe_subscription",
   "rate_limit_tier":"default_claude_max_20x","has_extra_usage_enabled":true,
   "subscription_status":"active","subscription_created_at":"2025-03-05T14:12:05.165124Z"},
 "application":{"uuid":"9d1c250a-e61b-44d9-88ed-5944d1962f5e","name":"Claude Code","slug":"claude-code"}}
```

This is the only place the tier appears. `rate_limit_tier` (`default_claude_max_20x`) is the multiplier that explains the absolute size of the `five_hour`/`seven_day` allowances, which the usage endpoint never states.

### 4.3 Behaviour and pitfalls [CODE + BINARY]

> **Attribution note (2026-10-26).** The `.references/oh-my-pi/…` paths cited in
> this section do not exist in this repository and were never committed
> (`git ls-files | grep '^\.references'` → 0). Those bullets describe a
> *third-party* reference client, not Claude Code. They are now marked
> `[3P]`, and the client behaviours that Claude Code actually implements are
> marked `[BINARY]` and sourced from the shipped binary — see
> `claude-binary-re/report.md` and `claude-binary-re/findings/00-artifact-and-transport.md`.

- `[BINARY]` **`403` is a rate-limit signal, not an auth failure.** Claude Code folds `403` and `429` into one `rate_limited` state; only a recognisable auth rejection becomes `auth_rejected`. Do not invalidate a credential on 403.
- `[BINARY]` **There is no multi-host failover.** The usage reader accepts exactly `200` and `404` (`validateStatus: (K) => K === 200 || K === 404`) and treats `404` as "no usage route on this host". No `405` / `410` / `501` handling exists on that path.
- `[BINARY]` **Failures are memoised per bearer**, held for `min(Retry-After, cap)` on 429/403 and for a separate constant on auth rejection. There is no flat `FAILURE_BACKOFF_MS` in the binary (0 occurrences); that constant belongs to the third-party client.
- `[BINARY]` **The request is short and cheap**: 5 s timeout, `maxRedirects: 0`, no retries, and a ~5-minute read-through cache per credential. Polling more often than that is outside first-party behaviour.
- `[3P]` `/api/oauth/usage` stays rate-limited **for minutes after a 429**; failed refreshes back off (`FAILURE_BACKOFF_MS = 60_000`) rather than re-polling.
- `[3P]` 404 / 405 / 410 / 501 mean "this host has no usage endpoint" and justify switching host; other errors do not.
- A non-JSON 2xx or a payload with no usable bucket means the path was answered by something else (proxy, gateway) — treat as absent, not as zero quota.
- `[BINARY]` Proxies/gateways: the usage base is `BASE_API_URL` (`https://api.anthropic.com`) or the gateway record's own `url`, suffixed with `/api/oauth/usage`. `CLAUDE_AI_ORIGIN` (`https://claude.ai`) is **not** an API fallback — it is an origin allowlist check on OAuth redirect/error URIs, and the string `claude.ai/api/oauth` does not occur in the binary. A claude.ai origin can appear only because a gateway is served from one.
- `api.anthropic.com/api/claude_code/policy_limits` is organization policy gating (whether Claude Code may run at all), **not** quota. Its copy is `"disabled by your organization's policy"`, it is polled (`policy_limits_poll`), and it sits alongside `/api/claude_code/settings`.
- `[BINARY]` `limits[]` is the normalised view and the server owns severity and ordering (`"severity and order are the server's"`). Render it as given; do not re-derive it from the legacy top-level buckets.

## 5. Synthetic (the `synthetic` credential)

### 5.1 `GET https://api.synthetic.new/v2/quotas` [LIVE]

`Authorization: Bearer <key>`. Captured response:

```json
{"subscription":{"limit":1000,"requests":0,"renewsAt":"2026-10-21T17:17:59.621Z"},
 "search":{"hourly":{"limit":250,"requests":0,"renewsAt":"2026-10-21T13:17:59.622Z"}},
 "freeToolCalls":{"limit":0,"requests":0,"renewsAt":"2026-10-22T12:17:59.630Z"},
 "weeklyTokenLimit":{"nextRegenAt":"2026-10-21T13:41:14.000Z","percentRemaining":86.33328516666666,
                     "maxCredits":"$48.00","remainingCredits":"$41.43","nextRegenCredits":"$0.96"},
 "rollingFiveHourLimit":{"nextTickAt":"2026-10-21T12:23:37.000Z","tickPercent":0.05,
                         "remaining":1000,"max":1000,"limited":false}}
```

- Five independent meters in one response: `subscription` (window implied by `renewsAt`), `search.hourly`, `freeToolCalls`, `weeklyTokenLimit`, `rollingFiveHourLimit`.
- **Two meters, two unit systems.** `weeklyTokenLimit` mixes a **percent remaining** float with **currency strings** (`"$48.00"`). `rollingFiveHourLimit` uses **absolute counts** (`remaining`/`max`) plus a fractional `tickPercent`.
- `percentRemaining` is remaining, the inverse of Claude/Codex.
- `freeToolCalls.limit: 0` with `requests: 0` — a zero limit here means the meter is not provisioned, not that it is exhausted.
- Every meter carries its own next-reset timestamp; there is no unified reset field.
- `rollingFiveHourLimit.limited` is the only explicit boolean verdict in this whole set of providers.
- The CDN rewrites the path: the response carried `x-middleware-rewrite: /api/v2/quotas`, so `/v2/quotas` is a public alias for `/api/v2/quotas`. Both are usable; prefer the documented `/v2/` form.

### 5.2 Authentication note

The same request with the account's OAuth-style token produced `x-clerk-auth-status: signed-out` / `reason=token-invalid` instead of a quota payload. Synthetic's quota endpoint is a Clerk-fronted API expecting the API key in the normal `Authorization` header; an invalid credential yields a **200-with-headers** from Clerk rather than a 401. Check for the expected JSON keys, not only the status code.

## 6. xAI Grok (the `xai` credential)

Base: `https://cli-chat-proxy.grok.com/v1/billing` — the Grok CLI's billing proxy. Two shapes, selected by query parameter.

### 6.1 Default — monthly/unified shape [LIVE]

```json
{"config":{"monthlyLimit":{"val":0},"used":{"val":0},"onDemandCap":{"val":0},
  "billingPeriodStart":"2026-10-01T00:00:00+00:00","billingPeriodEnd":"2026-11-01T00:00:00+00:00",
  "history":[{"billingCycle":{"year":2026,"month":9},"includedUsed":{"val":0},
              "onDemandUsed":{"val":0},"totalUsed":{"val":0}}]}}
```

### 6.2 `?format=credits` — weekly/unified-billing shape [LIVE]

```json
{"config":{"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY",
   "start":"2026-10-20T12:23:09.952398+00:00","end":"2026-10-27T12:23:09.952398+00:00"},
  "onDemandCap":{"val":0},"onDemandUsed":{"val":0},
  "isUnifiedBillingUser":true,"prepaidBalance":{"val":0},
  "topUpMethod":"TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
  "billingPeriodStart":"2026-10-20T12:23:09.952398+00:00",
  "billingPeriodEnd":"2026-10-27T12:23:09.952398+00:00"}}
```

- **Amounts are wrapped objects**: `{"val": <number>}`, not bare numbers. Dollars, not cents.
- The account decides which shape is meaningful. `isUnifiedBillingUser: true` means the weekly period is authoritative and the monthly `monthlyLimit`/`used` are zero/absent by design. `monthlyLimit.val === 0` is the code's explicit "this account has no monthly quota" signal [CODE: `.references/oh-my-pi/packages/ai/src/usage/xai-oauth.ts:198-205`].
- Both responses use an ISO 8601 `+00:00` period start/end; the period **type string** (`USAGE_PERIOD_TYPE_WEEKLY`) is the only window declaration, so parse the substring, not an enum.
- Two more fields appear only on the weekly/credits shape when the account has usage: `creditUsagePercent` (0..100 used) and `productUsage[]` of `{product, usagePercent}` for per-product breakdowns.
- **Fresh or zero-usage weekly periods omit `creditUsagePercent` entirely.** The reference implementation infers `0` when the period is still active and rejects the report when the period has ended, to avoid overwriting good cached data with an absence.
- `prepaidBalance` is a separate meter from the included allowance; `onDemandCap`/`onDemandUsed` is a spend cap on top of the plan.
- `history[]` gives per-billing-cycle `includedUsed`/`onDemandUsed`/`totalUsed` — the only historical series in this whole set besides OpenRouter's rolling usage.
- No HTTP rate-limit headers were present on either response.

## 7. OpenAI ChatGPT / Codex subscription (the `openai` and `openai-codex` credentials)

### 7.1 `GET https://chatgpt.com/backend-api/wham/usage` [CODE, then LIVE in §7.9]

Headers: `Authorization: Bearer <oauth>`, `User-Agent: <codex_cli_rs style>`, and — critically — `ChatGPT-Account-Id`.

Response contract as parsed by the reference implementation [CODE: `.references/oh-my-pi/packages/ai/src/usage/openai-codex.ts:30-77`]:

| Field | Meaning | Units |
|---|---|---|
| `plan_type` | `free` / `plus` / `pro` / `pro_lite` / `team` / `enterprise` / `edu` … | string |
| `rate_limit.allowed` | account may serve | bool |
| `rate_limit.limit_reached` | plan window exhausted | bool |
| `rate_limit.primary_window` | first window | object |
| `rate_limit.secondary_window` | second window | object |
| `.used_percent` | within a window | percent 0..100 |
| `.limit_window_seconds` | real window length | seconds |
| `.reset_after_seconds` | relative reset | seconds |
| `.reset_at` | absolute reset | unix (s or ms) |
| `additional_rate_limits[]` | extra meters, each `{limit_name, metered_feature, rate_limit{...}}` | — |
| `credits.has_credits` / `.unlimited` / `.overage_limit_reached` / `.balance` | paid overage | bool / string-or-number |
| `spend_control.reached` | spend cap hit | bool |
| `rate_limit_reset_credits.available_count` | reset credits | integer |

- `primary`/`secondary` are named windows with **no inherent duration**. The real period is only in `limit_window_seconds`, so build window labels from it: `≥86400` seconds → `"Nd"`, otherwise `"Nh"` (minimum 1) [CODE: `:288-302`]. Assuming "primary = 5h, secondary = weekly" is correct only coincidentally.
- `reset_at` is unix time where values `> 1e12` are milliseconds and anything smaller is seconds.
- `credits` describes whether **paid credits** can fund overage past a spent plan window; it is not a quota. When credits are available the plan verdict flips back to allowed, which is why an account can look exhausted by `limit_reached` yet keep serving.
- `rate_limit_reset_credits` is the "banked resets" feature. Detail lives at a separate pair of endpoints: `GET wham/rate-limit-reset-credits` (list) and `POST wham/rate-limit-reset-credits/consume`, each entry `{grantedAt, expiresAt, status}` filtered on `status === "available"`. `available_count` from the usage payload can be stale; the list endpoint is authoritative. Preserve a reported `0` as zero available resets; an omitted count remains unknown (parser regression verified 2026-10-26).
- `GET accounts/verified_access` returns `programs[]` (`{program, state}`) and `grants[]` — entitlement badges (e.g. a `cyber` program), not quota.
- **401/403 is the only credential-rejection signal**; 429 and 5xx are transient and should keep serving the last good report.

### 7.2 Response headers — the cheaper path [CODE]

Every Codex response carries the plan snapshot as headers, which is why the reference implementation prefers them (`parseCodexRateLimitHeaders`, `openai-codex.ts:448-487`):

```
x-codex-primary-used-percent
x-codex-primary-window-minutes
x-codex-primary-reset-at
x-codex-secondary-used-percent
x-codex-secondary-window-minutes
x-codex-secondary-reset-at
```

`window-minutes × 60` → seconds; `reset-at` is unix time. A 2xx response implies `allowed: true, limitReached: false`. This avoids a separate quota request per turn — an explicitly stated design goal: ingest the headers so an exhausted account is blocked before the next request burns a 429.

### 7.3 Two path styles, and where quota actually lives [CODE + LIVE]

Verified against `openai/codex` at commit `c419fd01a70` (2026-10-21), `codex-rs/` sparse checkout. The quota surface is **attached to the ChatGPT-backend inference path, not to the regular OpenAI API**, and the client selects between two URL styles (`codex-rs/backend-client/src/client/rate_limit_resets.rs:124-150`):

| | `PathStyle::CodexApi` | `PathStyle::ChatGptApi` |
|---|---|---|
| usage | `{base}/api/codex/usage` | `{base}/wham/usage` |
| reset credits | `{base}/api/codex/rate-limit-reset-credits` | `{base}/wham/rate-limit-reset-credits` |
| consume a reset | `.../rate-limit-reset-credits/consume` | `.../rate-limit-reset-credits/consume` |
| account check | `{base}/api/codex/accounts/check` | `{base}/wham/accounts/check` |
| profile | `{base}/api/codex/profiles/me` | `{base}/wham/profiles/me` |

Selection is purely lexical: `PathStyle::from_base_url` picks `ChatGptApi` when the base URL contains `/backend-api`, otherwise `CodexApi` (`codex-rs/backend-client/src/client.rs:150-155`). The default `chatgpt_base_url` is `https://chatgpt.com/backend-api` (`codex-rs/login/src/auth/workload_identity.rs:380`), so a ChatGPT subscription normally lands on `wham/usage`. The dedicated Codex backend constant is `CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"` (`codex-rs/model-provider-info/src/lib.rs:80`).

Transport selection is separate from quota: `supports_codex_backend_routes()` is true for the `openai` provider when no `base_url` is set or it ends in `/backend-api/codex` (`model-provider-info/src/lib.rs:622-629`). A client pointed at `https://api.openai.com/v1` therefore still uses the ChatGPT backend for the routes above when it wants quota — which is exactly the split that breaks in practice, see §7.4.

### 7.4 Rate-limit headers, generalized [CODE]

The header contract is broader than the `x-codex-*` family I documented earlier. `codex-rs/codex-api/src/rate_limits.rs:59-107` builds the prefix as `x-{limit_id}` with `limit_id` defaulting to `codex`, so any metered limit advertises its own family:

```
x-<limit-id>-primary-used-percent      x-<limit-id>-secondary-used-percent
x-<limit-id>-primary-window-minutes    x-<limit-id>-secondary-window-minutes
x-<limit-id>-primary-reset-at          x-<limit-id>-secondary-reset-at
x-<limit-id>-limit-name
```

Additional headers (`rate_limits.rs:198-230`):

```
x-codex-credits-has-credits   x-codex-credits-unlimited   x-codex-credits-balance
x-codex-promo-message         x-codex-rate-limit-reached-type
```

- `window-minutes` is **minutes**, not seconds (the older oh-my-pi parser read `x-codex-primary-window-minutes` and multiplied by 60 — same field, same conclusion).
- A window is only emitted when it carries data: `used_percent != 0`, or a non-zero window, or a present `reset-at` (`rate_limits.rs:262-273`). A zeroed window is indistinguishable from absent.
- `limit_id` normalisation is lowercase with `-` → `_`, so `x-codex-other-...` becomes limit id `codex_other`.
- Every header in the family is discovered by scanning for the `-primary-used-percent` suffix, so unknown future meters surface automatically.

### 7.5 Rate-limit event in the SSE stream [CODE]

Quota also arrives **inside the response stream** as an event, which is how a streaming client gets a fresh snapshot without an extra request (`codex-rs/codex-api/src/rate_limits.rs:130-170`):

```json
{"type":"codex.rate_limits",
 "plan_type":"plus",
 "rate_limits":{"primary":{"used_percent":12.5,"window_minutes":300,"reset_at":1792586489},
                "secondary":null},
 "credits":{"has_credits":true,"unlimited":false,"balance":"12.40"},
 "metered_limit_name":"codex",
 "limit_name":null}
```

### 7.6 Live probe matrix — the credential gap [LIVE]

All with the real `openai` access token from `~/.pi/agent/auth.json`, 2026-10-21. This token was issued to a third-party OAuth client; §7.9 repeats the decisive cases with a first-party-client credential, where they succeed.

| Request | Result |
|---|---|
| `GET https://api.openai.com/v1/models` | **200** — token is valid on the regular API |
| `POST https://api.openai.com/v1/responses` (stream) | **200** — inference works, ~9 KB SSE |
| `POST .../v1/responses` response headers | only `x-codex-turn-state`; **no** `x-codex-primary-*`, no credits headers |
| SSE events | `response.created`, `response.in_progress`, … — **no** `codex.rate_limits` |
| `GET https://chatgpt.com/backend-api/wham/usage` | **401** `rejected_by_access_enforcement` / `no_matching_rule` |
| `GET https://chatgpt.com/backend-api/codex/wham/usage` | **401** same |
| `GET https://api.openai.com/api/codex/usage` | **404** (auth accepted, path absent) |
| `GET https://api.chatgpt.com/{wham,backend-api/wham}/usage` | **404** |
| `GET https://api.openai.com/v1/usage` | **401** `Incorrect API key provided: eyJhbGci…` — API-key auth only |

The 401 is an edge access-enforcement rejection rather than an invalid-token error: the same token authenticates fine on `/v1/models` and `/v1/responses` seconds earlier. It also fired with `ChatGPT-Account-Id` set to the JWT `sub` and to a random UUID, so it is not just a missing header. The stored token's `https://api.openai.com/auth` claim carries only `per_user_salt` and `encrypted_auth_metadata` — **no `chatgpt_account_id`** — and `~/.pi/agent/auth.json` persists neither an account id nor an id token. The reference implementation derives `accountId` from exactly those two places and treats a login without `accountId` **or** `email` as a failure [CODE: `.references/oh-my-pi/packages/ai/src/registry/oauth/openai-codex.ts:60-99`].

**Net result:** on the regular OpenAI API path, quota is not reported at all — no headers, no stream event, no endpoint. On the ChatGPT backend path, the quota surface exists but *this* credential is refused. See §7.9 for the resolution: the refusal is caused by the OAuth client identity, not by a missing header.

### 7.7 The client migration, and why the report looked stale

pi 1.3.0 (Pi-Bolt 0.9.6) moved its `openai` provider from the legacy `openai-codex`/`/backend-api/` transport to the regular OpenAI API. Confirmed by inspection: the shipped `pi` binary contains **zero** occurrences of the string `wham` and no `x-codex-` quota header names; its only ChatGPT-account artefact is the `chatgpt-account-id` header. The provider is now `openai` (`defaultProvider` in `~/.pi/agent/settings.json`) with a regular-API base URL.

That migration is precisely what removes the quota surface: the checks in §7.3-§7.5 all hang off the ChatGPT backend, which the new transport no longer calls. A client wanting Codex quota from pi's current credential has to reach the ChatGPT backend itself, and needs the account id that pi does not store.

### 7.8 Supplying the account id does not unlock the endpoint [LIVE]

The obvious remaining hypothesis was the missing `ChatGPT-Account-Id`. With the account id `1384833a-bb62-412c-9838-0ebd4d673ddc` supplied explicitly, the request still fails:

| Request | Result |
|---|---|
| `GET chatgpt.com/backend-api/wham/usage` + `ChatGPT-Account-Id` + `originator: codex_cli_rs` + codex UA | **401** `no_matching_rule` |
| same + `session_id`, `oai-device-id`, `conversation_id`, `oai-language`, `OpenAI-Beta` | **401** |
| same, with a `__cf_bm` / `__oailb` cookie jar seeded from `api.openai.com` | **401** |
| `GET chatgpt.com/backend-api/codex/models` | **401** |
| `GET chatgpt.com/backend-api/codex/responses` | **401** |
| `GET chatgpt.com/backend-api/me` | **401** |
| `GET api.openai.com/v1/models` (same token, same minute) | **200** |

So the rejection is not route-specific, not account-id-specific, and not cookie-specific. Every `chatgpt.com/backend-api/*` route fails identically while the same token succeeds on `api.openai.com` — the gate is on the calling client, not on the request.

The likely discriminator is the OAuth client identity. Codex CLI authenticates as `app_EMoamEEZ73f0CkXaXp7hrann` (`login/src/auth/manager.rs:1784`), an `app_`-prefixed first-party OpenAI client. pi's credential was issued to `oaiapp_rezTsTEy8MH87z2EjeJxEx6nH`, a third-party registered app. Under that reading, `rejected_by_access_enforcement` / `no_matching_rule` means what it says: the edge has no access rule matching this calling application for that surface. **This was subsequently confirmed — see §7.9.**

Practical consequence: there is no client-side fix for a third-party credential. Supplying the account id, the Codex User-Agent, `originator`, session/device ids, or Cloudflare cookies all change nothing. Reading Codex quota requires a token issued to a client the `chatgpt.com` backend admits.

### 7.9 Resolution — the legacy `openai-codex` credential works [LIVE]

Probing with a credential obtained through the **legacy `openai-codex` login** (stored in the project `.auth.json`) succeeded on every ChatGPT-backend route. Its JWT carries the decisive differences:

| Claim | pi's new `openai` token | legacy `openai-codex` token |
|---|---|---|
| `client_id` | `oaiapp_rezTsTEy8MH87z2EjeJxEx6nH` (third-party app) | `app_EMoamEEZ73f0CkXaXp7hrann` (**first-party Codex CLI**) |
| `https://api.openai.com/auth` claims | `per_user_salt`, `encrypted_auth_metadata` | `chatgpt_account_id`, `chatgpt_account_user_id`, `chatgpt_plan_type`, `chatgpt_compute_residency`, `chatgpt_user_id`, `poid`, `user_id`, `amr` |
| `chatgpt_account_id` readable client-side | no | **yes** |
| lifetime | ~10 min | ~5 days |

So §7.8's inference was correct: the gate is the OAuth *client application*, and the account id was never the blocker.

**`GET https://chatgpt.com/backend-api/wham/usage`** — headers `Authorization: Bearer`, `ChatGPT-Account-Id`. Captured in full:

```json
{"user_id":"user-0InQm55Bkaiqn2DXMgV7T4o4",
 "account_id":"1384833a-bb62-412c-9838-0ebd4d673ddc","email":"furbyhaxx@gmail.com",
 "plan_type":"pro",
 "rate_limit":{"allowed":true,"limit_reached":false,
   "primary_window":{"used_percent":27,"limit_window_seconds":604800,
                      "reset_after_seconds":497680,"reset_at":1793084764},
   "secondary_window":null},
 "code_review_rate_limit":null,"additional_rate_limits":null,
 "model_usage":{"gpt-6-astra":{"available":true,"available_at":null,"credits_would_enable":false}},
 "credits":{"has_credits":false,"unlimited":false,"overage_limit_reached":false,"balance":"0",
            "approx_local_messages":[0,0],"approx_cloud_messages":[0,0]},
 "spend_control":{"reached":false,"individual_limit":null},
 "rate_limit_reached_type":null,"promo":null,
 "rate_limit_reset_credits":{"available_count":1,"applicable_available_count":0}}
```

Fields the client-side reference parser does not model, now confirmed present on the wire: `user_id`, `account_id`, `email`, `code_review_rate_limit`, `model_usage`, `credits.approx_local_messages` / `approx_cloud_messages`, `rate_limit_reset_credits.applicable_available_count`, `promo`, `rate_limit_reached_type`.

Real-world shape note: this account has a **single** window — `primary_window` at 604800 s (7 days), `secondary_window: null`. The familiar "primary = 5h, secondary = weekly" assumption is wrong for it.

**`GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`** — `200`:

```json
{"credits":[{"id":"RateLimitResetCredit_964ef9f41ca081918e9be9293ca7e29b",
  "reset_type":"codex_rate_limits","is_supported_by_plan":true,"status":"available",
  "granted_at":"2026-10-07T23:17:42.446820Z","expires_at":"2026-11-06T23:17:42.446820Z",
  "redeem_started_at":null,"redeemed_at":null,
  "profile_user_id":"Codex Team","title":"Full reset",
  "description":"Thanks for using Codex! You've been granted one free rate limit reset."}],
 "available_count":1,"total_earned_count":0,
 "immediate_reset_purchase_eligible":false,"history_enabled":true}
```

Entries carry `expires_at` (30 days after `granted_at`) and `status` (`available` / `redeem_started` / `redeemed`), plus `profile_image_url` and a human `title`/`description`. `available_count` here agreed with the usage payload.

**`GET https://chatgpt.com/backend-api/accounts/verified_access`** — `200`: `{"programs":[{"program":"cyber","state":"inactive","grants":[],"individual_blue_security_setup_required":true,"individual_blue_security_signin_required":false}]}`.

**Quota headers on inference** — `POST https://chatgpt.com/backend-api/codex/responses` (stream) returned `200` and carried the contract from §7.4 verbatim:

```
x-codex-primary-used-percent: 28          x-codex-primary-window-minutes: 10080
x-codex-primary-reset-at: 1793084764      x-codex-primary-reset-after-seconds: 497658
x-codex-secondary-used-percent: 0         x-codex-secondary-window-minutes: 0
x-codex-secondary-reset-at:               (empty)
x-codex-credits-has-credits: False        x-codex-credits-balance: 0
x-codex-credits-unlimited: False          x-codex-plan-type: pro
x-codex-active-limit: premium             x-codex-primary-over-secondary-limit-percent: 0
x-codex-safety-buffering-enabled: true    x-codex-safety-buffering-faster-model: gpt-6-luna
```

Four header facts that matter for an implementation:

- `x-codex-primary-window-minutes: 10080` confirms the weekly window and that the unit is **minutes**.
- `x-codex-secondary-*` are present but zero-valued (and `secondary-reset-at` is an **empty string**, not an absent header). A parser must treat empty/zero as "no data" exactly as `parse_rate_limit_window` does.
- `x-codex-active-limit: premium` and `x-codex-primary-over-secondary-limit-percent` are not in the reference parser's model.
- **The `codex.rate_limits` SSE event did not appear** in this response; event types were `response.created`, `response.in_progress`, `response.metadata`, `response.output_item.*`, `response.content_part.*`, `output_text`, `response.completed`. The event is conditional, so headers are the reliable channel and the event is an extra.

Also note: `/wham/usage` itself returned **no** `x-codex-*` headers. The header family belongs to inference responses, not to the quota endpoint.

### 7.10 The two credentials are complementary, not interchangeable [LIVE]

The sharpest result of this investigation: the credential that can read quota and the credential that can call the regular API are **different credentials**, and neither can do both.

| | pi `openai` | legacy `openai-codex` |
|---|---|---|
| OAuth client | `oaiapp_rezTsTEy8MH87z2EjeJxEx6nH` (third-party) | `app_EMoamEEZ73f0CkXaXp7hrann` (first-party) |
| `scope` claim | `chatgpt.tokens.use.direct email offline_access openid profile resource.invoke` | none |
| `POST api.openai.com/v1/responses` | **200**, inference works | **401** — `insufficient permissions … Missing scopes: api.responses.write` |
| `POST chatgpt.com/backend-api/codex/responses` | **401** `no_matching_rule` | **200**, inference works |
| `x-codex-*` quota headers | none on its usable path | **present** |
| `GET /backend-api/wham/usage` | **401** | **200** |
| token lifetime | ~10 min | ~5 days |

So a client cannot pick one credential and get both transports. Using the regular API costs quota visibility; using the ChatGPT backend costs regular-API access. Neither credential crosses over. §7.12 shows this is a transport constraint rather than a login-count constraint.

### 7.11 Confirming that the regular API reports no quota at all

The negative result was established with the **only** credential that can use that path (pi's `openai` token), so it is not an artefact of a refused token. Verified with an **unfiltered** header dump and a scan of the whole stream:

`POST api.openai.com/v1/responses` with `stream: true` returned `200` and 9136 bytes of SSE, genuine inference. The complete response header set was:

```
date  cf-ray  cf-cache-status  server  x-openai-proxy-wasm  strict-transport-security
access-control-expose-headers  x-content-type-options
x-codex-turn-state        <- opaque session-state blob, not quota
x-models-etag  x-oai-request-id  set-cookie (__oailb, __cflb, __cf_bm)  alt-svc
```

Absent: `x-codex-primary-*`, `x-codex-secondary-*`, `x-codex-credits-*`, `x-codex-plan-type`, `x-codex-active-limit`, and any standard OpenAI `x-ratelimit-*` header.

The stream contained no `rate_limit`, `quota`, `credit` or `limit` field. The only matches for `usage` were `usage` and `tool_usage` — per-request token accounting, i.e. cost telemetry, not remaining quota. Event types were `response.created`, `response.in_progress`, `response.metadata`, `response.output_item.*`, `response.content_part.*`, `response.output_text.*`, `response.completed` — no `codex.rate_limits`.

Contrast with the same style of call on the ChatGPT backend, which returns the full header family (see §7.9). **Conclusion: Codex subscription quota is a property of the ChatGPT-backend transport. The regular OpenAI API exposes none of it — not as an endpoint, not as headers, not as a stream event.**

### 7.12 Single-login options [LIVE + judged]

The question this investigation ends on: can one login yield both inference and quota, or must the user log in twice?

**Answer: one login is enough — provided the ChatGPT backend is used for inference too.** That backend is not a side channel; it is a complete inference surface:

| Capability | `chatgpt.com/backend-api/codex/...` | `api.openai.com/v1` |
|---|---|---|
| Model catalog | `GET codex/models` → **10 models** (608 KB payload) | `GET v1/models` |
| Streaming inference | `POST codex/responses` → **200** | `POST v1/responses` → 200 |
| Quota headers | **yes** | **no** |
| Quota endpoint | `wham/usage` | none |
| Works with | first-party-client credential | third-party-client credential |

Catalog returned by the backend: `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-reserve`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-daybreak-blue-latest`, `codex-auto-review`.

Version gating is a footgun: `GET codex/models?client_version=0.60.0` returns **200 with an empty list** (13 bytes), while `client_version=1.0.0` returns the full catalog. A too-low version silently yields no models rather than an error — the same class of trap as Antigravity's User-Agent version.

So the three viable shapes:

1. **One login, ChatGPT backend only.** A Codex-style (first-party client) login gives a credential that does inference *and* reports quota. Everything the user asked for, at the cost of the `api.openai.com` transport. This is what codex-rs itself does.
2. **Two logins, both transports.** Keep a first-party credential for quota plus a third-party credential for the regular API. Only worth it if the regular-API transport is required for reasons other than quota.
3. **One login for both, if the first-party client can be authorized with `resource.invoke`.** `UNVERIFIED`. The two observed tokens differ in *both* client id and scope set (first-party: no `scope` claim; third-party: `chatgpt.tokens.use.direct … resource.invoke`), so the gate could be either. Whether `app_EMoamEEZ73f0CkXaXp7hrann` accepts `resource.invoke` at authorize time can only be settled by running a browser OAuth flow — it is not testable with stored tokens, because a refresh grant cannot change scope.

Consequence for a provider layer: model the credential as carrying **capability flags** (`chatgpt_backend`, `openai_api`, `quota`), not as a single undifferentiated token. Two dialects over one credential store, selected by capability, is the honest representation of what the wire actually supports. Do not assume a credential can be upgraded in place.

## 8. DeepSeek (the `deepseek` credential)

### 8.1 `GET https://api.deepseek.com/user/balance` [LIVE]

`Authorization: Bearer <api key>`. Captured response:

```json
{"is_available":true,"balance_infos":[{"currency":"USD","total_balance":"13.20",
  "granted_balance":"5.54","topped_up_balance":"7.66"}]}
```

- `balance_infos` is an **array** keyed by currency; more than one entry is documented as possible. `total_balance = granted_balance + topped_up_balance`.
- All amounts are **decimal strings**, not numbers — parse to a decimal type, never a float, or the cent will drift.
- `is_available` is a boolean verdict derived from the balance; it is the closest thing DeepSeek has to "can I still make requests".
- **No windows, no percentages, no resets, no rate-limit headers.** The response carries only `x-ds-trace-id` and CloudFront headers. This is a pure prepaid balance, structurally unlike the other six.
- `GET /models` reports context/output limits, and completion responses carry `prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens` [DOCS].
- Rate limiting is documented as account-level concurrency (2,500 for `deepseek-flash`, 500 for `deepseek-v4-pro`) with 429 under load; **no endpoint or header exposes remaining concurrency** [DOCS, and no such surface found live].

## 9. Cross-provider normalization

Field-level mapping for a single internal quota model:

| Concept | OpenRouter | Antigravity | Claude | Synthetic | xAI | Codex | DeepSeek |
|---|---|---|---|---|---|---|---|
| primary number | `usage_*` USD | `remainingFraction` | `utilization` % | `percentRemaining` / counts | `creditUsagePercent` % or `used.val` | `used_percent` % | `total_balance` |
| direction | used | **remaining** | used | **remaining** | used | used | absolute |
| scale | absolute | 0..1 | 0..100 | 0..100 / counts | 0..100 | 0..100 | decimal string |
| 5-hour window | — | `"5h"` | `five_hour` | `rollingFiveHourLimit` | — | via `limit_window_seconds` | — |
| weekly window | `usage_weekly` | `"weekly"` | `seven_day` | `weeklyTokenLimit` | `currentPeriod` | via `limit_window_seconds` | — |
| monthly window | `usage_monthly` | — | `limits[group=monthly]`, `extra_usage` | `subscription` | `monthlyLimit` | — | — |
| per-model scope | — | bucket prefix (`gemini-*`, `3p-*`) | `weekly_scoped` + `scope.model` | — | `productUsage[]` | `additional_rate_limits[]` | — |
| reset | none | ISO `Z` | ISO `+00:00` | ISO `Z` (per meter) | ISO `+00:00` | unix s/ms | none |
| exhausted signal | `limit_remaining <= 0` | `remainingFraction == 0` | `severity != normal` | `limited` | `onDemandUsed >= onDemandCap` | `limit_reached` | `is_available == false` |

Notes for implementers:

- Normalize to **used fraction 0..1** internally; invert Antigravity and Synthetic on ingest. Keep the raw payload for display.
- Reset timestamps appear as ISO `Z`, ISO `+00:00`, unix seconds and unix milliseconds across this set. One parser that sniffs all four is required.
- "Zero" and "absent" mean different things per provider: OpenRouter `limit: null` = uncapped, Synthetic `limit: 0` = not provisioned, xAI `monthlyLimit.val: 0` = no monthly quota, Antigravity `remainingFraction: 0` = exhausted. There is no shared convention, so each provider needs an explicit rule.
- Only two providers expose header-based quota (OpenAI Codex `x-codex-*`, OpenRouter `X-RateLimit-*` on 429). Both should be ingested opportunistically and must never be the sole source.
- Probing cost: all seven endpoints are free of charge and do not consume model quota. Only Claude's endpoint has a documented post-429 cooldown; the others tolerate short polling, but a 60–300 s cache is appropriate everywhere.

## 10. Open questions

| Item | Status |
|---|---|
| Whether `wham/usage` succeeds with a correct `ChatGPT-Account-Id` | **Answered: yes** — with a first-party-client credential. The header alone is not enough; a third-party-client token is refused regardless (§7.9) |
| Whether the regular `api.openai.com/v1/responses` path can ever report quota | **Answered: no.** A `200` streaming response carried only `x-codex-turn-state`, no `x-codex-*` quota headers and no `codex.rate_limits` event. Quota is a property of the ChatGPT-backend transport, not the OpenAI API |
| Where a client must capture `chatgpt_account_id` | The legacy `openai-codex` login embeds it in the access-token JWT auth claim and stores it as `accountId`. pi 1.3.0's `openai` token has no readable `chatgpt_account_id` |
| Claude named bucket semantics (`iguana_necktie` et al.) | `LIVE` shows it is the `$250` monthly cap; the full name→concept map is per-account and undocumented |
| OpenRouter `/api/v1/generation` retention period | `UNVERIFIED` |
| OpenRouter `/credits` management-key requirement | **Contradicted** by live 200 with a non-management key |
| DeepSeek remaining-concurrency or QPS surface | Not found; docs describe limits without exposing counters |
| Antigravity `gemini-argon-wtu-weekly` family beyond one bucket | Only one such bucket observed; the naming pattern suggests more (`-wtu-`) |
| OpenAI `credits.balance` | Typed as string-or-number in the client; observed as the string `"0"` |
| Whether OpenAI will admit third-party OAuth clients to `chatgpt.com/backend-api` | `UNVERIFIED` — currently refused with `rejected_by_access_enforcement` / `no_matching_rule` for client `oaiapp_rezTsTEy8MH87z2EjeJxEx6nH` |

## 11. Sources

- Live captures: this session, 2026-10-21, credentials from `~/.pi/agent/auth.json`. Response bodies reproduced verbatim above, trimmed only where marked.
- `openai/codex` at commit `c419fd01a70dd1d05356da443ac44328bda2e6f4` (2026-10-21), path `codex-rs` — authoritative current contract for Codex quota: `backend-client/src/client.rs:150-155` (path-style selection), `backend-client/src/client/rate_limit_resets.rs:124-150` (usage/reset-credit routes), `codex-api/src/rate_limits.rs` (generalized header family, credits headers, `codex.rate_limits` event), `model-provider-info/src/lib.rs:80,622-629` (transport constants and `supports_codex_backend_routes`), `login/src/auth/workload_identity.rs:380` (default ChatGPT base URL).
- `.references/oh-my-pi/packages/ai/src/usage/{claude,google-antigravity,openai-codex,openai-codex-reset,synthetic,xai-oauth}.ts` — per-provider fetchers, parsing rules, backoff and endpoint-failover behaviour.
- `.references/oh-my-pi/packages/catalog/src/wire/gemini-headers.ts` — Antigravity client User-Agent format and version gating.
- `@cortexkit/antigravity-auth-core` (`dist/quota-manager.js`, `dist/antigravity/oauth.js`, `dist/project.js`) and `@cortexkit/pi-antigravity-auth` — Antigravity quota aggregation, project discovery, failover.
- `/home/furbyhaxx/.local/share/claude/versions/2.1.306` — Claude binary; confirmed `/api/oauth/usage` schema and the `extra_usage`/`limits` contract, `anthropic-ratelimit-unified-*` headers, and that `/api/claude_code/policy_limits` is policy rather than quota.
- `.project/research/provider-quota-openrouter-deepseek.md` — vendor-documentation research for OpenRouter and DeepSeek.
