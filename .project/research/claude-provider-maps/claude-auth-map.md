---
document:
  type: "analysis"
  id: "plan-0005-5a-claude-auth-reference"
  title: "pi-claude-auth drift and test provenance at b489042"
  description: "Delta of pi-claude-auth 9b8e52f to b489042 against SPEC 17.4 and the offline test provenance for the claude provider rows."
  status: "published"
  revision: 3
  created_at: "2026-10-26T14:25:50+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "pi"
  updated_by: "pi"
  source: "nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/plans/0005-provider-expansion/contract/reference-map-claude-auth.md"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["document creation"]
      updated_at: "2026-10-26T14:25:50+01:00"
    - revision: 2
      reason: "frontmatter migration"
      changes: ["migrate flat frontmatter to the document block"]
    - revision: 3
      reason: "imported into pi-auth-plus"
      changes: ["copied from nukular-ai@3bffbd4304af854808dd3b664c863468b10477ab:.project/plans/0005-provider-expansion/contract/reference-map-claude-auth.md"]
---

# pi-claude-auth reference map at `b489042`

## Answer

Delta list vs SPEC §17.4 (all verified against `b489042`, 0.2.2). Old commit `9b8e52f` **was** reachable (shallow-boundary commit); real diff obtained, not text comparison.

1. **Default Claude Code version `2.1.284` → `2.1.306`** (`src/constants.ts:68`). Drives `user-agent` and `cc_version`; SPEC "Version" bullet stale.
2. **Billing fixture suffixes stale** (suffix hashes the version). cch values unchanged; at 2.1.306: `""`→`dcf`, `"abc"`→`dcf`, `"abcd𝄞zXabcdefghijklmnY"`→`63f`, `"abcdéfg中ijklmnopqrstZ"`→`a98` (was `12a`, `12a`, `8be`, `2cb`).
3. **New header `x-app: cli`** on every OAuth request (`src/transform.ts:341`), set next to `user-agent`. SPEC Headers bullet omits it.
4. **Sanitizer identity matching changed from exact paragraph to prefix list** (`HARNESS_IDENTITY_PREFIXES`, `constants.ts:43-47`): `You are OpenCode`, `You are an expert coding assistant operating inside` (covers pi **and** Pi-Bolt), ``You are operating inside `Pi` ``.
5. **Three new paragraph-removal anchors** (`constants.ts:96-107`): `github.com/opensec-git/Pi-Bolt`, `earendil-works/pi`, `pi-coding-agent`. A bare `pi` must not be an anchor (paths `/home/pi`, `api`, `.pi/settings.json` survive).
6. **New user-configurable sanitization `claude.replacePatterns`** (`src/settings.ts`, new): literal match; with `replacement` = inline rewrite, without = drop paragraph; user settings always, project `.pi/settings.json` only when trusted; malformed entries dropped, never fatal.
7. **New version resolution behavior**: installed `claude --version` newer than bundled is reported (`config.ts:149-179`); older detected release ignored; explicit `ANTHROPIC_CLAUDE_CODE_VERSION` still wins.
8. Unchanged: OAuth constants/URLs/scopes, PKCE 64 bytes, UUID-without-dashes state, callback parsing, 3-attempt refresh with 500 ms/1 s backoff, system layout, identity text, `mcp_`+uppercase tool mapping, CCH formulas, catalog, zero-cost for OAuth.

pi itself has an independent Anthropic OAuth whose constants **partly disagree** (see digest).

## Evidence

Clone state: `git log 9b8e52f..HEAD` = one commit `b489042 chore: release 0.2.2`; `.git/shallow` lists both `9b8e52f` and `b489042` as shallow roots, so `git diff 9b8e52f HEAD` works fully.

