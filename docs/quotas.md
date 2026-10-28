# Quotas and credits

Open `/auth quotas`, `/quotas`, or `/quota`. The line and panel read the same cached
provider reports. A missing number is unknown, never an inferred zero. An explicit 0%
is real usage; an absent limit is not proof of unlimited access.

## Providers

Use Pi provider ids in settings, commands and integrations. Accepted aliases resolve to
the same source; reports always use the Pi id. Compact display ids are not necessarily
accepted aliases.

| Pi id | Accepted aliases | Compact id | Reports |
|---|---|---|---|
| `claude` | `cl`, `cc` | `cl` | Claude subscription session (5h), weekly (7d), scoped weekly windows, spend caps and enabled extra usage; response-header updates |
| `antigravity` | `agy`, `ag` | `ag` | Every reported quota bucket in each group, including Gemini, Argon and third-party pools; reset times |
| `synthetic` | None | `syn` | Subscription request count, weekly plan budget, hourly search requests |
| `codex` | `openai`, `openai-codex`, `chatgpt`, `cx`, `cox`, `oai` | `cox` | ChatGPT primary, secondary and additional primary windows, plan and reset-credit count; response-header updates |
| `xai` | `grok` | `xai` | Current included period (weekly where reported), positive on-demand cap and positive monthly included limit |
| `openrouter` | `or` | `or` | USD account balance, account-credit usage and positive key spend cap; daily/weekly/monthly spend breakdown |
| `deepseek` | `ds` | `ds` | Prepaid USD or CNY balance, with granted and topped-up amounts when reported |

