---
document:
  type: "analysis"
  id: "pi-quotas-inventory"
  title: "pi-quotas inventory for the M2 port"
  description: "File-level feature, contract and state inventory of pi-quotas mapped onto pi-auth-plus"
  status: "published"
  revision: 1
  created_at: "2026-10-27T14:20:25+01:00"
  updated_at: "2026-10-27T14:20:25+01:00"
  created_by: "explorer"
  updated_by: "pi"
---

## Summary

pi-quotas `3284a14`: 45 files / 6833 LOC in `src/`, 21 test files + `setup.ts` (3071 LOC), 6 fixtures.

Contract types: `ProviderQuotaId`, `ProviderQuotaSnapshot`, `QuotaWindow`, `CreditBalance`, `ResetCredit`, `ResetCreditList`, `ResetOutcome`/`ResetOutcomeCode`, `ProviderMeta`/`PROVIDER_META`, `QuotasConfig`/`DEFAULT_QUOTAS_CONFIG`, `QuotaLinePlacement`; derived `QuotaReport`/`ReportProvider` (`cli/report.ts`) is the bus/`--json` payload.

Five findings that decide the slicing:

1. Four of seven providers have no pi-auth-plus family to attach to (`openrouter`, `deepseek`, `codex`, `xai`), and `codex` additionally drags its own OAuth file and a `<cwd>/.auth.json` token read, which M2 drops. Provider fetch/parse is therefore four new quota-only families plus three insertions into existing ones.
2. `core/cache` `HostCache` already covers leases, backoff, parser fence and locked atomic writes, but not the header-partial merge, the 403-as-rate-limit rule, or drainage. Drainage needs a home inside the cached value; the merge/staleness behaviour is a decision, because header ingestion rewrites `fetchedAt`.
3. `core/bus` exists with nonce envelopes and redaction but a 1 s timeout and a different reply shape; all seven bus channels and the `QuotaReport` payload must be re-expressed as `pi-auth-plus:v1:quotas:*`, which is a contract change, not a port.
4. The interactive surface is the largest gap: pi-auth-plus's dashboard renders static rows, while pi-quotas ships a 457-line provider panel and a 361-line staged settings panel. `ui/frame` gives the frame and keybindings, so both panels are ports, not rewrites.
5. Credentials are the missing seam: `FamilyHost` exposes only `settings()`, so a quota engine cannot reach `auth.json` slots or Pi's `ModelRegistry` without a new host part — and `providers/request.ts:47-52` already contains the pi-auth-plus header-only bearer special case.

Safe to slice roughly: contract+registry, engine/cache/drainage, bus, per-family fetch (4+3), CLI, line/template, panels, resets.

---

# pi-quotas inventory for the M2 port

Source: `pi-quotas` at `3284a14` (`main`, 2026-10-27 13:36). All citations are absolute paths.

| Item | Value |
|---|---|
| `src/` files | 45 |
| `src/` LOC | 6833 |
| test files | 21 + `tests/setup.ts` |
| test LOC | 3071 |
| fixtures | 5 JSON + 1 TS child-process script |

---

## 1. Module map

`src/index.ts` is the whole entrypoint: factory-only registration, 14 lines.

| File | LOC | Responsibility | Depends on |
|---|---|---|---|
| `/mnt/Projects/furbyhaxx/pi-quotas/src/index.ts` | 14 | Factory: `registerListQuotasFlags` → `handleOneShotStartup(process.argv.slice(2))` → `new QuotaRuntime` → `registerQuotaEvents` → `registerQuotaCommand` | cli/flags, commands/quota, events, runtime |
| `src/types.ts` | 282 | Domain model, provider registry, parser versions, min poll ages, `QuotasConfig` + defaults, `resolveAgentDir`, `StoredCodexCredential` | `node:os`, `node:path` only |
| `src/events.ts` | 44 | The five `pi.on` handlers | providers/parse, runtime, types |
| `src/runtime.ts` | 346 | Per-session state: config, host cache, refresh dedupe/lease, line placement, poll timer, bus host, reset confirm/consume | bus/service, cache/host-cache, cli/report, config/store, providers/errors, providers/fetch, render/*, resets/service, types |
| `src/providers/fetch.ts` | 82 | Dispatch, `needsAuth` snapshot, parser-version stamping, claude 401 retry | all provider modules, providers/{errors,request}, types |
| `src/providers/request.ts` | 68 | `readAuthJson`, `resolveBearerToken` (registry then slot), `composeRequestSignal` (10 s) | `node:fs/promises`, types |
| `src/providers/errors.ts` | 40 | `ProviderHttpError` with status/`retryAfterMs`, `parseRetryAfterMs`, `httpFailureOf` | none |
| `src/providers/parse.ts` | 140 | `parseTimestampMs`, `clamp01`, `windowLabelFromSeconds`, `parseResponseHeadersForQuota` | types |
| `src/providers/openrouter.ts` | 105 | Credits + key cap | parse |
| `src/providers/deepseek.ts` | 44 | Balance | types |
| `src/providers/codex.ts` | 159 | Usage windows, `codexHeaders`, `CODEX_BACKEND` | auth/codex-oauth, parse |
| `src/providers/codex-resets.ts` | 154 | Reset-credit list/consume, `CodexResetError` with `outcomeUnknown` | codex, parse, auth/codex-oauth, pi-tui |
| `src/providers/claude.ts` | 247 | `limits[]`, legacy buckets, dollar caps, `extra_usage` | providers/errors, parse |
| `src/providers/antigravity.ts` | 145 | Project id + quota summary groups/buckets | parse |
| `src/providers/synthetic.ts` | 102 | Subscription / weekly / search budgets | parse, request |
| `src/providers/xai.ts` | 94 | Grok billing credits, on-demand, monthly | parse |
| `src/cache/host-cache.ts` | 306 | Snapshots, leases (12 s), backoff, parser fence, header merge, mtime sync, atomic flush, listeners | cache/drainage, types |
| `src/cache/drainage.ts` | 205 | Observation history, segmentation, merge, rate/ETA | types |
| `src/bus/protocol.ts` | 296 | v1 channels, payload types, request/reply parsers | cli/report, types |
| `src/bus/service.ts` | 211 | Subscribe, resolve providers, nonce replies, snapshot/event pushes | protocol, resets/service, types |
| `src/bus/consumer.ts` | 145 | Consumer helpers with timeout/abort, `QuotaBusError` | protocol |
| `src/config/store.ts` | 184 | Layered store, sanitizing parse, `parseEnabledProviders`, `sourceOf`, `shadowed`, save | types |
| `src/config/fields.ts` | 102 | Settings field catalog (10 fields) | store |
| `src/cli/args.ts` | 52 | Flag names, argv parsing | none |
| `src/cli/flags.ts` | 132 | Flag registration, one-shot query before TUI, `runListQuotas`, lazy `ModelRegistry` | cache, config, providers, types, cli/* |
| `src/cli/io.ts` | 27 | Exit codes, color decision, `writeSync` to fd | `node:fs` |
| `src/cli/report.ts` | 126 | `QuotaReport` derivation, state, drainage attachment | cache/drainage, config/store, types |
| `src/cli/table.ts` | 193 | Width-aware table, diagnostics, time/money/percent formatting | cache/drainage, render/values, cli/report |
| `src/cli/resets.ts` | 97 | `--quota-reset` list/spend | codex-resets, resets/service, render/values, cli/* |
| `src/commands/quota.ts` | 320 | `/quota`, completions, subcommand router, panel launch, reset flow, codex login | auth/codex-oauth, render/summary, resets/service, runtime, types, ui/panel |
| `src/render/values.ts` | 47 | `clamp01`, `creditStress`, `formatPercent`, `formatResetCountdown`, `plainText` | pi-tui, types |
| `src/render/format.ts` | 36 | `gradientColor`, `styleByStress`, `renderGradientBar` | pi-tui, values |
| `src/render/template-parser.ts` | 237 | Template grammar → `CompiledTemplate` + `unknown[]` | pi-tui, types, values |
| `src/render/template.ts` | 303 | Memoized compile, field rendering, `{all}`, segments | config/store, types, format, parser, values |
| `src/render/line.ts` | 57 | Segment packing, `limitQuotaRows` | pi-tui, template |
| `src/render/widget.ts` | 23 | `QuotaLineWidget` | pi-tui |
| `src/render/footer.ts` | 169 | Full footer replacement + quota rows | pi-ai, pi-coding-agent, pi-tui |
| `src/render/workbench.ts` | 19 | pi-workbench footer host shape check | pi-coding-agent |
| `src/render/summary.ts` | 44 | Plain-text summary | types, values |
| `src/ui/primitives.ts` | 37 | `rule`, `padRightVisible`, `formatAge` | pi-tui |
| `src/ui/panel.ts` | 457 | Interactive panel: tabs, provider list, bars, spinner, keys, mouse | config/fields, render/*, resets/service, types, ui/* |
| `src/ui/settings.ts` | 361 | Staged edits, edit mode, save prompt, template preview | config/*, render/*, types, ui/primitives |
| `src/auth/credentials.ts` | 68 | `quotas-codex-auth.json` load/save (0600), seeding | types |
| `src/auth/codex-oauth.ts` | 391 | Browser + device OAuth, JWT claims, refresh | credentials, types |
| `src/resets/service.ts` | 122 | Reset support registry, credit pick, wording | codex-resets, request, values, types |

`types.ts` is imported by everything; providers never import UI; `render/*` and `ui/*` read only `types.ts` and the cache, never a provider payload (`AGENTS.md:120-130`).

---

## 2. The normalized data contract

Verbatim from `/mnt/Projects/furbyhaxx/pi-quotas/src/types.ts`.

```ts
export type ProviderQuotaId =
	| "openrouter"
	| "deepseek"
	| "codex"
	| "claude"
	| "antigravity"
	| "synthetic"
	| "xai";

export const ALL_PROVIDER_IDS: readonly ProviderQuotaId[] = [
	"openrouter", "deepseek", "codex", "claude", "antigravity", "synthetic", "xai",
] as const;

/**
 * Parser version per provider. Bump it when a parser change makes older snapshots wrong;
 * the shared cache then ignores snapshots written by older sessions and refetches.
 */
