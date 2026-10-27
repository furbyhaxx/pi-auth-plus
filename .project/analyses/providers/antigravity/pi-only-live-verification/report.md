---
document:
  type: "analysis"
  id: "analysis-pi-only-live-verification"
  title: "Live verification of the Pi-only package"
  description: "Git-install mechanics and live Antigravity calls against the collapsed Pi-only package at commit 61fc343."
  status: "done"
  revision: 2
  created_at: "2026-10-27T08:57:35+01:00"
  updated_at: "2026-10-27T10:00:06+01:00"
  created_by: "pi"
  updated_by: "pi"
  source: "pi-antigravity-auth@b04d594e3412160204bedb974688482d6028eff3:.project/analyses/pi-only-live-verification/report.md"
  changelog:
    - revision: 2
      reason: "imported into pi-auth-plus"
      changes: ["copied from pi-antigravity-auth@b04d594e3412160204bedb974688482d6028eff3:.project/analyses/pi-only-live-verification/report.md"]
---

# Live verification of the Pi-only package

Subject: branch `refactor/pi-only` at `61fc343`, cloned fresh into `/tmp`.

## Git install mechanics

Pi installs git packages with `npm install --omit=dev --omit=peer`
(`pi-coding-agent/dist/core/package-manager.js`). Reproduced on a fresh clone:

- `npm install --omit=dev --omit=peer`: 6 packages, only `@cortexkit/*` runtime
  dependencies; no `@earendil-works/*` peers installed.
- `pi-bolt --mode rpc -ne -e ./src/index.ts` + `get_commands` lists `"name":"antigravity"`.

Limitation: pi-bolt's `install` parser rejects `git://` and `file://` URLs, so the
URL step itself is only exercised by the post-push install from GitHub.

## Live Antigravity calls

`pi-bolt -ne -e ./src/index.ts --no-session --mode json`, real account in Pi's native
`google` OAuth slot. Event summaries (no headers, tokens or bodies) in `captures/`.

| Run | Result |
| --- | --- |
| `antigravity-gemini-3.8-flash`, "pong" | `stop`, text `pong` |
| `antigravity-claude-sonnet-5-5`, "pong" | `stop`, text `pong` |
| Claude 5.5, `--thinking high`, read tool on `./NOTICE` | `toolUse` → `read` → `stop`, text `cortexkit/antigravity-auth` |

The third run covers the multi-turn path: tool call emission, tool result conversion back
into Antigravity contents, and a final answer.
