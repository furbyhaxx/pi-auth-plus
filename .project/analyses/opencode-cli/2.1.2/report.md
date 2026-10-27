---
document:
  type: "analysis"
  id: "opencode-cli-2.1.2"
  title: "OpenCode Zen free tier: the request fingerprint that separates opencode 2.1.2 from Pi"
  description: "Captures of a successful opencode 2.1.2 Zen request and of Pi's rejected one, the replay matrix that isolates the three checked elements (opencode/ user agent, x-opencode-client: cli, a session-affinity header, plus an <env> block in the system message), and the fix this implies for the opencode family."
  status: "published"
  revision: 2
  created_at: "2026-10-27T10:36:29+01:00"
  updated_at: "2026-10-27T10:42:48+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes:
        - "Captured opencode 2.1.2 and Pi requests through a logging proxy."
        - "Replayed 50 variants to isolate the accepted fingerprint."
        - "Verified the fix end to end against the live endpoint."
    - revision: 2
      reason: "transport gate confirmed after the fix landed"
      changes:
        - "Node's fetch is refused for byte-identical content that Bun's fetch gets through."
        - "Recorded the fix as shipped in src/families/opencode."
---

# OpenCode Zen free tier: the request fingerprint that separates opencode 2.1.2 from Pi

## Summary

Zen's free-tier gate rejects Pi's request because of two things, both outside `identity.ts`'s
current header rewrite: Pi sends no `x-session-affinity` (or `X-Session-Id`) header, and its system
message carries no `<env>` block. The user agent version is *not* the problem — `opencode/1.18.18`
is accepted as long as it starts with `opencode/` and `x-opencode-client` is `cli`.

Minimal accepted delta over what Pi sends today:

1. header `x-session-affinity: <the same ses_ id already in x-opencode-session>`;
2. the system message must contain `<env>` with a `Working directory:` line.

Both `x-opencode-request`, `x-opencode-project: global`, `Authorization: Bearer public`, the
`x-stainless-*` headers, the request path and the body's `max_tokens`/`reasoning_effort` are
accepted as Pi sends them. The delta is **not** headers-only: it needs a body hook.

## Reproduction

Environment: host `cachy-max`, IP unchanged throughout, `opencode v2.1.2`
(`/home/furbyhaxx/.opencode/bin/opencode`), Pi-Bolt `1.4.0 (Pi-Bolt 1.0.5, JIT off)`, repo
`/mnt/Projects/furbyhaxx/pi-auth-plus` at `dev` (baseline commit `git archive HEAD`, see below).

| run | command | result |
|---|---|---|
| Pi, patched | `pi-bolt -ne -e ./src/index.ts --no-session --model opencode/big-pickle -p "Reply with exactly: pong"` | `429 FreeUsageLimitError` |
| Pi, patched, through proxy | same with an agent dir whose `models.json` sets `providers.opencode.baseUrl` to the proxy | `429` (`captures/pi-with-patch-identity-headers-429.json`) |
| CLI | `cd /tmp && opencode run --standalone -m opencode/big-pickle "Reply with exactly: pong"` | `pong` |
| CLI, through proxy | same, config provider pointing at the proxy | `pong`, `200` (`captures/cli-2.1.2-opencode-big-pickle-200.json`) |

Capture method: `tools/proxy.ts`, a Bun server that logs method, path, all headers and the raw body,
forwards to `https://opencode.ai` with Bun's `fetch`, and records the upstream status. The CLI was
pointed at it with `OPENCODE_CONFIG_CONTENT` (a throwaway provider `zenprobe` with
`api: http://127.0.0.1:18900/probe`; the proxy rewrites `/probe/*` to
`/inference/openai/v1/chat/completions`). Pi was pointed at it with a temporary
`PI_CODING_AGENT_DIR` whose `models.json` sets `providers.opencode.baseUrl`. No user config was
touched: neither `~/.pi/agent/*` nor `~/.config/opencode/*`.

