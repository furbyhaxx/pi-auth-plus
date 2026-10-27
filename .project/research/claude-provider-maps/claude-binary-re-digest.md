---
document:
  type: "analysis"
  id: "plan-0005-5a-claude-binary-re"
  title: "Claude Code 2.1.310 binary reverse-engineering digest for the claude provider"
  description: "Model listing/metadata endpoints, OAuth and header deltas versus SPEC 17.4, quota headers and evidence quality from the pi-quotas static RE of the Claude Code binary."
  status: "published"
  revision: 3
  created_at: "2026-10-26T15:05:00+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "pi"
  updated_by: "pi"
  source: "nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/plans/0005-provider-expansion/contract/reference-claude-binary-re.md"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["document creation"]
      updated_at: "2026-10-26T15:05:00+01:00"
    - revision: 2
      reason: "frontmatter migration"
      changes: ["migrate flat frontmatter to the document block"]
    - revision: 3
      reason: "imported into pi-auth-plus"
      changes: ["copied from nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/plans/0005-provider-expansion/contract/reference-claude-binary-re.md"]
---

# Claude Code binary RE digest (2.1.310)

Source: `relap001:/mnt/Projects/furbyhaxx/pi-quotas/.project/research/claude-binary-re/` (`F00`-`F05` = `findings/0N-*.md`, `R` = `report.md`). Static analysis only; every claim needs live confirmation before C-unit acceptance. Consequence for 5A: C1-C7 must reconcile each contradiction below with a live capture; the SPEC 17.4 values stay authoritative until then.

## Answer

RE corpus (Claude Code **2.1.310**, static only) does not use `/v1/models` for first-party model listing. Claude Code's own catalogue path is `GET /api/model_selector/{surface}`; `/v1/models` appears only as (a) a bundled SDK resource definition and (b) a gateway/base-URL discovery call with `?limit=1000`. Baked model metadata (22 models, 1M-context flags, thinking/effort capabilities, pricing tiers) is embedded in the binary and overlaid — not replaced — by the served selector. It contradicts SPEC §17.4 in a few concrete places: the Claude.ai authorize host, the scope set (`user:plugins`), PKCE/state size, callback mechanics, and refresh wire shape. It cannot corroborate the billing header at all.

Citations: `F00`–`F05` = `/mnt/Projects/furbyhaxx/pi-quotas/.project/research/claude-binary-re/findings/`; `R` = `.../claude-binary-re/report.md`.

## 1. Model listing and metadata

