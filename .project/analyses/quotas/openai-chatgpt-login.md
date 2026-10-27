---
document:
  type: "analysis"
  id: "analysis-openai-chatgpt-login-quota"
  title: "Quota sources for Pi's Sign in with ChatGPT (openai) login"
  description: "Which usage and reset-credit sources accept Pi 1.4's ChatGPT-direct token, what its inference responses carry, and where quota can come from instead"
  status: "published"
  revision: 1
  created_at: "2026-10-27T16:54:04+01:00"
  updated_at: "2026-10-27T16:54:04+01:00"
  created_by: "analyst"
  updated_by: "analyst"
  changelog:
    - revision: 1
      reason: "investigate why openai quota always returns HTTP 401"
      changes:
        - "live probes with Pi's openai token: wham routes, api route sweep, one successful inference turn"
        - "account-id and Codex-identity variants ruled out"
        - "openai/codex CLI source comparison for usage surfaces"
        - "recommendation: attach quota to the openai-codex login"
---

# Quota sources for Pi's Sign in with ChatGPT (`openai`) login

status: "root-caused"
confidence: "high"

## Summary

Pi 1.4's `openai` login is a separate OAuth grant from the Codex CLI's: dynamic client
`dynamic_agent_client`, scopes `chatgpt.tokens.use.direct` and `resource.invoke`, no
`chatgpt_account_id` claim, and an access-enforcement rule that matches only
`api.openai.com/v1/models` and `/v1/responses`. Every `chatgpt.com/backend-api` route Pi
tries — `wham/usage`, `wham/rate-limit-reset-credits`, `wham/accounts/check`, `wham/profiles/me`,
`backend-api/me`, `backend-api/codex/usage` — answers 401 `rejected_by_access_enforcement`
(`no_matching_rule`, or `scopes_not_allowed` on the one route that matches), independent of
User-Agent, `originator` or a `ChatGPT-Account-Id` header.

Inference on the same login carries no quota either: the 200 response has no `x-codex-*`
rate-limit headers, the SSE stream has no rate-limit event, and `response.completed` holds only
`usage`. So a quota source for `openai` as it is logged in today does not exist.

The only working source remains the legacy Codex client (`app_EMoamEEZ73f0CkXaXp7hrann`, token
with `chatgpt_account_id`), which Pi already ships as the builtin `openai-codex` provider.
Recommended: attach the quota family to `openai-codex`, and make the `openai` fetch detect the
direct token and say so instead of issuing a guaranteed 401. Cost to the user: one additional
`/login openai-codex` (browser or device code, same ChatGPT account); both credentials coexist in
`auth.json` under their own provider ids.

## Reproduction

Environment: Pi-Bolt 1.0.5 / Pi 1.4.0, Linux x86_64, real agent dir (`/home/furbyhaxx/.pi/agent`),
`openai` logged in via `Sign in with ChatGPT`, `openai-codex` not configured
(`pi-bolt auth check --provider openai-codex --no-refresh --json` →
`{"status":"not_ready","reason":"credentials_not_configured"}`).

Probe extensions (scratch, tokens never printed): `probe.ts`, `probe2.ts`, `probe3.ts` in this
directory; raw logs `probe-run1.log` … `probe-run6.log`.

```bash
cd /mnt/Projects/furbyhaxx/pi-auth-plus
PROBE_OUT=$PWD/.project/analyses/quotas/openai-chatgpt-login/probe-run3.log \
  pi-bolt --no-session -ne -nc -nt -p "say ok" --model openai/gpt-5.6-luna \
  -e "$PWD/.project/analyses/quotas/openai-chatgpt-login/probe.ts"        # 200, headers, SSE types
PROBE_INJECT=1 PROBE_OUT=.../probe-run4.log pi-bolt ... probe.ts          # + originator/session-id/OpenAI-Beta
PROBE_OUT=.../probe-run5.log pi-bolt ... probe2.ts                        # /v1 route sweep, full /v1/models
PROBE_OUT=.../probe-run6.log pi-bolt --mode rpc -ne -nc --no-session --model openai/gpt-5.6-luna \
  -e "$PWD/.project/analyses/quotas/openai-chatgpt-login/probe3.ts" < /dev/null   # account-id variant, no turn
pi-bolt --no-session -ne -nc --list-quotas --json \
  -e /home/furbyhaxx/.pi/agent/git/git.viitrium.io/furbyhaxx/pi-quotas/src/index.ts  # legacy token, live
```