**A raw curl replay cannot reproduce the CLI verdict at all.** With byte-identical headers and body,
curl straight to `https://opencode.ai` gets `429` (replays 01–05), while the same request re-issued
by the proxy through Bun's `fetch` gets `200` (replay 06). Every replay below 06 therefore goes
through the proxy so that only the *content* varies. The mechanism for that transport split is not
determined (TLS/HTTP fingerprint, HTTP/2 vs HTTP/1.1, or a header curl rewrites); see open questions.

## The two observed requests

Path: Pi uses `https://opencode.ai/inference/v1` (its builtin `opencode` model data) →
`/inference/v1/chat/completions`; the CLI uses models.dev's `opencode.api` =
`https://opencode.ai/inference/openai/v1` → `/inference/openai/v1/chat/completions`. Replay 22 shows
the path is irrelevant.

Headers:

| header | Pi (429) | CLI 2.1.2 (200) | checked |
|---|---|---|---|
| `user-agent` | `opencode/1.18.18` | `opencode/latest/2.1.2/cli` | must start with `opencode/`; version and shape free |
| `x-opencode-client` | `cli` | `cli` | must be `cli` (`pi` → 429, replay 20) |
| `x-session-affinity` | absent | `ses_e834fe19fffefdSy5jRrv9iYk3` | **required**, `ses_`-shaped value |
| `X-Session-Id` | absent | same value | satisfies the same check (replay 18) |
| `x-opencode-session` | `ses_e834f928cffeB2ivyxwvf5Aic7` | same value as affinity | not checked by itself (42/14 pass without it) |
| `x-opencode-session-id` | absent | same value | not the checked header (replay 13) |
| `x-opencode-project` | `global` | `470c8549ef01a2a9d3c85b22965766cefc874134` | not checked (replay 15) |
| `x-opencode-request` | `msg_17cb06d75001stbF61fmUMekoa` | absent | not checked (replay 15/24) |
| `authorization` | `Bearer public` | absent in this capture (probe provider had no key) | not checked (`Bearer public` passes in 15/22/24/42) |
| `x-stainless-*`, `accept` | present / `application/json` | absent / `*/*` | not checked (replay 23 fails only because of the body) |
| `b3`, `traceparent` | absent | present | not required (replay 12/14 pass without them) |

Body: Pi sends `model, messages, stream, stream_options, max_tokens, tools, reasoning_effort`; the CLI
sends `model, messages, tools, stream, stream_options, max_completion_tokens`. `max_tokens` vs
`max_completion_tokens` and `reasoning_effort` are both accepted (replays 25, 26 still fail with Pi's
system message; 24 passes with the CLI body). The body difference that matters is the system message:
the CLI's prompt contains an `<env>` block, Pi's prompt contains none.

## Minimal accepted delta

Starting from Pi's exact captured request (replay 07, 429) the accepted set was found by adding and
removing one element at a time; see `captures/replay-matrix.md` for all 50 replays and their statuses.

1. **A session-affinity header.** `x-opencode-client: cli` + an `opencode/` user agent + nothing else
   is rejected (09). Adding `x-session-affinity` (14) or `X-Session-Id` (18) makes it `200`.
   `x-opencode-session-id` does not (13).
2. **Its value must be a plausible session id.** `not-a-session` (21) and `ses_x` (47) are rejected;
   `ses_` + 26 `a`s (48) and a 24-character synthetic id (49) are rejected; Pi's own
   `ses_e834f928cffeB2ivyxwvf5Aic7` is accepted (16, 22, 24), and so is a freshly generated
   `ses_<12 hex>B2ivyxwvf5Aic7` (50). The exact validation beyond "26-character `ses_` id" is
   undetermined; `identity.ts`'s current `ses_` values are accepted.
