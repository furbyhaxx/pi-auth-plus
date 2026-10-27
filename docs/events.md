# Quota event bus

Other Pi extensions use `pi.events` to read, refresh and observe quotas. The namespace
is `pi-auth-plus:v1:quotas:`. Payload changes within v1 are additive; consumers should
ignore unknown fields. Provider inputs accept [registry aliases](quotas.md#providers);
outputs use Pi ids. Payloads contain no credentials or account/project identifiers.

The service belongs to the current session. It is registered at session start and
removed on shutdown; in-flight replies are suppressed after disposal. It is unavailable
while pi-quotas is loaded. Do not treat a missing reply as zero usage or approval.
Pi emits synchronously without awaiting listeners: always subscribe before emitting and
wait for a correlated reply, not the return value of `emit`.

## Client helpers

Import from `@furbyhaxx/pi-auth-plus/bus`:

```typescript
import {
  queryQuotas,
  refreshQuotas,
  listQuotaResets,
  requestQuotaReset,
  QuotaBusError,
} from "@furbyhaxx/pi-auth-plus/bus";
```

| Helper | Arguments after `pi.events` | Resolves to |
|---|---|---|
| `queryQuotas` | Optional `{ providers?: string[], maxAgeSec?: number }`, optional request options | `QuotaReport` |
| `refreshQuotas` | Optional `{ providers?: string[], force?: boolean }`, optional request options | `QuotaReport` |
| `listQuotaResets` | Provider string, optional request options | `ResetCreditList` |
| `requestQuotaReset` | `{ provider: string, creditId?: string, confirm: true }`, optional request options | `ResetOutcome` |

`QuotaRequestOptions` has `timeoutMs?: number` and `signal?: AbortSignal`. Helpers reject
with `QuotaBusError`, whose `reason` is `rejected` (service refusal), `timeout` (no valid
reply in time), or `aborted` (caller cancellation). Cancellation/timeout stops waiting;
it cannot undo a reset already approved or a consume already sent. Never retry a reset
automatically. Allow enough time for its human confirmation dialog.

For example, inside another extension's session-start handler:

```typescript
pi.on("session_start", async (_event, ctx) => {
  try {
    const report = await queryQuotas(
      pi.events,
      { providers: ["cc"], maxAgeSec: 60 },
      { timeoutMs: 15_000 },
    );
    const claude = report.providers.find((provider) => provider.id === "claude");
    const used = claude?.windows[0]?.usedPercent;
    ctx.ui.notify(`Claude: ${used === undefined ? "unknown" : `${used}% used`}`, "info");
  } catch (error) {
    if (!(error instanceof QuotaBusError)) throw error;
    ctx.ui.notify(`Quota request ${error.reason}: ${error.message}`, "warning");
  }
});
```

Listen for `ready` or query after the service has started; extension listener ordering
can affect availability during session startup. Do not wait indefinitely for a `ready`
broadcast that may already have happened.

## Wire request/reply

For each operation below, send to `pi-auth-plus:v1:quotas:<operation>`:

```typescript
{ nonce: "unique-request-id", payload: { /* operation fields */ } }
```

Subscribe first to `pi-auth-plus:v1:quotas:<operation>:reply`. Replies use that same
operation-specific channel, with the matching nonce:

```typescript
{ nonce: "unique-request-id", payload: { v: 1, ok: true, report: { /* QuotaReport */ } } }
{ nonce: "unique-request-id", payload: { v: 1, ok: false, error: "Recovery information" } }
```

The nonce is a string supplied by the caller. Filter replies by nonce and remove the
listener on completion, timeout or cancellation. It is correlation, not an authorization
token. Malformed envelopes/payloads are silently dropped, so callers need a timeout.
Valid but unknown/disabled provider requests receive an explicit failure. A successful
report reply can still contain provider errors: inspect `state`.

| Operation | Request payload | Success payload (inside envelope) |
|---|---|---|
| `query` | `{ providers?: string[], maxAgeSec?: number }` | `{ v: 1, ok: true, report: QuotaReport }` |
| `refresh` | `{ providers?: string[], force?: boolean }` | `{ v: 1, ok: true, report: QuotaReport }` |
| `resets` | `{ provider: string }` | `{ v: 1, ok: true, resets: ResetCreditList }` |
| `reset` | `{ provider: string, creditId?: string, confirm: true }` | `{ v: 1, ok: true, outcome: ResetOutcome }` |

Omitted `providers` selects enabled quota providers; `[]` selects none. Aliases are
resolved and duplicates removed. Explicit disabled providers are rejected, not enabled
by the request.

`query` without `maxAgeSec` reads cached state. A finite nonnegative `maxAgeSec` requests
refresh of older/missing endpoint data (minimum requested age: one second), respecting
provider floors, leases and backoff. `refresh` attempts each selected source with a zero
requested age but still observes floors; `force: true` bypasses freshness, leases and
ordinary failure backoff. Active HTTP 403/429 holds are never bypassed.

### Reset approval

`resets` is read-only. Only enabled `openai` has reset support. `reset` needs both
`confirm: true` and the user's explicit approval in the owning session's UI. Missing or
false confirmation receives a refusal. Missing UI or a dismissed dialog also refuses.
The dialog identifies that another extension requested the action, with **Keep the
credit** first. Supplying `confirm: true` never substitutes for the dialog.

`creditId` selects an available credit; when omitted, the soonest-expiring available
credit is used. Unavailable credits are rejected. The consume request is sent once,
never retried, then quota refresh is attempted even on failure. A bus timeout or abort
is not evidence that a credit was kept. List again before any further user-approved
attempt. An `ok: true` outcome still needs its `code` checked.

## Broadcasts

Broadcast payloads are direct objects, without nonce envelopes. Subscribe with
`pi.events.on(channel, listener)` and call its returned unsubscribe function on disposal.

### `pi-auth-plus:v1:quotas:ready`

Emitted when the session's service is registered:

```typescript
{
  v: 1,
  providers: [{ id: "claude", aliases: ["cl", "cc"] }],
  capabilities: ["query", "refresh", "resets", "reset", "snapshot", "event"]
}
```

`providers` lists all enabled sources, not just the example above. Capabilities advertise
service operations, not reset support for every provider.

### `pi-auth-plus:v1:quotas:snapshot`

```typescript
{ v: 1, provider: ReportProvider }
```

Emitted for changed provider views, including header updates and refresh-state changes.
It is a current report row, not a vendor response or a delta to apply. To obtain initial
state or resynchronize, use `query`.

### `pi-auth-plus:v1:quotas:event`

The payload is one of:

```typescript
{ v: 1, kind: "auth-required", provider: string, message?: string }
{ v: 1, kind: "rate-limited", provider: string, status: number }
{
  v: 1, kind: "reset-consumed", provider: string, code: "reset",
  windowsReset: number, requester: "panel" | "command" | "bus"
}
```

Auth/rate-limit events are emitted on state transitions, not on every failed poll.
`reset-consumed` is emitted only for the provider's confirmed `reset` outcome, not for
an attempted or declined spend. No credential, credit id or account id is broadcast.

## Report shape

The CLI JSON and successful query/refresh replies share:

```typescript
interface QuotaReport {
  v: 1;
  generatedAt: number;
  providers: ReportProvider[];
}
interface ReportProvider {
  id: string;
  title: string;
  short: string;
  state: "ok" | "stale" | "error" | "needs-auth" | "rate-limited" | "unknown";
  windows: ReportWindow[];
  credits?: ReportCredits;
  tier?: string;
  needsAuth?: boolean;
  fetchedAt?: number;
  ageSec?: number;
  source?: "endpoint" | "headers";
  error?: string;
}
interface ReportWindow {
  id: string;
  shortLabel: string;
  label: string;
  usedFraction?: number;
  valueText?: string;
  resetAtMs?: number;
  important?: boolean;
  group?: string;
  period?: string;
  scope?: string;
  usedPercent?: number;
  remainingPercent?: number;
  resetAt?: number;
  resetInSec?: number;
  drainage?: DrainageMetrics;
}
interface ReportCredits {
  remaining?: number;
  total?: number;
  used?: number;
  currency: string;
  detailText?: string;
  drainage?: DrainageMetrics;
}
interface DrainageMetrics {
  observedAt: number;
  window?: { perHour: number; coverageSec: number };
  h1?: { perHour: number; coverageSec: number };
  h24?: { perHour: number; coverageSec: number };
  etaSec?: number;
  resetsBeforeExhaustion?: boolean;
}
```

Timestamps are epoch milliseconds; ages/countdowns/coverage/ETA are seconds.
`usedFraction` is 0–1; percentages are 0–100. Window drainage rates are fractions per
hour (multiply by 100 for `%/h`), credit rates are currency units per hour. `resetAt`
aliases `resetAtMs`. Missing numbers remain absent (`undefined`, omitted in JSON), never
zero. A real zero is valid. `state: "ok"` means a current report without a provider-level
failure, not that every optional metric is known. Staleness is more than twice the
larger of the configured refresh interval and provider polling floor.

The report does not expose reset-credit counts; use `resets` for their authoritative
listing. Reset result shapes are:

```typescript
interface ResetCreditList {
  provider: string;
  fetchedAt: number;
  available: number;
  credits: ResetCredit[];
}
interface ResetCredit {
  id: string;
  type: string;
  status: string;
  title?: string;
  description?: string;
  grantedAtMs?: number;
  expiresAtMs?: number;
  redeemedAtMs?: number;
  supportedByPlan?: boolean;
}
interface ResetOutcome {
  provider: string;
  code: "reset" | "nothing_to_reset" | "no_credit" | "already_redeemed";
  creditId: string;
  windowsReset: number;
}
```

These channels replace pi-quotas's namespace and its wire envelope. Update raw bus
consumers rather than changing only the channel prefix; prefer the client helpers.
