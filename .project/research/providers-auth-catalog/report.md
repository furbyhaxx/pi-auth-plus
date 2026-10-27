---
document:
  type: "report"
  id: "spec-0001-rfc-providers"
  title: "RFC review: SPEC-0001 providers, auth, and catalog"
  description: "Cross-check of SPEC-0001 provider, OAuth, discovery, and CLI design against references"
  status: "published"
  revision: 3
  created_at: "2026-10-19T14:35:27+02:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "second-opinion"
  updated_by: "pi"
  source: "nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/analyses/spec-0001-rfc/providers-auth-catalog.md"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["document creation"]
      updated_at: "2026-10-19T14:35:27+02:00"
    - revision: 2
      reason: "frontmatter migration"
      changes: ["migrate flat frontmatter to the document block"]
    - revision: 3
      reason: "imported into pi-auth-plus"
      changes: ["copied from nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/analyses/spec-0001-rfc/providers-auth-catalog.md"]
---

## Verdict

Request changes before implementing discovery and authentication. The approved provider splits and metadata strategy remain viable, and most explicitly stated OAuth endpoints and constants match the references. The material gaps are in translating those decisions into working contracts: SDK-package mapping does not establish operation or endpoint support; concurrent login methods need shared authorization-session state; the credential schema cannot express Cloudflare setup; file locking needs whole-file mutation semantics; and Radius is substantially underspecified. Several smaller omissions would break renewal, transcript replay, or provider-specific transformations. Authenticated generation and OAuth exchanges were **UNVERIFIED**; this review used source inspection and unauthenticated catalog requests without reading credentials.

## Findings

### 1. [major] SDK packages do not identify supported operations or transport routes

**Spec:** §5.1, §9.1–§9.4, §17.5, §17.8.

**Evidence:**

- Live `https://models.dev/api.json`:
  - `openrouter.npm` is `@openrouter/ai-sdk-provider`, outside the specified mapping.
  - `xai.npm` is `@ai-sdk/xai`, also outside it.
  - OpenAI entries include `text-embedding-3-small` and image models under the same provider-level `@ai-sdk/openai`.
  - None of the inspected in-scope provider model entries supplies an operation `type`.
  - Cloudflare has 27 entries, but none of the classifier entries present in pi's built-in catalog.
- `.references/pi/packages/ai/scripts/generate-models.ts:2630–2749` separately constructs classifier catalogs.
- `.references/pi/packages/ai/src/providers/openai.ts:25–31` excludes classifiers for ChatGPT credentials; this operates on an already classified catalog.

**Problem:** Applying the stated package table excludes OpenRouter, a multi-dialect provider explicitly in scope. Extending that table alone still cannot distinguish Responses-compatible generation from embeddings, image-only APIs, or classifiers. Checking only whether a dialect is registered also admits Cloudflare generation models even though Cloudflare is classify-only in §5.1. “OpenAI chat models” is not an implementable Codex eligibility rule against this metadata.

**Proposed spec change:** Define a provider-specific discovery adapter that resolves `(operation, model, supported transport routes)` before membership selection. Provider/operation overrides must precede package inference and exclusion. Explicitly cover OpenRouter, xAI/Grok, OpenAI/Codex operation filtering, and the built-in classifier additions. Treat unknown endpoint support as unresolved rather than routing every model through a provider's default dialect.

### 2. [major] Provider-wide dialect selection permits invalid model/dialect combinations

**Spec:** §9.3–§9.4, §16.2, §17.6.

**Evidence:**

- `.references/pi/packages/ai/scripts/generate-models.ts:2246–2318` selects OpenCode dialects **per model**, including protocol exceptions.
- The same generator records OpenCode Go models whose package says Anthropic but whose working endpoint uses chat completions.
- Live models.dev assigns OpenCode's `mistral-large-4` `@ai-sdk/mistral` with an OpenAI-path API URL.
- `.references/pi/packages/ai/src/providers/data/openrouter.json:1` uses `https://openrouter.ai/api` for Anthropic Messages, rather than the provider-level `/api/v1` used for chat completions.

**Problem:** §9.3 allows a request to select any dialect supported by the provider. A provider serving some models through Anthropic and others through Responses does not establish that each model supports both. Package names also identify SDK implementations, not necessarily exclusive wire protocols. Consequently, the blanket “anything else … excluded” rule can discard compatible offerings.