export const PROVIDER_PARSER_VERSIONS: Readonly<Record<ProviderQuotaId, number>> = {
	openrouter: 1, deepseek: 1, codex: 1, claude: 2, antigravity: 2, synthetic: 2, xai: 1,
};

/** Minimum endpoint polling intervals, independent of the configured refresh cadence. */
export const PROVIDER_MIN_POLL_MS: Readonly<Partial<Record<ProviderQuotaId, number>>> = {
	claude: 300_000,
};

export interface ProviderMeta {
	id: ProviderQuotaId;
	label: string;       // full label in the condensed line
	shortLabel: string;  // short label on small screens
	title: string;       // display title in the /quota detail widget
	piProviders: readonly string[]; // Pi model provider IDs mapping to this quota provider
	aliases: readonly string[];     // accepted in `/quota <provider-id>`
	kind: "credits" | "windows";
}

export const PROVIDER_META: Record<ProviderQuotaId, ProviderMeta> = {
	openrouter:  { id: "openrouter",  label: "openrouter",  shortLabel: "or",  title: "OpenRouter",          piProviders: ["openrouter"],                        aliases: ["openrouter", "or"],                        kind: "credits" },
	deepseek:    { id: "deepseek",    label: "deepseek",    shortLabel: "ds",  title: "DeepSeek",            piProviders: ["deepseek"],                          aliases: ["deepseek", "ds"],                          kind: "credits" },
	codex:       { id: "codex",       label: "codex",       shortLabel: "cox", title: "OpenAI Codex",        piProviders: ["openai", "openai-codex"],             aliases: ["codex", "cox", "openai", "oai", "openai-codex"], kind: "windows" },
	claude:      { id: "claude",      label: "claude",      shortLabel: "cl",  title: "Claude Code",         piProviders: ["claude", "anthropic"],                aliases: ["claude", "cl", "cc", "anthropic"],         kind: "windows" },
	antigravity: { id: "antigravity", label: "antigravity", shortLabel: "ag",  title: "Google Antigravity",  piProviders: ["antigravity", "google", "google-antigravity"], aliases: ["antigravity", "ag", "google"],     kind: "windows" },
	synthetic:   { id: "synthetic",   label: "synthetic",   shortLabel: "syn", title: "Synthetic",           piProviders: ["synthetic"],                         aliases: ["synthetic", "syn"],                        kind: "windows" },
	xai:         { id: "xai",         label: "xai",         shortLabel: "xai", title: "xAI Grok",            piProviders: ["xai", "xai-oauth"],                  aliases: ["xai", "grok"],                             kind: "windows" },
};

export function resolveProviderQuotaId(input: string): ProviderQuotaId | undefined {
	const norm = input.trim().toLowerCase();
	if (!norm) return undefined;
	for (const id of ALL_PROVIDER_IDS) {
		if (PROVIDER_META[id].aliases.includes(norm) || PROVIDER_META[id].piProviders.includes(norm)) {
			return id;
		}
	}
	return undefined;
}
```

(The `PROVIDER_META` block above is collapsed to one line per provider; each value is field-for-field
identical to `types.ts:63-127`, which carries one field per line.)

```ts
export interface QuotaWindow {
	/** Stable identifier within provider, e.g. "5h", "7d", "gemini-5h" */
	id: string;
	/** Short compact label for the condensed bar, e.g. "5h", "7d", "gem", "3p", "arg" */
	shortLabel: string;
	/** Full descriptive label for `/quota` widget */
	label: string;
	/** Used fraction in [0, 1] (0 = untouched/healthy, 1 = 100% used / exhausted) */
	usedFraction: number;
	/** Optional detail text, e.g. "$41.43 / $48.00" or "1000 / 1000 req" */
	valueText?: string | undefined;
	/** Epoch milliseconds when this window resets, if known */
	resetAtMs?: number | undefined;
	/** True if this window is the primary/important one to show in the condensed line */
	important?: boolean | undefined;
	/** Optional group name (e.g. "Gemini Models", "Claude & GPT") */
	group?: string | undefined;
	/** Window duration as reported by the provider, e.g. "5h", "7d", "1mo" */
	period?: string | undefined;
	/** What the window limits when it is not the plan-wide allowance, e.g. "fable", "search" */
	scope?: string | undefined;
}

export interface CreditBalance {
	/** Remaining balance in currency units (USD) */
	remaining: number;
	/** Total credits or cap if known */
	total?: number | undefined;
	/** Used credits if known */
	used?: number | undefined;
	/** Currency symbol/code, default "$" */
	currency: string;
	/** Extra breakdown text */
	detailText?: string | undefined;
}

/** One on-demand rate-limit reset credit as listed by the provider. */
export interface ResetCredit {
	id: string;
	type: string;
	status: string;
	title?: string | undefined;
	description?: string | undefined;
	grantedAtMs?: number | undefined;
	expiresAtMs?: number | undefined;
	redeemedAtMs?: number | undefined;
	supportedByPlan?: boolean | undefined;
}

export interface ResetCreditList {
	provider: ProviderQuotaId;
	fetchedAt: number;
	/** Provider-reported count of credits that can be redeemed now */
	available: number;
	credits: ResetCredit[];
}

