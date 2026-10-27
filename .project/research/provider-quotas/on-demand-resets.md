---
document:
  type: "research"
  id: "research-provider-on-demand-resets"
  title: "Provider on-demand quota reset and credit-consumption endpoints"
  description: "Source-backed audit of whether seven AI providers expose reset-credit listing or consumption APIs, with Codex request details and limits of evidence"
  status: "published"
  revision: 2
  created_at: "2026-10-26T09:18:34+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "researcher"
  updated_by: "pi"
  source: "pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/research/provider-on-demand-resets.md"
  changelog:
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/research/provider-on-demand-resets.md"]
---

| Provider | On-demand reset exists | Reset endpoint known | Can consume programmatically | Source confidence |
|---|---|---|---|---|
| OpenAI Codex / ChatGPT | Yes | Yes | Yes, via private backend route | High for client contract; medium for server semantics |
| Anthropic Claude | Yes — occasional, account-specific “Limit resets”; separate from usage credits | Private client read/claim routes found; no public API contract | Bundled CLI implements private claim flow; not a supported public API | High for feature; medium for static client contract |
| xAI Grok | Unknown; none found | No | No known route | Low |
| Google Antigravity | Unknown; none found | No | No known route | Low |
| OpenRouter | No; money credits/budgets, scheduled windows | No | No | High |
| DeepSeek | No; money balance/top-ups | No | No | High |
| Synthetic | Unknown; none found | No | No known route | Low |

“Reset endpoint” means a route that claims/consumes a credit to reset a subscription quota, not the provider’s read-only quota or billing endpoint. “No” means no such operation is documented or present in the inspected interface; it is not proof that no private website endpoint exists. Evidence for undocumented read endpoints is from dated live captures in the cited local report.

## OpenAI Codex / ChatGPT

**Confirmed, implemented in open-source Codex CLI backend client.** At commit `970111f6cb62cc02fe36a82ea7d71b37a2889c97` (2026-10-23), `codex-rs/backend-client/src/client/rate_limit_resets.rs` builds the route and sends `POST`; `types.rs` defines the request outcomes; `client.rs` constructs common headers; the adjacent test checks both path styles and body serialization. [1–4]

- ChatGPT backend route: `POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume`. Codex API-style alternative: `POST https://chatgpt.com/backend-api/codex/api/codex/rate-limit-reset-credits/consume` only when its base URL is `https://chatgpt.com/backend-api/codex`; the normal ChatGPT base uses the WHAM route. [1]
- Request headers constructed by the CLI: `Authorization: Bearer <first-party Codex OAuth access token>`, `ChatGPT-Account-Id: <account id>` when configured, `User-Agent: <Codex CLI UA>` (Codex-generated; fallback in client is `codex-cli`), and `Content-Type: application/json`. The read endpoint was live-tested with the first-party Codex OAuth credential plus account ID. A third-party `openai` OAuth client credential was rejected by ChatGPT backend access enforcement. [3, 5]
- **No `originator`, `OpenAI-Beta`, or beta header is added by the consume method** in the pinned Codex client. The source does not establish whether the server accepts/requires other middleware-generated headers; these are not specified as endpoint requirements by a public API contract. [1, 3]
- Body: `{"redeem_request_id":"<caller-supplied string>"}`; optional explicit selection adds `"credit_id":"<listed credit id>"`. Codex source does not state how to mint the request ID. [1, 4]
- Typed response: `{"code":"reset|nothing_to_reset|no_credit|already_redeemed","windows_reset":<integer>}` (`windows_reset` defaults to 0 in the client model). `reset` is successful; the other codes are no-op/denial outcomes. Non-2xx responses are raised as errors with status/body by the client; actual failure HTTP statuses and payloads were not found. [2, 3]
- Listing route: `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`. Live response includes `credits[]`, `available_count`, `total_earned_count`, `immediate_reset_purchase_eligible`, and `history_enabled`. Credit entries include `id`, `reset_type`, `status`, `granted_at`, `expires_at`, redeem timestamps, and presentation title/description. The live example's `reset_type` was `codex_rate_limits`; there is no typed per-window applicability field. A fixture title says “Full reset (Weekly + 5 hr),” but does not prove every credit has identical applicability. [4, 5]
- Consumption is a state-changing one-credit operation. A `reset` result plus `redeemed` status indicates a successful credit is spent; no reversal route was found. Treat it as irreversible. **Idempotency is unverified**: `redeem_request_id` may be a deduplication token, but Codex source/tests make no idempotency promise or duplicate-request test. Do not blindly retry after timeout; check the list/status first. No endpoint-specific rate limit, 429 policy, or ban behavior was found; rapid-retry safety is unverified. [1–5]

## Anthropic Claude / Claude Code

**Correction:** Anthropic's first-party “Limit resets” feature exists and is separate from paid usage credits. The earlier report conflated the absence of a public usage-credit API with absence of reset grants. Usage credits are pay-as-you-go overage; a limit reset is a free entitlement that restores an included plan limit. Resetting does not change the usage-credit balance or refund already-billed extra usage. [6, 7, 13]