| Surface | Contract | Cite |
|---|---|---|
| Served selector (real first-party listing) | `GET /api/model_selector/{surface}`, surfaces `cc,ccr,ccd`. Lane-dependent path: account → `/api/organizations/:orgUUID/model_selector/{s}` (`teleport-org`), token → `/api/model_selector/{s}` (`claude-ai-oauth`), api_key → same path (`required`), profile/federation → `async`. Non-account lanes add `anthropic-client-platform`. 5 s timeout, 2 MiB cap, optional `If-None-Match`/304, **no query params** | F03:292-301 |
| SDK `/v1/models` | Plain and `?beta=true` wrappers; `anthropic-beta` from caller betas, `anthropic-workspace-id` from `workspace_id`; `list` forwards all remaining query fields unconstrained (no `after_id`/`limit` names appear). Host = inference base or gateway; auth class `O/K/GJ` | F03:268-272, F04:351-352 |
| Gateway bootstrap | `GET {gateway.url}/v1/models?limit=1000`, 5 s, `Authorization: Bearer <jwt>`, `anthropic-version: 2023-06-01`, `User-Agent: claude-code/<v>` (account UA `Ds`, not the claude-cli UA). Validator `{data:[{id:string, display_name?:string|null, description?:string|null}]}`; filter `/(claude\|anthropic)/i`, then keep unknown-or-Fable only | F03:276-281 |
| Base-URL discovery | Env-gated (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`), firstParty + non-Anthropic `ANTHROPIC_BASE_URL`; `/v1/models?limit=1000`, `redirect:"error"`, 3 s default; caches `{baseUrl,fetchedAt,models[]}` to `gateway-models.json`; augments options | F03:283-290 |

Response shape (selector rows): surface `id`, `models[]`, `description`, `auto_compact_window`, `provider_alias_targets`, `dropped_model_ids`, `dropped_confidential_ids`. Model rows: `id`, `name`, `short_name`, `description`, `section`, `disabled`, `confidential`, `notice`, `badge`, `tooltip`, `capabilities` (`compass`,`gsuite_tools`,`mm_images`,`mm_pdf`,`web_search`), `thinking{type:"effort",effort_options[]}`, `fast_mode`, `hard_limit`, `context_window`, `runtime{max_input_tokens,max_output_tokens,default_output_tokens,effort_levels,default_effort,capabilities,family,knowledge_cutoff,image_limits{max_width,max_height}}`, `behaves_as`, `provider_ids`, `offered_on`, `min_claude_code_version`. State rows: surface id, `model`, `selection_source`, `org_enforced_default_model`, `thinking`. `resolution ∈ token_org,membership,api_key_org,console_org,federation_org,service_key_org,public`. F03:301-311.

No endpoint returns pricing. Pricing is baked `pricing_tiers` (11 tiers, input/output/write-5m/write-1h/read/search, USD inferred not asserted) plus policy/custom-cost caches and unknown-model fallback. F03:214-231, F03:237.

Baked catalogue: 22 entries, 5 families, `context{native_1m,supports_1m_beta,supports_1m_suffix,max window}`, `max_output_tokens{default,upper}`, capability strings (`effort`,`max_effort`,`xhigh_effort`,`adaptive_thinking`,`rejects_disabled_thinking`,`fast_mode`,…), `default_effort`, `effort_cost_index`, `image_limits`, `advisor_rank`, aliases (`opus→claude-opus-5-5`, `sonnet→claude-sonnet-5-5`, `haiku→claude-haiku-5-5`, `fable→claude-fable-5-1`, `best:"fable"`). Examples: `claude-sonnet-5-5` 1e6 native / 128000 output, `claude-opus-4-5` 200000 / 64000. F03:38-62, F03:166-186.

Filtering: `disabled`/`confidential` rows, 64-id confidential masking → `"confidential"`, `availableModels`/`deniedModels`, provider alias targets, `offered_on`, `min_claude_code_version`. Served layer supersedes selection/runtime/capability overlays but the baked catalogue stays behind it. Cache: ETag/304 reuse, background fetch; legacy `model-capabilities.json` schema has `timestamp` with `TH=3600000`, `RH=300000`, but its gate returns false in this build. F03:311, F03:381-397, F03:240, F03:292.

`/v1/models` **with** the OAuth token: only the shipped SDK definition implies OAuth-capable (`SDK O/K/GJ`); no CLI call against `api.anthropic.com` and no live test. UNVERIFIED. API-key listing in Claude Code also goes through `model_selector`, not `/v1/models`. F04:351, F03:292.

## 2. Contradictions / deltas vs SPEC §17.4 and reference map

| Claim | SPEC value | RE finding | Cite | Conf. |
|---|---|---|---|---|
| Claude.ai authorize URL | `https://claude.ai/oauth/authorize` | Production authorize is `platform.claude.com/oauth/authorize` **or `claude.com/cai/oauth/authorize`**; `https://claude.ai` appears only as redirect-origin allowlist | F04:21; F05:76-82 | Medium |
| Scopes | 6 scopes | + `user:plugins` when registered (**true in production**); design/project scopes separate | F01:22,25 | High |
| PKCE/state | verifier 64 random bytes; state=UUID | 32 random bytes each, base64url (43-char verifier); S256 | F01:31-32 | High |
| Callback | `https://platform.claude.com/oauth/code/callback` | Primary is loopback `http://localhost:<os-port>/callback`, bound `127.0.0.1`; platform URL is the manual fallback | F01:35 | High |
| Token exchange body | not specified | `grant_type,code,redirect_uri,client_id,code_verifier,state`, optional `expires_in`, **no scope**; refresh sends space-joined `scope` | F01:63,66 | High |
| Refresh policy | 3 attempts, 500 ms/1 s backoff on 5xx/network | Interactive refresh eligible 5 min before expiry; **no universal network-refresh backoff established**; `invalid_scope` → one retry with stored scopes; rotation returns `refresh_token` + `refresh_token_expires_in` | R:113-131; F01:70,262-278 | High |
| Betas on inference | always `oauth-2025-04-20` + `interleaved-thinking-2025-05-14` | Both literals exist; `oauth-2025-04-20` observed as Bearer beta on **auxiliary** calls (`validate`, `create_api_key`) and in the federation token call. Inference betas are registry-driven; no finding says `/v1/messages` requires the OAuth beta | F01:238, F01:89, F04:468-470 | Medium |
| Identity headers | `user-agent: claude-cli/<v> (external, cli)`, `x-app: cli` | UA grammar `claude-cli/2.1.310 (external, <entrypoint>[,…])`; `x-app` is `cli` **or `cli-bg`** when backgrounded; builder also sets a third computed header `[P2t]` (unresolved) | F04:476-477 | High / UNK |
| Billing header | `x-anthropic-billing-header: cc_version=…; cc_entrypoint=sdk-cli; cch=…` | **Zero** occurrences of `cch`, `cc_version`, `sdk-cli`, `billing-header` anywhere in the RE tree; the 33-name header inventory omits it (possibly the unresolved `[P2t]`) | grep of F00-F05, R; F04:472 | Low |
| Version | 2.1.306 | Binary is 2.1.310 (build `2026-10-23T17:43:32Z`); 2.1.306→2.1.310 diff leaves endpoints, betas, ratelimit headers identical | R:135-148; F03:12 | High |
| `anthropic-version` | P-1 pins `2026-10-21` | Only `2023-06-01` observed (gateway bootstrap, MCP connectors); inference version value not recovered | F03:281, F04:428 | UNK |
| Base URL | `ANTHROPIC_BASE_URL` replaces protocol+host | Confirmed for inference SDK; `CLAUDE_CODE_API_BASE_URL` is a real Files fallback; account base is separate `BASE_API_URL`; `ANTHROPIC_API_URL` does not exist | F04:19-21 | High |
| Catalog source | models.dev `anthropic` + `provider.ts:33-85` additions | Subscription lane's real set is baked catalogue + served selector with **1M native** context on 5.5 and 128k output, display names, `offered_on`, `provider_ids`; models.dev values for these ids are not the client's values | F03:38-62, F03:292-311 | High |
| Listing mechanism | U6: `/v1/models` + `after_id`/`has_more` | Claude Code never lists first-party models via `/v1/models`; pagination param names are nowhere in the findings (only `{data,has_more,first_id,last_id}` from the gateway handler) | F03:268-272, F03:384-391, F04:351 | High |

Also confirmed on the wire-adjacent side: `/api/oauth/validate` (POST, null body, Bearer + UA, 10 s), `/api/oauth/claude_cli/create_api_key` (POST null, Bearer, consumes `raw_key`), `/v1/oauth/token/revoke`. F01:325-328, F01:358-362, F04:92-93.

## 3. Quota headers (brief)

31 literal `anthropic-ratelimit-unified-*` suffixes plus `retry-after`. Selection: `status` (`allowed|allowed_warning|rejected`), `reset` (epoch seconds), `representative-claim`, `fallback:"available"`, `overage-*`, `grace-5h/7d-utilization`, `slow-*`, and per-window `5h|7d|7d_oi|overage-{utilization,reset,surpassed-threshold,status}`. Utilization/thresholds are fractions (`0..1`, may exceed 1); body `utilization`/`percent` are `0..100`. F02:121-190. The reader is generic over a headers object; no finding proves which responses carry them (inference header capture absent). F02:19-22.

## 4. Evidence quality

All findings are static: carved `.bun` JS from the installed 2.1.310 ELF (`291,638,640` bytes, BuildID `b47f28de…`), 75,594/134,876 string runs. No request was made; no credential read. Grades `[OBS]` literal / `[INF]` control flow / `[UNK]`. Model metadata explicitly had "no live selector/model/count/price requests". Corroboration is a prior **LIVE 2.1.306** capture in `pi-quotas/.project/research/provider-quota-credits-reporting.md` §4, which covers the usage payload only. F00:11-22, F00:44-60, R:32-48, F03:8, F03:471.

## Not found / not covered

- No `x-anthropic-billing-header`/`cch` anywhere; SPEC billing formulas are unconfirmed by this source (`[P2t]` unresolved) — either a RE coverage gap or the header precedes 2.1.310.
- Inference-request beta assembly and `anthropic-version` value not reconstructed; `x-app: cli-bg` and `[P2t]` unresolved.
- `/api/model_selector` response was never captured live; field semantics (`hard_limit`, `behaves_as`, `provider_alias_targets`) are schema-only.
- `/v1/models` OAuth acceptance, pagination params, and its response beyond `id/display_name/description` remain unobserved.
- `claude.com/cai/oauth/authorize` vs `claude.ai/oauth/authorize` cannot be reconciled from these findings; both constants may coexist for different login routes.