3. **An `<env>` block with a working directory in the system message.**
   25 and 26 (Pi's system message, `429`) and 27 (the CLI's system message, `200`) hold every header
   and the rest of the body constant; 28 replaces only the tools and stays `429`. That isolates the
   system message. Bisecting the CLI prompt gives chars 7568–8650 (41), then `<env>`,
   `Working directory:`, `Workspace root folder:`, `Is directory a git repo:`, `Platform:`,
   `Prefer …`. Direct reconstruction: Pi's prompt +
   `<env>\n  Working directory: /tmp\n  Platform: linux\n</env>` → `200` (42);
   `<env>Working directory: /tmp</env>` → `200` (45); empty `<env></env>` → `429` (44); bare
   `Working directory: /tmp` without the element → `429` (46); the introductory sentence alone →
   `429` (43). Tools (28), `max_tokens` naming (26), `reasoning_effort` (25) and simple
   `opencode`/`OpenCode` markers (29–31, 38, 39) change nothing.

Complete fingerprint for a free-model request: `user-agent: opencode/…`, `x-opencode-client: cli`,
`x-session-affinity: ses_…` (or `X-Session-Id: ses_…`), and a system message containing
`<env>…Working directory: …</env>`. Nothing else observed in either request is checked.

## Headers-only or body?

Body. `src/families/opencode/identity.ts` can add `x-session-affinity` in
`before_provider_headers` (one line), but the `<env>` block needs a second hook that can rewrite the
payload. `before_provider_request` runs *before* `before_provider_headers` in Pi
(`node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js:206` builds `transformHeaders` for
the transport; the payload transform is registered separately), so the payload hook cannot use the
`x-opencode-*` stamp to identify a Zen request. The candidates are `context_with_system` (full
message list per model call, with `ctx.model` as a hint) or `before_provider_request` plus a
family-owned set of the opencode model ids. End-to-end proof that the two changes are sufficient:
`captures/tools/harness.ts` applies exactly those two deltas from outside the repository, and the
unmodified extension plus that harness answers `pong` (exit 0) on the live endpoint, while the same
extension alone and the same extension with only the header delta both return `429`.

## How the CLI produces the ids and the version

From the compiled 2.1.2 binary (`captures/cli-2.1.2-request-assembly.js.txt`,
`captures/cli-2.1.2-system-prompt-strings.txt`; the CLI is a Bun single-file binary, so the
minified chunk text is the source of record here — upstream `sst/opencode` file paths for this
release were not verified):

```js
function eJ(H = {}) { return { name: H.name ?? "opencode", version: H.version ?? "unknown",
                                channel: H.channel ?? "unknown" }; }
function rl(H) { return `opencode/${H.channel}/${H.version}/${H.name}`; }   // User-Agent
// per generation:
eH = YN(session),
headers = {
  "x-opencode-session-id": session.id,
  ...(session.parentID ? { "x-opencode-parent-session-id": session.parentID } : {}),
  "x-session-affinity": eH, "X-Session-Id": eH,
  ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
  "User-Agent": rl(app), "x-opencode-project": session.projectID,
  "x-opencode-session": eH, "x-opencode-client": app.name,
},
promptCacheKey = /^ses_[0-9a-f]{64}$/.test(eH) ? eH.slice(4) : eH
```

- User agent: four segments, `opencode/<channel>/<version>/<name>`; observed
  `opencode/latest/2.1.2/cli` (`name` comes from `OPENCODE_CLIENT`, default `cli`; `channel` is
  `latest`). Pi's two-segment `opencode/1.18.18` is accepted, so no version check applies.
- Session ids: `ses_` + 26 characters, e.g. `ses_e834fe19fffefdSy5jRrv9iYk3`. Pi's parallel value
  proves the encoding is the same descending-ULID scheme `identity.ts` implements: Pi's
  `ses_e834f928cffe…` and `msg_17cb06d75001…` are the bit-inverse pair of one 48-bit
  `ms*0x1000+counter` stamp.