### Public feature and eligibility

Anthropic says limit resets are occasionally given to eligible plans. In Settings > Usage, the **Resets** section offers “Reset for free”; depending on the specific offer, it restores either the five-hour session limit or a weekly usage limit. The user need not wait until that limit is exhausted. Normal weekly reset timing is unchanged, and the account's usage is shared across Claude surfaces. Once used, a reset cannot be undone. An offer may have an expiry shown in the UI; unused resets expire at the displayed time, and downgrading or cancelling makes an unused reset unavailable. [13]

The Pro and Max plan FAQs both point subscribers to the limit-reset feature, but Anthropic does not publish a fixed qualifying rule, issuance frequency, grant count, or expiry duration. Their wording does not guarantee every Pro or Max subscriber receives a reset. The Team/Enterprise Claude Code guide discusses usage credits but does not affirm reset eligibility; that is a documentation gap, not proof of exclusion. The public article directs users to Claude web or Desktop and says the “Reset for free” button is not currently available in Claude Mobile or Claude Code terminal/IDE. [13–16]

### Bundled-client evidence and endpoints

Static inspection of the installed Claude Code 2.1.306 Linux client (build `2026-10-21T00:58:51Z`, embedded Git SHA `01ae8327ca9931db91a0802d6e8e377419dd44e6`) finds a `cedar_ember` grant flow and a `/limit-reset` client action. This is a client contract, not a public API specification. The current public Claude Code changelog is at v2.1.310 and has no Limit resets release entry; that absence does not establish that the feature or private route is absent. The inspected binary is 2.1.306, not the latest release. [17, 18]

- **Read/list:** the client sends `GET {configured API base}/api/oauth/usage?cedar_ember=1&skip_spend=1` and parses the top-level `cedar_ember` status. The prior live snapshot used `https://api.anthropic.com/api/oauth/usage` [5], but the feature query was not called, so no account list or count was observed. The response schema accepts `eligible`, `ineligible_reason`, `grants[]`, `next_grant_id`, `weekly_resets_at`, and `cooldown_until`. Each grant can carry `resets_total`, `resets_left`, `starts_at`, `ends_at`, and `id`. The prior usage snapshot is not evidence that reset grants are absent.
- **Consume:** the client sends `POST {configured API base}/api/organizations/{organization_uuid}/reset_rate_limits` with `{"program":"cedar_ember","grant_id":"…","request_id":"…"}`. The route is relative to the configured API base; its host was not independently verified for POST. Parsed result values include `reset`, `already_used`, `not_limited`, `cooldown`, `ineligible`, and `unavailable`. The shipped code uses its OAuth credential handling; no public OAuth scope or service guarantee is documented.
- **Scope and period:** the client schema represents grant `type` as `session`, `weekly`, or `full`; `clears[]` can name `five_hour`, `seven_day`, or specific weekly windows (Opus, Sonnet, Cowork, Omelette, OAuth apps, or overage-included). These are possible contract fields, not a live grant observed here. `use_requires_limit`, `usable_now`, `paused`, and optional `starts_at`/`ends_at` constrain a grant. A `gives_back_weekly` case has Fable-specific UI text that it “frees up only what Fable used this week”; scope is offer-specific. The server remains authoritative about which limit a particular offer clears and when it can be used.
- **Eligibility/count gaps:** client status can report `config_off`, `tier`, `seat`, `mobile`, `surface`, `cli_version`, `no_grant`, `tenure`, or `other_experiment` as ineligibility reasons. Its telemetry schema recognizes Pro, Max 5x, Max 20x, and Team tiers, plus tenure and billing categories; this is not an eligibility formula. The grant list provides per-account totals and remaining counts, but neither the public docs nor this static schema specify a universal quantity.

There is no public, documented list or consume API found in the sources checked. The private CLI route is positively identified in bundled code, but neither endpoint was called live and no reset was consumed. Officially documented use remains the web/Desktop UI; do not treat the private route as a supported integration. The binary also contains a distinct `juniper_tide` reset experiment using the same POST route with a different `program`; it is separate from the `cedar_ember` grant inventory and does not establish the number or eligibility rules for the documented Resets section. [13, 17, 18]

## xAI Grok

**Unknown; no reset-credit operation found.** The inspected Grok CLI billing proxy is `GET https://cli-chat-proxy.grok.com/v1/billing` (and `?format=credits`), with OAuth bearer auth. Its observed responses describe monthly or weekly usage periods, `onDemandCap`/`onDemandUsed`, and sometimes a separate `prepaidBalance`; those are usage windows and money, not reset credits. The proxy is undocumented and the evidence is a live capture/reference-client report, so absence of a claim route is low-confidence. No consume URL/body/auth scope or retry policy is verified. [5]

## Google Antigravity