**Proposed spec change:** Store verified transport alternatives per model. Reject unsupported model/dialect overrides before I/O. Define base-URL semantics relative to each dialect's appended path, and apply verified routing overrides before package-based exclusion. Maintain a small compatibility manifest with evidence and regression fixtures for exceptions.

### 3. [major] Concurrent login methods need a logical login session, not independent `login(method)` calls

**Spec:** §17.5, §18.2, §28.3.

**Evidence:**

- `.references/pi/packages/ai/src/auth/oauth/openai-chatgpt.ts:230–307` creates one verifier, state, nonce, authorization URL, and loopback server, then races two ways of receiving the **same callback**.
- Its callback parser validates state and requires the issued `client_id` (`:53–79`).
- `.references/pi/packages/ai/src/auth/oauth/radius.ts:136–267` implements genuinely separate browser and device grants.
- `.references/pi/packages/ai/src/auth/oauth/callback-server.ts:67–145` distinguishes claimed, settled, cancelled, and completing callbacks.

**Problem:** The proposed `login(method, interaction) -> Credential` interface does not specify shared state for browser-plus-paste. Independent calls can create incompatible states or compete for port 1455. “First to complete wins” also leaves unclear whether a bind error cancels a still-usable device grant, whether both branches exchange the same code, and which branch may persist a credential.

**Proposed spec change:** Preserve concurrent methods, but introduce a login-session contract:

- Browser and paste share one authorization transaction and exchange a code at most once.
- Independent grants have separate protocol state.
- First successful credential wins; method-local failures do not terminate other viable methods.
- The coordinator persists only the winner.
- Cancellation closes listeners and accepted connections, aborts prompts, HTTP requests and polling timers, and joins cleanup.
- Explicitly define port-conflict, overall cancellation, timeout, and simultaneous-success behavior.

Require tests for browser/paste sharing, browser/device cancellation, and a failed browser branch with a successful device branch.

### 4. [major] Codex lacks the installation identity and grant-validation contract needed by its login flow

**Spec:** §17.5, §18.2, §28.3.

**Evidence:** `.references/pi/packages/ai/src/auth/oauth/openai-chatgpt.ts`:

- `:161–179`: validates tokens, positive expiry, and granted `chatgpt.tokens.use.direct` scope.
- `:182–206`: requires an ID token on the initial exchange.
- `:226–232`: requires a valid installation UUID.
- `:234–269`: obtains that UUID from application-supplied login options and sends a nonce.
- `.references/pi/packages/ai/src/auth/types.ts:200–216`: defines stable installation identity and application-name inputs.

**Problem:** The spec mentions `ext_agent_host_id` but neither exposes its input through `OAuthFlow` nor defines how `npcli` persists it. Generating it per login violates the reference's stable-installation contract. Requesting a scope is also insufficient if the granted response lacks it.

**Proposed spec change:** Add login context containing an application name and stable installation UUID. Specify `npcli` persistence independently of provider credentials, so logout does not regenerate it. Document callback state/origin validation, issued-client-ID validation, token-response validation, and mandatory direct-token scope checking before persistence.

### 5. [major] FileCredentialStore needs whole-file serialization and logout ordering

**Spec:** §18.1.

**Evidence:**

- The spec says mutations are “serialized per provider” and cross-process locking guards `modify`.
- `.references/pi/packages/ai/src/auth/types.ts:89–93` explicitly requires `delete` to serialize against `modify`.
- `.references/pi/packages/coding-agent/src/core/auth-storage.ts:450–483` reads, merges and writes the entire credential document under the same storage lock for both operations.

**Problem:** Per-provider locks do not prevent two processes updating different providers from replacing the same `auth.json` with conflicting snapshots. Atomic rename prevents partial JSON, not lost updates. An independently executed logout can also be overwritten by a completing refresh.

**Proposed spec change:** Require a stable, whole-file cross-process lock around the authoritative read-modify-write transaction for all mutations, including delete and initial creation. The lock must survive replacement of the data-file inode. Retain per-provider coordination only as an additional optimization. Define unchanged versus deleted callback results and require two-process tests covering different providers, refresh/logout, and login/refresh.

### 6. [major] AuthSpec, credentials, and CLI setup cannot represent all declared auth variants

**Spec:** §17.1, §17.3, §18.1–§18.2, §28.3.

**Evidence:**