Credentials resolve through Pi's model registry, including OAuth refresh. Use
[the login reference](getting-started.md#sign-in) for the required credential kind.
`codex` is the exception: see [Codex login](#codex-login). There is no read from a
project `.auth.json`.
OpenCode's `opencode` and `opencode-go` have no quota source.

Provider details:

- **Claude:** reads `/api/oauth/usage`. New `limits[]` windows keep server order;
  legacy five-hour, weekly, Opus, Sonnet and OAuth-app windows are used when that list
  is absent. Percentages are used allowance; extra-usage money is converted from minor
  units. Disabled extra usage is omitted. Scoped names do not imply a universal plan
  limit. There is no Claude reset-credit spend action.
- **Antigravity:** discovers the project through `loadCodeAssist`, then calls
  `retrieveUserQuotaSummary`. `remainingFraction` is converted to used allowance;
  an omitted fraction stays unknown. The most-used known bucket per group is marked
  important for broad line summaries. The project id is not exposed as a plan or tier.
- **Synthetic:** reads `/v2/quotas`. Count windows use requests divided by a positive
  limit; weekly usage is the complement of the reported remaining percentage. An
  existing meter with missing numbers stays visible as unknown. Subscription duration
  is unspecified; a past regeneration time is not taken as evidence of a full reset.
- **Codex (ChatGPT):** reads ChatGPT `/backend-api/wham/usage`, not OpenAI API billing. Window
  duration comes from the response: primary does not always mean 5h. Reset credits
  are counts, not money. Paid overage balances are not reported here.
- **xAI:** reads both `/v1/billing?format=credits` and `/v1/billing` on the Grok CLI
  billing service. A zero monthly limit is omitted, not shown as exhausted. An omitted
  usage percentage is treated as unused only while the reported period is still active;
  after it ends the value is unknown. If both requests fail, the refresh fails.
- **OpenRouter:** reads `/api/v1/credits` and `/api/v1/key`; both requests must succeed.
  Remaining account credit is total minus usage, floored at zero; key remaining credit
  is the fallback when account totals are unavailable. A null key limit means no key cap.
  Spend breakdowns are detail text, not independent allowance windows.
- **DeepSeek:** reads `/user/balance`, preferring USD over the first balance entry.
  Supported currencies are USD and CNY. Missing usable amounts produce an error or an
  unknown balance, never a fabricated zero. There are no timed windows or concurrency
  counters.

## Codex login

Pi's `openai` login ("Sign in with ChatGPT") is rejected with HTTP 401 by the ChatGPT
usage endpoints, and `/login openai-codex` adds duplicate Codex models to the model
picker. The `codex` quota source therefore resolves its credential in this order:

1. Pi's `openai-codex` login, if one is stored (`/login openai-codex`).
2. Otherwise pi-quotas' dedicated file `<agentDir>/quotas-codex-auth.json`.

`/quota codex login [--device|--browser]` (also `/quota login codex`, or any `codex`
alias) runs the Codex OAuth login and writes that file, without registering models.
`--device` forces the device-code flow, `--browser` the browser callback flow; the
default uses the browser and falls back to the device code when the local callback
server cannot start. It needs an interactive
session. An existing pi-quotas file keeps working without a new login, and its token is
refreshed under a file lock, so parallel sessions never spend the same refresh token.
The Providers tab shows the sign-in state of whichever credential is used.

## Status line

Choose `quotas.linePlacement` in `/auth settings`, or press `p` in the Quotas tab:

| Placement | Location |
|---|---|
| `above-editor` | Widget above the editor |
| `below-editor-first` | Widget immediately below the editor (default) |
| `below-editor-last` | Last/footer rows; integrates with pi-workbench's footer when available, otherwise uses its own footer |
| `off` | Hidden; refresh and reporting continue |

With pi-workbench loaded, the quotas become one segment (`pi-auth-plus:quotas`) in its
configurable statusline, and every placement above stays dormant: the statusline decides
where and how the line appears. Enable it in `/workbench statusline`; removing the item
hides the line without changing this setting.

One template applies at every width. Below `quotas.compactWidthCols` (default 100),
`id` fields and automatic summaries shorten; `quotas.alwaysShortIds` forces that at all widths. The line
wraps at ` · ` or `{sep}` boundaries, then inside oversized segments. It reserves eight
terminal rows for the rest of Pi; overflow is marked with the total quota row count.
Inspect the full template using the Settings tab's paged preview.

### Template reference

Write literal text and `{provider:field}` tokens in `quotas.lineTemplate`. Provider ids
and accepted aliases are case-insensitive. Unknown tokens and invalid styles are ignored
and listed by the Settings preview. Disabled providers contribute no token output.

| Field | Value |
|---|---|
| `id` | Token's provider spelling on wide terminals; compact id on narrow terminals |
| `name` | Full provider display name |
| `short` | Compact id at every width |
| `tier` | Reported plan badge, when available |
| `credits`, `credits-remaining` | Remaining balance, two decimals and provider currency |
| `pct` | Primary important window percentage; follows `quotas.percentDisplay` |
| `wins` | Important windows, or first two if none are marked important; follows `percentDisplay` |
| `rst` | Primary window's reset countdown |
| `bar` | Primary window's six-cell used-allowance bar |
| `resets-available` | Bare positive reset-credit count; empty for zero or unknown |
| `r` | Positive reset-credit badge in the form `(r 1)`; otherwise empty |
| `window-<period>[-<scope>]-used-percent` | A specific window's used percentage |
| `window-<period>[-<scope>]-remaining-percent` | A specific window's remaining percentage |

Named windows must match exactly one period/scope, such as `5h`, `7d`, `7d-opus`,
`1h-search`, `7d-gemini` or `7d-gemini-4-argon`. Periods/scopes are lowercased and
punctuation becomes hyphens. Missing or ambiguous matches show `?`. Explicit used and
remaining fields ignore `percentDisplay`. Named percentages round to whole percentages.

`{provider}` renders its automatic summary. Comma-separated fields combine values:
`{claude:short,wins,rst}`. Identity plus metrics automatically adds `: `.
`{all}` renders enabled providers not explicitly placed elsewhere; `{all:short}` forces
short summaries. `{sep}` inserts a preferred break, displayed as ` · ` within a row.

`{in-use}` renders like `{all}`, but only providers the session actually uses: the current
model's provider, providers of running subagents, and any provider under quota pressure
(a window at 90% used or a balance below the critical threshold). `{in-use:short}` forces
short summaries. Use `{provider:in-use}` as a gate: the segment renders only when that
provider is in use, so `[{codex:in-use,id,pct}]` disappears for a session without Codex.

Square brackets make a conditional segment: its directly referenced values must all
be available. Real usage zero and balance zero count as available; zero reset credits
do not. A missing nested group does not hide its parent. Keep the preceding space inside
the group:

```text
{codex:id}: {codex:window-7d-used-percent}[ ({codex:resets-available}r)]
```

With 27% usage and one credit this reads `codex: 27% (1r)`; without a credit it reads
`codex: 27%`. Before data arrives, fields show `…`; missing login shows `login`;
an error without usable windows or balance shows `err`; unknown metrics show `?`.

Escape literal brackets, braces and backslashes with a backslash; double the backslash
inside JSON strings. Token styles follow `|`:

```text
{claude:id|fg=#cba6f7,bold}: {claude:window-5h-used-percent|fg=warning,underline}
```

`fg` and `bg` accept Pi theme color tokens or `#rgb`/`#rrggbb`. Attributes are `bold`,
`italic`, `underline` and `strikethrough`. Explicit colors override automatic metric
colors for that token. Credit thresholds control appearance, not limits or currency
conversion. Bars and automatic stress colors always measure used allowance.

Examples:

```text
{all}
{claude:short,wins,rst}{sep}{codex:short,pct}[ ({codex:resets-available}r)]
{openrouter:id}: {openrouter:credits-remaining} · {deepseek:id}: {deepseek:credits-remaining}
```

The exact default template is:

```text
{openrouter:id}: {openrouter:credits-remaining} · {deepseek:id}: {deepseek:credits-remaining} · {codex:id}: {codex:window-7d-used-percent}[ ({codex:resets-available}r)] · {claude:id}: 5h/{claude:window-5h-used-percent} 7d/{claude:window-7d-used-percent}[ ({claude:resets-available}r)] · {antigravity:id}: gem/{antigravity:window-7d-gemini-used-percent} arg/{antigravity:window-7d-gemini-4-argon-used-percent} · {synthetic:id}: {synthetic:window-7d-used-percent}[ ({synthetic:resets-available}r)] · {xai:id}: {xai:window-7d-used-percent}[ ({xai:resets-available}r)]
```

## Quotas tab

`/auth quotas [provider]`, `/quotas [provider]` and `/quota [provider]` open the same
live view. A provider argument starts in solo mode; `a` returns to all providers.
The panel shows every window, balances, reset countdowns, plan badges where reported,
fetch age, errors, login hints and observed drainage. Opening it does not itself fetch.
Without a TUI, these commands print cached text instead.

| Key | Action |
|---|---|
| Up/Down or `k`/`j` | Select provider; scroll within a provider taller than the view |
| `r` | Force refresh selected provider |
| `R` | Force refresh all enabled providers, even in solo mode |
| `a` | Toggle selected provider solo / all providers |
| `p` | Cycle line placement and save to user scope |
| `x` | Start the reset-credit flow for a supported provider |
| Tab / Shift+Tab | Switch dashboard tabs |
| Esc | Close |

Navigation follows Pi's configured keybindings; the hint row shows the current bindings.
See [commands](commands.md) for shared dashboard and Settings keys.

## Reset credits

Only `codex` supports spending reset credits. Use `x` on its Quotas row or
`/quotas reset [provider]` (also `/quota reset`, `resets`). With no provider, the first
enabled reset-capable provider is used: currently `codex`.

Credits are listed first; the soonest-expiring available credit is selected. The dialog
shows the credit and current windows. **Keep the credit** is the first choice; only
**Spend 1 credit now (cannot be undone)** authorizes one consume request. Dismissal,
missing UI or no redeemable credit spends nothing. Headless use only lists credits.

A consume is sent once and never retried. Every attempt is followed by a forced quota
refresh, including failures or a provider refusal. Outcomes are `reset`,
`nothing_to_reset`, `no_credit` or `already_redeemed`; only `reset` confirms a spend.
If a request fails or is interrupted, the credit may already be spent: list again with
`/quotas reset codex` and inspect before approving anything else. There is no CLI reset.
[Bus reset requests](events.md) still require the same in-session approval.

## Read-only CLI

```sh
pi --quotas-list
pi --quotas-list claude
pi --quotas-json codex
```

These flags print once and exit before Pi starts its terminal or session. The optional
provider must follow the flag; ids and aliases both work. JSON wins if both flags are
present. Pi's help, version and model-list flags take precedence; flags after `--` are
not interpreted as quota flags.

Only user settings apply: project trust and runtime overrides are unavailable here.
Credentials use Pi's refreshing auth path. The CLI syncs the host cache and refreshes
old requested entries through the same polling floors, leases and backoff as sessions.

- Exit **0**: every requested provider has state `ok`.
- Exit **1**: a provider is stale, unknown, errored, needs auth or rate-limited, or the
  query fails.
- Exit **2**: an unknown or disabled provider was requested; details go to stderr.

The table has Provider, Window, Used, Remaining, Resets at, On-Demand Resets and Drainage
(window/1h/24h) columns. On-Demand Resets is the provider-wide available reset-credit
count on the provider's first row; a reported zero shows `0`, an unreported count is blank. It uses Pi ids, one row per window or balance, original currencies and absolute
Europe/Zurich reset times with offset. Unknown percentages/balances show `?`; absent
reset times and rates are blank. Percentages have up to two decimals with `<0.01%` and
`>99.99%` boundary notation. Table diagnostics go to stderr; stdout contains the table.
Color requires a TTY; `NO_COLOR` or `FORCE_COLOR=0` disables it.

JSON is the versioned [QuotaReport](events.md#report-shape), with omitted unknown fields;
`resets.available` carries the reported reset-credit count. Use the bus `resets` request
for the individual credits. No CLI flag spends a credit.

## Shared cache, refresh and drainage

`<agentDir>/cache/auth-plus/quotas.json` holds snapshots, header observations, drainage,
refresh leases and backoff. Sessions sharing that agent directory share the cache.
Writes are locked and atomic; corrupt or incompatible cache data is ignored. Normal
refreshes use expiring 30-second leases to avoid duplicate polling.

Session start launches background refreshes. Every five seconds the engine syncs other
sessions' writes and checks whether enabled providers are due. The default endpoint
interval is 60 seconds; Claude has a five-minute floor and Antigravity a one-minute
floor. After a turn, `quotas.refreshOnRequest` refreshes the active provider with a
minimum age of two seconds, still honoring its floor. Rendering never fetches. Timers
and pending work stop with the session.

Failures retain older data with an error/backoff state. Generic failures back off for
30 seconds; HTTP 403/429 use 60 seconds or `Retry-After`, capped at 15 minutes. A forced
refresh bypasses freshness, leases and ordinary failure backoff, but never an active
403/429 hold. Hiding the line does not stop polling. `quotas.providers` selects sources;
an empty list enables all, while a nonempty list of only unknown names enables none.

Claude's `anthropic-ratelimit-unified-*` and ChatGPT's `x-codex-*` response headers update
cached windows without an extra quota request. Newer header values overlay endpoint
values without unknown values erasing known ones. Header observation time is separate
from endpoint freshness; receiving headers does not postpone an endpoint refresh.

Drainage is an estimate from real observations, not an invented usage counter. It needs
at least two observations spanning 60 seconds. Window rates are allowance per hour;
balance rates are money per hour. Window/1h/24h rates include sample coverage; the CLI
hides lookback rates below 80% coverage. A top-up, utilization drop or reset-time advance
of more than 60 seconds starts a new segment. ETA uses remaining allowance divided by a
positive observed rate, anchored to the latest observation. A reset before exhaustion is
flagged, and a passed reset without new evidence suppresses ETA (observed rates remain).
These are linear estimates, not predictions of provider policy.

See [configuration](configuration.md) for all settings and [migration](getting-started.md#migrating)
for pi-quotas carry-over.