- `/mnt/Projects/nukular/nukular-ai/.references/pi-claude-auth/src/constants.ts:68` — `CLAUDE_CODE_VERSION = '2.1.306'` (was `2.1.284`).
- `.../src/constants.ts:43-47` — `HARNESS_IDENTITY_PREFIXES` (new); `:29` still exports `OPENCODE_IDENTITY_PREFIX`.
- `.../src/constants.ts:96-107` — `PARAGRAPH_REMOVAL_ANCHORS` now includes Pi-Bolt repo, `earendil-works/pi`, `pi-coding-agent`.
- `.../src/constants.ts:131-138` — `TEXT_REPLACEMENTS` unchanged (both literal rules, applied once).
- `.../src/transform.ts:331-346` — `setOAuthHeaders`: `authorization: Bearer`, beta union, `user-agent: claude-cli/<v> (external, cli)`, **`x-app: cli` at :341**, `x-api-key` deleted. SPEC citation `330-344` still lands correctly.
- `.../src/transform.ts:448-500` — `rewriteUrl`: `?beta=true` for `/v1/messages`, `ANTHROPIC_BASE_URL` replaces protocol+host only, rejects non-HTTP(S)/userinfo; `isInsecure` :414-419, `resolveBaseUrl` :424-441. SPEC citation `415-499` shifted ~+1.
- `.../src/transform.ts:506-548` — `sanitizeSystemText(text, extra)`: split `/\n\n+/`, drop on any `HARNESS_IDENTITY_PREFIXES` prefix (:514), drop on built-in anchors (:520), drop on user anchors (:524-528), then `TEXT_REPLACEMENTS` once each (:535), then user replacements once each (:541), `trim()`.
- `.../src/transform.ts:559-616` — `prependClaudeCodeIdentity`: identity block has no `cache_control`; non-text/record inputs preserved via spread (so `cache_control` on existing blocks survives); idempotent when first block equals identity.
- `.../src/transform.ts:618-648` — `rewriteRequestBody`: billing block only when a `role === 'user'` message exists (:624-635), layout `[billing, identity, ...rest]` (:642-644), then `prefixToolNames`.
- `.../src/transform.ts:256-275` — `prefixName` = `mcp_` + uppercased first char; comment: lowercase `mcp_bash`/`mcp_read` "are flagged as non-Claude-Code clients". `prefixToolNames` :350-401 still rewrites `tool_choice.name`, `tool_reference.tool_name`, definitions, `tool_use` blocks; `unprefixName` keeps `StructuredOutput` special case.
- `.../src/cch.ts` unchanged (`extractFirstUserMessageText` :12, `computeCCH` :30, `computeVersionSuffix` :37, `buildBillingHeaderValue` :52). Formulas identical to SPEC; only the version input changed. Verified arithmetic with an independent SHA-256 computation: cch `e3b0c`/`ba781`/`fa63e`/`580bb` reproduce; suffix at 2.1.284 reproduces SPEC (`12a`,`12a`,`8be`,`2cb`); at 2.1.306 gives `dcf`,`dcf`,`63f`,`a98`.
- `.../src/config.ts:14` env var name; `:66-97` `resolveClaudeCodeVersion` (unchanged semantics, `<` bundled → `outdated`, invalid → `invalid` with no `version`); `:102-105` `parseClaudeCodeVersionOutput`; `:109-145` `findExecutable`; `:149-170` `detectClaudeCodeVersion` (2 s timeout, swallows all errors); `:172-179` `resolveReportedVersion` (newer-than-bundled wins, older ignored).
- `.../src/settings.ts:1-94` — `ReplacePattern {match, replacement?}`, `parsePattern`, `parseReplacePatterns`, `readReplacePatterns`, `agentSettingsPath` (`PI_CODING_AGENT_DIR` or `~/.pi/agent`), `projectSettingsPath` (`<cwd>/.pi/settings.json`), `loadReplacePatterns({cwd, projectTrusted, env})`.
- `.../src/transport.ts:31-61` — `claudeFetch(token, version, context, underlying, patterns)`; passes `patterns` into `rewriteRequestBody` (new 5th param).
- `.../src/provider.ts:78,99` — `claudeProvider(version, patterns = [])` threads patterns to `claudeFetch`; `:84-86` catalog = models.dev `anthropic` mapped to provider `claude` plus `CLAUDE_55_MODELS` (`:64-76`, opus-5-5 4/20/0.2/5, sonnet-5-5 2/10/0.2/2.5); `:13` `FREE_COST`, `:94-96` per-request free cost, `:110-111` `filterModels` zeroes cost for oauth credentials. SPEC citation `provider.ts:33-85` now lands on the 5.5 model block, not the catalog logic.
- `.../src/auth.ts`, `pkce.ts`, `provider-auth.ts` — **byte-identical** across the range (no diff hunk). Redirect URI is `https://platform.claude.com/oauth/code/callback`, callback parsed as URL, `code#state`, or query string (`auth.ts:25-54`); state = `crypto.randomUUID()` minus dashes (:21-23); verifier = 64 random bytes base64url, S256 (`pkce.ts:10-24`); refresh 3 attempts, 500 ms then 1 s, retry on 5xx and network only, `axios/1.13.6` UA (`provider-auth.ts:30-57`); `create` flow validates nonempty `raw_key` and returns only `{type:'api_key', key}` (`provider-auth.ts:80-95`).
- `index.ts` — new wiring: override env var wins, else `detectClaudeCodeVersion()` fills only when the override is invalid; patterns loaded before trust and replaced on `session_start` via `splice` into the same array the provider closed over.
- `CHANGELOG.md:8-35` (0.2.2) and `README.md:50-73` document 2.1.306, detection precedence, `x-app: cli`, `claude.replacePatterns`.

