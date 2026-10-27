---
document:
  type: "specification"
  id: "SPEC-0001"
  title: "nukular-ai architecture, public API, and initial scope"
  description: "Excerpt from SPEC-0001 covering provider architecture sections 17.4–17.8."
  status: "published"
  revision: 18
  created_at: "2026-10-20T11:10:04+02:00"
  created_by: "Furby Haxx"
  updated_at: "2026-10-27T10:00:06+01:00"
  updated_by: "pi"
  source: "nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/specs/0001-nukular-ai-architecture.md"
  changelog:
    - revision: 17
      reason: "5A contract preparation"
      changes: ["Settle the credential-kind type, accessor and serialization policy", "Pin anthropic-version 2026-10-21 and default supports_temperature to false", "Complete the Anthropic compat field list and terminal reasons", "Refresh 17.4 against pi-claude-auth b489042"]
    - revision: 16
      reason: "Apply approved provider-plan review and explicit Google legacy support"
      changes: ["Require independent Anthropic API-key and Claude OAuth acceptance with user-confirmed access", "Add the planned non-secret credential-kind seam and complete 5A contract inventory", "Commit GenerateContent support for explicit selection and verified proxy bindings; prefer Interactions for direct Google and conditionally Antigravity"]
    - revision: 15
      reason: "Record the user-selected provider expansion order"
      changes: ["D-85: Anthropic and Claude first, OpenAI and Codex next, Google afterward", "Prioritize Google Interactions and assess GenerateContent separately", "Link bounded step-5 scoping without claiming implementation"]
    - revision: 14
      reason: "Close step 4 with explicit OpenCode inference deferral"
      changes: ["Record D-84 user decision and revised live acceptance scope", "Accept M7 after OpenRouter generation 4/4 and native classification 1/1", "Preserve OpenCode failures as deferred evidence without claiming access or entitlement"]
    - revision: 13
      reason: "Record real OpenRouter stored-key acceptance and persistent OpenCode quota blocker"
      changes: ["M4 accepted through Browser-mode pasted completion, restart, inference and local logout", "All-provider discovery passes on rerun", "Step 4 remains in progress only for blocked OpenCode inference revalidation"]
    - revision: 12
      reason: "Synchronize step-4 classifier integration and bounded acceptance status"
      changes: ["Sync all 314 source files in §7", "Clarify generated-classifier control isolation, header precedence and revalidation", "Record M4/M7 human and quota blockers without claiming completion"]
    - revision: 11
      reason: "Close step-4 M3"
      changes: ["§16.2 reasoning_replay_recovery and M3 compat matrix row", "D-83 replay recovery", "D-81 amended: M3 adds the embeddings and decisions listings"]
    - revision: 10
      reason: "Named required tool with default placeholder injection"
      changes: ["§15 and §17.6: required_tool replaces requires_tools; placeholder injected by default, placeholder_tool(false) opts out", "D-82", "§17.1 SseDecoder accept_unterminated_final and EOF dispatch"]
    - revision: 9
      reason: "Record step-4 M2 discovery, hook and OpenCode decisions"
      changes: ["§9.4 listing rows and wiring paragraph", "§17.6 built-in hook slot and anonymous OpenCode without Authorization", "§17.7 Synthetic listing URL and name fallback", "D-81, V-24"]
    - revision: 8
      reason: "Record the published step-4 contracts"
      changes: ["Update compat, sampling, response-schema, hook, identity, registration and listing contracts", "Record user-selected implicit OpenRouter affinity and public custom listing registration", "Specify classifier methods, optional answer evidence and logprob scoring", "Add login-mode API and CLI behavior", "Replace the earlier required ClassifyAnswer probability/confidence fields and deferred response-schema design with the approved contracts"]
    - revision: 7
      reason: "Add logprob classification requirements and select OpenRouter PKCE login"
      changes: ["Distinguish measured label logprobs from generated confidence and require route-level capability evidence", "Use OpenRouter authorization-to-key login for step 4 without inventing refresh-token coverage"]
    - revision: 6
      reason: "Select step-4 provider targets and correct prompted-classification intent"
      changes: ["Replace direct OpenAI embedding coverage with OpenRouter and pin generation, embedding and native JEv targets", "Distinguish prompted classification over ordinary inference from native Decisions; require its design in step 4 without claiming implementation"]
    - revision: 5
      reason: "Clarify foundation contracts after the step-3b review"
      changes: ["Specify retained buffered accounting, credential completion records, account-aware preparation and bounded executor suspension", "Preserve schema scope and opaque extension values, and clarify cache equality and request-size enforcement"]
    - revision: 4
      reason: "Sync module layout and mark step 3b done"
      changes: ["Synchronize §7 with the source tree and record step-3b completion in §25"]
    - revision: 3
      reason: "Clarifications from step-3b planning"
      changes:
        - "Add §23.1 revision 3 clarifications C-1–C-33 (plan 0002 decisions and user decisions)"
        - "Prelude failure/resource exports, buffered-output and input-capability feature setters, provider-data timer and budget keys"
        - "Define structural inline-image validation as the §9.1 decode check"
    - revision: 2
      reason: "Integrate third-party architecture review"
      changes:
        - "Complete downstream executor transport and authoritative sink contracts"
        - "Specify credential-work shutdown, request deadlines, failure metadata and resource budgets"
        - "Clarify schema projection, input representations, usage provenance and embedding identity"
        - "Bound catalog caches, define gateway-frame handling and retain explicit scope boundaries"
        - "Add source evidence, revision decisions and acceptance tests"
        - "Synchronize revision 1 step-3 remediation through commits f5302f0 and 265f9d5"
        - "Reconcile cache hydration and credential lineage with revision 2 capacity, shutdown and execution controls"
        - "Publish revision 2 in place of revision 1; add step 3b to the roadmap"
    - revision: 1
      reason: "document creation"
      changes: ["document creation"]
    - revision: 18
      reason: "imported into pi-auth-plus"
      changes: ["copied from nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/specs/0001-nukular-ai-architecture.md"]