- §17.1 describes `AuthSpec` as `none | env vars | static key | built-in OAuth flow`.
- §18.1 restricts API-key credentials to `{ key }`.
- `.references/pi/packages/ai/src/providers/cloudflare-auth.ts:10–66` merges key and account ID per field and prompts for both.
- `.references/pi/packages/ai/src/providers/cloudflare-stream.ts:6–19` substitutes account information into the request endpoint.
- `.references/pi-claude-auth/src/provider-auth.ts:72–114` offers manual key entry **or console OAuth followed by API-key creation**.

**Problem:** The exclusive AuthSpec description conflicts with providers exposing both OAuth and API-key variants. The API-key credential cannot persist Cloudflare account configuration, and `npcli`'s universal masked-key prompt cannot collect it. Claude's API-key creation is acknowledged in §17.4 but unreachable through the documented CLI flow: selecting API key goes straight to manual entry, while `--method` selects OAuth completion mechanics rather than key-creation intent.

**Proposed spec change:** Make provider auth a set of variants with provider-defined setup methods. Separate secrets from typed, provider-scoped configuration. Specify Cloudflare's `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID`, precedence per field, endpoint substitution and missing-account error. Add an interactive Claude manual/create-key choice and a non-interactive method selector. Successful creation must persist the returned API-key credential, not the temporary console OAuth credential.

### 7. [major] Radius needs its own provider contract, including catalog replacement

**Spec:** §9.4, §17.3, §18.2, §28.3.

**Evidence:**

- `.references/pi/packages/ai/src/providers/radius.ts:15–31`: configurable provider ID, name and gateway; a baseline only for the default gateway.
- `:28–31, 72–84`: account-specific gateway catalogs replace the baseline because organizations may disable models.
- `.references/pi/packages/ai/src/providers/radius-config.ts:5, 49–52, 79–95`: default gateway, normalization, and `GET /v1/config`.
- `.references/pi/packages/ai/src/auth/oauth/radius.ts:17–25, 40–55, 103–134, 136–267, 275–322`: browser and device flows, discovery, refresh, client and scopes.

**Problem:** “Dynamic id and catalog” does not establish how callers configure a gateway, how credentials are isolated across gateways, or how login and discovery interact. Radius is absent from the login-method table despite being the in-scope provider with both browser and device grants. Unconditional layer-3 additions can also reintroduce models disabled by an authenticated gateway catalog.

**Proposed spec change:** Add a Radius subsection specifying:

- Default gateway `https://radius.pi.dev`, configurable gateway/name/ID and URL normalization.
- `GET /v1/config`, optional bearer auth, returned request `baseUrl`, model mapping and account-specific replacement semantics.
- Default-gateway baseline as a fallback, not unconditional additions after a successful listing.
- Browser discovery through `/v1/oauth`, loopback `http://127.0.0.1:1456/oauth/callback`, PKCE S256, client `pi-gateway`, scope `gateway offline_access`, and `handoff=url`.
- Device endpoint `/v1/oauth/device`, token endpoint `/v1/oauth/token`, and 60-second expiry skew.
- CLI configuration/loading and isolated credential/cache keys for custom gateways.

The unauthenticated default-gateway probe returned HTTP 403; current public availability is **UNVERIFIED**.

### 8. [major] Listing authentication and account scope are underspecified

**Spec:** §9.4.

**Evidence:**

- Runtime refresh is limited to providers with resolvable credentials.
- `.references/pi-synthetic-auth/src/models.ts:114–126` fetches its catalog without credentials.
- `.references/pi/packages/ai/scripts/generate-models.ts:1331–1368` uses unauthenticated NVIDIA and OpenRouter listings.
- `.references/pi/packages/ai/src/providers/openrouter.ts:17–64` documents the authenticated `/models/user` mapping, including key-specific membership, prices and limits.
- Live unauthenticated observations:
  - Synthetic `/v1/models`: HTTP 200, 13 rich records.
  - NVIDIA `/v1/models`: HTTP 200, 81 identity-only records.
  - OpenRouter `/api/v1/models`: HTTP 200, 469 rich records.
  - OpenRouter `?output_modalities=decisions`: HTTP 200, 27 records.

**Problem:** Credential-gated refresh skips useful public listings. Public OpenRouter availability is not equivalent to key-authorized availability. The spec also does not define cache identity or invalidation when a provider's gateway, region or credentials change. Reusing one account's `Listed` snapshot for another can produce stale or unauthorized membership.