- `x-opencode-project` is a 40-hex project id (`470c8549…` for `/tmp`), not the literal `global`.
- The prompt's `<env>` block is assembled from constants (`Working directory`, `Workspace root
  folder`, `Is directory a git repo`, `Platform`, `Prefer …`) and is emitted on every request.

## Recommended fix

`src/families/opencode/identity.ts` — add the affinity header in `applyCliIdentity`, next to the
session header it already sets (the value is the same id, and the gate accepts it):

```ts
setHeader(headers, "x-session-affinity", sessionId);
```

`src/families/opencode/index.ts` — beyond that, the family needs one body hook that appends the
block to the system prompt for Zen requests, e.g.

```ts
pi.on("before_provider_request", (event) => {
  const payload = event.payload as { model?: unknown; messages?: { role?: string; content?: unknown }[] } | undefined;
  if (!payload || !Array.isArray(payload.messages)) return;
  const system = payload.messages.find((message) => message.role === "system");
  if (!system || typeof system.content !== "string" || system.content.includes("<env>")) return;
  system.content += `\n\n<env>\n  Working directory: ${ctx.cwd}\n  Platform: ${process.platform}\n</env>`;
  return payload;
});
```

with the Zen filter decided by the lead: `before_provider_request` carries no provider id and runs
before `before_provider_headers`, so either scope it by the opencode model ids the family knows, or
move both changes to `context_with_system` where `ctx.model.provider` is available (as a hint, per
`AGENTS.md`). `x-opencode-request`, `x-opencode-project: global` and the pinned `CLI_VERSION` can
stay: all three are accepted, and dropping them is not required by this evidence.

Regression test: capture a Zen free-model request with a fake transport and assert the shaped request
carries `x-session-affinity`, `x-opencode-client: cli`, and a system message containing
`<env>` with a `Working directory:` line. The existing fake-Pi test in
`tests/families/opencode.test.ts` already captures shaped headers, so the header half is a one-line
assertion there; the body half needs a `before_provider_request` handler in its `fakePi` and a
system-message assertion.

Same pattern elsewhere: none — the other families patch providers that never proxied through Zen.

## Open questions / follow-ups

- The exact affinity-value validation is undetermined: 26 `a`s and a 24-character id were rejected,
  two 26-character `ses_` ids with mixed-case tails were accepted. A future probe could pin the regex.
- Why curl's own transport is rejected while Bun's is accepted for identical content is undetermined.
  If Zen is fingerprinting the transport, any fix that only changes headers and body keeps working
  from Pi (verified live), but a rolling pin of `CLI_VERSION` cannot help a rejected transport.
- `.project/analyses/opencode-cli/tracking.md` (required by `AGENTS.md` for this client) does not
  exist in this checkout; it needs the 2.1.2 row: user agent, the five `x-opencode-*`/`x-session-*`
  headers, the `<env>` prompt block, and this report as the live verification.
- While this analysis ran, another agent was editing `src/families/index.ts` and adding
  `src/families/synthetic/`; `pi-bolt -e ./src/index.ts` failed to load ("JSON Parse error") from
  10:34 on. All verification above therefore used a `git archive HEAD` snapshot
  (`/tmp/zenproxy/snap`), which loads and reproduces both the `429` and the fixed `200`.

## Transport gate (revision 2)

The fix (affinity headers plus the `<env>` block, shipped in `src/families/opencode/`) answers
`pong` from Pi-Bolt on `big-pickle` and `nemotron-3.5-lightning-free`. Stock Pi still gets `429`,
under Node and under Bun alike, yet the same stock-Pi request answers `pong` when a Bun proxy
forwards it. Stock Pi installs an undici `EnvHttpProxyAgent` as the global fetch dispatcher
(`pi-coding-agent/dist/core/http-dispatcher.js`), so it never uses the runtime's native fetch.

Replaying one captured request byte for byte from `/tmp` (2026-10-27, same host and IP):

| client | status |
|---|---|
| Node 26.11.1 global fetch | 429 (twice) |
| Bun global fetch | 200 (twice) |
| undici `Agent({ allowH2: false })` | 429 |
| undici `Agent({ allowH2: true })` | 429 |
| Node fetch without `x-stainless-*`, `accept-language`, `sec-fetch-mode` | 429 |

Zen's free tier therefore also gates on the HTTP/TLS client, which matches curl being refused in
replays 01-05. The CLI is a Bun binary, and Pi-Bolt uses Bun's fetch. Header or body shaping cannot
make stock Pi pass; anonymous free models work from Pi-Bolt only. Keyed paid models are not
covered by this evidence (no Zen key on this host).