/** Provider verdict for one consume request; only `reset` spends a credit. */
export type ResetOutcomeCode = "reset" | "nothing_to_reset" | "no_credit" | "already_redeemed";

export interface ResetOutcome {
	provider: ProviderQuotaId;
	creditId: string;
	windowsReset: number;
}

export interface ProviderQuotaSnapshot {
	provider: ProviderQuotaId;
	fetchedAt: number;
	source: "endpoint" | "headers";
	/** Plan or tier badge, e.g. "pro", "max 20x", "free-tier" */
	tier?: string | undefined;
	/** For credits-based providers (openrouter, deepseek) or hybrid */
	credits?: CreditBalance | undefined;
	windows: QuotaWindow[];
	/** Available on-demand rate-limit reset credits */
	resetCredits?: number | undefined;
	/** Last error if refresh failed */
	error?: string | undefined;
	/** True if credentials are missing and the user needs to authenticate */
	needsAuth?: boolean | undefined;
	/** `PROVIDER_PARSER_VERSIONS` entry of the writer; absent means version 1 */
	parserVersion?: number | undefined;
}

export type QuotaLinePlacement =
	| "above-editor" | "below-editor-first" | "below-editor-last" | "off";

export type PercentDisplayMode = "used" | "remaining";

export interface QuotasConfig {
	linePlacement: QuotaLinePlacement;
	refreshIntervalSec: number;
	refreshOnRequest: boolean;
	percentDisplay: PercentDisplayMode;
	compactWidthCols: number;
	alwaysShortIds: boolean;
	creditHealthyUsd: number;
	creditCriticalUsd: number;
	enabledProviders: string;
	lineTemplate: string;
}

export const DEFAULT_QUOTAS_CONFIG: QuotasConfig = {
	linePlacement: "below-editor-first",
	refreshIntervalSec: 60,
	refreshOnRequest: true,
	percentDisplay: "used",
	compactWidthCols: 100,
	alwaysShortIds: false,
	creditHealthyUsd: 50,
	creditCriticalUsd: 5,
	enabledProviders: "openrouter,deepseek,codex,claude,antigravity,synthetic,xai",
	lineTemplate:
		"{openrouter:id}: {openrouter:credits-remaining} · {deepseek:id}: {deepseek:credits-remaining} · {codex:id}: {codex:window-7d-used-percent}[ ({codex:resets-available}r)] · {claude:id}: 5h/{claude:window-5h-used-percent} 7d/{claude:window-7d-used-percent}[ ({claude:resets-available}r)] · {antigravity:id}: gem/{antigravity:window-7d-gemini-used-percent} arg/{antigravity:window-7d-gemini-4-argon-used-percent} · {synthetic:id}: {synthetic:window-7d-used-percent}[ ({synthetic:resets-available}r)] · {grok:id}: {grok:window-7d-used-percent}[ ({grok:resets-available}r)]",
};
```

`StoredCodexCredential` (`types.ts:274-282`) is `{type: "oauth", access, refresh, expires, accountId?,
email?, planType?}` and belongs to the codex auth file M2 drops.

Derived contract: `QuotaReport` is `{v: 1, generatedAt, providers[]}` with `ReportProvider` adding
`piProvider`, `title`, `short`, `state: "ok"|"stale"|"error"|"needs-auth"|"unknown"`, `resets`,
`fetchedAt`, `ageSec`, `source`, `error`; `ReportWindow` adds `usedPercent`, `remainingPercent`,
`resetAt`, `resetInSec`, `drainage` (`cli/report.ts:7-43`). Staleness is `refreshIntervalSec × 2`
(`report.ts:50`). This is the bus reply and the `--json` payload.

---

## 3. Per provider

Shared: `resolveBearerToken` asks Pi's `ModelRegistry` first (`getAll()` → first model of each
`piProviders` id → `getApiKeyAndHeaders`), taking `apiKey` or a `Bearer` from the returned headers,
then falls back to `<agentDir>/auth.json`, preferring `access` over `key`
(`providers/request.ts:36-63`); the header-only branch exists for pi-auth-plus claude/antigravity
(`request.ts:47-52`). Timeout = caller signal + `AbortSignal.timeout(10_000)` (`request.ts:11,66-71`).
No token → `{windows: [], needsAuth: true, error: "No credential configured"}`, never a throw
(`providers/fetch.ts:52-61`). Parser version is stamped by the dispatcher (`fetch.ts:30-33`).

**openrouter** (`providers/openrouter.ts`) — `GET https://openrouter.ai/api/v1/credits` and
`GET https://openrouter.ai/api/v1/key`, both via `Promise.allSettled` (`:11-14`). Headers: bearer +
`Accept: application/json`, no UA. Parsed: `data.total_credits`, `data.total_usage`; key `limit`,
`limit_remaining`, `usage`, `usage_daily|weekly|monthly`; `free_model_daily_requests` declared but
unused (`:27-35`). Windows: `credits` (important, `"$X left of $Y"`) when `total > 0`; `key-cap`
(scope `key cap`) (`:74-98`). `credits.remaining = max(0, total−usage)`, else `limit_remaining`, else
`0`; currency `$`; `detailText day $x · wk $y · mo $z` (`:54-71`). No resets. A failing endpoint is
ignored; if nothing usable arrives it throws a plain `Error` (`:47-52`).

**deepseek** (`providers/deepseek.ts`) — `GET https://api.deepseek.com/user/balance`, bearer +
Accept. `is_available` → `tier: available|unavailable`; `balance_infos[]`, USD preferred else first,
`total_balance`/`granted_balance`/`topped_up_balance` as strings; currency `¥` for CNY else `$`;
`detailText granted X · topped-up Y`; `windows: []` (`:11-43`). Non-2xx → plain `Error`. Missing balance
becomes `0` via `parseFloat(x ?? "0") || 0` (`:26-30`).

**codex** (`providers/codex.ts`, `providers/codex-resets.ts`) — own credential file, not slots:
`ensureValidCodexCredential` reads `<agentDir>/quotas-codex-auth.json`, seeds from `<cwd>/.auth.json`
or `<agentDir>/auth.json` (`openai-codex`/`.openai-codex`), refreshes under 120 s
(`auth/credentials.ts:44-72`, `auth/codex-oauth.ts:187-215`). `GET
https://chatgpt.com/backend-api/wham/usage` with `User-Agent: codex_cli_rs/0.60.0`,
`originator: codex_cli_rs`, `ChatGPT-Account-Id` (`codex.ts:8-21`). 401 with refresh → refresh once and
retry; 401/403 → `needsAuth` with `"Auth rejected (N) — run /quota codex login"` (`:46-73`). Parsed:
`plan_type`, `rate_limit.{primary,secondary}_window{used_percent, limit_window_seconds,
reset_after_seconds, reset_at}`, `additional_rate_limits[]`, `rate_limit_reset_credits.available_count`
(`:75-100`). Windows `primary`/`secondary` (labels from seconds, `resetAtMs` from `reset_at` else
`now + reset_after_seconds`, secondary important only when primary is absent), extras as
`extra:<name>` with a lowercased scope (`:101-148`). `tier = plan_type ?? planType`. Resets:
`GET/POST …/wham/rate-limit-reset-credits[/consume]`, body `{redeem_request_id: randomUUID(),
credit_id}`; sent once, never retried; transport failure and 5xx set `outcomeUnknown`
(`codex-resets.ts:22-38,113-154`); verdicts `reset|nothing_to_reset|no_credit|already_redeemed` +
`windows_reset`; errors carry a redacted 200-char body snippet.