### Test provenance (offline fixtures)

Sanitizer / harness anchors:
- `tests/transform.test.ts:554` `returns text unchanged when OpenCode identity not present`; `:559` `removes identity, keeps generic content`; `:582` `removes paragraph containing feedback URL anchor`; `:593` `removes paragraph containing docs URL anchor`; `:604` `applies inline text replacement`; `:615` `rewrites the "useful information about the environment" fingerprint`; `:634` `preserves "opencode" in file paths and unrelated content`; `:647` `preserves content before and after identity`; **new** `:674` `removes the stock pi harness preamble`; `:681` `removes the Pi-Bolt harness preamble`; `:692` `removes the harness self-description paragraph`; `:699` `removes paragraphs that link the harness repositories`; `:712` `preserves paths and words that merely contain pi`; `:718` `drops a paragraph matching a user-supplied anchor`; `:725` `rewrites a user-supplied inline match`.
- Fixture prompt: `tests/fixtures/realistic-system-prompt.ts` (10 KB, unchanged).

Billing (cch + suffix):
- `tests/cch.test.ts:10` `extracts text from the first user message`; `:25` `computes the 5-character cch hash` (`4ffc3`); `:29` `computes the 3-character version suffix` (`2.1.87` → `6ff`); `:35` `builds the full billing header value`.
- `tests/transform.test.ts:986` `user-agent and billing header both report CLAUDE_CODE_VERSION`; `:838-884` `rewrites realistic OpenCode request end-to-end`; `:794` `handles missing system field`; `:891` `handles body with no messages array`; `:947` no-user-message billing omission case; `:803` **new** `applies user-supplied patterns to the system prompt`.
- Snapshot `tests/__snapshots__/transform.test.ts.snap:146-152` pins `cc_version=2.1.306.813; cc_entrypoint=sdk-cli; cch=185f8;` (was `.b93`, same cch) — a ready wire-level fixture.

Tool mapping / restoration:
- `tests/transform.test.ts:147` `prefixes tool definition names`, `:160` `prefixes tool_use block names in messages`, `:177` `does not prefix non-tool_use blocks`, `:193` missing tools/messages, `:199` tools without names; `:208-231` `stripToolPrefix` group.
- `tests/transport.test.ts:51` `forced tools and nested deferred references use the same wire names`; `:61` `JSON response restores original PascalCase custom tools and removes stale headers`.
- `tests/transform.stream.test.ts:512` `stripToolPrefix reverses prefixToolNames for lowercase tool names`; `:528` `does not restore the original case for PascalCase tool names`; `:168` `strips several tool names in a single chunk`; `:193` `keeps StructuredOutput unchanged apart from the prefix`; `:365` `keeps StructuredOutput casing in non-streaming JSON`; collision rejection covered by `tests/transport.test.ts:19-49` body/signal/method case plus provider case-collision expectations.

