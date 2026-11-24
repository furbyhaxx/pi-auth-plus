---
document:
  type: "research"
  id: "omp-overlap"
  title: "oh-my-pi v19.1.1 overlap with pi-auth-plus"
  description: "Where oh-my-pi v19.1.1 already provides providers, quotas, token counting, web search, model management, status line and login surfaces that pi-auth-plus also provides, with the extension seams that could replace our code."
  status: "draft"
  revision: 3
  created_at: "2026-11-24T09:22:40+01:00"
  updated_at: "2026-11-24T11:32:37+01:00"
  created_by: "scout"
  updated_by: "claude"
  changelog:
    - revision: 3
      reason: "user decisions on the remaining conflicts"
      changes: ["Recorded decisions for conflicts 8-13"]
    - revision: 2
      reason: "hybrid integration landed (0.8.0)"
      changes: ["Marked conflicts 1, 3, 4, 5 and 7 resolved and 6 reduced by the omp hybrid split"]
    - revision: 1
      reason: "document creation"
      changes: ["Mapped omp v19.1.1 provider, quota, token-counting, web-search, model, status-line and login surfaces against pi-auth-plus; listed concrete conflicts"]
---

# oh-my-pi v19.1.1 overlap with pi-auth-plus

Evidence roots (paths below are relative to them):

- `omp/` = `/mnt/cache/ext-seams-src/oh-my-pi` at tag `v19.1.1`
  (`omp/package.json:2` reports name `omp`; the checkout is the source tree, not the installed binary).
- `src/`, `docs/`, `.project/` = `/mnt/Projects/furbyhaxx/pi-auth-plus`.


Two facts shape everything below:

1. omp's provider policy is data, not code: ids, auth flows, default models, seeds and wire
   contracts live in `omp/packages/catalog/src/compat/rules/{auth,providers}/<id>.kdl`
   (`omp/packages/ai/src/registry/types.ts:1-13`), with the code half in
   `omp/packages/catalog/src/provider-models/descriptors.ts:106-195`.
2. omp's extension seams are `ProviderConfigInput`
   (`omp/packages/coding-agent/src/config/model-registry.ts:4898-4971`), the event bus, and
   `ctx.ui`. Not one of them is used by pi-auth-plus today for quotas, web search or status
   text; we register providers and run our own engines.

## 1. Providers

omp row names are the literal provider ids (`KnownProvider`,
`omp/packages/catalog/src/compat/provider-ids.ts:4-102`). Wire ids are the `api` values.