**claude** (`providers/claude.ts`) — `GET https://api.anthropic.com/api/oauth/usage`, bearer +
`anthropic-beta: oauth-2025-04-20` + `User-Agent: claude-cli/2.1.306 (external, cli)`,
`redirect: "error"`, `any(caller, timeout(5000))` (`:6,117-129`). 404 → non-throwing snapshot
(`no usage route on this host`); other failures → `ProviderHttpError` with parsed `Retry-After`; 401
says `/login`, 403/429 say retry after the hold (`:131-147`). Body: `limits[]`
(`{kind, group, severity, is_active, percent, resets_at, scope.model|surface.display_name}`) mapped to
`5h`, `7d`, `scoped:<name>`, else `<kind>:<group>`, collisions suffixed `:<index>`
(`:33-84,155-168`); legacy buckets `five_hour`, `seven_day`, `seven_day_opus|sonnet|oauth_apps`
(`:86-119,169-180`); top-level dollar caps (`limit_dollars` + `utilization` → `"$used / $cap"`,
important at ≥90 %) (`:181-200`); `extra_usage` enabled → minor units ÷100 with currency prefix
(`:201-233`). 401 retry only if the re-resolved token differs (`fetch.ts:73-83`). Poll floor 300 s via
`PROVIDER_MIN_POLL_MS`. Resets deliberately unsupported, private/unverified routes
(`resets/service.ts:16-31`).

**antigravity** (`providers/antigravity.ts`) — project id from `refresh` split on `|`
(`parts[2] ?? parts[1]`), else `POST …/v1internal:loadCodeAssist` `{metadata:{ideType:"ANTIGRAVITY"}}`,
fallback `"aicode-consumers"` also on failure (`:10-46`). `POST
…/v1internal:retrieveUserQuotaSummary` `{project}` (`:48-67`). Headers:
`User-Agent: antigravity/hub/2.19.1 (aidev_client; os_type=darwin; arch=arm64; cl=963137146)`
(`:4-6`) — a different product, version, platform and format from pi-auth-plus's
`agy/cli/1.4.8 (… os_type=<host>; arch=<host>; cl=1007749967; auth_method=consumer)`
(`pi-auth-plus/src/families/google/transport.ts:15-22`). Windows from
`groups[].buckets[]{bucketId, displayName, window, resetTime, remainingFraction}`: `used = 1 −
remaining` (default 1), group tag `arg|gem|3p|<first 3 letters>`, most-used bucket takes the group short
label and `important`, `scope` from the bucket prefix, `period` from `window` (`weekly`→`7d`), `id` =
`bucketId` (`:69-132`). **`tier` is the project id** (`:135`).

**synthetic** (`providers/synthetic.ts`) — `GET https://api.synthetic.new/v2/quotas`, bearer +
Accept, caller signal composed with a second 10 s timeout (`:5,63-69`). Parsed: `subscription{limit,
requests,renewsAt}`, `planWeeklyLimit{percentRemaining,nextRegenAt}`, `search.hourly{…}`
(`:22-34,87-95`). Windows `subscription` (`sub`, important, `N/M used`), `7d` (`1 − p/100`, `N% left`,
important), `search-1h` (`srch`, scope `search`, period `1h`) (`:81-131`). Every failure names
endpoint, status and recovery; unrecognized payload and invalid JSON throw likewise (`:70-80`).

**xai** (`providers/xai.ts`) — `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` and
`GET …/v1/billing`, both `allSettled` (`:9-12`). Credits path: `config.currentPeriod{start,end,type}`,
`creditUsagePercent`, `isUnifiedBillingUser` → `tier: "unified"`, `onDemandCap.val`,
`onDemandUsed.val` (`:16-33`); default path: `billingPeriodEnd`, `monthlyLimit.val`, `used.val`
(`:65-72`). Windows `7d`/`period`, `ondemand` (`cap`, `$used / $cap`), `monthly` (`mo`, important only
when no other window) (`:31-84`). Both endpoints failing yields an empty window list with no error
(`:88-93`).

**Response-header ingestion** — `parseResponseHeadersForQuota` (`providers/parse.ts:53-140`), called
for **every** provider response from `after_provider_response` (`src/events.ts:22-32`), guarded by
header shape only: codex `x-codex-{primary,secondary}-{used-percent,window-minutes,reset-at}` +
`x-codex-plan-type` (`:58-94`); claude `anthropic-ratelimit-unified-{5h,7d,7d_oi,overage}-{utilization,
reset}`, utilization a fraction that may exceed 1 and is clamped (`:96-138`). Those are the only two
families; no other provider exposes inference headers.

---

## 4. Runtime

**Factory** (`src/index.ts:8-14`): register four flags, run the one-shot CLI path (network + exit
possible here), construct the runtime, register events and the command. The constructor subscribes to
`workbench:service` (`runtime.ts:49-51`).

**`session_start`** (`runtime.ts:88-123`): abort and recreate the `AbortController` (session signal),
`configStore.setCwd(ctx.cwd)`, emit `workbench:service-request` for a footer host, `await
configStore.load()` (+ warning on the first problem), `await cache.syncFromDisk(true)`, restart the
bus, `syncLinePlacement`, `syncPollTimer`, fire-and-forget `refreshAllEnabled(false)`.

**`session_shutdown`** (`runtime.ts:125-139`): clear timer, stop bus, abort, clear in-flight map,
`setWidget(key, undefined)`, unmount footer, forget the TUI.

**Triggers** (`src/events.ts`): `model_select` → attach context + repaint; `after_provider_response` →
header ingestion + repaint; `agent_end` → when `refreshOnRequest`, map `ctx.model.provider` through
`resolveProviderQuotaId` (Pi ids `openai`, `google`, `anthropic` work) and refresh with
`minAgeMs: 2000`. Commands and the CLI call `refreshProvider` with explicit options.

**Timers**
- Poll (`runtime.ts:316-345`): one `setInterval`, tick `clamp(refreshIntervalSec*1000, 1000, 5000)`;
  each tick re-syncs from disk and refreshes enabled providers older than
  `effectiveMinPollAge(id, refreshIntervalSec*1000)`; `0` disables; `unref()`.
- Claude floor 300 s, all others 0 (`types.ts:44-46`, `cache/host-cache.ts:52-54`).
- Panel spinner 100 ms while refreshing, `unref`, disposed with the panel (`ui/panel.ts:82-95`);
  feedback message 2.5 s (`ui/panel.ts:97-106`).

**Concurrency**: in-session `refreshing` map returns the same promise (`runtime.ts:206-215`);
cross-session 12 s lease persisted in `inFlightUntil` (`host-cache.ts:47,205-234`); bulk refreshes use
`Promise.allSettled` (`runtime.ts:310-314`, `bus/service.ts:92-107`). `force` skips freshness, leases
and any backoff unless the recorded status is 403/429 (`host-cache.ts:207-221`).

**Host cache** (`cache/host-cache.ts`): `<agentDir>/cache/quotas-cache.json` (`:60-62`), `agentDir` =
`PI_CODING_AGENT_DIR` else `~/.pi/agent` (`types.ts:4-6`). Payload `{version: 1, updatedAt,
snapshots, inFlightUntil, backoffUntil, backoffStatus, history}` (`:18-31`) — one file, no per-key
namespacing. Writes serialized by `writeChain` to `${path}.tmp.<pid>.<ms>.<counter>` + `rename`, every
failure swallowed, **no file lock** (`:163-192`). Reads compare `stat().mtimeMs` (`:117-161`). Parser
fence drops `(parserVersion ?? 1) < PROVIDER_PARSER_VERSIONS[id]` (`:132-135`). Newest `fetchedAt`
wins; leases take max; backoff takes the later deadline and its status. Header merge (`:236-266`):
windows unioned by id, old `label`/`shortLabel`/`period`/`scope` preferred, `credits`/`resetCredits`
preserved, **`fetchedAt` becomes now**. Backoff (`:285-305`): 30 s default; 403/429 use
`Retry-After` capped 15 min, else 60 s for claude and 30 s otherwise; the old snapshot is kept and
annotated with `error`. Listeners: `onChange(provider, snapshot, status?)`.