Observed (`probe-run3.log`, `probe-run6.log`):

- `GET https://chatgpt.com/backend-api/wham/usage` → **401**, body
  `{"error":{"message":"Unauthorized","type":"rejected_by_access_enforcement","code":"no_matching_rule"}}`,
  response headers `x-openai-ide-error-code: no_matching_rule`, `x-openai-internal-caller:
  unknown_through_ide`. Same for `wham/rate-limit-reset-credits`, `wham/accounts/check`,
  `backend-api/me`, `backend-api/codex/usage`, `api.openai.com/v1/me`.
- `GET .../wham/profiles/me` → **401**, `x-openai-ide-error-code: scopes_not_allowed`.
- Adding `ChatGPT-Account-Id` (the account id from the user's pi-quotas Codex credential, same
  ChatGPT account, never logged) changes nothing: still `no_matching_rule`.
- `GET https://api.openai.com/v1/models` → **200**, 697 KB, 11 codex model slugs
  (`gpt-6.1-sol`, `gpt-6-astra`, `gpt-5.6-luna`, …). `GET /v1/responses` → **405** (route exists,
  POST only). `/v1/usage`, `/v1/organization/usage/completions`, `/v1/dashboard/billing/credit_grants`
  → 401 "Incorrect API key provided" (API-key auth path, not this token). `/v1/codex/usage`,
  `/v1/usage/limits`, `/v1/subscription`, `/v1/account/usage`, `/v1/organization/rate_limits`,
  `/v1/rate_limits` → **404** (routes do not exist).
- Successful turn `openai/gpt-5.6-luna` → **200**; response header names:
  `access-control-expose-headers, alt-svc, cf-cache-status, cf-ray, connection, date, server, set-cookie,
  strict-transport-security, transfer-encoding, x-codex-turn-state, x-content-type-options,
  x-models-etag, x-oai-request-id, x-openai-proxy-wasm`. No `x-codex-primary-*` /
  `x-codex-secondary-*` / `x-codex-plan-type`. Identical with `originator: codex_cli_rs`,
  `session_id`, `x-client-request-id` and `OpenAI-Beta: responses=experimental` injected.
  Distinct `provider_stream_event` types: `response.created`, `response.in_progress`,
  `response.output_item.added`, `response.reasoning_summary_part.added`,
  `response.reasoning_summary_text.delta|done`, `response.reasoning_summary_part.done`,
  `response.output_item.done`, `response.content_part.added`, `response.output_text.delta|done`,
  `response.content_part.done`, `response.metadata` (moderation only), `response.completed`.
- `response.completed.response` keys include `usage`, `service_tier`, `access_programs`; no
  `rate_limits`, `plan_type`, `subscription` or limit fields.
- Legacy path (pi-quotas, same host, live): `codex` provider `state: ok`, `tier: pro`,
  `primary` 7d window 64 % used, `resetCredits: 1`, `source: endpoint`, fetched now.

## Root cause

Causal chain:

1. Pi's `openai` provider authenticates through pi-ai's new *Sign in with ChatGPT* flow
   (`node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js:13,18,24,186,259`):
   dynamic client id, resource `https://api.openai.com/v1`, scopes
   `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. The agent host
   id (`urn:uuid:<device>`) exists only as `ext_agent_host_id` in the authorize URL; no agent-host
   or account header is sent on API calls (`providers/openai.js:11` base URL, `api/openai-responses.js:213`
   client headers = identity + model headers + session headers + caller headers).
2. That grant's token is a *direct API* credential. Its JWT carries `scope` and only
   `per_user_salt` / `encrypted_auth_metadata` under `https://api.openai.com/auth`
   (`probe-run1.log` auth line).