---
This is an excerpt of SPEC-0001 §17.4–17.8.

### 17.4 `claude` (from pi-claude-auth)

- **OAuth** (`src/constants.ts:1-20`, `src/auth.ts`, `src/pkce.ts`, `src/provider-auth.ts`): client id `9d1c250a-e61b-44d9-88ed-5944d1962f5e`; authorize `https://claude.ai/oauth/authorize` (max) or `https://platform.claude.com/oauth/authorize` (console); callback `https://platform.claude.com/oauth/code/callback`; token `https://platform.claude.com/v1/oauth/token`; scopes `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`; PKCE S256 (64 random bytes), state = UUID without dashes; callback accepted as URL, `code#state`, or query string; refresh with up to 3 attempts (500 ms, 1 s backoff, retry on 5xx/network). Optional API-key creation via `https://api.anthropic.com/api/oauth/claude_cli/create_api_key`.
- **Headers:** `authorization: Bearer <access>`; `anthropic-beta` = union of `oauth-2025-04-20`, `interleaved-thinking-2025-05-14` and requested betas; `user-agent: claude-cli/<version> (external, cli)`; `x-app: cli`; no `x-api-key` (`src/transform.ts:330-344`).
- **URL:** `?beta=true` on `/v1/messages`; `ANTHROPIC_BASE_URL` overrides protocol + host (`src/transform.ts:415-499`).
- **Setup variants:** OAuth subscription login (max; console authorization route where selected) is distinct from API-key setup: `manual` (enter key) or `create` (console OAuth, then POST `https://api.anthropic.com/api/oauth/claude_cli/create_api_key`). `create` validates nonempty `raw_key` and persists **only that API key**, never the temporary console OAuth tokens (`.references/pi-claude-auth/src/provider-auth.ts:66-124`). Plain API-key credentials bypass all OAuth identity/billing/header/URL/tool transformations in this subsection; ordinary Anthropic key behavior applies.
- **System:** layout `[billing block, identity block, …sanitized system]`; no billing block when there is no user message (`.references/pi-claude-auth/src/transform.ts:605-629`). Identity: `You are a Claude agent, built on Anthropic's Claude Agent SDK.` Existing system block fields, including `cache_control`, survive sanitization; newly inserted identity/billing blocks carry **no** cache marker (`transform.ts:541-592,623-627`).
- **Billing formulas:** select the **first user message**, then its string content or **first text block**, without searching later blocks/messages for nonempty text. Missing text is `""`. `cch = hex(SHA256(UTF8(text)))[0..5]`; `suffix = hex(SHA256(UTF8("59cf53e54c78" + sample + version)))[0..3]`, where `sample` concatenates zero-based JS **UTF-16 code units** at 4, 7, 20, substituting literal `"0"` for each absent unit. Encode sampled lone surrogates as U+FFFD, as Node's UTF-8 hashing does. Header: `x-anthropic-billing-header: cc_version=<version>.<suffix>; cc_entrypoint=sdk-cli; cch=<cch>;` (`.references/pi-claude-auth/src/cch.ts:12-66`, `constants.ts:33-34`). No-user requests omit billing rather than hashing empty text; a user without text hashes empty text.
- **Billing fixtures:** reference execution at version `2.1.306`: `""` → `e3b0c` / `dcf`; `"abc"` → `ba781` / `dcf`; `"abcd𝄞zXabcdefghijklmnY"` → `fa63e` / `63f`; `"abcdéfg中ijklmnopqrstZ"` → `580bb` / `a98` (`cch` / suffix); wire snapshot `cc_version=2.1.306.813; cc_entrypoint=sdk-cli; cch=185f8;` (`tests/__snapshots__/transform.test.ts.snap:146-152`). Include first-user/first-text-block and no-user wire fixtures; Unicode scalar indexing is incorrect.
- **Sanitizer:** split paragraphs on `/\n\n+/`; remove paragraphs starting with a harness identity prefix (`You are OpenCode`, `You are an expert coding assistant operating inside`, ``You are operating inside `Pi` ``) or containing an anchor (`github.com/anomalyco/opencode`, `opencode.ai/docs`, `github.com/opensec-git/Pi-Bolt`, `earendil-works/pi`, `pi-coding-agent`; a bare `pi` is never an anchor) (`constants.ts:43-47,96-107` at `b489042`). Then apply the provider setting `replace_patterns` (port of `claude.replacePatterns`, `src/settings.ts`): literal matches, an entry with `replacement` rewrites inline, one without drops the paragraph; malformed entries fail setting validation. Rejoin with two newlines, apply each literal replacement once (`if OpenCode honestly` → `if the assistant honestly`; `Here is some useful information about the environment you are running in:` → `Environment context you are running in:`), then trim (`.references/pi-claude-auth/src/transform.ts:501-529`, `constants.ts:29,71-119`). The wrapper attributes a disguised usage error to the latter phrase; current server behavior **UNVERIFIED**.
- **Tools:** one request-wide forward/reverse map covers **every emitted definition and reference**: current/historical definitions (even removed-before-called tools), native additions/redefinitions/removals, forced selection, tool-use blocks and deferred references. Names become `mcp_` + uppercased first character; restore exact original names in responses. Reject collisions over the complete set before I/O; retain `StructuredOutput` restoration special case. Native tool-change support is a **nukular extension** beyond `.references/pi-claude-auth/src/transform.ts:351-397`; the wrapper's reverse map uses current tools and historical calls (`transport.ts:6-20`), insufficient for native history.
- **Version:** reported Claude Code version (default `2.1.306`, `src/constants.ts:68` at `b489042`) is used for both user agent and billing header; override `ANTHROPIC_CLAUDE_CODE_VERSION` (`src/config.ts`) — exposed as a provider setting. The reference's detection of a newer installed `claude --version` (`config.ts:149-179`) is not ported: the library spawns no processes; the setting covers it.
- **Catalog:** models.dev id `anthropic` plus the additions from `src/provider.ts:33-85`. The reference reports zero cost for OAuth credentials (`src/provider.ts:12,94,109-111`); nukular reports list prices by default (D-26).
- **Not ported:** `ANTHROPIC_INSECURE` (Bun-only).