| Concept | omp (path, names) | pi-auth-plus (path, names) | Overlap |
|---|---|---|---|
| Anthropic subscription (Claude OAuth) | id `anthropic`; `auth "anthropic"` → `login "oauth-code"`, PKCE, client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, callback `:54545`, scopes `org:create_api_key user:inference …` (`rules/auth/anthropic.kdl:1-34`); catalog = bundled seed + `/v1/models` discovery + models.dev mapping (`provider-models/openai-compat.ts:7125-7181`); wire `anthropic-messages` (`rules/providers/anthropic.kdl:31,107`) | id `claude`; OAuth in `src/families/anthropic/oauth.ts:13-17` (same client id, `platform.claude.com` callback, `/api/oauth/claude_cli/create_api_key`), surfaced as Pi `/login claude`; catalog `https://api.anthropic.com/v1/models?limit=1000`, 4 h TTL (`src/families/anthropic/catalog.ts:8-9`), prices from models.dev (`:10`); wire `anthropic-messages` with Claude-Code-CLI shaping (`src/families/anthropic/provider.ts:61-129`) | **duplicate**: same OAuth app, same catalog endpoint, same wire, different id (`claude` vs `anthropic`) |
| Google Antigravity (Cloud Code PA, OAuth) | id `google-antigravity`; `oauth-code` with Google client id/secret, callback `:51121`, **plus `disabled "…paused: Google's terms do not allow third-party sign-in…"` and `login-warning`** (`rules/auth/google-antigravity.kdl:1-25`); wire `google-gemini-cli` on `https://daily-cloudcode-pa.googleapis.com`, discovery authoritative from `fetchAvailableModels` (`rules/providers/google-antigravity.kdl:3-24`); its usage provider exists but is suppressed for a paused provider (`omp/packages/ai/src/auth/usage.ts:169-171`) | id `antigravity` (`src/families/google/catalog.ts:8`); own OAuth with redirect `https://antigravity.google/oauth-callback` and the **same** Cloud Code client secret (`src/families/google/oauth.ts:15-25`; omp's base64 at `rules/auth/google-antigravity.kdl:8` decodes to the same value); catalog `fetchAvailableModels` (`src/families/google/catalog.ts:8-9`); custom `streamSimple` + `google-generative-ai` models (`src/families/google/provider.ts:21,75-175`); quota from `retrieveUserQuotaSummary` (`docs/quotas.md:36-39`) | **conflict**: same upstream and same OAuth app implemented three times (omp's disabled HTTP provider, omp's `antigravity-cli`, ours) |
| Google Antigravity via the official CLI | id `antigravity-cli`; `login "custom" hook="antigravity-cli"` driving `agy acp`, `api-key-format structured` (`rules/auth/antigravity-cli.kdl:1-11`); wire `antigravity-acp` on `https://antigravity.google`, roster seeded from `agy acp` `session/new` (`rules/providers/antigravity-cli.kdl:1-30`); **no usage provider** (`omp/packages/ai/src/usage/registry.ts:29-52`) | none (we speak HTTP to `v1internal:streamGenerateContent`, `src/families/google/provider.ts:23`) | **complementary**: omp's live Antigravity path is a local ACP subprocess; ours is HTTP impersonation. omp gives no Antigravity quota on that path — that stays ours |
| OpenAI Codex (ChatGPT subscription) | id `openai-codex`; `oauth-code`, fixed callback `http://localhost:1455/auth/callback`, no port fallback, `after-exchange hook="openai-codex-profile"` (`rules/auth/openai-codex.kdl:1-24`); discovery authoritative per stored account from Codex `/models` (`omp/packages/coding-agent/src/config/model-provider-discovery.ts:121-126`); wire `openai-codex-responses` on `https://chatgpt.com/backend-api` (`rules/providers/openai-codex.kdl:31`) | id `codex`, **quota only**, aliases `openai, openai-codex, chatgpt, cx, cox, oai` (`src/families/openai/index.ts:19-29`, `src/families/openai/identity.ts:2`); credential from Pi's `openai-codex` login else `quotas-codex-auth.json` (`docs/quotas.md:60-76`); usage `https://chatgpt.com/backend-api/wham/usage` (`src/families/openai/quota.ts:15`); resets `…/wham/rate-limit-reset-credits` (`src/families/openai/resets.ts:16-17`) | **duplicate quota** on the same endpoint; omp additionally owns models, streaming and automatic reset spending (`omp/packages/coding-agent/src/session/codex-auto-reset.ts:383-410`) |
| xAI OAuth (SuperGrok) | id `xai-oauth`; `login "device-code"` (`rules/auth/xai-oauth.kdl:2-24`); catalog = declaration-order seed roster + discovery label (`rules/providers/xai-oauth.kdl:6,20-121`); wire `openai-responses` on `https://api.x.ai/v1` (`:36`); usage from `cli-chat-proxy.grok.com/v1/billing` (`omp/packages/ai/src/usage/xai-oauth.ts:34-35`) | id `xai`, alias `grok`, **quota only**, no provider registration (`src/families/xai/index.ts:1-26`); reads the same two billing URLs (`src/families/xai/quota.ts:10-11`) | **duplicate data, conflicting identity**: our `xai` is omp's *paid API-key* provider; the subscription lives at `xai-oauth` (`rules/providers/xai.kdl` vs `xai-oauth.kdl`) |
| Synthetic | id `synthetic`; `login "api-key"` validating `https://api.synthetic.new/openai/v1/models` (`rules/auth/synthetic.kdl:1-8`); wire **`openai-completions`** on `https://api.synthetic.new/openai/v1`, dynamic roster authoritative (`provider-models/openai-compat.ts:4657-4666`); env `SYNTHETIC_API_KEY` (`rules/providers/synthetic.kdl:5`); usage `/v2/quotas` (`omp/packages/ai/src/usage/synthetic.ts:13`) | id `synthetic`; wire **`anthropic-messages`** on `https://api.synthetic.new/anthropic`, `apiKey: "$SYNTHETIC_API_KEY"`, `refreshModels` 4 h (`src/families/synthetic/index.ts:66-78`); catalog `https://api.synthetic.new/v1/models` (`src/families/synthetic/catalog.ts:6-9`); usage `/v2/quotas` (`src/families/synthetic/quota.ts:11`) | **conflict**: identical id, different wire, different catalog path, same quota endpoint |
| OpenCode Zen | id `opencode-zen`; `login "api-key"` (`rules/auth/opencode-zen.kdl:1-8`); dynamic roster + models.dev + seeds, per-model api routing including Anthropic lanes (`provider-models/openai-compat.ts:3382-3522`); env `OPENCODE_API_KEY` (`rules/providers/opencode-zen.kdl:5`); **no usage provider** | id `opencode` (`src/families/opencode/index.ts:10`) — Pi's builtin id; registers only the anonymous `public` key when nothing else exists (`:14-15,73-76`); spoofs the CLI on `before_provider_headers`/`before_provider_request` (`:82-96`); physical hooks (`src/families/opencode/physical.ts`) | **conflict**: on omp our hooks filter `provider === "opencode"`, which can never match `opencode-zen`; omp implements neither the anonymous key nor CLI identity spoofing (no `x-opencode-client` anywhere in `omp/packages`) |
| OpenCode Go | id `opencode-go`; `login "api-key"` (`rules/auth/opencode-go.kdl:1-9`); same manager (`provider-models/openai-compat.ts:3529-3531`); native usage `GET https://opencode.ai/zen/go/v1/usage` with rolling-5h / weekly / monthly windows (`omp/packages/ai/src/usage/opencode-go.ts:16-34,99-177`) | id `opencode-go` (`src/families/opencode/index.ts:11`); **no quota source** (`docs/quotas.md:27`); registers nothing unless the ambient key is anonymous, which never happens for Go (`src/families/opencode/index.ts:25-33,73-76`) | **conflict (benign)**: same id, and omp already provides the quota we lack — nothing to keep |
| OpenRouter | id `openrouter`; `login "oauth-code"` with PKCE-only browser sign-in or key paste, `result "api-key"` (`rules/auth/openrouter.kdl:1-31`); discovery authoritative `/models` filtered to `tools`, pseudo-api `openrouter` (`provider-models/openai-compat.ts:3651-3676`); **no usage provider** | id `openrouter`, alias `or`, **quota only**, no provider registration (`src/families/openrouter/index.ts:1-11`); `/api/v1/credits` + `/api/v1/key` (`src/families/openrouter/quota.ts:10-11`) | **complementary**: same id, disjoint capability — omp has no balance source |
| DeepSeek | id `deepseek`; `login "api-key"` (`rules/auth/deepseek.kdl:1-9`); plain completions manager on `https://api.deepseek.com` (`provider-models/openai-compat.ts:2225-2228`); **no usage provider** | id `deepseek`, alias `ds`, **quota only** (`src/families/deepseek/index.ts:1-11`); `/user/balance` (`src/families/deepseek/quota.ts:5`) | **complementary** |

Detail worth keeping: omp's `/login` list is derived from the KDL `login` blocks and from OAuth
providers registered at runtime (`omp/packages/ai/src/registry/types.ts:47-68`;
`omp/packages/coding-agent/src/config/model-registry.ts:4492-4498`), so API-key providers such as
`synthetic` and `deepseek` *are* `/login` entries, and our `claude`/`antigravity` appear there only
because `legacyOAuth` (`src/core/host/legacy-provider.ts:85-98`) hands omp an `oauth` block.

## 2. Quotas and usage

| Concept | omp (path, names) | pi-auth-plus (path, names) | Overlap |
|---|---|---|---|
| Normalized schema | `UsageReport`, `UsageLimit`, `UsageWindow`, `UsageAmount`, `UsageUnit` (`percent/tokens/requests/credits/usd/minutes/bytes/unknown`), `UsageResetCredits` (`omp/packages/ai/src/usage.ts:9-158`) | `ProviderQuotaSnapshot`, `QuotaSource`, `QuotaResets` (`src/quotas/types.ts`), documented per provider (`docs/quotas.md:13-58`) | **complementary**: omp's shape is the host contract; ours has no host counterpart |
| Built-in coverage | 22 adapters in `DEFAULT_USAGE_PROVIDERS` (`omp/packages/ai/src/usage/registry.ts:29-52`): `anthropic`, `google-antigravity`, `openai-codex`, `synthetic`, `xai-oauth`, `opencode-go`, plus 16 unrelated providers. **No `openrouter`, `deepseek`, `opencode-zen`, `antigravity-cli`** | `claude`, `antigravity`, `codex`, `synthetic`, `xai`, `openrouter`, `deepseek` (`src/families/*/index.ts`); none for `opencode`/`opencode-go` | **mix**: `claude`, `codex`, `synthetic`, `xai`, `opencode-go` covered by omp; `antigravity`, `openrouter`, `deepseek` are ours alone |
| Endpoint sameness | claude `api/oauth/usage?cedar_ember=1` (`usage/claude.ts:704-790`); codex `wham/usage` (`usage/openai-codex.ts:24`); synthetic `/v2/quotas` (`usage/synthetic.ts:13`); xai billing (`usage/xai-oauth.ts:34`); opencode-go `/zen/go/v1/usage` (`usage/opencode-go.ts:17-19`) | claude `src/families/anthropic/quota.ts:17`; codex `src/families/openai/quota.ts:15`; synthetic `src/families/synthetic/quota.ts:11`; xai `src/families/xai/quota.ts:10-11`; antigravity `retrieveUserQuotaSummary`, openrouter `/credits`+`/key`, deepseek `/user/balance` | **duplicate** for the four shared providers, byte-for-byte the same upstream calls |
| Extension plug-in seam | `ProviderConfigInput.usage?: UsageProvider` (`config/model-registry.ts:4909-4910`); installed as `authStorage.usage.setProvider(name, usage, config.apiKey)` (`:4536-4538`); precedence runtime > configured > built-in (`omp/packages/ai/src/auth/usage.ts:169-176`); removed by `removeProvider` (`:226-230`) / unregister (`config/model-registry.ts:4358-4362`); documented at `omp/docs/extensions.md:187-237` | none — our `QuotaEngine` polls and caches itself (`src/quotas/engine.ts:21-63`), UI reads only snapshots (`docs/quotas.md:1-5`) | **conflict**: on omp the whole quota engine could be replaced by one field per provider |
| `UsageProvider` shape | `id`, `cacheVersion`, `fetchUsage(params, ctx)`, `parseRateLimitHeaders(headers, now?, {responseStatus})`, `supports(params)`, `validatesCredentials`, `retainLastGoodOnFailure`, `failureBackoffMs`, `usesRequestKey` (`omp/packages/ai/src/usage.ts:432-455`); params carry the normalized credential, `accountKey`, `baseUrl`, `signal` (`:409-416`); ctx carries `fetch`, `logger`, `retryWait`, `previousReport` (`:419-429`) | `QuotaSource.fetch(ctx)` + `headers` claim (`src/quotas/types.ts`, `docs/quotas.md:293-296`) | **complementary**: field-for-field, ours is a superset in UI terms, a subset in host integration |
| Response-header ingestion | `parseRateLimitHeaders` on the usage provider (`usage.ts:438-442`) driven by `UsageService.ingestHeaders(provider, headers, {sessionId, baseUrl, responseStatus})` (`omp/packages/ai/src/auth/usage.ts:557-636`), called from the session stats hook on every provider response (`omp/packages/coding-agent/src/session/session-stats.ts:494`), throttled except when a window reads exhausted (`auth/usage.ts:577-579`) | `after_provider_response` handler claims a header shape per family, overlays cached windows (`docs/quotas.md:293-296`, `src/quotas/engine.ts`, family `QuotaSource.headers`) | **duplicate** mechanism, different events; omp's is provider-owned and per-credential |
| Cache and history | shared `agent.db`, keyed by provider + `cacheVersion` + base URL + credential identity, last-good retention (`omp/docs/extensions.md:234-237`), history rows for every fetch (`omp/packages/ai/src/usage.ts:190-221`) | `<agentDir>/cache/auth-plus/quotas.json` with leases, backoff, drainage (`docs/quotas.md:273-300`; `src/quotas/engine.ts:45-63`) | **duplicate**: two pollers, two caches, same endpoints |
| Display in the TUI | `usage` status-line segment renders 5 h / daily / 7 d / monthly / reset credits and a plan tier (`omp/packages/tui/src/status-line/schema.ts:27`; `status-line/segments.ts:1284-1360` from `SegmentContext.usage`, `status-line/types.ts:203-217`), fed by `host.fetchUsageReports` with a 5-minute TTL (`status-line/component.ts:2182-2242`) | own line with a full template language (`docs/quotas.md:78-182`), above/below editor widget, footer, pi-workbench segment (`src/quotas/line/index.ts:96-123`) | **complementary**: omp's segment is not extensible; see §6 |
| Command and CLI surface | `/usage [show\|reset …]` (`slash-commands/builtin-session.ts:410-456`), `omp usage` (`cli/usage-cli.ts:1-63`), `omp usage clients`/history from the broker (`:1212-1216,1651-1653`) | `/auth quotas`, `/quota`, `/quotas`, `--quotas-list`, `--quotas-json` (`src/ui/commands/index.ts:653-783`; `docs/quotas.md:184-271`), bus channels | **duplicate** for show; ours adds JSON/exit codes and drainage |
| Reset credits | claude/codex spending with inventory, expiry warnings and auto-reset (`session/claude-auto-reset.ts:193-210`, `session/codex-auto-reset.ts:383-410`, `usage/openai-codex-reset.ts`), `/usage reset <provider/credential>` | `src/quotas/resets.ts` + per-family consume (`src/families/anthropic/resets.ts:14-16`, `src/families/openai/resets.ts:16-17`), approval-gated UI | **duplicate** program; omp's is account-pool aware |
| Credential ranking by usage | `CredentialRankingStrategy` per provider: plan gates, window extraction, reserve scoping, block healing (`omp/packages/ai/src/usage.ts:457-551`; registry `usage/registry.ts:63-77`) | none — one credential per provider, no rotation | **complementary**: omp-only capability |

## 3. Token counting

| Concept | omp (path, names) | pi-auth-plus (path, names) | Overlap |
|---|---|---|---|
| Local tokenizers | `Model.tokenizer` ∈ `claude-v3`, `claude-v47`, `claude-v5`, `claude-v5-sonnet`, `qwen3`, `deepseek-v3`, `kimi-k2`, `glm5`, `cl100k`, `o200k`, mapped to native encodings (`omp/packages/agent/src/tokenizer.ts:29-45`); resolved from model identity at build (`omp/packages/catalog/src/model-tokenizer.ts:58-82`, `build.ts:529`); unknown models count in `o200k_base` | `@huggingface/tokenizers` artifacts resolved per `hf:` model, cached under `$XDG_CACHE_HOME/pi-auth-plus/tokenizers/` (`docs/tokens.md:67-82`); other families use measured char-per-token estimates (`src/families/xai/index.ts:18-22`, `src/families/openai/index.ts:55-59`) | **complementary**: omp is exact for 10 model families we estimate; ours is exact for arbitrary HF repos omp cannot count |
| Counting implementation | `natives.countTokens` with an LRU of 256 entries / 512 KiB (`omp/packages/agent/src/tokenizer.ts:177-230`), modes `strict \| approximate \| upperbound` with byte-length floors (`:137-145`) | provider endpoint or tokenizer or chars/token, each labelled with its source (`docs/tokens.md:25-34`) | **complementary** |
| Context accounting | anchor = provider-reported `correctedPromptTokens(anchorAssistant)` from the last usage-bearing assistant message, tail = `tokenizer.countMessages(...)` (`omp/packages/coding-agent/src/session/session-stats.ts:299-371`); compaction reads the same number (`packages/agent/src/compaction/compaction.ts:1653-1655,371-375`) | identical anchor+tail model (`docs/tokens.md:9-34`), corrected in our `message_end` handler for synthetic (`src/families/synthetic/index.ts:121-138`) | **duplicate** architecture; ours adds per-family constants for Pi that omp does itself |
| Provider count endpoints | **none**: no HTTP `count_tokens` call exists in the tree (the only text match is the Rust binding doc, `omp/packages/natives/native/index.d.ts:1178-1180`) | Claude `/v1/messages/count_tokens` for the complete shaped request (`src/families/anthropic/count.ts:24`, `src/families/anthropic/count-context.ts`) | **complementary**: ours is strictly more accurate on Claude; omp is more accurate on the ten local families |
| Display | `context_pct`, `context_total` status segments (`status-line/schema.ts:16-17`), `/context` (`slash-commands/builtin-session.ts:563-580`), per-turn cost/token metrics from the session rollup (`status-line/segments.ts:756-806`) | `/tokens` tab with Total/Pi/Delta/Anchor/Tail/Breakdown (`docs/tokens.md:84-102`), footer percent in our fallback footer (`docs/tokens.md:104-114`), bus channels | **conflict on numbers**: on omp our tab and omp's `context_pct` will disagree whenever our source outranks omp's o200k fallback |

## 4. Web search

| Concept | omp (path, names) | pi-auth-plus (path, names) | Overlap |
|---|---|---|---|
| Tool surface | one built-in tool `web_search` (`omp/packages/coding-agent/src/web/search/index.ts:592-593`, custom-tool twin `:637-638`) with `query, recency, limit, max_tokens, temperature, num_search_results` (`:54-61`) | `synthetic_web_search` with only `query` (`src/families/synthetic/web-search.ts:27,33-35`), registered inactive in the factory and toggled by `synthetic.webSearch` / `--synthetic-web-search` (`src/families/synthetic/index.ts:86-105`) | **duplicate surface**: two tool names, same purpose |
| Engine selection | `web` model role + `getSearchProvider` / `getGroundedSearchProvider`, `web/hosted` expansion, xAI/HN preference (`web/search/index.ts:266-300,222-233`) | fixed to Synthetic, no chain (`src/families/synthetic/web-search.ts:94-313`) | **complementary**: omp's chain may route to Synthetic anyway |
| Synthetic implementation | `searchSynthetic` POST `https://api.synthetic.new/v2/search`, `SyntheticProvider.id = "synthetic"`, key via `authStorage.keys` (`web/search/providers/synthetic.ts:18,41-125`) | same URL (`src/families/synthetic/web-search.ts:28`), returns highlights, writes full page text to a 0600 temp file (`:76-85`; `docs/AGENTS.md` synthetic invariants) | **duplicate endpoint**, different output contract |
| Extension seam | `ProviderConfigInput.webSearch?(params): Promise<SearchResponse>` (`config/model-registry.ts:4919-4926`), consulted only for a model whose provider has a grounding backend (`web/search/index.ts:409-411`), exposed as `getProviderWebSearch` (`:4313-4315`); docs `omp/docs/extensions.md:245` | not used; our tool is a separate tool registration | **complementary**: we could own `synthetic` grounding output shape through it, but it cannot add a tool |

## 5. Model aliases, virtual groups, visibility

| Concept | omp (path, names) | pi-auth-plus (path, names) | Overlap |
|---|---|---|---|
| Visibility / enable filters | `enabledModels`, `enabledProviders`, `disabledProviders`, scoped by path prefix (`omp/packages/coding-agent/src/config/model-settings.ts:94-112`; `omp/docs/models.md:886-919`), `modelProviderOrder`, `cycleOrder` (`model-settings.ts:164-166`) | `models.rules` hide/show chain, last match wins, `#` disables, user/project/runtime scopes (`src/models/rules/*`; `docs/models.md:23-77`) | **complementary**: different shapes, same intent |
| Model aliases | only catalog-side alias collapse for retired effort variants (`omp/docs/models.md:799-801`) and role aliases such as `@smol`, `@default` (`:844`). No user-defined `provider/alias` models | `models.aliases` list, `{provider, source, id}`, edited in `/auth models` (`src/models/aliases/*`; `docs/models.md:97-119`) | **conflict**: omp has no seam to add an alias model; ours registers them through the factory |
| Virtual model groups | none: no `registerVirtualModel` anywhere in `omp/packages/coding-agent/src`; the closest are single-selector roles and request-level `retry.fallbackChains` (`omp/docs/models.md:846-848`) | `group/<id>` with priority tiers, `sticky/failover/random/balance`, thinking maps, context caps (`src/models/groups/*`; `docs/models.md:121-177`) | **conflict**: unimplementable on omp; our groups stay inactive there (`src/core/host/index.ts:24-29`) |
| Per-model overrides | `models.yml` `providers.<id>.modelOverrides` + `models[]` entries incl. `maxContextWindow` (`omp/docs/models.md:49-107`; schema `config/models-config.ts:100-212`) | Pi `models.json` overrides staged from `/auth models`, user scope only (`src/models/overrides/*`; `docs/models.md:79-95`) | **complementary**: same job, two files |
| Roles / presets (omp-only) | `modelRoles` in `config.yml`: `default, smol, slow, vision, plan, commit, tiny, memory, task, advisor`, kind roles `image, web, speech, dictation, judge`; `modelPresets` snapshots; `modelTags` (`omp/docs/models.md:829-882`; `config/model-settings.ts:22-166`) | none | **complementary**: omp-only capability we neither need nor duplicate |
| Provider registration per host | `pi.registerProvider(name, config)` merges into a built-in id, replacing that provider's models when `models` is present (`config/model-registry.ts:4439-4451`) | factory registration with merge semantics across hosts (`src/core/registry/index.ts:83-96`; `src/index.ts:237-323`) | **complementary** with a sharp edge: on omp "merge" means replace-models (see conflicts) |

## 6. Status line and footer

| Concept | omp (path, names) | pi-auth-plus (path, names) | Overlap |
|---|---|---|---|
| Segment catalog | closed list `STATUS_LINE_SEGMENT_IDS` incl. `usage`, `context_pct`, `cost`, `token_total`, `cache`, `subagents`, `tree` (`omp/packages/tui/src/status-line/schema.ts:2-32`); presets and per-segment options (`status-line/types.ts:46-64`) | own template token language with per-provider fields (`docs/quotas.md:100-182`) | **conflict**: no seam adds a segment id; omp exposes only its own `usage` segment |
| Provider quota segment | `usage` segment from `SegmentContext.usage` (`status-line/types.ts:203-217`, `segments.ts:1284-1360`), filled by `host.fetchUsageReports` on a 5-minute timer keyed by credential/org/model (`status-line/component.ts:2148-2242`) | own line/rows (`src/quotas/line/line.ts`, `format.ts`, `template*.ts`) | **complementary** only if we register `ProviderConfigInput.usage`; otherwise two independent renders |
| Extension status text | `ctx.ui.setStatus(key, text)` → footer/status bar, `undefined` clears (`extensions/types.ts:421-422`), rendered as key-sorted hook statuses in the status line (`status-line/types.ts:96-97`, `segments.ts:392-420`) | **not used** (no `setStatus` anywhere in `src/`) | **complementary**: available and unused |
| Widgets | `ctx.ui.setWidget(key, content, {placement: "aboveEditor" \| "belowEditor"})` works in interactive mode (`extensions/types.ts:427-428`; `omp/docs/extensions.md:1069-1072`) | quota line mounts through `setWidget` for `above-editor` and `below-editor-first` (`src/quotas/line/index.ts:96-123`) | **complementary**: already portable |
| Footer / header replacement | `setFooter` / `setHeader` are no-ops in the interactive controller (`omp/packages/coding-agent/src/modes/controllers/extension-ui-controller.ts:248-249`) and documented as current no-ops (`omp/docs/extensions.md:1058-1061`); also no-ops in RPC (`modes/rpc/rpc-mode.ts:1828-1834`) and headless (`runner.ts:556-558`) | `below-editor-last` placement replaces the footer via `ctx.ui.setFooter` (`src/quotas/line/placement.ts:44,66-78`; `footer.ts:60-202`) | **conflict**: that placement silently renders nothing on omp |
| Third-party footer host | none (omp owns its status line) | pi-workbench service push (`src/quotas/line/workbench.ts:8-11,28-122`) | **complementary** on Pi, absent on omp |

## 7. Login, logout, accounts and dashboards

| Concept | omp (path, names) | pi-auth-plus (path, names) | Overlap |
|---|---|---|---|
| `/login` | `/login [provider\|redirect URL]` (`slash-commands/builtin-session.ts:691-743`) → `ctx.showOAuthSelector("login", provider)` over `getOAuthProviders()`; API-key providers included; manual redirect paste via `oauthManualInput` (`:720-727`) | none: `/auth` never logs in and points at `/login <id>` (`AGENTS.md` "Login is Pi's"; `docs/getting-started.md`) | **complementary**: our providers surface in omp's `/login` through `legacyOAuth` |
| `/logout` and multi-account | `/logout [provider]` with per-credential selector and org disambiguation for same-email subscriptions (`builtin-session.ts:744-766`; `slash-commands/helpers/logout.ts:26-28,109-133`) | none (Pi `/logout`); single credential per provider | **complementary** |
| Account pools, rotation, pinning | `AuthStorage` credential pools per provider, usage-based ranking/rotation (`omp/packages/ai/src/auth/{pool,rank,select,rotation}.ts`; `usage.ts:457-551`), `/session pin` (`builtin-session.ts:121-184`), per-account usage rows (`slash-commands/helpers/usage-accounts.ts:13-118`) | one slot per provider id (`src/core/auth/store.ts`, `src/core/auth/index.ts`) | **complementary**: omp-only capability |
| Usage dashboard | `/usage` renders the usage dashboard (`builtin-session.ts:437-443` → `ctx.handleUsageCommand()`), `/usage reset` selector (`:444-450`), history in `omp usage` (`cli/usage-cli.ts:1651-1653`) | `/auth quotas`/`/quota`/`/quotas` panel (`src/ui/commands/index.ts:653-783`; `docs/quotas.md:184-212`) | **duplicate** surface, ours adds resets UI, drainage, JSON |
| Model picker / provider setup | `/model` (alias `/models`) hub with roles (`slash-commands/builtin-modes.ts:413-415`), `/setup` (alias `providers`) (`:267-269`), `omp models` (`omp/docs/models.md:921-922`) | `/auth models`, `/auth groups`, `/auth settings` tabs (`src/ui/dashboard/*`) | **duplicate** for models; groups/settings have no omp counterpart |
| Credential export/import | `omp auth export` / `omp auth import` CLI only (`commands/auth.ts:1-186`; arg surface `:167-186`), refuses when an auth broker is configured (`:201-209`) | none | **complementary**, and it is a CLI subcommand, not a slash command: our `/auth` slash does not collide with it |
| Extension/status dashboard | `/extensions` (alias `/status`) (`builtin-session.ts:582-590`) | `/auth` overview tab (`src/ui/dashboard/index.ts`) | **complementary** |

## 8. Seams we could use instead of our own code

All signatures are from `ProviderConfigInput` (`omp/packages/coding-agent/src/config/model-registry.ts:4898-4971`)
unless stated. "Called when" quotes the code path.

| Seam | Signature | When omp calls it | Our current use |
|---|---|---|---|
| `usage` | `usage?: UsageProvider`; `fetchUsage(params: UsageFetchParams, ctx: UsageFetchContext): Promise<UsageReport \| null>` (`omp/packages/ai/src/usage.ts:409-436`) | Status-line refresh (5-min TTL, per credential/org/model), `/usage`, `omp usage`, reset-credit flows, ranking (`auth/usage.ts:169-200`; `status-line/component.ts:2182-2242`) | **not used**; `QuotaEngine` polls on its own schedule (`src/quotas/engine.ts:52-369`) |
| `usage.parseRateLimitHeaders` | `(headers: Record<string,string>, now?: number, context?: {responseStatus?: number}) => UsageReport \| null` (`usage.ts:438-442`) | Every provider response via `UsageService.ingestHeaders` (`auth/usage.ts:557-636`; caller `session/session-stats.ts:494`) | not used; we ingest in `after_provider_response` per family |
| `discoverModels` | `discoverModels?(context: {accounts: OAuthDiscoveryAccount[]; baseUrl?: string; fetch: FetchImpl}): Promise<readonly ModelSpec<Api>[] \| null>` (`model-registry.ts:4886-4893,4924`) | Only for a **built-in** provider id: the built-in manager's `fetchDynamicModels` is replaced, its cache/merge/authority kept (`:3349-3371`); "runs once with all signed-in accounts" (`omp/docs/extensions.md:246`) | **not used**; we refresh through `refreshModels` |
| `fetchDynamicModels` | `(apiKey: string \| undefined) => Promise<readonly ProviderConfigInput["models"][number][]>` (`:4942-4944`) | Extension-registered providers: 24 h SQLite cache, 15 s hard timeout (`:4629-4700`; `omp/docs/extensions.md:259`), rows dropped with a warning when their `kind` does not fit their api (`:4670-4673`) | used indirectly: `hostProviderConfig` projects our `refreshModels` into it (`src/core/host/legacy-provider.ts`) |
| `webSearch` | `webSearch?(params: SearchParams): Promise<SearchResponse>` (`:4926`) | `web_search` tool, only when the session model's provider has an extension search, in place of its grounding backend; availability/labels still come from the backend (`web/search/index.ts:409-411`) | **not used**; we register a second tool |
| `stream` | `stream?(model: Model<Api>, context: Context, options: StreamOptions): AssistantMessageEventStream` (`:4911-4912`) | Every request to that provider's models, replacing the api adapter; `options` already mapped, provider key included (`docs/extensions.md:243`) | **not used**; we pass `streamSimple` plus our own reserved api id |
| `streamSimple` + `api` | `streamSimple?(model, context, options?: SimpleStreamOptions)` (`:4902`); `api` is required with it (`:4468-4470`) and goes through `registerCustomApi` (`:4485-4490`) | Requests to models whose `api` equals that string; built-in api names are reserved, so we namespace `pi-auth-plus-<api>` (`src/core/host/legacy-provider.ts:22-25`) | **used** (`legacyProviderConfig` `:108-128`) |
| `rules` | `rules?: Readonly<Record<string, unknown>>` — KDL `provider` directives (`:4927-4928`) | Applied when every model of the provider is built; unknown/invalid directives fail `registerProvider`; a runtime rule loses to a more specific KDL rule (`docs/extensions.md:247`) | **not used** |
| `oauth` | `{name, login(callbacks: OAuthLoginCallbacks), refreshToken?(credentials), getApiKey?(credentials), modifyModels?(models, credentials)}` (`:4929-4935`) | Registers an OAuth provider for `/login`, `/logout` and refresh (`:4492-4498`); `apiKey` becomes a **fallback** only when `oauth` is present (`:4545-4546`) | **used** (`legacyOAuth`, `src/core/host/legacy-provider.ts:85-98`) |
| `apiKey` | `apiKey?: string` — literal key or env var name (`:4900`) | Installed as a config override (`:4539-4548`); normally outranks any stored `/login` credential; with `oauth` it is only a fallback (`omp/docs/extensions.md:261`); `KeyOverrides.setConfig` (`omp/packages/ai/src/auth/cascade.ts:109-121`) with `suppressesOAuth` (`:57-58`) | synthetic passes `$SYNTHETIC_API_KEY` (`src/families/synthetic/index.ts:73`); `hostProviderConfig` drops it on omp |
| `unregisterProvider` | `(providerName: string) => void` (`model-registry.ts:4400-4401`) | Removes the runtime usage override/registration (`:4358-4362`), restoring built-ins | unused |
| `ctx.ui.setStatus` / `setWidget` | `setStatus(key: string, text: string \| undefined)`, `setWidget(key, content, options?)` (`extensions/types.ts:421-428`) | Live footer status row and above/below-editor widgets | `setWidget` used for two placements (`src/quotas/line/index.ts:96-123`); `setStatus` unused |
| `message_end` rewrite | `ExtensionHandler<MessageEndEvent>` returning a replacement message (`extensions/types.ts:1276-1287`; overload `:1977`) | After the stream settles, before history/persistence/tool dispatch; the replacement is authoritative | used for synthetic usage correction (`src/families/synthetic/index.ts:121-138`) |

Events omp **does not** emit (registered silently, because `on(event: string, handler)` only stores
by key: `omp/packages/coding-agent/src/extensibility/extensions/loader.ts:245-249`; the full union is
`extensions/types.ts:1929-2006`): `before_provider_headers`, `model_select`,
`thinking_level_select`, `agent_before_settle`, `agent_settled`, `provider_stream_event`.
pi-auth-plus registers all six (`src/families/opencode/index.ts:82,92`,
`src/families/synthetic/index.ts:113`, `src/tokens/tracker/index.ts:112-113`,
`src/core/boundary/index.ts:70-71`, `src/families/google/signature-recovery.ts:161`,
`src/families/google/compatible-signatures.ts:29`). omp does emit `session_start`,
`session_shutdown`, `session_before_switch`, `session_compact`, `session_tree`,
`before_provider_request`, `after_provider_response`, `before_agent_start`, `turn_start`,
`turn_end` and `message_end`.

## Concrete conflicts

1. **Resolved 0.8.0 (omp's provider serves it): `synthetic` registered twice, with a different wire.** omp's built-in is
   `openai-completions` on `/openai/v1` (`omp/packages/catalog/src/provider-models/openai-compat.ts:4661-4666`);
   our registration replaces its models and points them at `anthropic-messages` on `/anthropic`
   (`src/families/synthetic/index.ts:66-78`) through `registerProvider`, whose contract is "if
   provider has models: replaces all existing models" (`config/model-registry.ts:4439-4445`,
   projection at `src/core/host/legacy-provider.ts:108-128`). Users who expect omp's Synthetic
   behaviour get ours instead, and vice versa for any omp feature keyed to `openai-completions`
   (e.g. the `when-thinking`/compat rules in `rules/providers/synthetic.kdl:9-20`).

2. **Resolved 2026-11-24: our Synthetic `apiKey` shadowed the `/login` key.** `$SYNTHETIC_API_KEY`
   (`src/families/synthetic/index.ts:73`) reached omp as a config override
   (`config/model-registry.ts:4539-4548`) that outranks a `/login synthetic` credential when no
   `oauth` is registered (`:4545-4546`; `omp/docs/extensions.md:261`); with the variable unset,
   `KeyOverrides` (`omp/packages/ai/src/auth/cascade.ts:109-121`) sent its literal name as the
   bearer. `hostProviderConfig` now drops `$NAME` references on omp and moves the static models to
   `fetchDynamicModels`, so omp's own cascade serves the key.

3. **Resolved 0.8.0 (family off on omp): `opencode` vs `opencode-zen` breaks our Zen patch on omp.** Our hooks branch on
   `provider === "opencode"` (`src/families/opencode/index.ts:85,92`) and our anonymous key
   registration uses the same id (`:10,73-76`); omp's Zen provider is `opencode-zen`
   (`omp/packages/catalog/src/compat/provider-ids.ts:69-70`). On omp the header/body spoof never
   applies, and our anonymous registration creates a second, non-spoofing Zen provider instead of
   patching the builtin. omp also has no anonymous `public` key and no `x-opencode-client` /
   `ses_` identity anywhere in `omp/packages` (search over the tree), so our behaviour cannot be
   reproduced by configuration there.

4. **Resolved 0.8.0 (family off on omp): `opencode-go` shares the id and omp already reports its quota.** Ours registers the id
   (`src/families/opencode/index.ts:11`) with no quota (`docs/quotas.md:27`); omp has
   `GET /zen/go/v1/usage` with three windows (`omp/packages/ai/src/usage/opencode-go.ts:16-34`).

5. **Resolved 0.8.0 (quota reads `xai-oauth`):** `xai` names two different products. Our quota entry is `xai` with alias `grok`
   (`src/families/xai/index.ts:13`), matching omp's paid API-key provider (`rules/providers/xai.kdl:93`
   in `provider-ids.ts:93`), while the SuperGrok subscription — the account our quota reads — is
   `xai-oauth` in omp (`rules/providers/xai-oauth.kdl:3-6`; usage `usage/xai-oauth.ts:34`).
   Any migration of our quota onto `ProviderConfigInput.usage` under the name `xai` would attach
   subscription usage to the API-key product.