**Unknown; no reset-credit operation found.** The internal quota read observed by the client is `POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`, body `{"project":"<project id>"}`, with bearer OAuth and a versioned Antigravity `User-Agent`. It returns per-model-group `5h`/`weekly` buckets, `remainingFraction`, and `resetTime`; it exposes no reset-credit count or consume operation in the observed contract. The `v1internal` endpoint is undocumented; public Gemini Apps help describes waiting for 5-hour/weekly refreshes, but is not an Antigravity API specification. Do not infer a reset endpoint from this read path. [5, 8]

## OpenRouter

No on-demand reset-credit feature found in the documented API. `GET /api/v1/key` reports USD key usage, scheduled budget intervals (`daily`, `weekly`, `monthly`) and free-model daily requests. `GET /api/v1/credits` reports total purchased and used USD credits; neither exposes a reset/claim operation. Budget windows roll on schedule; they are not user-consumable reset tokens. [9, 10]

## DeepSeek

No on-demand reset found. Official `GET https://api.deepseek.com/user/balance` returns account financial balance by currency (`total_balance`, `granted_balance`, `topped_up_balance`); exhausted balance is addressed by top-up, not resetting a subscription window. The official rate-limit page describes concurrency ceilings and 429 behavior, not reset credits or a reset endpoint. [11, 12]

## Synthetic

**Unknown; no reset-credit operation found.** The live read path `GET https://api.synthetic.new/v2/quotas` returns subscription, hourly search, weekly-token and rolling-five-hour meters with their own next-renewal timestamps. It also includes dollar-formatted `maxCredits`/`remainingCredits` values. It is a read-only quota/credit snapshot, not evidence of a reset-credit bank. No public consume endpoint, body, auth scope, retry policy, or abuse limit was found; this API surface is undocumented, so classify existence as unknown. [5]

## Sources

[1] OpenAI Codex CLI, `rate_limit_resets.rs` — https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/backend-client/src/client/rate_limit_resets.rs (accessed 2026-10-26; pinned commit).

[2] OpenAI Codex CLI, `types.rs` — https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/backend-client/src/types.rs (accessed 2026-10-26; pinned commit).

[3] OpenAI Codex CLI, `client.rs` — https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/backend-client/src/client.rs (accessed 2026-10-26; pinned commit).

[4] OpenAI Codex CLI, `rate_limit_resets_tests.rs` — https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/backend-client/src/client/rate_limit_resets_tests.rs (accessed 2026-10-26; pinned commit).

[5] Local live provider evidence, checked 2026-10-21 — `.project/research/provider-quota-credits-reporting.md`, §§3–7 (including Codex list response); companion `.project/research/provider-quota-openrouter-deepseek.md`. These are project captures, not public API documentation.

[6] Anthropic, “Manage costs effectively” — https://code.claude.com/docs/en/costs.md (accessed 2026-10-26; current Claude Code docs).

[7] Anthropic Support, “Manage usage credits for paid Claude plans” — https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans (accessed 2026-10-26; updated over two weeks before access).

[8] Google Support, “Gemini Apps limits & feature availability” — https://support.google.com/gemini/answer/16275805 (accessed 2026-10-26; adjacent consumer quota guidance, not Antigravity API docs).

[9] OpenRouter, “Get current API key” — https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key.md (accessed 2026-10-26; current API schema).

[10] OpenRouter, “Get remaining credits” — https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits.md (accessed 2026-10-26; current API schema).

[11] DeepSeek, “Get User Balance” — https://api-docs.deepseek.com/api/get-user-balance (accessed 2026-10-26; official API schema).

[12] DeepSeek, “Rate Limit & Isolation” and “Error Codes” — https://api-docs.deepseek.com/quick_start/rate_limit and https://api-docs.deepseek.com/quick_start/error_codes (accessed 2026-10-26; current docs).

[13] Anthropic Support, “What is a limit reset?” — https://support.claude.com/en/articles/17007452-what-is-a-limit-reset.md (accessed 2026-10-26; article dated 2026-09-22).

[14] Anthropic Support, “What is the Pro plan?” — https://support.claude.com/en/articles/8325606-what-is-the-pro-plan.md (accessed 2026-10-26; current plan FAQ).

[15] Anthropic Support, “What is the Max plan?” — https://support.claude.com/en/articles/11049741-what-is-the-max-plan.md (accessed 2026-10-26; current plan FAQ).

[16] Anthropic Support, “Use Claude Code with your Team or Enterprise plan” — https://support.claude.com/en/articles/11845131-use-claude-code-with-your-team-or-enterprise-plan.md (accessed 2026-10-26; current plan guide).

[17] Anthropic Claude Code, `CHANGELOG.md` — https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (accessed 2026-10-26; main resolved by the forge fetch to commit `2eff7a8d21c8`, latest listed release v2.1.310).

[18] Installed Claude Code client, `/home/furbyhaxx/.local/share/claude/versions/2.1.306` (accessed 2026-10-26; static inspection only; SHA-256 `520bc6c1f40af466bd03a278b5ae1af1a2938bc7de5b9e5cb15526da20d71cfe`; no public source URL).