**Drainage** (`cache/drainage.ts`): stored as the `history` array of the same file, one entry per
`(provider, kind, id)` with `kind` `window` (value = usedFraction) or `credits` (value = remaining,
`id` = currency) (`:12-47`). Recorded only for successful snapshots with a finite fraction in `[0,1]`
(`:150-197`). Merge sorts by time/value/reset, starts a new segment on a window decrease, a credit
increase, or a reset advancing >60 s, drops duplicate timestamps, keeps the baseline plus the last
day's samples capped at 1500, prunes entries idle >7 days (`:75-148`). `rate(lookback)` = consumed per
hour over real coverage, requires ≥60 s and a non-negative result; window consumption `last − first`,
credits `first − last`; `window`/`h1`/`h24` (`:167-206`). ETA = `remaining / perHour` hours
(`remaining = 1 − value` for windows, `value` for credits), suppressed as
`resetsBeforeExhaustion` when the scheduled reset comes first, omitted when the reset already passed
(`:186-205`). Disk validation rejects samples >60 s in the future, out-of-range window values and
unknown providers (`:52-72`).

---

## 5. Surfaces

### `/quota` command (`src/commands/quota.ts`)

`pi.registerCommand("quota", {description, getArgumentCompletions, handler})` (`:160-166`) — one
command. 17 static completions filtered by `fuzzyFilter` over value/label/description (`:25-71`).
Dispatch (`:167-320`): `codex login [--device|--browser]` or `login [codex] …` (`--device` wins;
aliases like `cox login` unsupported; `/quota login --device` mis-parses) → `refresh [provider]` →
`reset|resets [provider]` (default codex) → `line|position|placement <pos>` (aliases `above|top`,
`below|below-first`, `last|footer|below-last`, `off|none|hide`, `:74-90`) → `show [provider]` or any
non-TUI invocation (plain-text notify; an unknown provider silently falls back to the unfiltered
summary) → the panel (`settings`/`config` tab, or filtered to the provider with a fire-and-forget 5 s
refresh). Reset flow (`:107-149`): unsupported → warning; list; no UI or no credit → notify; else
`confirmReset` then `consumeReset`. A panel-requested reset runs **after** the panel closes
(`:305-319`).

### Panel (`src/ui/panel.ts`, 457)

Two tabs; `Tab`/`s` switches, `Esc`/`q` closes. Quotas keys: `↑↓`/`j`/`k` select, `r` refresh
selected, `R` refresh all, `a` solo/all, `x` reset (incapable providers just explain), `l` codex login,
`p` cycle placement (`below-editor-first`→`below-editor-last`→`above-editor`→`off`), wheel scrolls
(`:125-224`). Rows: title rule with tab labels and right status (staged count / spinner / placement);
per provider a cursor, bold title, `(short)`, `[tier]`, `(r N resets)`, age, then `Loading quota…`, a
`⚠` auth hint, a `✗` error, a credits row with a gradient bar, or one row per window (label column,
bar, percent, `used`/`left` tag, `valueText`, `↻ countdown`) (`:232-390`). Height `min(22, rows −
quotaLineRows − chrome)`; scroll follows the selection; `↑/↓ N more`; hint row filtered by
`RESET_SUPPORT`. Bar width 16/12/8, label column `min(26, max(14, 28 % width))`.

### Settings UI and config keys

Fields (`src/config/fields.ts:15-101`):

| Key | Kind | Default | Range / options |
|---|---|---|---|
| `linePlacement` | enum | `below-editor-first` | `above-editor`, `below-editor-first`, `below-editor-last`, `off` |
| `refreshIntervalSec` | number | `60` | 0–3600, step 5 |
| `refreshOnRequest` | boolean | `true` | — |
| `percentDisplay` | enum | `used` | `used`, `remaining` |
| `compactWidthCols` | number | `100` | 40–220, step 5 |
| `alwaysShortIds` | boolean | `false` | — |
| `creditHealthyUsd` | number | `50` | 5–500, step 5 |
| `creditCriticalUsd` | number | `5` | 0–100, step 1 |
| `enabledProviders` | string | all seven | comma/whitespace separated |
| `lineTemplate` | string | section 2 | — |

Interaction (`ui/settings.ts:100-270`): `↑↓`/`k`/`j` move, `←→`/`h`/`l`/Enter/Space change
boolean/enum/number, Enter on string/number opens an `Input` prefilled via bracketed paste, Backspace
stages the default, `ctrl+s` → save prompt (`u` user, `p` project, `r` session only), `Tab` back to
quotas, `Esc` discards staged edits first, else closes. Each row shows its source scope or `● staged`;
description and hint rows appear only when tall enough (`:271-361`). `lineTemplate` gets a live
preview of unapplied edits, a paging counter using the user's own page keys, and `⚠ ignored: …` from
`CompiledTemplate.unknown` (`:68-92`).

Config files: `<agentDir>/quotas.json` (user) and `<cwd>/.pi/quotas.json` (project), JSON,
tab-indented, unknown keys preserved, `lineTemplateNarrow` deleted on save (`config/store.ts:114-183`).
Layers defaults < user < project < runtime; **project is read unconditionally** (no trust check). A
malformed/unreadable file warns and contributes an empty layer; saving against it throws
`Cannot save <path>; fix the existing settings file and retry` (`:121-151,160-183`).

### Line, footer, widget (`src/render/*`)

Placement (`runtime.ts:141-204`): `above-editor` / `below-editor-first` mount a `QuotaLineWidget`
through `ctx.ui.setWidget("quotas-line", …, {placement})`; `below-editor-last` either hands rows to
pi-workbench via `setFooterRows("pi-quotas", renderRows)` or replaces Pi's footer with
`createFooterWithQuotaLine`, which reimplements the whole footer (cwd with `~` and git branch, session
name, ↑↓RW totals, cache hit rate, cost, context `%`/size with warning colors, model + thinking,
provider count, extension statuses) then appends quota rows (`render/footer.ts:44-169`); `off` mounts
nothing. Rows (`render/line.ts:32-57`): one template at every width, segments joined with a dim ` · `,
packed while they fit, oversized segments wrapped with `wrapTextWithAnsi`; `shortIds` when
`alwaysShortIds` or `width < compactWidthCols`; `limitQuotaRows` caps at `terminalRows − 8` and
replaces the last row with `… /quota settings (N rows)`. pi-workbench contract: `workbench:service`
push, `workbench:service-request` pull, `setFooterRows`/`requestFooterRender` (`render/workbench.ts`).

Template grammar (`render/template-parser.ts`): `{alias}` / `{alias:field,field}`; alias resolves
through the provider registry; one optional style suffix `|fg=#rgb|#rrggbb|themeToken`, `bg=…`,
`bold`, `italic`, `underline`, `strikethrough` (`:100-127`); `{sep}` and a literal ` · ` both start a
preferred-break segment (`:186-190`); `{all}`/`{all:short}` covers enabled providers without an
explicit token (`render/template.ts:284-290`); `[...]` renders only when every value inside is
available (`template.ts:268-277`); escapes `\[ \] \{ \} \\`; group depth capped at 64; malformed
tokens collect into `unknown` and never throw (`template-parser.ts:167-236`). Fields: `id`, `name`,
`short`, `tier`, `credits`, `credits-remaining`, `pct`, `wins`, `rst`, `r`, `resets-available`,
`bar`, `window-<key>-(used|remaining)-percent` (`:7-30`); `<key>` is `<period>[-<scope>]` normalized
(`gemini-models`→`gemini`, `gemini-argon-wtu`→`gemini-4-argon`), legacy ids
`gemini-weekly`/`gemini-argon-wtu-weekly`, and only a **unique** match renders (`template.ts:36-76`).
Missing data renders `…`, `login`, `?` or `err` (`template.ts:124-142`). Summary:
`Title: 12.34$ (detail) | Title: 5h 42% (↻ 3h 12m), …` (`render/summary.ts:10-44`).