6. **Reduced 0.8.0 (claude, antigravity, openrouter, deepseek feed omp from our cache): Double quota polling of the same endpoints.** claude (`src/families/anthropic/quota.ts:17`
   vs `omp/packages/ai/src/usage/claude.ts:704`), codex (`src/families/openai/quota.ts:15` vs
   `omp/packages/ai/src/usage/openai-codex.ts:24`), synthetic (`src/families/synthetic/quota.ts:11`
   vs `omp/packages/ai/src/usage/synthetic.ts:13`) and xai (`src/families/xai/quota.ts:10-11` vs
   `omp/packages/ai/src/usage/xai-oauth.ts:34`) are fetched by both stacks, into two caches
   (`<agentDir>/cache/auth-plus/quotas.json`, `docs/quotas.md:273-276`, and omp's `agent.db`,
   `omp/docs/extensions.md:234-237`) on two schedules (our 60 s default with a 5-min Claude floor,
   `docs/quotas.md:280-285`; omp's 5-minute status-line TTL, `status-line/component.ts:2190-2191`).

7. **Resolved 0.8.0 (our tool is off on omp): Two web-search tools over the same endpoint.** omp `web_search`
   (`omp/packages/coding-agent/src/web/search/index.ts:593`) and our `synthetic_web_search`
   (`src/families/synthetic/web-search.ts:27`) both eventually POST
   `https://api.synthetic.new/v2/search` (omp `providers/synthetic.ts:18`; ours `:28`). omp's
   chain can pick Synthetic on its own (`providers/synthetic.ts:115-125`), so a session with both
   enabled exposes two names for one backend, with different argument schemas and output shapes
   (ours writes full page text to a temp file, `:76-85`).

8. **Antigravity: three implementations, one of them disabled by omp policy.** omp disables
   `google-antigravity` sign-in with an explicit warning that Google suspended accounts using it
   (`rules/auth/google-antigravity.kdl:3-4`) and instead runs the official `agy acp` CLI
   (`rules/auth/antigravity-cli.kdl:1-11`, wire `antigravity-acp`,
   `rules/providers/antigravity-cli.kdl:4,19`). Our `antigravity` (`src/families/google/provider.ts:21-23,75-175`)
   continues the disabled path with the same OAuth app (`src/families/google/oauth.ts:15-25`).
   This is a product-policy conflict, not only a code one: the user's decision here also decides
   whether we keep impersonating Cloud Code at all.

9. **Codex aliases shadow omp provider ids.** Our registry claims `openai` and `openai-codex` as
   aliases of `codex` (`src/families/openai/index.ts:23`). On omp both are real provider ids
   (`provider-ids.ts:67-68`), so `/auth openai-codex` resolves to our quota row instead of omp's
   provider, and any command that accepts aliases (`/quota`, `/quotas`, `--quotas-list`) will read
   as if omp's provider were ours.

10. **Our `below-editor-last` quota line renders nothing on omp.** It mounts through
    `ctx.ui.setFooter` (`src/quotas/line/placement.ts:44,66-78`), which omp implements as a no-op
    in interactive mode (`omp/packages/coding-agent/src/modes/controllers/extension-ui-controller.ts:248-249`;
    documented `omp/docs/extensions.md:1058-1061`), RPC (`modes/rpc/rpc-mode.ts:1828-1834`) and
    headless (`runner.ts:556-558`). The pi-workbench fallback is unavailable too
    (`src/quotas/line/workbench.ts:8-11`). Only the two widget placements survive there.

11. **Our omp path silently loses six events.** `before_provider_headers`, `model_select`,
    `thinking_level_select`, `agent_before_settle`, `agent_settled` and `provider_stream_event`
    are not in omp's event union (`extensions/types.ts:1929-2006`) and `on()` stores any name
    without validation (`loader.ts:245-249`), so registration succeeds and nothing fires. Concrete
    losses: Zen header identity (`src/families/opencode/index.ts:82`), antigravity signature
    recovery/capture (`src/families/google/signature-recovery.ts:155-166`,
    `signature-recovery.ts:161`, `compatible-signatures.ts:29`), tokenizer preload and token
    recount scheduling on model change (`src/families/synthetic/index.ts:113`,
    `src/tokens/tracker/index.ts:112-113`), and group settlement on `agent_before_settle`
    (`src/core/boundary/index.ts:70-71`).

12. **Two context percentages, one of them authoritative to omp.** omp computes context from the
    provider anchor plus its own local tokenizers (`session/session-stats.ts:306-371`) and uses it
    for compaction (`packages/agent/src/compaction/compaction.ts:371-375`); our `/tokens` tab and
    fallback footer publish our own number (`docs/tokens.md:84-114`). For Claude our recount can
    differ because it uses the count endpoint (`src/families/anthropic/count.ts:24`) while omp
    counts `claude-v5*` locally for models it knows and `o200k_base` otherwise
    (`agent/src/tokenizer.ts:29-45`); for `hf:` Synthetic models omp has no tokenizer at all,
    so its number is a fallback while ours is the model's own vocabulary
    (`docs/tokens.md:58-63`).

13. **Aliases and groups have no omp seam.** `registerVirtualModel` is absent from
    `omp/packages/coding-agent/src` (no match), so `models.groups` cannot publish `group/<id>`
    and, per our own host notes, groups warn once and stay inactive (`AGENTS.md` "Hosts";
    `src/core/host/index.ts:24-29`). `models.aliases` likewise has no omp counterpart: aliases are
    catalog-side collapse only (`omp/docs/models.md:799-801`).

## Decisions (2026-11-24, user)

- **8:** settled earlier: Antigravity on omp stays our registered provider with its own OAuth, at parity with Pi.
- **9:** drop the `openai` alias of `codex` on every host; keep `openai-codex`, `chatgpt`, `cx`, `cox`, `oai`.
- **10:** on omp, `below-editor-last` falls back to the below-editor widget.
- **11:** omp-only substitutes; Pi keeps its event paths. Antigravity signature repair moves into
  our Antigravity stream on omp; model and thinking changes are detected at `turn_start` /
  `before_agent_start`; the OpenRouter-Gemini signature gap is accepted and documented. The
  host branch goes through a `core/host` capability check, never a host test in the family.
- **12:** live-check that the `message_end` usage rewrite reaches omp's Synthetic messages (fix
  if not), and show omp's and our context number side by side in `/tokens` on omp.
