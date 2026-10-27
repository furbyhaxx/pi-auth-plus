---
document:
  type: "analysis"
  id: "pi-antigravity-auth-inventory"
  title: "pi-antigravity-auth: what to port, drop or rework for pi-auth-plus"
  description: "Feature inventory of the @furbyhaxx/pi-antigravity-auth fork 3.0.12 against the agy 1.4.8 dossier, with UX/architecture conflicts, open decisions and gaps"
  status: "published"
  revision: 1
  created_at: "2026-10-27T11:27:03+01:00"
  updated_at: "2026-10-27T11:27:03+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Initial inventory. Nothing ported; decision material for a review session."]
---

# pi-antigravity-auth inventory

Sources: fork at `/mnt/Projects/furbyhaxx/pi-antigravity-auth` (v3.0.12, branch `dev`, HEAD `b04d594`);
`agy` dossier at `.project/analyses/antigravity-cli/1.4.8/` (paths below are relative to that dir).
"Unverified" marks an inference this pass did not prove on the wire or by running the fork.

## 1. What the fork is

A single flat Pi package that serves Antigravity (Gemini 4 Argon, Gemini 3.8 Flash, Claude 5.5,
GPT-OSS 120B) as Pi provider **`google`**, plus a Claustrum vault mode that serves the same models
from a remote account the vault operator approves. `src/` 13,369 LOC, `tests/` 17,584 LOC.
Runtime deps: `@cortexkit/common-auth` 0.26.0, `@cortexkit/claustrum-client` 0.12.0,
`@cortexkit/subc-client` 0.22.5 (the last is named only in a comment,
`src/core/common-auth-runtime.ts:17`). Dev types pin Pi 1.3.0 (`package.json`), one minor behind our target.

| area | files | LOC |
|---|---|---|
| streaming + request conversion | `src/stream.ts`, `src/convert.ts`, `src/core/agy-request-metadata.ts` | 1,379 |
| raw TLS transport + timeouts | `src/core/agy-transport.ts`, `fetch-timeout.ts`, `pre-response-deadline.ts`, `abort-forwarding.ts` | 957 |
| OAuth, project discovery, UA | `src/core/antigravity/oauth.ts`, `project.ts`, `fingerprint.ts`, `constants.ts`, `auth.ts` | 1,258 |
| model catalog | `src/core/model-registry.ts` | 558 |
| transforms (≈330 live: `toGeminiSchema`) | `src/core/transform/*` | 2,287 |
| Claustrum vault custody | `src/vault-setup.ts`, `vault-source.ts`, `core/vault-*` | 2,600 |
| account-store/pool vestige | `src/core/account-*.ts`, `quota-presentation.ts`, `quota-types.ts` | 2,340 |
| `/antigravity` menu | `src/commands.ts`, `core/antigravity-command-menu.ts` | 711 |
| plumbing (redact, logger, atomic write, dep loaders, barrel) | `src/core/*` | 689 |

Measured dead weight: the transform tree is imported only through the barrel
(`src/core/index.ts`), and `applyClaudeTransforms`, `applyGeminiTransforms`,
`sanitizeCrossModelPayloadInPlace`, `resolveModelWithTier`, `resolveModelWithVariant`,
`normalizeGeminiTools`, `wrapToolsAsFunctionDeclarations` have **no caller outside
`src/core/transform/`** (grep over `src/`). `account-repository-types.ts` (1,041) and
`quota-presentation.ts` (100) are reached only by the unused repository branch of the menu
(`src/core/antigravity-command-menu.ts:24-33`, `:263-265`).

## 2. Feature inventory

Paths relative to the fork root. "CLI" cites the 1.4.8 dossier.