### CLI (`src/cli/*`)

Flags registered in the factory (`flags.ts:20-36`, names `args.ts:2-5`): `--list-quotas`, `--json`,
`--quota-reset`, `--confirm-reset`, all boolean; `--json` is a **global** name. Parsing is a manual
`process.argv` scan because Pi populates flag values later; everything after `--` ignored; `--help`,
`-h`, `--version`, `-v`, `--list-models` suppress the path; reset wins over list; the provider is the
first non-`--json`/`--confirm-reset` positional after the trigger flag (`args.ts:24-51`). Execution
writes to fd 1/2 with `writeSync` (Pi owns `process.stdout`) and calls `process.exit(code)`
(`flags.ts:39-55`, `io.ts:15-27`). Exit codes 0 ok / 1 partial / 2 usage (`io.ts:4-6`); color:
`NO_COLOR` wins, `FORCE_COLOR=0` disables, `FORCE_COLOR` enables, else `isTTY` (`io.ts:8-14`). Table
(`table.ts:10-15`): Provider, Window, Used, Remaining, Resets at, On-Demand Resets, Drainage
(window|1h|24h); right-aligned 2/3/6/7/8; `sv-SE` Europe/Zurich timestamps with offset; two decimals
that never round onto 0/100 % (`:37-53`); money with currency suffix; lookback rates need 80 %
coverage; stderr diagnostics for non-`ok` providers (`:180-193`). `--quota-reset`: provider defaults
to codex, unknown/incapable → exit 2; list (table or JSON) + a spend hint on stderr; with
`--confirm-reset` it picks the soonest-expiring credit and **spends with no dialog**, then refreshes,
exiting 0 only on `code == "reset"` (`resets.ts:42-97`).

### Event bus (`src/bus/*`)

Version 1; channels `pi-quotas:v1:{ready,snapshot,query,refresh,event,resets,reset}` and replies on
`pi-quotas:v1:reply:<nonce>` (`protocol.ts:10-25`); capabilities `query|refresh|snapshot|event|resets|
reset` (`:27-34`). Payloads: `ready {v, providers:[{id, piProvider}], capabilities}` pushed once per
session after config and cache load (`:37-43`, `service.ts:198-206`); `snapshot {v, provider:
ReportProvider}` on every cache change (`service.ts:184-189`); `event`:
`auth-required|rate-limited|reset-consumed` (`protocol.ts:50-62`); `query {nonce, providers?,
maxAgeSec?}` refreshes older providers before replying, `refresh {nonce, providers?, force?}` forces
`minAgeMs: 0`; `resets {nonce, provider}` → `{ok, resets}`; `reset {nonce, provider, confirm: true,
creditId?}` refuses without `confirm: true`, without an interactive UI, or on refusal
(`service.ts:127-180`). Validation: nonce `/^[A-Za-z0-9_-]{1,128}$/`, malformed requests dropped,
unknown providers get an error reply listing known ids (`protocol.ts:113-140`). Consumer helpers: 15 s
default timeout (180 s for a reset), `QuotaBusError` with `reason: rejected|timeout|aborted`
(`consumer.ts:14-138`); `package.json` exports exactly `./bus` → `src/bus/consumer.ts`.

### Resets and confirmation

Support matrix: only `codex` is `{list: true, consume: true}`; the rest are false with
"…exposes no verified on-demand reset endpoint. Supported: codex." (`resets/service.ts:16-31`). Credit
pick: `status === "available"`, `supportedByPlan !== false`, soonest `expiresAtMs` first
(`:63-74`). Confirmation is `ctx.ui.select` with `["Keep the credit", "Spend 1 credit now (cannot be
undone)"]` — not `confirm`, which preselects "Yes" (`runtime.ts:258-285`); the prompt names the
requester for bus requests and lists current windows. Any consume attempt is followed by a forced
refresh (`:286-307`); audit listeners fire only on `code == "reset"`. Tone: `reset` info, others
warning (`resets/service.ts:100-122`).

### Codex own OAuth

Client `app_EMoamEEZ73f0CkXaXp7hrann`; `https://auth.openai.com/oauth/{authorize,token}`,
`/api/accounts/deviceauth/{usercode,token}`, `/codex/device`; callback
`http://localhost:1455/auth/callback` on `127.0.0.1`; scopes `openid profile email offline_access
api.connectors.read api.connectors.invoke` (`codex-oauth.ts:8-19`). PKCE S256, `randomBytes(32)`
verifier, 16-byte state, `id_token_add_organizations`, `codex_cli_simplified_flow`, `originator:
codex_cli_rs` (`:282-297`). Device flow polls `interval + 3 s` (first ≤5 s), 120 attempts, 403/404 =
keep polling (`:211-280`). `auto` uses device when SSH without a display, else browser then device
(`:377-391`). Profile from JWT claims `https://api.openai.com/auth` (account id, plan) and
`/profile` (email) (`:44-83`). Refresh: `grant_type=refresh_token`, one in-flight promise, 15 s
timeout, rotated credential saved (`:117-171`). Storage `<agentDir>/quotas-codex-auth.json`, dir 0700,
temp file 0600 → chmod → rename, seeded from `<cwd>/.auth.json` and `<agentDir>/auth.json`
(`credentials.ts:52-89`).

---

## 6. Tests

`bun:test`; `tests/setup.ts` isolates agent dirs.

