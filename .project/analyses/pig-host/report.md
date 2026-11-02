---
document:
  type: "analysis"
  id: "pig-host"
  title: "pig host: four root causes"
  description: "Why claude returned 429, quotas and the line were missing, and the token service was silent when the package ran under the pig host, with the evidence and the fix in 0.5.2."
  status: "published"
  revision: 1
  created_at: "2026-11-02T14:52:04+01:00"
  updated_at: "2026-11-02T14:52:04+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["four pig-host defects reproduced, root-caused and live-verified against pig 0.5.3+1.4.0.74f46864"]
---

# pig host: four root causes

Reported under `pig` 0.5.3 (`+1.4.0.74f46864`), package `0.5.1`:

1. `claude` answered every turn with `429 {"type":"error","error":{"type":"rate_limit_error","message":"Error"}}`.
2. `/auth` reported “pi-quotas is loaded and still owns quotas”.
3. The dashboard showed `Claude signed in` next to `Recovery claude: Claude token counting … needs authentication`.
4. No quota line without pi-workbench.

None of them is a pig bug alone; each is a host assumption this package made that Pi satisfies
and pig does not. Fixed in 0.5.2 (`v0.5.2`), verified with the installed package under pig.

## 1. The request body arrives already serialized

**Symptom.** Every attempt fails with `429 rate_limit_error`; the same account works from
pi-bolt (`claude/claude-haiku-5-5`, `ok`).

**Evidence.** A local capture proxy (`ANTHROPIC_BASE_URL`) recorded what each host sends. Both
shaped the headers (`user-agent: claude-cli/2.1.316 (external, cli)`, `x-app: cli`, the beta
list, `?beta=true`). The bodies differed:

| Field | pi-bolt | pig |
|---|---|---|
| `system[0]` | billing header | the harness prompt |
| identity block | `You are Claude Code, Anthropic's official CLI for Claude.` | absent |
| `metadata.user_id` | present | absent |
| key order | Pi's insertion order | alphabetical (serialized by the host) |

Replaying both captured bodies against the live API reproduced it deterministically: pi-bolt's
body `200`, pig's body `429`, and pig's body with the identity and billing blocks prepended
`200`. The blocks do not come from Pi's provider; they are added by this package's fetch
wrapper. Instrumenting `claudeFetch` showed why:

```text
[probe] input=string initBody=[object Uint8Array] body=[object Uint8Array] shaped=false
```

pig builds the request in its own provider implementation and hands the wrapper an encoded
`Uint8Array`; `if (typeof body === "string")` skipped `shapeBody`. OAuth turns without the
identity blocks and `metadata.user_id` are refused with 429, not 401.

**Fix.** `src/families/anthropic/transport.ts` reads the body as text whoever serialized it
(string, `Uint8Array`, `ArrayBuffer` view, `Blob`) before shaping. Stale body headers are
dropped and the fetch layer recomputes them.

## 2–4. Session ownership keyed on host object identity

**Symptom.** Settings from `<agentDir>/auth-plus.json` were ignored, quotas never started (the
UI then printed its “pi-quotas is loaded” fallback), the quota line never mounted, and the token
service never answered a `queryTokens` request.

All four come from one mechanism: `src/index.ts` kept a `WeakMap` from the `session_start`
**event object** to session state. Pi passes one object to every handler; pig snapshots a fresh
one per handler:

```text
handler 1: sameAsFirst=true
handler 2: sameAsFirst=false      (same emission, same snapshot shape)
other extension: keys=["type","reason"]   (same emission)
```

So every later handler's lookup missed and returned early. The settings handler never stored
its store (hence no user settings and no `startup.store` for the quota handler), the quota
handler never ran `loadsPackage` at all, the line never mounted, and `registerTokenBus` never
registered.

**Fix.** Session state is module-level; each emission is still keyed by object identity when
the host preserves it, and falls back to the current session when it does not. A replacement
swaps the state out and aborts the old signal, so the existing staleness guards keep working
(the lifecycle suite's overlapping-startup cases still pass). `session_shutdown` ownership gets
the same fallback. The unavailable-quota message now names its reason: only a real pi-quotas
load says “pi-quotas is loaded”.

## The token bus was also dropping payloads

Found while verifying 3: even with the service registered, `queryTokens` timed out. Two
payload defects, both independent of pig:

- `redactValue` collapsed a value the payload reuses into `"[circular]"`. An unanchored
  `ContextReport` shares one `TokenCount` between `tokens` and `tail`, so every such reply and
  every `tokens:context` broadcast failed validation. Redaction now copies reused values and
  only collapses real cycles.
- Pig's typed container turns an absent optional field into `null`; the decoders rejected
  `anchor: null`. `optionalFields` now reads `null` as absent.

`redactValue` also stopped inventing keys for `undefined` values, so a payload stays
JSON-faithful across a host boundary.

## Where the paths went

`agentDir()` resolved `~/.pi/agent` under pig, which keeps `~/.pig/agent`. That read the wrong
`auth.json`, dropped `~/.pig/agent/auth-plus.json`, and cached quotas in the wrong tree.
pig's extension host reports its resolved directories in `PIG_EXT_HOST_INFO`
(`agentDir`, `configDirName`); `core/paths` now prefers that report, then
`PI_CODING_AGENT_DIR`/`PIG_CODING_AGENT_DIR`, then `PIG_HOME`, then Pi's defaults. The project
file follows the host: `<cwd>/.pig/auth-plus.json` on pig.

## Verification (installed package 0.5.2 under pig)

- `pig -p "Reply with exactly: ok" --model claude/claude-haiku-5-5` → `ok`.
- `/auth`: `Claude: signed in · expires in 6h 41m`, no Recovery line, no pi-quotas text.
- `/quotas`: live windows for Claude (`7d 34%`, `fab 0%`, `cap 100%`), Codex, Synthetic,
  OpenRouter credits, DeepSeek credits; `needs auth` only for the two providers without a slot.
- `/tokens`: `claude-haiku-5-5`, `22.9K · estimate`, `Anchor: No provider usage yet`, no
  `needs-auth` diagnostic.
- Quota line, tmux capture (no pi-workbench), 140 columns:

  ```text
  openrouter: 8.78$ · deepseek: 9.05$ · codex: 35% (1r) · claude: 5h/? 7d/34% · antigravity: gem/login arg/login · synthetic: 8% · xai: login
  ```

  At 80/57/36 it drops to short ids and wraps, staying inside each width.
- pi-bolt unchanged: `pi-bolt -p … claude/claude-haiku-5-5` → `ok`; `just rpc-verify`,
  `just parity-verify`, `just aot-verify`, `just check` (1241 tests) green.

## Follow-ups

- pig's snapshotting also applies to `ctx`, so any future handler that keys state on a context
  object reintroduces this class of defect. Keep per-session state module-level.
- Anonymous OpenCode Zen still needs Bun's fetch; pig's extension fetch is not Bun's, so the
  Zen free tier remains a Pi-Bolt-only path until that is measured separately.
