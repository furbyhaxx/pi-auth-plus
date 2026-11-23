---
document:
  type: "analysis"
  id: "ANALYSIS-AGY-1.5.15-DELTA"
  title: "agy 1.5.15 delta for the antigravity provider"
  description: "What the 1.5.15 public surface changes for pi-auth-plus, verified from the installed CLI and the knowledge-base capture"
  status: "published"
  revision: 1
  created_at: "2026-11-23T17:00:00+01:00"
  updated_at: "2026-11-23T17:00:00+01:00"
  created_by: "omp"
  updated_by: "omp"
  changelog:
    - revision: 1
      reason: "bump the pinned client from 1.4.8 to 1.5.15"
      changes:
        - "identity: version, binary size and sha256 of the installed 1.5.15"
        - "public-surface delta and what it changes in src/families/google"
        - "xhigh level handling and the unrecovered change-list value"
---

# agy 1.5.15 — delta for the antigravity provider

## Identity

| field | value |
|---|---|
| version | `1.5.15` (`agy --version`) |
| binary | `/home/furbyhaxx/.local/bin/agy` |
| binary size | 273,879,752 bytes |
| sha256 | `7b004d26c3fdea25a7c9d456de4bfaccef4be1e4cc7fd6db628859c5c941fa2d` |
| installed | 2026-11-23 (host package state, not re-installed for this analysis) |
| observed via | `agy --version`, `agy --help`, `agy changelog`, `sha256sum` |

The ten-part binary dossier remains [`../1.4.8/`](../1.4.8/README.md). The 1.5.15
public-surface capture and its synthesis live in the knowledge base:
`/mnt/shared/.agents/knowledge-base/antigravity-internals/` (article revision 6,
`sources/analysis-1.5.15.md`, source ids `antigravity-cli-1.5.15-*`). That pass did not
decompose the 1.5.15 binary and made no provider call.

## What moved

| surface | 1.5.15 state | effect on us |
|---|---|---|
| CLI contract | `--help` byte-identical to 1.5.6; flags and subcommands unchanged | none; our client invocation surface was never used |
| model catalogue | server-supplied; new four-level families are gated by auth mode (Hydrogen and Neon at low/medium/high/xhigh for API key, ADC and gateways; Carbon stays three-level) | accept `-xhigh` ids and map Pi's `xhigh` level onto them |
| thinking level | `xhigh` is a real model-id level on four-level families; `--effort` still accepts `low\|medium\|high\|xhigh\|max` and a conflicting pair is rejected | catalog level, not a new wire enum value |
| wire effort enum | still only `LOW`, `MEDIUM`, `HIGH` in the recovered `THINKING_LEVEL_*` dumps; `xhigh`/`max` were derived to map down | `thinkingConfig` sends `HIGH` for `XHIGH`; the envelope `model` keeps the xhigh level id |
| route | consumer turns still go to `daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent` (CCPA) | none |
| gateway | 1.5.7 drops the level suffix from the model id only on enterprise gateways | confirms the compound id decomposes; not our route |
| Orchestrator | per-role Planner/Executor effort, default `high` from 1.5.15 | client-side selection layer; not part of a provider request we send |
| `cl` change list | not exposed by any 1.5.15 surface we can read | keep `1007749967`, last observed on the wire at 1.4.8; recorded as unverified for 1.5.15 |
| rest | permissions, ACP, remote agents, plugins, quota retry semantics | no provider wire change |

The OAuth consumer catalogue **was** fetched for this account on 2026-11-23 through the
provider's own `fetchAvailableModels` call: 22 ids over seven families, including
`gemini-4-hydrogen-xhigh` and `gemini-4-neon-xhigh`. XHigh rows carry `thinkingLevel: 100`
(not 4), which the parser maps to `XHIGH`. `gemini-4-carbon-disabled` and non-level rows
such as `gemini-4-hydrogen-sonar` are skipped. The trimmed response is
[`evidence/fetch-available-models-2026-11-23.json`](evidence/fetch-available-models-2026-11-23.json)
(`models` and `agentModelSorts` only; experiment and group-selection fields were dropped).

## Changes in this repo

- `src/families/google/transport.ts`: `AGY_VERSION` is `1.5.15`; the change-list comment
  records that the value is inherited from the 1.4.8 wire observation.
- `src/families/google/catalog.ts`: `-xhigh` ids parse into the family, `thinkingLevel: 4`
  decodes as `XHIGH`, and `thinkingLevelMap.xhigh` carries the encoded level; three-level
  families leave it `null`, so Pi clamps as before.
- `src/families/google/levels.ts`: `XHIGH` round-trips through the models store and maps to
  the wire's `HIGH` in `thinkingConfig`.
- Tests: four-level catalog parsing and the `XHIGH → HIGH` wire mapping.

## Gaps

- No 1.5.15 symbol, rodata or proto pass; no request body observed at any version.
- The change-list value in the user agent is not verified for 1.5.15.
- Four-level families are parsed and covered by a fixture; no Antigravity turn has completed through the updated provider yet (see the identity block note).