- **13:** groups and aliases stay off on omp; docs point to omp's model roles and presets.

## What is already covered (input to keep / delegate / plug into)

- **omp fully covers**: Codex quota *and* reset spending, OpenCode-Go quota, credential pools with
  usage-based ranking and multi-account logout, exact local tokenizers for ten model families,
  model roles/presets, a `web_search` chain, and `/login`/`/logout`/`/usage` UX.
- **omp covers the provider but not the quota**: `opencode-zen`, `antigravity-cli`,
  `openrouter`, `deepseek`.
- **omp covers the quota but not the provider, under a different id**: `anthropic` (ours `claude`),
  `xai-oauth` (ours `xai`).
- **Only pi-auth-plus covers**: Antigravity quota (`retrieveUserQuotaSummary`) and the working
  Antigravity HTTP path; OpenRouter balances and DeepSeek balances; Claude count-endpoint token
  counting; HF tokenizers for `hf:` Synthetic models; the anonymous OpenCode Zen key and CLI
  identity; drainage/history-to-JSON CLI; model groups and user-defined aliases.
- **Seams that would delete code rather than duplicate it**: `ProviderConfigInput.usage` (one
  object per provider replaces our polling, cache and header ingestion for that provider),
  `webSearch` (replaces our tool's backend while keeping omp's `web_search` name), and
  `ctx.ui.setStatus` (a footer row without a custom footer).

## Gaps and unverified items

- Live behaviour of omp's `/login` for a *runtime-registered* API-key-only provider was read from
  code (`getOAuthProviders` + `registerOAuthProvider`), not run: our providers always register
  `oauth`, so their list presence is certain, but an omp-only API-key flow was not exercised.
- `google-antigravity`'s usage adapter was not executed against an account; its unusability is
  inferred from the `disabled` rule plus `providerPauseReason` gating (`omp/packages/ai/src/auth/usage.ts:169-171`).
- Whether omp's `message_end` rewrite is honoured for messages produced through a
  **custom `streamSimple` api** (our path) was not traced end to end; our synthetic correction
  depends on it on omp.
- The installed `~/.local/bin/omp` binary was not compared with this v19.1.1 tree (it is a
  compiled binary); all statements are about the tag's source.
- No write tool was available in this run, so this report exists only as returned text.