**Proposed spec change:** Add a per-provider listing matrix with endpoint, authentication policy, pagination, operation coverage, mapping and timeout. Distinguish public listings from account-specific listings. Scope account-sensitive caches to provider configuration and credential identity without storing token values in cache keys or logs. Define credential-change invalidation and distinguish successful empty listings from failed listings. Include OpenRouter's image/decision queries and explicitly decide whether account personalization is supported.

### 9. [major] Synthetic's tool filter contradicts the approved catalog inclusion rule

**Spec:** §9.4, §17.7; D-6.

**Evidence:**

- §9.4 explicitly keeps models without tool calling.
- §17.7 copies “skip when `supported_features` is non-empty and lacks `tools`”.
- `.references/pi-synthetic-auth/src/models.ts:62–67` contains that reference filter.

**Problem:** A text-generation model without tools is removed by the provider adapter before the unified catalog can expose it. This is an actual conflict with the approved decision, rather than a missing capability description.

**Proposed spec change:** Preserve the `always_on` availability rule, but replace the tool-based exclusion with capability mapping. Treat absent feature information according to an explicit unknown-metadata policy. Apply operation support checks independently of tool calling.

### 10. [major] Renamed subscription providers must retain protocol behavior currently keyed by provider name

**Spec:** §16.2–§16.3, §17.5, §17.8.

**Evidence:**

- `.references/pi/packages/ai/src/api/openai-responses.ts:31` declares `OPENAI_TOOL_CALL_PROVIDERS` containing `openai`, not the new `codex`.
- `.references/pi/packages/ai/src/api/openai-responses-shared.ts:176–191` uses that set to preserve and normalize composite call/item IDs.
- `.references/pi/packages/ai/src/api/openai-responses.ts:410` requests encrypted reasoning content specifically when `model.provider === "xai"`.

**Problem:** Moving ChatGPT-specific request omissions into `chatgpt_sign_in` addresses only one name-dependent branch. A literal port would normalize Codex composite IDs through the generic path and omit xAI's unconditional encrypted-reasoning inclusion for Grok. Both affect multi-turn replay.

**Proposed spec change:** Require an audit of provider-name-dependent behavior when implementing the approved splits. Express these behaviors as explicit protocol settings or include both provider IDs where appropriate. Add multi-turn tool-result tests for Codex and reasoning-replay tests for Grok, including the no-explicit-effort case. Preserve Responses session-affinity headers through the existing compatibility setting.

### 11. [major] Claude tool renaming omits native tool additions and historical definitions

**Spec:** §17.4, also §12.4's native tool-change contract.

**Evidence:**

- `.references/pi/packages/ai/src/api/anthropic-messages.ts:1378–1399` emits `tool_addition.tool.definition` and `tool_removal.tool`.
- `.references/pi-claude-auth/src/transform.ts:351–397` rewrites request-level tools, tool choice, tool-use blocks and selected references, but does not implement those native addition/removal forms.
- `.references/pi-claude-auth/src/transport.ts:6–20` builds its reverse map from current tools and historical assistant calls.

**Problem:** The spec adds removal mapping but omits addition definitions. A newly introduced tool can therefore be defined under one name and referenced under another. Current tools plus assistant calls also miss historical definitions that were removed before being called; those definitions still appear in native tool-history requests and can participate in naming collisions.

**Proposed spec change:** Define one request-wide mapping over every emitted tool definition and reference, including native additions, redefinitions, removals, forced selection, tool-use blocks and deferred references. Validate collisions across that complete set. Label native change support as a deliberate extension beyond the current Claude wrapper, and test add/call/remove/redefine replay.

### 12. [major] Grok refresh must preserve an omitted refresh token

**Spec:** §17.8, §18.1.

**Evidence:**

- `.references/pi/packages/ai/src/auth/oauth/xai.ts:132–146` retains the previous refresh token when xAI omits `refresh_token`.
- `:173–202` handles pending, slowdown and both denial spellings.
- `.references/pi/packages/ai/src/auth/oauth/device-code.ts:5–10, 54–106` defines default polling and slowdown behavior.

**Problem:** §17.8 lists grant types and expiry defaults but omits the non-rotating refresh response rule. A generic “replace credential from token response” implementation will reject a valid refresh or lose the only refresh token.

**Proposed spec change:** Explicitly require preserving the previous refresh token only when the response omits it, while validating any supplied replacement. Include verification-URI HTTPS validation, default five-second polling, expiry/cancellation handling, initial wait for xAI and `slow_down` behavior. Clarify that provider expiry skew and the resolver's five-minute refresh trigger are separate, cumulative margins.