| File | Protects |
|---|---|
| `tests/bus/bus.test.ts` (308) | `ready` with Pi ids; query answers from cache without fetching; `maxAgeSec` uses the lease path; `refresh` passes force; unknown providers rejected; malformed requests ignored; cache changes push a row plus auth/rate-limit events; stop unsubscribes, drops in-flight replies and times out consumers; abort rejects immediately; resets list read-only, unsupported providers error; never consumes without `confirm: true` or approval; approved reset spends the soonest-expiring credit once and emits an audit event |
| `tests/cache/host-cache.test.ts` (230) | Success headers clear a stale `needsAuth`; claude waits 5 min unless forced; a persisted claude 403 hold survives a forced refresh until `Retry-After`; force bypasses a 500 backoff; header subsets keep endpoint-only windows and rich labels; leases coordinate and persist across instances; older-parser snapshots ignored and refetched |
| `tests/cache/drainage.test.ts` (191) | Lookbacks use real coverage, zero stays zero, resets suppress ETA; short spans unknown; credits per currency, top-ups restart; baseline retention, sample bounds, disk validation, pruning; header/failure/out-of-order samples make no observations; instances merge; cached lookbacks survive; a drop starts unknown |
| `tests/providers/fetch.test.ts` (176) | All seven providers populate the host cache from a monkey-patched `globalThis.fetch` and a temp agent dir; header-only antigravity gets Pi's refreshed bearer, not the stale slot |
| `tests/providers/claude.test.ts` (310) | `limits` replace legacy buckets in server order; 5 s budget; no redirects, honors cancellation; open kinds/surface scopes/collisions/importance; unnamed scoped rows; unknown kinds; invalid JSON message; no invented usage; dollar caps; `extra_usage` minor units; `null` extra usage; 404 no-route |
| `tests/providers/antigravity.test.ts` (42) | Captured Gemini/Argon buckets keep distinct stable template scopes; a weekly-only response invents no Argon |
| `tests/providers/synthetic.test.ts` (154) | Captured live response; weekly rounding; subscription-only and missing subscription; zero limits/absent counts stay unknown; missing weekly fields; past regen and clamping; failure context; unrecognized body; invalid JSON; combined cancellation+bounded signal |
| `tests/providers/codex-resets.test.ts` (154) | Live list parse; list uses usage headers and names the endpoint on failure; consume sends a fresh id and maps verdicts; interrupted/failed consume never retried and flagged possibly spent |
| `tests/providers/parse.test.ts` (82) | Claude overage-included window alone; overage id kept, invalid utilization skipped; codex `x-codex-*`; claude unified headers |
| `tests/cli/table.test.ts` (220) | One table, exact headers, no trailing notes; period-first window names with scope and Pi ids; two decimals without hitting 0/100; credits money-only, on-demand resets only on the first row; drainage rates, 80 % rule, ETA placement; color only adds escapes; diagnostics only for non-fresh providers |
| `tests/cli/report.test.ts` (132) | Window/money mapping without invention; drainage attached without losing raw fields; state resolution; enabled order |
| `tests/cli/resets.test.ts` (133) | Provider positional after our flags, reset wins over list; one row per credit with the Pi id; lists without spending, spends once with `--confirm-reset`; unknown/incapable exit 2 |
| `tests/cli/flags.test.ts` (67) | One-shot argv parsing and precedence |
| `tests/cli/startup.test.ts` (101) | `--list-quotas` finishes before TUI startup and preserves exit codes (PTY regression) |
| `tests/config/store.test.ts` (56) | A long single template survives save/reload without cutting tokens; the default names windows and reset groups for all providers |
| `tests/render/line.test.ts` (119) | Tall blocks leave editor room and name the preview; default shows every window and only available badges; wrapping loses nothing at every width; one template at both widths with unauthenticated claude still visible; styled/wide literals wrap; widget exposes all rows, `off` none |
| `tests/render/template.test.ts` (213) | Exact period+scope matching, never a sibling; named percentages ignore display mode; `all`/`short` keep windows and auth state; legacy ids only without a period; optional reset punctuation; nested-vs-direct suppression; identities without snapshots; separators; malformed syntax diagnostics; custom styles replace inner styles |
| `tests/render/workbench.test.ts` (64) | `below-editor-last` joins pi-workbench's footer; without it, installs and clears its own |
| `tests/ui/panel.test.ts` (124) | Fullscreen settings fit with and without quota rows; a panel opened on one provider acts on it; showing all keeps the cursor; `x` on an incapable provider only explains; a selected template field stays visible and flags ignored tokens |
| `tests/ui/settings.test.ts` (119) | Preview uses the real width and keeps paging metadata; paging in list and edit modes with unshadowed keys; follows page-key rebindings; a long template edits at 36 columns; failed persistence retains staged edits |
| `tests/types/aliases.test.ts` (22) | Alias resolution; the default keeps the line below the editor |

Fixtures: `tests/providers/fixtures/antigravity-quota.json` (1390 B), `antigravity-weekly-only.json`
(1171 B), `claude-usage.json` (847 B), `codex-reset-credits.json` (761 B),
`synthetic-quotas.json` (379 B), and `tests/cli/fixtures/list-quotas.ts` — a 22-line child-process
script that stubs `fetch`, runs `runListQuotas({provider: "synthetic", json: true})` and prints the
called URLs (used by `startup.test.ts`). No openrouter/deepseek/codex-usage/xai fixture: those paths
are inline JSON in `tests/providers/fetch.test.ts`.

---

## 7. Mapping onto pi-auth-plus

| pi-quotas module | Proposed pi-auth-plus location | Reuse instead of porting |
|---|---|---|
| `types.ts` snapshot/window/credit/reset types | `src/quotas/types.ts` | nothing equivalent; `core/registry` types cover ids only |
| `types.ts` ids/aliases/labels/`PROVIDER_META` | `core/registry` `ProviderEntry` for ids and aliases; `shortLabel`/`title`/`kind` need a home (extend `ProviderEntry` or a quotas display table) | `src/core/registry/index.ts:8-22` resolves ids+aliases case-insensitively and rejects duplicates; it has no `shortLabel`/`title`/`kind` |
| `PROVIDER_PARSER_VERSIONS`, `PROVIDER_MIN_POLL_MS` | `src/quotas/registry.ts` (quota half of each adapter) | `core/cache` has a `parserVersion(key)` hook; the 300 s claude floor is new |
| `QuotasConfig` + defaults | `core/config/catalog.ts` keys `quotas.*` | `SettingsStore` already does layering, sanitizing parse, staged save, unknown-key preservation, malformed-file refusal (`src/core/config/index.ts:75-229`); `enumField`/`stringField`/`listField` exist |
| `providers/request.ts` token resolution | `src/quotas/credentials.ts` behind a new `FamilyHost` seam, from `core/auth` + Pi's `ctx.modelRegistry` | `core/auth` `readCredential` covers the slot fallback (`src/core/auth/index.ts:70-100`); the header-only bearer case must stay (`request.ts:47-52`); `FamilyHost` exposes only `settings()` today (`core/registry/index.ts:25-28`) |
| `providers/errors.ts` | delete | `core/http` `ProviderHttpError` + `parseRetryAfter` are a superset (`src/core/http/index.ts:20-105`) |
| `providers/fetch.ts` | `src/quotas/refresh.ts` dispatching through `core/registry` (registry gains a `quota` part) | registry iteration/alias resolution exist (`core/registry/index.ts:24-114`); `FamilyAdapter` has no `quota` part yet |
| `providers/parse.ts` helpers | `src/quotas/normalize.ts` | no overlap (`ui/frame` has sanitize/pad only) |
| `providers/parse.ts` header ingestion | `src/quotas/headers.ts`; call it inside our own fetch wrappers, keep the event only for builtins | `core/http` `request()` returns the `Response` |
| `providers/openrouter.ts` | `src/families/openrouter/quota.ts` (**new family**, quota only) | none; absent from `src/families/index.ts:7-12` |
| `providers/deepseek.ts` | `src/families/deepseek/quota.ts` (**new family**) | none |
| `providers/codex.ts`, `codex-resets.ts` | `src/families/openai/quota.ts`, `resets.ts` (**new family**) | `core/auth` slot `codex` replaces `quotas-codex-auth.json` (M2 decision); `core/http` gives retry-after |
| `providers/claude.ts` | `src/families/anthropic/quota.ts` | `families/anthropic/version.ts` (pinned CLI version) and `identity.ts`/`transport.ts` headers instead of a second UA constant |
| `providers/antigravity.ts` | `src/families/google/quota.ts` | `families/google/project.ts` already resolves the project id once per credential (SHA-256 cache key), `transport.ts` `userAgent()`/`cliHeaders()`, `errors.ts` recovery text; drop the darwin/arm64 pin |
| `providers/synthetic.ts` | `src/families/synthetic/quota.ts` | `families/synthetic/catalog.ts` owns `BASE_URL`; the family already injects `FetchFn` |
| `providers/xai.ts` | `src/families/xai/quota.ts` (**new family**) | none; registry accepts `xai` with alias `grok` |
| `cache/host-cache.ts` | `core/cache` `HostCache<QuotaState>`, keys = provider ids, `parserVersion` from the family | `HostCache` has entries, leases, backoff, parser fence, atomic writes **under a file lock**, `onChange` (`src/core/cache/index.ts:1-238`, `core/cache/lock.ts`). Gaps: 403 not rate-limited (`backoffFor`, `index.ts:217-227`), no header-partial merge, no drainage payload |
| `cache/drainage.ts` | `src/quotas/drainage.ts`, stored inside the cached value per key | `HostCache.parse` validates stored values at the read boundary |
| `bus/*` | `core/bus` channels `pi-auth-plus:v1:quotas:*` | `publish`/`subscribe`/`serve`/`request` with nonce envelopes, 1 s default timeout and payload redaction (`src/core/bus/index.ts:1-95`). Differences: envelope + `:reply` channel vs flat `{v, nonce, ok, …}` + `reply:<nonce>`; 1 s vs 15 s/180 s |
| `config/store.ts` | `core/config` + `src/quotas/settings.ts` for `parseEnabledProviders` | `shadowed`/`sourceOf` match the panel; the trust gate is stricter than pi-quotas and is correct per AGENTS.md |
| `runtime.ts` | `src/quotas/engine.ts` | `core/cache` + `core/bus` remove about half; keep the timer lifecycle rule |
| `render/values.ts`, `format.ts` | `src/ui/quotas/{values,format}.ts` (or `quotas/format.ts` for CLI reuse) | `ui/frame` `sanitize` overlaps `plainText` partly |
| `render/template{,-parser}.ts`, `line.ts` | `src/ui/quotas/{template,template-parser,line}.ts` | none; largest self-contained port, 597 LOC of pure functions |
| `render/widget.ts`, `footer.ts`, `workbench.ts` | `src/ui/quotas/{widget,footer,workbench}.ts` | the footer duplicates token math that M3 will remove (`roadmap.md`) |
| `render/summary.ts` | `src/ui/quotas/summary.ts`, shared with `dashboardText` | `ui/dashboard/tabs.ts` already has a text renderer |
| `ui/panel.ts` | dashboard quotas-tab rows + a quotas panel | `ui/frame` (`drawFrame`, `rule`, `fitHint`, `bodyRowsFor`, `sanitize`, `padTo`) and `ui/panel` `FramePanel`; the dashboard renders static rows with no actions today (`src/ui/dashboard/tabs.ts:126-138`) |
| `ui/settings.ts`, `config/fields.ts` | a settings panel driven by the `core/config` catalog | catalog carries `kind/label/description/default/options/min/max/step`; no panel exists yet |
| `ui/primitives.ts` | drop; use `ui/frame` | `rule`/`padTo`/`sanitize` cover it; `formatAge` moves to quotas format |
| `commands/quota.ts` | `ui/commands` router: `/quota`, `/quotas` as entry points into `/auth quotas`; codex login subcommand disappears (Pi `/login`) | `registerAuthCommands` has completions, `closestNames`, headless text and the panel launcher (`src/ui/commands/index.ts:88-113`); `/auth` accepts `quota`/`quotas` aliases already |
| `cli/*` | `src/quotas/cli/*`, flags registered from `src/index.ts` | `core/http` errors for messages; `QuotaReport` becomes the bus payload |
| `resets/service.ts` | `src/quotas/resets.ts` | none |
| `auth/credentials.ts`, `auth/codex-oauth.ts` | delete for M2 | `core/auth` PKCE + callback server + code paste is exactly this surface (`src/core/auth/pkce.ts`, `code-paste.ts`); `/login codex` owns the credential |
| `events.ts` | `src/quotas/events.ts` registered from `src/index.ts` after families | `src/families/synthetic/index.ts:31-52` shows the family `session_start` pattern |
| `tests/*` | `tests/quotas/**`, `tests/families/<vendor>/quota.test.ts` | `tests/host.ts` `testHost()` builds a settings-only `FamilyHost`; move monkey-patched-`globalThis.fetch` tests to the families' injected `FetchFn` |