3. `wham/*` lives on `chatgpt.com/backend-api` behind an access-enforcement layer that decides per
   (caller, token client, scopes) whether a route may be called. The dynamic client has no rule for
   those routes, hence `no_matching_rule`; the one route that does match reports
   `scopes_not_allowed`. A missing `chatgpt_account_id` is not the trigger — supplying a valid
   account id header produced the same 401.
4. The direct flow's inference route (`api.openai.com/v1/responses`, answered by the same
   Codex-flavoured proxy: `x-openai-proxy-wasm`, `x-codex-turn-state`) does not attach the
   codex rate-limit header family, and the stream carries no limit event. Pi itself treats the
   web page as the usage surface for this login: `api/openai-responses.js` points
   `subscription_sharing_usage_*` errors at `https://chatgpt.com/settings/usage`
   (`CHATGPT_USAGE_URL`, line 18), which needs a web session cookie Pi does not hold.
5. Therefore `src/families/openai/quota.ts:13` and `resets.ts:14` can never succeed for an
   `openai` login, and the 401 branch (`quota.ts:211-212`) turns it into a `needs-auth` row whose
   advice ("run /login openai") loops the user.

Contributing, not causal: the account-claim difference reported earlier is a property of the
new grant, and `openaiQuotaHeaders` (`quota.ts:175`) already omits the account header when absent.

The working alternative is the legacy Codex client: same ChatGPT account, client
`app_EMoamEEZ73f0CkXaXp7hrann`, scope `openid profile email offline_access`, token with
`chatgpt_account_id` (`auth/oauth/openai-codex.js:18,30,241`). pi-quotas holds such a token and
reads `wham/usage` live (values above). Pi ships exactly this flow as builtin provider
`openai-codex` (`providers/openai-codex.js`), currently labeled "OpenAI Codex (legacy)".

## Evidence

| # | Experiment | Result |
|---|---|---|
| E1 | `getProviderAuth("openai")` via a scratch extension | OAuth, JWT, claims `aud client_id exp iat iss jti nbf scope sub`; `https://api.openai.com/auth` = `encrypted_auth_metadata, per_user_salt`; scope list `chatgpt.tokens.use.direct email offline_access openid profile resource.invoke`; no account id |
| E2 | GET probes with Codex-CLI headers, minimal headers and Pi UA (`probe-run1..4.log`) | all wham/backend-api routes 401; `profiles/me` `scopes_not_allowed`; `/wham/usage` identical with account-id header (`probe-run6.log`) |
| E3 | `/v1` route sweep (`probe-run5.log`) | `/v1/models` 200; `/v1/responses` 405; usage/billing routes 401 API-key error or 404 |
| E4 | one successful turn, plain and with Codex identity headers | 200; no rate-limit headers; only `x-codex-turn-state` and `x-models-etag`; SSE has no limit event |
| E5 | legacy credential through pi-quotas `--list-quotas --json` at 16:52 | `wham/usage` 200: 7d 64 %, plan `pro`, 1 reset credit — the endpoint and parser still work for that client |
| E6 | `pi-bolt auth check --provider openai-codex` | not configured; `openai` is the only OpenAI credential on this host |
| E7 | `pi-coding-agent/dist/core/auth-storage.js:214-226` | `auth.json` is a map keyed by provider id, so `openai` and `openai-codex` credentials coexist; `/logout` is per provider |
| E8 | `openai/codex` repo (main @ 970111f6, sparse `codex-rs`) | no `oaiapp` / `ext_agent_host_id` / `resource.invoke` / dynamic client anywhere; `login/src/auth/manager.rs:1784` still `app_EMoamEEZ73f0CkXaXp7hrann`; usage from `wham/usage` / `wham/rate-limit-reset-credits` (`backend-client/src/client/rate_limit_resets.rs:124-151`), rate limits parsed from SSE *response headers* (`x-codex-primary-*`, `codex-api/src/sse/responses.rs:44`, `rate_limits.rs:28`) and a websocket-only `codex.rate_limits` event (`endpoint/responses_websocket.rs:858-859`) |

Ruled out: missing `ChatGPT-Account-Id` (E2 account variant), User-Agent or `originator`
spoofing (E2), a hidden usage route on `api.openai.com` (E3), quota inside the response stream
(E4), and the idea that the legacy client itself stopped working (E5). Also ruled out: reading
headers from `openai` inference responses — they are simply not sent.