### 17.5 `codex` (Sign in with ChatGPT)

- OAuth (`src/auth/oauth/openai-chatgpt.ts`): dynamic client registration (`client_id: dynamic_agent_client`, issued id returned in the callback), authorize `https://auth.openai.com/api/accounts/authorize`, token `https://auth.openai.com/api/accounts/oauth/token`, `resource=https://api.openai.com/v1`, loopback callback `http://127.0.0.1:1455/auth/callback`, scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, PKCE S256, `agent_name_hint` + `ext_agent_host_id=urn:uuid:<device id>`, 3-minute refresh margin, refresh with stored `client_id` + `resource`.
- Requests: `openai-responses` against `https://api.openai.com/v1/responses` with `chatgpt_sign_in = true` (§16.3); usage-limit error enrichment (`openai-responses.ts:34, 257`).
- Validate callback state and exact loopback origin/path for pasted URLs; accept only nonempty authorization code and callback-issued `client_id` (not `dynamic_agent_client` as the stored client). Bind only the loopback listener; reject unrelated routes/invalid callbacks without claiming the transaction. Browser and paste share verifier/state/nonce/URL and exchange at most once (§18.2). Initial exchange requires nonempty ID token (presence only, not a source of profile identity), access/refresh tokens, finite positive `expires_in`, and a granted scope list containing `chatgpt.tokens.use.direct`; refresh also validates access/refresh/expiry/scope and uses the stored issued client ID. Persist only after all validation (`.references/pi/packages/ai/src/auth/oauth/openai-chatgpt.ts:52-79,161-307`).
- Login context supplies application name and stable installation UUID for `agent_name_hint` and `ext_agent_host_id=urn:uuid:<lowercase UUID>`; generate a fresh nonce per authorization transaction, never a fresh installation UUID per login (`openai-chatgpt.ts:226-269`; §18).
- Catalog eligibility/bindings follow §9.4's Codex adapter; do not infer eligibility from “chat models.” Classifiers excluded (Decisions rejects ChatGPT tokens, `.references/pi/packages/ai/src/providers/openai.ts:25-27`). Usage is priced at list prices by default (D-26).