Header / URL transforms:
- `tests/transform.test.ts:23-71` `mergeHeaders` (6 cases); `:74-110` `mergeBetaHeaders` (`includes required betas`, `merges`, `deduplicates`, `comma-separated`); `:112-146` `setOAuthHeaders` (`authorization bearer`, `user-agent`, `removes x-api-key`, **new `:131` `identifies the client as a cli`**, `anthropic-beta`); `:232-363` `rewriteUrl` (16 cases incl. `adds beta=true …`, `overrides origin when ANTHROPIC_BASE_URL is set`, `preserves beta=true`, `trailing slash`, `ignores invalid`, `rejects file: scheme`, `rejects embedded credentials`); `:365-417` `isInsecure` (6 cases); `tests/transform.branches.test.ts:4-10` unparseable URL.

Config / settings:
- `tests/config.test.ts:15-112` version override resolution incl. `test.each` tables (`lower patch 2.1.305`, `2.1.99` lexical trap, `02.1.305`, `10.0.0`, `9007199254740993.0.0`, invalid); **new** `:115` `parseClaudeCodeVersionOutput` group (real banner `2.1.306 (Claude Code)`, no version); `:126` `findExecutable` group (first match, non-executable ignored, empty PATH); `:154` `detectClaudeCodeVersion` group (installed release, missing binary, throwing binary, unparseable output); `:189` `resolveReportedVersion` group (bundled when nothing detected, newer release reported, older release ignored, unparseable ignored).
- `tests/settings.test.ts:13` `parseReplacePatterns` (`reads anchors and inline replacements`, `drops entries a user cannot have meant`, `returns nothing for a non-array value`); `:46` `settings files` (`resolves the agent settings path from the environment` incl. empty/whitespace override, `reads patterns from a settings file`, `returns no patterns for missing or malformed files`, `applies user patterns without project trust`, `appends project patterns once the project is trusted`).

OAuth / PKCE / callback parsing:
- `tests/auth.test.ts:9` `authorize` (`returns the hosted callback URL for max mode`, `… console mode`, `sets required OAuth query params`, `does not use localhost`); `:52` `exchange` (`accepts code#state format`, `accepts a full callback URL`, `returns failed on invalid callback input`, `returns failed on state mismatch`).
- `tests/pkce.test.ts:8-100` `generatePKCE` (86-char verifier = 64 bytes, 43-char challenge, S256, base64url alphabet, independent SHA-256 verification, uniqueness, RFC 7636 bounds, deterministic known-bytes vector).
- `tests/provider-auth.test.ts:43` `subscription login validates state, PKCE, endpoints and returns canonical credential`; `:60` `manual API key and environment resolution`; `:68` `console flow creates an API key instead of storing OAuth tokens`; `:147` `API-key creation checks HTTP status and response schema`; `:124` `login cancellation makes no network request`; `:154`/`:170` abort-during-authorize and abort-during-prompt.
- `tests/provider.test.ts:125` `API-key calls bypass OAuth transformations and retain prices`; `:84` OAuth stream preserves tools/usage/hooks.

Refresh:
- `tests/provider-auth.test.ts:82` `refresh retries 5xx and persists rotated tokens`; `:93` `refresh retries network failure`; `:103` `refresh does not retry 4xx or leak response secrets`; `:109` `abort interrupts refresh backoff`; `:119` `rejects malformed successful token response`; `:132` serialized concurrent refresh.
- `tests/auth.branches.test.ts:46` `returns failed when the token endpoint rejects the code`; `:60` `returns failed on a 500`; `:74` `releases the connection when the token endpoint rejects the code`.

### pi (`.references/pi`, `66c2fa3d`) own Anthropic OAuth