| feature | where | LOC | real CLI does this? | rec | reason |
|---|---|---|---|---|---|
| provider registered as `google`, `api: google-generative-ai`, baseUrl `cloudcode-pa` | `src/index.ts:246-330`, `core/constants.ts:136` | 90 | 04-api §4 (host), 03-models | **rework** | id must be `antigravity`; today it replaces Pi's builtin Google catalog |
| consumer OAuth client, PKCE S256, `prompt=consent`, `access_type=offline` | `core/antigravity/oauth.ts:154-176` | 40 | 02-auth §2 ✓ | keep | matches; client id is the same constant |
| client secret as a source constant | `core/constants.ts:13` | 1 | 02-auth §3 ✓ (public installed-app component) | keep | protocol constant; document it in NOTICE |
| redirect `http://localhost:51121/oauth-callback` + manual paste | `core/constants.ts:29`, `src/index.ts:52-77` | 30 | 02-auth §2: remote `https://antigravity.google/oauth-callback`, loopback "will be rejected" | **rework** | direct contradiction with the dossier; see D10 |
| scope set (5) | `core/constants.ts:18-24` | 7 | 02-auth §4 (7: adds `aicode`, `openid`) | **rework** | missing two scopes the CLI always sends |
| refresh + expiry | `core/antigravity/oauth.ts:79-113` | 35 | 02-auth §6 ✓ (`expires_in 3599`) | keep | |
| refresh string packed as `refresh\|projectId\|managedProjectId` + in-process map | `core/auth.ts:12-31`, `src/credential-cache.ts` | 60 | CLI keeps its own token file (02-auth §6) | **decide** | Pi's `OAuthCredentials` is a fixed shape; needs a stored-format decision (D7) |
| `loadCodeAssist` + `onboardUser` project discovery, 30 min cache | `core/project.ts` | 378 | 05-quota §1 ✓ `loadCodeAssist`; `onboardUser` not in dossier | rework | keep discovery, drop onboarding unless proven; unverified |
| static model catalog, 7 public ids with thinking variants | `core/model-registry.ts:278-380` | 110 | 03-models: dynamic `fetchAvailableModels` + static fallback | **rework** | no dynamic catalog; advertises `gemini-3.5-flash`, absent from the 1.4.8 live list |
| wire ids `MODEL_PLACEHOLDER_M###` + numeric `thinkingLevel` | `core/model-registry.ts:101-251`, `core/transform/agy-generation.ts` | 200 | 03-models §2 (level in id) | keep | values match the 1.4.8 catalogue ids |
| retired-model refusal before credentials/transport | `core/model-registry.ts:256-275`, `src/stream.ts:355` | 25 | 03-models §3 ✓ | keep | |
| image model kept out of the chat catalog | `src/index.ts:104-127` | 20 | 03-models (a flash-image model exists) | keep | Pi has no image-output block |
| envelope `{project, requestId, request, model, userAgent, requestType}` + payload field order | `src/stream.ts:394-425`, `core/agy-request-metadata.ts:180-210` | 90 | 04-api §6.2 (structurally; bodies unobserved) | keep | core value of the fork; verify once live |
| attribution labels (`trajectory_id`, `last_step_index`, `used_claude*`, `model_enum`), `sessionId` FNV1a | `core/agy-request-metadata.ts` | 276 | 04-api §6.2 `Metadata` ✓ | keep | |
| `userAgent: "antigravity"` inside the envelope | `src/stream.ts:404` | 1 | not in dossier | **decide** | unverified; may be ignored or checked |
| `toolConfig.functionCallingConfig.mode = VALIDATED` except Argon | `src/stream.ts:293-299` | 10 | no dossier evidence | decide | cheap; drop if a live capture shows nothing |
| thinking config: `includeThoughts`, `thinkingLevel` LOW/MEDIUM/HIGH, adaptive `budget:0`, budget floors | `core/transform/agy-generation.ts`, `src/stream.ts:355-370` | 60 | 03-models §2, 04-api §7.3 (effort via generation config) | keep | table still an open question (08 §5 #5) |
| signature round-trip: `thoughtSignature`, `textSignature`, batch signature on first tool call, only for same model+provider | `src/convert.ts:67-107`, `src/stream.ts:657-780` | 120 | 06-mechanics §1.5, 08 §3 | keep | but no Claude strip in the live path (see next row) |
| Claude thinking strip, cross-model sanitizer, `claudeValidated` schema mode | `core/transform/claude.ts`, `cross-model-sanitizer.ts`, `gemini.ts:254,358` | 800 | 08 §3 invariant | **drop as written** | dead code in the Pi path; live path never strips for Claude |
| tool/schema sanitizer allowlist (`toGeminiSchema`, numeric constraints moved into description for gpt-oss) | `core/transform/gemini.ts:60-390` | 330 | 04-api §6 (tools inside the envelope) | **keep** | the one live, load-bearing transform |
| Gemini/Claude tool normalization, image-gen config, web-search grounding, tool wrapping | rest of `core/transform/*` | ~1,950 | 06 §2 (different tool inventory) | **drop** | no caller |
| hand-written TLS HTTP/1.1 transport: 7-header set, chunked body, gzip, Content-Length, proxy env, idle watchdog | `core/agy-transport.ts` | 599 | 04-api §8.1 ✓ (seven headers, chunked) | **decide** | duplicates `core/http`; see D6 |
| 10-minute pre-response deadline with its own JSON error body | `core/pre-response-deadline.ts` | 174 | CLI instead uses keepalive + continuation (04-api §6.3) | rework | our rule is a bounded timeout; the fake 412 JSON is ours, not the wire's |
| 15 s active timeout for token/bootstrap calls | `core/fetch-timeout.ts` | 165 | n/a | keep (simplify) | |
| abort forwarding to the socket and to the token refresh | `core/abort-forwarding.ts`, `src/index.ts:88-95` | 30 | CLI `CancelCascadeInvocation` (04-api §6.1) | keep | |
| SSE parse: `{"response": …}` unwrap, in-band `error`, `promptFeedback`, finishReason map, 1 s trailing-usage grace for gpt-oss, empty-response error | `src/stream.ts:122-276`, `:600-660` | 160 | 04-api §6.3 ✓ | keep | |
| usage mapping incl. `thoughtsTokenCount` as output, zero cost | `src/stream.ts:213-232`, `src/index.ts:118-126` | 30 | 05-quota §3.3 (usage ≠ quota) | keep | directly reusable for M3 token counts |
| quota: none. Menu says "Pi does not record Antigravity quota"; formatter + store codecs unused | `src/commands.ts:175-185`, `core/quota-presentation.ts`, `account-repository-codecs.ts` | 2,340 | 05-quota §8 (two endpoints, 5 buckets, per-bucket resets) | **drop** | vestige; build the real thing in M2 |
| `/antigravity` menu: Accounts / Quota / Routing / Limits / Vault, rendered by `@cortexkit/common-auth` | `src/commands.ts:36-62`, `core/antigravity-command-menu.ts` | 711 | CLI has `/usage`, `/credits`, `/model` (05-quota §7) | **rework** | must become `/auth` tabs in the pi-workbench frame |
| Claustrum vault custody (enroll, approve, roster, mode, credential-source switch) | `src/vault-setup.ts` (795), `vault-source.ts` (327), `core/vault-account-source.ts` (708), `vault-provider-state.ts` (596) | 2,600 | no CLI equivalent | **decide (rec: drop)** | D1 |
| Pi `auth.json` `google` slot swap: non-secret marker `antigravity-vault-custody`, stash file, "refusing provider" fallback | `src/index.ts:44-49,236-345`, `core/vault-*` | 150 | 08 §2: credentials belong in Pi's slot, unqualified | **drop** | hijacks the slot of Pi's real Google login |
| re-registration on mode change (`local` / `custody` / `refusing`) | `src/index.ts:236-345` | 110 | n/a | drop | unnecessary once vault is gone |
| credential/project-id redaction in errors and streams | `core/credential-redaction.ts` | 286 | n/a (our rule) | keep (simplify) | ports well to `core/redact` |
| logger with `ANTIGRAVITY_CORE_CONSOLE_LOG` fallback | `core/logger.ts` | 93 | CLI klog (01 §3) | drop | our code reports through `ctx.ui` and Pi |
| telemetry | — (nothing sent) | 0 | 04-api §8.1: CLI posts ~117 KB/turn to Clearcut | keep absence | a Pi provider must not emit it |
| env vars `PI_AGENT_DIR`, `PI_ANTIGRAVITY_AUTH_FILE` | `src/paths.ts`, `core/pi-paths.ts`, `docs/configuration.md` | 40 | 07 §5 (different, CLI-only vars) | rework | our agent-dir helper + settings catalog instead |
| UA impersonation pinned `antigravity/cli/1.3.5 … cl=998863838` | `core/fingerprint.ts:12-13,69-75` | 40 | 04-api §8.1: 1.4.8, `cl=1007749967` | **rework** | stale against our pinned tracking version |
| device fingerprint, session token, 5-version history, idle regeneration | `core/fingerprint.ts:116-203` | 90 | never sent (only UA is) | **drop** | dead fields from the pre-1.1.3 design |
| endpoint fallback daily → prod | `core/constants.ts:50-63` | 15 | 04-api §4.1: one default origin | decide | a silent failover changes the quota pool |
| browser-shaped UA / `X-Goog-Api-Client` / `Client-Metadata` header set, `SEARCH_*` constants, tool-hallucination prompts | `core/constants.ts:104-226` | 120 | 04-api §8.1: none of those headers are sent | **drop** | dead |
| tests | `tests/` 17,584 LOC | — | — | drop with their subjects | includes suites for the transform tree and account store |

## 3. UX / architecture / API points that will grate

| point | path | conflicts with |
|---|---|---|
| provider id `google` | `src/index.ts:246`; `core/constants.ts:136` | `AGENTS.md` §Provider ids: `google` → `antigravity`; also silently replaces the user's Gemini API-key provider |
| `/antigravity` is the only command, no `/auth` tab, no argument completions, no headless path | `src/commands.ts:36-62` | §Slash commands: one `/auth` family, completions, headless-safe |
| menu drawn by `runPiCommandMenu` from `@cortexkit/common-auth` | `src/commands.ts:48` | §One Pi-native UI: shared frame, our keybindings, our widths |
| own state files (`antigravity-accounts.json`, `antigravity-auth-vault/`, `pi-mode.json`, `pi-roster.json`, `google-login-stash.json`) | `src/paths.ts`, `vault-setup.ts:93-130` | §Settings and data: credentials in `auth.json`, settings in `auth-plus.json`; a separate credential file needs a recorded reason |
| the factory awaits a credential-slot synchronisation that reads/writes Pi's `auth.json` before returning | `src/index.ts:336-340` | §No network or heavy disk work in the factory; unverified whether `enterVault` rewrites the slot, but it is called there |
| vault mode replaces the `google` slot with an API-key marker, and a failed swap leaves a "refusing provider" registered | `src/index.ts:44-49,196-235` | §Login is Pi's; invisible custody state, two extra provider identities |
| three runtime deps, one of which needs a live vault service | `package.json` | §Runtime dependencies: none; "no `@cortexkit/*` packages at all" |
| hand-rolled `node:tls`/`node:net` HTTP client instead of `fetch` | `core/agy-transport.ts` | §core/http owns fetch, timeouts and `ProviderHttpError`; bypasses Pi instrumentation |
| one barrel `src/core/index.ts` re-exporting everything, including pool types | `src/core/index.ts:1-46` | §AOT: literal imports, bytecode budget; the barrel pulls 12.8k LOC into one graph |
| modules far over the 400-line split point | `account-repository-types.ts` (1,041), `vault-setup.ts` (795), `gemini.ts` (865) | §Repository shape / AOT |
| impersonation pinned to a version we no longer track (1.3.5, cl/998863838), fixtures from 1.1.x–1.3.5 | `core/fingerprint.ts:12-13`; `tests/fixtures/agy-cli-*` | §Upstream client tracking: pin = verified version, fixtures refreshed on bump |
| `api: "google-generative-ai"` with a custom `streamSimple` | `src/index.ts:130-146` | acceptable (no Pi api fits antigravity) but the `api` string must equal the models' `api` — verify at port time |
| repo-specific "no upstream merges" policy | fork `AGENTS.md` | we rebuild, not merge; keep their behavior only |

## 4. Open decisions

| # | decision | options | tradeoff | recommendation |
|---|---|---|---|---|
| D1 | vault (Claustrum) | port / drop / later milestone | 2.6k LOC + 1 dep + a vault service on the user's machines; no CLI counterpart; the roadmap already parks Claustrum at M4 | **drop**; if wanted later, design it as an account source behind `core/auth`, not a slot swap |
| D2 | account pool / rotation / per-account limits | port / drop | the fork has none in the Pi path; the real CLI has one account and no rotation (05-quota §3.3) | **drop**; multi-account is new design, not a port |
| D3 | provider id + migration from `google` | rename with migration / rename only / keep `google` | users on the fork have credentials under `google` in `auth.json` | **rename to `antigravity`**, fill-only migration when the slot's refresh matches the packed form or the provider was ours |
| D4 | model catalog source | port static / dynamic `refreshModels` + snapshot / both | static goes stale (3.5 entry already wrong); dynamic is our proven pattern | **dynamic + bundled snapshot**, exact wire ids, drop `antigravity-gemini-3.5-flash` |
| D5 | picker ids | fork's `antigravity-*` + Pi reasoning dial / exact `<family>-<level>` ids | one entry per family is far better UX in `/model`; the invariant is about the wire id | **keep fork's picker ids**, derive exact wire ids |
| D6 | transport | port the TLS client / plain `fetch` with the 7 headers | the TLS client guarantees order and chunking; `fetch` is maintainable and what everything else uses | **try `fetch` first**, keep the raw client only if a live capture shows the wire rejects it |
| D7 | project id storage | packed `refresh\|project` string / re-derive per session via `loadCodeAssist` / extra `auth.json` field | packing is a stored-format hack with an in-process cache; re-deriving costs one request per turn without it | **re-derive once per session** with a cache; do not encode into `refresh` |
| D8 | thinking/signature policy | fork's same-model carry / plus Claude strip / port the dead sanitizer | cross-model replay is the known 400 risk (08 §3) | **same-model carry + strip thinking for Claude**, written fresh and tested |
| D9 | quota | port nothing / build from 05-quota in M2 | the fork contributes nothing but vocabulary | **build in M2**: `loadCodeAssist` + `retrieveUserQuotaSummary`, 300 s cache, 60 s floor |
| D10 | redirect | keep loopback + paste / remote redirect + paste | the dossier says loopback is rejected; the fork presumably works today | **verify live first**, then switch to `https://antigravity.google/oauth-callback` |
| D11 | scopes | keep 5 / add `aicode`, `openid` | extra consent lines only | **add both** |
| D12 | envelope details (`userAgent`, `toolConfig`) | port blind / drop unknowns / verify first | unnecessary headers are harmless until they are not (04-api §8.1) | **port, then one live capture decides** |

## 5. Gaps: real CLI behaviour the fork lacks and a Pi provider needs

| gap | source | why it matters |
|---|---|---|
| dynamic catalogue `v1internal:fetchAvailableModels` + experiment-assigned context windows | 03-models §3, §5 | the fork hardcodes 1M/65k and a model the server no longer lists |
| quota: tier, credits, five buckets, per-bucket rolling resets | 05-quota §8 | the fork shows "unknown" everywhere; this is our M2 engine, and `progress` in `.project/plans/roadmap.md:48` already expects it |
| error-reason mapping `RATE_LIMIT_EXCEEDED`, `INSUFFICIENT_G1_CREDITS_BALANCE`, `VALIDATION_REQUIRED`, `MODEL_CAPACITY_EXHAUSTED` | 05-quota §3.3 | the fork surfaces raw HTTP text; our goal #2 wants a named cause and recovery |
| mid-stream continuation and keepalive | 04-api §6.3 | the fork aborts a truncated stream with "ended without a terminal candidate" |
| gcp client and the other five auth methods | 02-auth §5 | out of scope for us; Pi's own `google` API-key login covers the key case |
| `minimal` / `model-default` thinking levels in the id grammar | 03-models §2 | the fork maps Pi `minimal` → wire `low`; acceptable if documented |
| no Clearcut, no `aicode:fetchConfig`, no `userinfo` call | 04-api §8.1 | deliberate on the fork's part; keep it that way |
| `window` as a verbatim display string, `remainingFraction` never converted to requests | 05-quota §3.2 | the fork's `quota-presentation.ts` does convert — do not port that file |

## 6. Method and limits

Read-only: fork source and docs, its `.project/` artifacts, `.project/analyses/antigravity-cli/1.4.8/`,
`.project/plans/roadmap.md`, `AGENTS.md`. Nothing was run: no `bun test`, no `just check`, no live
request. Dead-code claims come from import graphs over `src/` (barrel-aware), not from a build.
Wire claims are the dossier's, not re-observed. The fork's login is reported as working by its own
docs only; the loopback-vs-remote redirect conflict (D10) is unresolved.