Id map that changes: `codex`'s `piProviders ["openai","openai-codex"]` → `codex`; `claude`'s
`["claude","anthropic"]` → `claude` (alias `anthropic`); `antigravity`'s
`["antigravity","google","google-antigravity"]` → `antigravity` (alias `google`). `ProviderQuotaId`
and the Pi ids collapse to one id per family, which changes the `--list-quotas` Provider column (today
`openai`, `google`), `ready.piProvider`, and `tests/cli/table.test.ts`. `openrouter`, `deepseek` and
`xai` have no pi-auth-plus provider, so their families are quota-only adapters.

---

## 8. Risky or surprising behavior worth a decision

1. **`--json` is a global flag name** (`cli/flags.ts:26-29`); a second extension registering `json`
   collides. pi-quotas already records this as accepted and "noted for review"
   (`.project/designs/quota-surfaces/design.md:174-176`). Decide the name.
2. **The factory can `process.exit()`.** `handleOneShotStartup` runs before Pi's terminal and exits
   (`cli/flags.ts:39-55`). Required by the design, and it contradicts pi-auth-plus's "no network in
   the factory"; it also makes `rpc-verify`/`parity-verify` depend on argv scrubbing.
3. **The CLI spends a credit with no dialog**: `pi --quota-reset codex --confirm-reset`
   (`cli/resets.ts:76-97`). pi-auth-plus requires explicit per-call approval for irreversible actions;
   a flag is pre-approval. Decide whether the CLI path survives and how approval is recorded.
4. **Private, unverified first-party endpoints**: `chatgpt.com/backend-api/wham/*`,
   `api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20`,
   `cli-chat-proxy.grok.com/v1/billing`, `daily-cloudcode-pa.googleapis.com/v1internal:*`. Codex
   consume was never live-verified; claude reset routes are statically found and unimplemented.
5. **A second credential file with a project-local seed** (`auth/credentials.ts:52-72`): an extra
   credential store and a read of a repository file for tokens. M2 removes it; the migration must not
   write it into `auth.json` (pi-quotas seeds `openai-codex`, Pi's slot is `codex`).
6. **Header ingestion makes stale data look fresh**: `putSnapshot` with `source: "headers"` takes the
   header snapshot's `fetchedAt`, so `ageSec`, staleness and drainage samples move forward while the
   endpoint data is unchanged (`cache/host-cache.ts:236-266`).
7. **Header attribution is by shape only** (`providers/parse.ts:53-140`), for all traffic including
   unrelated providers; AGENTS.md wants attribution from the request inside our own providers.
8. **Silent zeros and silent unknowns**: deepseek turns a missing balance into `0`
   (`providers/deepseek.ts:26-30`); xai returns empty windows with no error when both endpoints fail
   (`providers/xai.ts:88-93`); antigravity defaults a missing `remainingFraction` to `1` = 0 % used
   (`providers/antigravity.ts:99-102`). All three contradict "unknown is not zero".
9. **`tier` carries the antigravity project id** (`providers/antigravity.ts:135`), leaking a Google
   project identifier into the UI, `--json` and bus `report` payloads. `core/redact` only scrubs known
   secrets.
10. **Two config files with new names**: `quotas.json` vs `auth-plus.json` (`config/store.ts:114-119`).
    Legacy migration must be fill-only, and making the project layer trust-gated silently changes
    behavior for untrusted projects.
11. **Poll cadence does a disk `stat` every 1–5 s per session** (`runtime.ts:316-345`), which now
    interacts with `HostCache`'s file lock. Measure before keeping it.
12. **Report and bus duplicate the snapshot**: `buildQuotaReport` recomputes `ReportProvider` on every
    push (`cli/report.ts:52-126`, `bus/service.ts:184-189`). Publishing snapshots instead is a
    `docs/events.md` contract change.
13. **Id collapse is user-visible**: printing `codex`/`antigravity` instead of `openai`/`google`.
    `tests/cli/table.test.ts` must be rewritten, not preserved.
14. **`/quota` versus `/auth`**: pi-quotas owns `/quota`, so both packages loaded means a renamed
    `/quota:1` and two cache files; `core/conflicts` does not list `pi-quotas`
    (`src/core/conflicts/index.ts:5-10`).
15. **Template quirks are load-bearing**: optional groups hide unavailable fields (a provider can
    vanish silently), `namedWindow` returns undefined on two matches (renders `?`), and the escapes
    plus the depth-64 cap are what make "a template never throws" true. Each has a test in
    `tests/render/template.test.ts`.
</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>