### 17.6 `opencode` and `opencode-go` (from pi-opencode-auth)

- Catalog bindings are per model; apply §9.4's evidence-backed manifest before package inference (`.references/pi/packages/ai/scripts/generate-models.ts:2246-2318`). Anthropic bases omit `/v1`, Responses/Completions bases include it. Go's Qwen package exceptions use Completions, not Anthropic. Current live route execution **UNVERIFIED**; do not copy the generator's tool-capability inclusion filter.

- pi-ai providers: `src/providers/opencode.ts:13-27`, `opencode-go.ts:11-23`; base URLs per model (`https://opencode.ai/inference`, `/inference/v1`, `/inference/go`, `/inference/go/v1`); `x-opencode-session` per session (`opencode-headers.ts:19-26`).
- Free-model identity headers: `User-Agent: opencode/1.18.18`, `x-opencode-client: cli`, `x-opencode-project: global`, `x-opencode-session: ses_<native identifier>`, `x-opencode-request: msg_<native identifier>` (`.references/pi-opencode-auth/src/spoof.ts:19-56`). Built-in hooks are installed for the built-in provider in a crate-private built-in slot that runs before a user's `provider_hooks` for the same provider (`begin`, `prepare`, `response_head` and `map_event` all run built-in first), so user hooks stay available on built-ins; static identity headers are provider-spec headers. This provider trigger is a **nukular adaptation**, whereas the reference triggers on presence of `x-opencode-client` or `x-opencode-session` marker headers (`spoof.ts:32-42`). It grants no extra credential destination trust (§9.4). Client version is a provider setting.
- **OpenCode native identifier format**, not a standard ULID: 26 characters = 12 lowercase hex + 14 base62 (`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`). Incorporate the per-timestamp incrementing counter: `current = timestamp_ms * 0x1000 + counter` (counter starts at 1, resets when timestamp changes); encode the low six bytes big-endian, bitwise-complemented for descending session IDs, unchanged for ascending request IDs. Append 14 random bytes mapped modulo 62 (`.references/pi-opencode-auth/src/identifier.ts:7-41`).
- OpenCode hooks map `(client session, explicit session)` to a memoized native `ses_` ID and each logical `RequestId` to a native `msg_` ID using the identifier algorithm above. The client session is stable across clones; explicit `GenerateSettings::session_id` distinguishes application sessions without sending the caller's ID as the native value. Retries reuse both IDs; each new logical operation gets a new request ID. Embed/classify have no explicit session. Test format, counter/complement encoding, session isolation/stability and per-request freshness.
- The free tier accepts a request only when it declares a function tool named `read` with nonempty `parameters.properties` (live ablation, `../plans/0004-step-4-horizontal-slice/evidence/m2-live-acceptance.md` D1). The free OpenCode binding declares `GenerateBinding::required_tool("read")`, without a provider-name check, so by default the pipeline injects a `read` placeholder when the request lacks one (user decision 2026-10-22, D-82). `placeholder_tool(false)` opts out and fails before auth with `SettingsError::ToolsRequired`. A model call to the injected placeholder is a typed protocol error, never a caller tool call. Prompt tokens count toward usage/cost, and docs must disclose that it changes the prompt (§15).
- OpenRouter `x-session-id` affinity is gated by `send_session_affinity_headers`; its value is the explicit session ID when set, otherwise the implicit client session. Callers can disable affinity through compat or remove the header. This intentionally differs from pi, which sends affinity only for explicit sessions (V-23).
- Anonymous access: when no credential resolves, `opencode` sends no `Authorization` header. Live evidence showed no header, `Bearer public` and a real key all pass the free tier (`../plans/0004-step-4-horizontal-slice/evidence/opencode-free-tier-gate.md`), so the reference's `Bearer public` fallback (`pi-opencode-auth/index.ts:16-40`) is not copied. Configured credentials always take precedence. `opencode-go` has no anonymous access (it is a paid plan); it requires `OPENCODE_API_KEY` or a stored key.