### 13. [major] Remote metadata must not silently expand where credentials may be sent

**Spec:** §9.4, §17.1.

**Evidence:** §9.4 accepts live per-model API URLs from a third-party catalog and places them into resolved models used with provider credentials. OpenCode demonstrates that these URLs can differ substantially from the provider's compiled endpoints. The reference generator instead chooses OpenCode base paths explicitly in `.references/pi/packages/ai/scripts/generate-models.ts:2252–2287`.

**Problem:** The proposed refresh path makes mutable metadata a request-destination authority. An erroneous or compromised upstream entry could direct provider bearer credentials to an unrelated origin. Correct TLS alone does not establish that this origin is authorized to receive those credentials.

**Proposed spec change:** Treat discovered URLs as candidates validated against provider-owned endpoint rules. Built-ins should constrain allowed origins and supported path families. Cross-origin overrides require explicit application/user configuration. Define equivalent trust rules for Radius-discovered request endpoints and authenticated redirects. Reject unsafe routes before catalog publication or credential attachment.

### 14. [minor] Claude's exact billing, sanitization and cache behavior needs a normative description

**Spec:** §17.4.

**Evidence:**

- `.references/pi-claude-auth/src/cch.ts:12–66` distinguishes two hashes:
  - `cch`: first five hex characters of SHA-256 of the selected user text.
  - Version suffix: first three hex characters of SHA-256 of salt, sampled characters and version.
- `.references/pi-claude-auth/src/transform.ts:497–529` also removes the OpenCode identity paragraph and one exact pi identity paragraph.
- `:543–585` preserves existing system-block properties.
- `:608–631` prepends new billing/identity blocks without cache markers.
- `.references/pi/packages/ai/src/api/anthropic-messages.ts:1227–1252` supplies cache markers on the original system prompt.

**Problem:** The current sentence can be read as applying the salt and sampled positions to `cch` itself. It omits identity-paragraph removal and does not say whether transformations preserve cache markers. A rewrite that reconstructs text-only system blocks loses caching behavior; copying pi's separate built-in OAuth identity behavior would also diverge from this extension.

**Proposed spec change:** State both hash formulas, first-user/first-text-block selection, missing-character fallback and no-user behavior. Preserve JavaScript string-index semantics for suffix sampling, with Unicode fixtures for the Rust port. Specify the complete sanitizer and preserve existing `cache_control` properties while leaving newly prepended billing/identity blocks unmarked. State that these OAuth transformations are bypassed for ordinary API-key credentials.

### 15. [minor] OpenCode identifiers are a custom format, not standard ULIDs

**Spec:** §17.6.

**Evidence:** `.references/pi-opencode-auth/src/identifier.ts:1–41` constructs a 26-character value from twelve hexadecimal characters and fourteen base62 characters. The timestamp portion incorporates a counter and is complemented for descending session identifiers.

**Problem:** “ULID” naturally suggests a standard Crockford-base32 ULID implementation, which does not reproduce this format. The spec also leaves the stable session mapping implicit despite hooks being request-scoped.

**Proposed spec change:** Call this the “OpenCode native identifier format” and specify the reference encoding rather than relying on the ULID name. Define ownership of the stable session identifier, behavior when no application session ID exists, and per-request identifier generation. Include format and session-stability tests.

### 16. [minor] Price enrichment needs missing-value semantics and provider-specific unit parsing

**Spec:** §9.1, §9.4, §17.7.

**Evidence:**

- Live models.dev contained pricing for 49 of 53 OpenAI entries, 8 of 13 xAI entries and 383 of 387 OpenRouter entries.
- `.references/pi-synthetic-auth/src/models.ts:34–41` parses strings using a heuristic: values below `0.001` are multiplied by one million; larger values are retained.
- `.references/pi/packages/ai/src/providers/openrouter-api.ts:31–73` handles per-token strings, negative router-price sentinels and conditional overrides.
- The live Synthetic listing returned string prices, including dollar-prefixed per-token values.

**Problem:** “Per-token → per-million normalization” does not fully describe the referenced Synthetic parser. More generally, the field-precedence rule cannot preserve models.dev fallback prices if an adapter eagerly converts missing provider prices to zero. Unknown pricing is not free pricing.

**Proposed spec change:** Keep fields optional during discovery merge. Define unknown versus explicit zero in the published pricing contract. Specify exact per-provider price units and supported forms; use the reference heuristic only where required by verified fixtures. Preserve fallback metadata for absent provider fields and document unsupported conditional pricing.