## Recommended fix

Ranked by what each costs the user.

1. **Attach the quota source to Pi's builtin `openai-codex` provider (recommended).**
   `src/families/openai/index.ts` gets a second provider entry
   (`id: "openai-codex"`, label, aliases) with the same `openaiQuota` (endpoint + headers + resets).
   `quotaAuthFor("openai-codex", …)` then resolves the legacy token, whose `chatgpt_account_id` the
   existing `accountId()` (`quota.ts:29`) already reads, and `wham/usage` /
   `wham/rate-limit-reset-credits` work as verified in E5. No new credential file, no custom login,
   no reset-credit change. User cost: one `/login openai-codex` ("OpenAI (ChatGPT Plus/Pro)",
   browser or device code) on the same account; the two credentials coexist (E7) and `/logout
   openai` still leaves `openai-codex` intact.
2. **Make the `openai` row honest and refuse the guaranteed request.** In
   `src/families/openai/quota.ts:190-213`, when the token has no `chatgpt_account_id` (or has the
   `chatgpt.tokens.use.direct` scope), return `needsAuth` with a message naming the alternative
   ("ChatGPT usage is not exposed for Sign in with ChatGPT; run /login openai-codex") and skip the
   GET. Same guard in `resets.ts:credential`. This ends the misleading "run /login openai" advice
   and the 401 noise in the line and panel. Cost: none to the user.
3. **Register a project-owned `codex` provider with pi-ai's `openai-codex` OAuth**, so one login
   serves both inference and quota under the planned id (D32). Correct end state, but it duplicates
   the builtin provider today, adds a third OpenAI entry to `/login` and model lists, and needs the
   planned provider slice first. Cost: one login plus a redundant provider entry; defer.
4. **Status quo**: `openai` shows unknown quota forever. Cost: no quota for the login the user
   actually uses.

Do not add a private credential file, a cached Codex token or a second OAuth flow; 1 and 2 reuse
Pi's `/login` and `auth.json` exactly.

Regression tests to add (project style, plain functions over fixtures):
`tests/quotas/...`: a claims fixture with `per_user_salt`/`encrypted_auth_metadata` and no
`chatgpt_account_id` yields `needsAuth` with the new message and performs no fetch; a claims fixture
with `chatgpt_account_id` still builds `ChatGPT-Account-Id` and parses a captured `wham/usage`
payload; the family registry exposes both `openai` and `openai-codex` quota entries.

Same pattern elsewhere: `src/quotas/engine.ts:176-215` tries every provider's header parser when
the hint matches nothing, so with an `openai-codex` session, `x-codex-*` headers would today be
cached under the `openai` row. Registering `openai-codex` (fix 1) makes the hint match; keep the
openai header parser for responses served by the legacy/Codex route, where the headers do arrive.

## Open questions / follow-ups

- Could OpenAI grant the dynamic client additional scopes that cover `wham/*`? Untested; would be a
  Pi/pi-ai change (the authorize URL and scope list), not a pi-auth-plus one.
- Does a 429 on the direct flow carry `x-codex-*` headers? Not observable without exhausting the
  account's limit; worth re-checking if a user hits `subscription_sharing_usage_limit_exceeded`.
- `openai-codex` is labeled legacy. If OpenAI retires `app_EMoamEEZ73f0CkXaXp7hrann`, this
  recommendation and pi-quotas' quota both stop working together; there is then no API usage
  surface for a ChatGPT subscription that Pi can reach.
- Interactive `/login openai-codex` completion was not exercised here (needs a browser); E5 proves
  the credential type, E7 proves coexistence, but the login round trip itself is `UNVERIFIED`.
- Related observation, not part of this unit: the `openai` login cannot call many models Pi lists
  (`gpt-5-nano`, `gpt-5.3-codex-spark` → 400 `model_not_found`, "not supported when using Codex with
  a ChatGPT account"), while `GET /v1/models` on the same token returns 11 codex slugs. The `openai`
  catalog and this login's usable set disagree.