### 17.7 `synthetic` (from pi-synthetic-auth)

- Auth: stored key, then `SYNTHETIC_API_KEY` (`src/auth.ts:6-42`).
- Dialects: `anthropic-messages` at `https://api.synthetic.new/anthropic` (reference default) and `openai-completions` at `https://api.synthetic.new/openai/v1` (Synthetic API docs, <https://dev.synthetic.new/docs/api/overview>). No compat overrides in the reference.
- Public layer-1 listing: `GET https://api.synthetic.new/openai/v1/models` (reference URL `/v1/models` rewrites to it), 5 s timeout (`.references/pi-synthetic-auth/src/constants.ts:3-7`); reference TTL 4 h, library scheduling follows §11.1. Retain `always_on === true`; map `supported_features` into tool/reasoning capabilities without tool-based exclusion (deliberate D-6 divergence from `src/models.ts:62-67`). Missing features are unknown, not false; enrich from models.dev. Positive `context_length`/`max_output_length`, image input from `input_modalities`, name fallback `display_name ?? name ?? hugging_face_id ?? id` (nukular adds `display_name` so an alias such as `syn:small:text` is not labelled with its current target; reference `src/models.ts:69-106`). Universal dual-dialect and embedding support **UNVERIFIED**; only publish verified per-operation bindings.
- Pricing fields: `pricing.{prompt,completion,input_cache_reads,input_cache_writes}`. Reference `parsePrice` (`.references/pi-synthetic-auth/src/models.ts:34-41`) extracts the first decimal from a string, multiplies values below `0.001` by 1,000,000, retains larger values, and returns zero on failure. This is a magnitude heuristic, not unit-aware parsing. Our parser uses explicit per-token/per-million units where supplied; the heuristic is limited to captured legacy unitless formats with fixtures, never generalized across providers. Missing/invalid/ambiguous units remain unknown through merge (§9.4); explicit zero remains zero. Successful empty always-on listing is empty, unlike the reference's throw-on-empty; failure retains previous provider entries.
- Web search (`src/web-search.ts`) is an application tool, not a provider feature; not ported into the library (an example may show it).

### 17.8 `grok` (xAI subscription OAuth)

- Device-code flow (`src/auth/oauth/xai.ts`, `device-code.ts`): client id `b1a00492-073a-47ea-816f-4c329264a828`, scopes `openid profile email offline_access grok-cli:access api:access`, device code `https://auth.x.ai/oauth2/device/code`, token `https://auth.x.ai/oauth2/token` (`grant_type=urn:ietf:params:oauth:grant-type:device_code`, then `refresh_token`), 5-minute refresh skew, default lifetime 3600 s.
- On refresh, retain the previous refresh token **only** if `refresh_token` is omitted; reject supplied empty/non-string replacements, including null. Initial exchange requires it. Access token must be nonempty; supplied expiry must be finite and positive, omitted expiry defaults to 3600 s (`.references/pi/packages/ai/src/auth/oauth/xai.ts:132-146`).
- Validate both verification URI forms as HTTPS before exposing/opening them. Poll at the supplied positive interval or 5 s default, minimum 1 s; wait before the first xAI poll. `authorization_pending` continues; `slow_down` uses a valid positive server interval or adds 5 s; both `access_denied` and `authorization_denied` terminate. Enforce device expiry and cancellation on waits/HTTP (`.references/pi/packages/ai/src/auth/oauth/xai.ts:113-202`, `device-code.ts:5-106`).
- Provider skew is subtracted from recorded expiry; the resolver's 5-minute refresh trigger is **additional**, not the same margin (Grok normally refreshes 10 minutes before actual expiry; Codex 8 minutes; Radius 6 minutes). Default trigger causes one refresh, not a loop demanding five minutes of post-refresh validity; an explicit caller minimum must be checked after refresh (`.references/pi/packages/ai/src/auth/resolve.ts:161-186`).
- Requests use the same `openai-responses` dialect and base URL `https://api.x.ai/v1` as `xai`; the catalog comes from models.dev id `xai` plus built-in overrides for subscription availability. Live login, refresh and subscription entitlements **UNVERIFIED**.

---