### 17. [minor] Z.AI has an unresolved endpoint mismatch outside the documented OpenCode exception

**Spec:** §9.4, §17.3.

**Evidence:**

- Live `models.dev/api.json`: `zai.api = https://api.z.ai/api/paas/v4`.
- `.references/pi/packages/ai/src/providers/zai.ts:10`: `https://api.z.ai/api/coding/paas/v4`.

**Problem:** The metadata source and the cited provider implementation select different API routes. The spec calls out this class of mismatch for OpenCode but does not settle Z.AI's route. Credential compatibility and billing implications of choosing either route were **UNVERIFIED**.

**Proposed spec change:** Explicitly select and document Z.AI's intended endpoint and credential product. Encode that selection as a provider override with a request-routing test; do not let metadata refresh silently change it.

### 18. [minor] CLI secret and status semantics need tightening

**Spec:** §18.1, §28.3.

**Evidence:**

- §28.3 exposes `--api-key <key>`.
- `.references/pi/packages/ai/src/auth/types.ts:36–40, 64–70` separates non-secret credential enumeration from resolution.
- `.references/pi/packages/ai/src/auth/resolve.ts:154–185` may refresh during resolution.

**Problem:** Command-line key arguments can leak through shell history and process inspection despite redacted `Debug`. “Whether a credential resolves” also makes `provider list` potentially perform OAuth refreshes, whereas users may expect status inspection. Logout removes stored credentials but can leave environment authentication active.

**Proposed spec change:** Prefer masked input and `--api-key-stdin`; remove the argv secret form or document its exposure explicitly. Define list output in terms of configured source, expiry and status without exposing credentials, with an explicit option for network validation if desired. State that logout deletes local credentials only and report any remaining environment-backed access.

## Verification scope and limits

- Read the requested spec sections, applicable workspace guidance, provider/auth sources, provider-specific extensions, attribution code and catalog generator.
- Queried `https://models.dev/api.json` successfully with `curl` and inspected provider coverage, package/API fields, operation ambiguity, pricing presence and modality fields.
- All mapped in-scope metadata IDs were present. `typesafe` and `radius` were absent, as the spec states. Per-model `provider` objects were present for all inspected OpenCode and OpenCode Go entries and absent for the other inspected providers.
- Unauthenticated model-list probes returned:
  - **200:** Synthetic, NVIDIA, OpenRouter general and decision listings.
  - **401:** OpenAI, Anthropic, xAI, DeepSeek and Z.AI.
  - **403:** OpenCode, OpenCode Go and Radius.
- These status codes do not establish authenticated endpoint behavior or whether a 403 originated at application or edge policy. A later Python `urllib` request to models.dev also returned 403 after successful `curl` inspections.
- **UNVERIFIED:** authenticated listing schemas for the 401/403 providers, current subscription model entitlements, all OAuth exchanges, generation requests, and universal dual-dialect support for every Synthetic model.
- No files, credentials, git state or installed packages were changed. No implementation tests were run.

## Facts verified as correct

- Claude's client ID, authorization/token/callback URLs, scopes, 64-byte PKCE verifier generation, required beta union, bearer header, user-agent format, version setting and refresh retry schedule match the extension.
- Codex correctly targets the new ChatGPT sign-in flow at `api.openai.com/v1` through Responses. Dynamic client registration, callback port, resource, scopes and stored client-ID refresh match the reference. Its request-field omissions and usage-limit enrichment are correctly identified; the new path does not add the legacy Codex-specific headers.
- Grok's client ID, device/token endpoints, scopes, default lifetime and five-minute provider expiry skew match xAI's OAuth implementation.
- OpenCode's spoof header names/values and literal anonymous bearer `public` match the extension. OpenCode Go is registered with key auth and receives no anonymous registration.
- Synthetic's listing URL, five-second timeout, reference four-hour TTL and stored-key-before-environment resolution are correct.
- Stored credentials taking precedence over ambient auth, no environment fallback after failed refresh, double-checked refresh locking and a caller-independent 15-second refresh operation match `auth/resolve.ts`.
- OpenRouter routing compatibility is already included in §16.2. Its attribution headers are application-level and telemetry-gated in `.references/pi/packages/coding-agent/src/core/provider-attribution.ts:39–48`; they should not be treated as mandatory authentication headers.
- A committed, offline baseline is feasible with the approved metadata strategy, provided operation/routing adapters and explicit built-in additions supply the information absent from models.dev.