---
document:
  type: "analysis"
  id: "analysis-cli-report"
  title: "Pre-TUI quota reports and observed drainage verification"
  description: "Startup reproduction, full per-window reporting, persisted drainage, live provider evidence and terminal/RPC acceptance checks"
  status: "published"
  revision: 2
  created_at: "2026-10-26T10:55:01+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "orchestrator"
  updated_by: "pi"
  source: "pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/analyses/cli-report/report.md"
  changelog:
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-quotas@78268296fed62ba14601b8cb80f1ff45a5c04796:.project/analyses/cli-report/report.md"]
---

# Result

The one-shot CLI now completes in the awaited extension factory, before terminal startup.
The previous `session_start` handler ran after `ui.start()`, so normal terminal redraw and
shutdown erased output and forced exit `0`. Piped output alone did not exercise that bug.
The startup regression failed before the change and now passes in both terminal modes.

The report has one row per normalized window, Pi provider IDs, fractional percentages,
monetary balance rows, Zurich timestamps with offsets and all nine requested columns.
Narrow output wraps cells and continues columns in additional tables. Raw normalized
fields survive in JSON. A reported Codex reset count of zero remains zero.

Drainage uses real observations, with coverage and observation-dated estimates. Cached
reads do not create samples. Drops, top-ups and reset advances restart conservative
segments. Header subsets no longer discard endpoint-only windows or rich labels.

# Checks

- `just check`: typecheck and Biome passed; **25 tests, 479 assertions, zero failures**.
- `just rpc-verify`: exit `0`; `/quota` registered from this checkout. Unrelated model
  scope warnings appeared on stderr. Filtered registration evidence: `captures/rpc-command.json`.
- Eight real PTYs: fullscreen and regular at **36, 57, 80, 140** columns. No alternate-screen,
  cursor-hide or screen-clear startup sequences. Maximum visible widths were respectively
  **36, 57, 80, 135** columns. Captures: `captures/{fullscreen,regular}-<width>.txt`.
- Piped JSON parsed successfully. `codex`, `openai`, `oai`, `google` and `ag` selected the
  expected Pi identity and returned exit `0`. The captured degraded report returned `1`;
  an invalid provider returned `2`, with empty stdout and usage diagnostics on stderr.
- `git diff --check` passed. Capture scanning found no bearer strings or common token
  forms; credential headers were explicitly redacted before persistence.
- Detailed machine-readable results: `captures/terminal-results.json` and
  `captures/evidence-checks.json`.

# Live observations

Read-only quota requests succeeded for `openrouter`, `deepseek`, `openai`, `google`,
`synthetic` and `xai`. Claude's usage endpoint returned **HTTP 429**. A retry after backoff
also returned 429; fresh Claude quota/drainage is **UNVERIFIED**. No reset was consumed.
The private Claude reset-list and claim routes were not called.

Captured credential-redacted exchanges:

- `captures/live-exchanges.json`: first shared-cache read, 9 requests.
- `captures/second-live-exchanges.json`: later shared-cache read, 9 requests.
- `captures/isolated-first-live-exchanges.json`: isolated baseline, 9 requests.
- `captures/isolated-second-live-exchanges.json`: second isolated observation, 8 requests;
  Claude was excluded to avoid further retries.

Older installed sessions rewrite the host cache without the new `history` field. This
was confirmed in their installed cache writer; the shared-cache CLI read could also
become healthy again when another session refreshed Claude. The final drainage evidence
therefore uses an isolated cache with real read results, not fabricated usage samples.
After updating the extension, restart older sessions so their writers stop dropping history.
No installed extension or remote repository was changed during this verification.

The final PTY and JSON checks use a frozen copy of the isolated cache, with no credentials
and a 3600-second freshness interval, so rendering checks cannot poll providers. The Claude
error entry was restored from its captured 429 exchange at the exchange's actual timestamp;
it is replayed diagnostic evidence, not a fresh successful quota read.

`captures/isolated-live.json` and `captures/observation-history.json` preserve the report
and underlying samples. Independent arithmetic against the captured sample deltas verified:

- `openrouter`: **0.8521526533422786 $/h**, over **202.726 seconds**; observation-relative
  exhaustion estimate **44641.34508810725 seconds**.
- `deepseek`: **0.1775936066301654 $/h**, over **202.71 seconds**; observation-relative
  exhaustion estimate **55339.82999999872 seconds**.

These are short observed net-change rates, not a full hour/day of evidence. The 1h and 24h
columns expose their actual coverage. Unchanged windows have a measured zero rate and no
exhaustion estimate; windows with advancing reset dates conservatively restart history.

# Review resolution

Regression tests reproduced and fixed header subset loss, read-time pruning of historical
lookbacks, copied-forward reset timestamps, expired-reset estimates and future-dated disk
samples. ETA now anchors to the last observation rather than the time a cached report is
printed; a scheduled reset preceding exhaustion suppresses the numerical ETA.

The existing strict-newer observation policy remains: duplicate or late arrivals do not
rewrite an already-recorded observation. Cross-cache merge ordering stays deterministic.
`resetAtMs` and derived `resetAt` both remain in report windows; the table uses the raw field.
Only the documented `--list-quotas [provider] [--json]` syntax is supported; an equals-form
provider selector was not added.

# Delivery boundary

Changes are committed locally. Push and installed-extension update require explicit user
authorization. Event-bus APIs, reset consumption and status-line templates remain design-only;
`.project/designs/quota-surfaces/design.md` preserves those decisions. Claude fresh usage
remains blocked by the provider's HTTP 429 response, without invented quota or reset counts.