- `packages/ai/src/auth/oauth/anthropic.ts` exists: `CLIENT_ID` base64-decodes to the same `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (:14), `AUTHORIZE_URL = https://claude.ai/oauth/authorize` (:15, **max only — no console route**), `TOKEN_URL = https://platform.claude.com/v1/oauth/token` (:16), scopes string identical to pi-claude-auth (:26-27), loopback `REDIRECT_URI = http://localhost:53692/callback` (:20-22) plus `COPY_CODE_REDIRECT_URI = https://platform.claude.com/oauth/code/callback` (:23).
- Refresh (`anthropic.ts:240-276`): **single attempt, no retry/backoff**, logs response bodies in errors, records `expires_in*1000 - 5*60*1000`. No `create_api_key` flow anywhere in pi.
- `packages/ai/src/auth/oauth/pkce.ts:18-33` uses **32** random bytes (43-char verifier), not 64.
- `packages/ai/src/api/anthropic-messages.ts:1006-1008` `isOAuthToken = apiKey.includes("sk-ant-oat")`.
- OAuth request path `:1044-1064`: `apiKey: null, authToken`, headers `user-agent: claude-cli/${claudeCodeVersion}` (**no `(external, cli)`**), `x-app: cli` (:1056 — agrees with 0.2.2), `anthropic-dangerous-direct-browser-access: true`.
- `claudeCodeVersion = "2.1.280"` (:100) — **disagrees** with 2.1.306.
- Betas (`:1137`): `claude-code-20250219`, `oauth-2025-04-20` when OAuth, then `interleaved-thinking-2025-05-14` only when reasoning + thinking enabled. pi-claude-auth always sends `oauth-2025-04-20` + `interleaved-thinking-2025-05-14`, never `claude-code-20250219`.
- System prompt (`:1222-1244`): OAuth injects `You are Claude Code, Anthropic's official CLI for Claude.` **with `cache_control`**, then the raw initial system text. No harness sanitization, no anchor removal, no billing header.
- Tool naming (`:104-139`, `toClaudeCodeName`): maps to Claude Code canonical casing (`Read`, `Bash`, …) case-insensitively; **no `mcp_` prefix**.
- No `x-anthropic-billing-header` / cch anywhere in pi.

## Notes

- The SPEC cites `.references/pi-claude-auth` at revision `9b8e52f` / 0.2.1 (`0001-nukular-ai-architecture.md:164`); that table row needs `b489042` / 0.2.2.
- Citation drift in SPEC §17.4 is small but real: `transform.ts:330-344`→`331-343`; `415-499`→`443-500`; `501-529`→`506-548`; `541-592`→`559-616`; `605-629`→`618-648`; `351-397`→`350-401`; `constants.ts:46`→`:68`; `constants.ts:29,71-119`→`29, 43-47, 96-107, 131-138`; `provider.ts:33-85`→`59-76` for the 5.5 additions and `84-86, 108-112` for catalog/cost. Unchanged: `constants.ts:1-20`, `cch.ts:12-66`, `transform.ts:6-20`-equivalent `transport.ts:6-20` (toolNameRestorer still :6-20), `provider-auth.ts:66-124`.
- SPEC also cites `provider.ts:34,88,107-121` at `:281`; current equivalent is `:78, 107-112`.
- Inference (labelled): the `x-app: cli` addition means the SPEC's Headers bullet is the only functional wire change besides the version and the sanitizer anchors; both are additive, nothing was removed.
- SPEC §17.4 "Sanitizer" and "Version" bullets are the two that need rewriting, plus the "Billing fixtures" values and the new `replacePatterns`/detection behaviors that have no SPEC counterpart yet.
- Conflict: the brief asked me to write the digest to "the output file" without naming a path; my role is read-only and forbids creating files, so the digest is delivered inline here.
- No `crates/` code references `2.1.284`, `2.1.306`, `claude_cli` or `sk-ant-oat`, so nothing in the Rust workspace is currently stale from this change.

## Not found / not covered

- No live verification of server behavior: whether `x-app: cli` is required, whether the gateway gate accepts 2.1.306 or a detected version, and whether the Pi-Bolt `pi-coding-agent` anchors are the only harness leaks. All `UNVERIFIED` by construction (read-only, no network).
- Did not inspect `.references/oh-my-pi` or `pi-opencode-auth`; out of scope for this brief.
- Did not run the pi-claude-auth test suite (read-only), so all test facts above come from reading sources, not from execution.