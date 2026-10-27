---
document:
  type: "analysis"
  id: "ANALYSIS-AGY-1.4.8-INDEX"
  title: "agy 1.4.8 reverse-engineering dossier"
  description: "Index, ten headline findings, reproduction instructions and method limits for the 1.4.8 analysis"
  status: "published"
  revision: 1
  created_at: "2026-10-27T09:59:34+01:00"
  updated_at: "2026-10-27T09:59:34+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      at: "2026-10-27T09:59:34+01:00"
      note: "Initial analysis of agy 1.4.8."
---

# agy 1.4.8 — reverse-engineering dossier

Full decomposition of Google's Antigravity CLI (`agy`) 1.4.8: login, auth, APIs,
quota and reset mechanics, and agent internals. Evidence-backed, written for
reimplementation in this repo's `antigravity` family.

Upstream tracking (pinned version, imitated surface, verification log):
[`../tracking.md`](../tracking.md).

## Read in this order

| # | file | contents |
|---|---|---|
| 00 | [`00-context.md`](00-context.md) | target identity, symbol-recovery toolkit, established facts, working rules |
| 01 | [`01-overview.md`](01-overview.md) | what the artifact is, architecture, component map, process model |
| 02 | [`02-auth.md`](02-auth.md) | OAuth flow, client/scope mapping, six auth methods, token storage, refresh |
| 03 | [`03-models.md`](03-models.md) | model catalogue, id grammar, thinking levels, capabilities, context window |
| 04 | [`04-api.md`](04-api.md) | endpoints, transport, inference envelope, multi-vendor routing, telemetry, flags |
| 05 | [`05-quota.md`](05-quota.md) | quota model, limits, **resets**, credits, tiers, seats, polling policy |
| 06 | [`06-mechanics.md`](06-mechanics.md) | turn loop, tools, permissions, sandbox, subagents, extensions, persistence |
| 07 | [`07-install-and-config.md`](07-install-and-config.md) | installer, self-update, config/state layout, env vars |
| 08 | [`08-integration-notes.md`](08-integration-notes.md) | **the contract for us**: what to reproduce, deviations, risks, open questions |

## Ten findings that matter most

1. **Login is manual-paste, not loopback.** Redirect is the remote
   `https://antigravity.google/oauth-callback`; `agy` never opens a socket for the
   consumer flow. A localhost callback will be rejected. (02 §2)
2. **Two OAuth clients, keyed on auth method**, each with an embedded installed-app
   secret: `consumer` and `gcp`. A third client belongs to MCP only. (02 §3)
3. **Quota limits and resets come from `v1internal:retrieveUserQuotaSummary`, not
   `loadCodeAssist`.** `loadCodeAssist` carries tier, plan and credit balance. (05 §1–2)
4. **Reset is server-authoritative.** Per-bucket `reset_time`; no client-side window, no
   midnight assumption. `window` is a free-form display string. (05 §4.1)
5. **Credit balance has no reset clock at all** — a second, independent concept from the
   per-bucket reset. (05 §4.2)
6. **Nothing is called vendor-direct.** Claude goes to Vertex `publishers/anthropic/models/
   {model}:streamRawPredict` in Anthropic wire format with the Google token; GPT-OSS goes
   to Vertex MaaS as `gpt-oss-120b-maas`. (04 §7.3)
7. **The CLI is not the network client.** It spawns a language-server child process on two
   ephemeral loopback ports (gRPC/TLS + HTTP) and drives it over Connect. (01 §3)
8. **Model id encodes the thinking level** (`gemini-4-argon-medium`), and context windows
   are experiment-assigned, not static. (03 §2, §5)
9. **Token storage is session-conditional**: file backend is chosen when an SSH session is
   detected, independently of the keyring-timeout fallback. (07, 02 §6.3)
10. **Permissions are a preset enum** (`REQUEST_REVIEW`, `TURBO`, `VETTED`, `NONE`, `AUTO`,
    …) with per-project grant records, plus a PolicyGuardian vetting layer. (06 §3)

## Reproducing this

The binary is stripped but pclntab survives. One tool does the work:

```bash
T=.project/analyses/antigravity-cli/1.4.8/tools/goresym.py
A=~/.local/bin/agy

python3 $T --bin $A init                        # build the function cache
python3 $T --bin $A funcs 'cli/backend/auth'     # regex over 171,928 function names
python3 $T --bin $A strs  '<exact func name>'    # string literals referenced by it
python3 $T --bin $A disas '<exact func name>'
python3 $T --bin $A grep  '<regex>'              # rodata scan
```

Recovered inventories live in [`data/`](data); captured live evidence in
[`evidence/`](evidence).

The large inventories (`funcs.txt`, `funcmap.json`, `pkgs.txt`, `tools/funcs.json`) are
**not committed** — they are regenerable in seconds and would add ~70 MB:

```bash
T=.project/analyses/antigravity-cli/1.4.8/tools/goresym.py
A=~/.local/bin/agy
python3 $T --bin $A funcs > data/funcs.txt          # 171,928 names + addresses
python3 $T --bin $A funcs | awk -F'\t' '{print $1,$3}' > data/funcmap.json  # if needed
```

### The three tools

| tool | purpose | contributed by |
|---|---|---|
| `goresym.py` | pclntab symbol recovery, alignment-independent string-literal and disassembly dumps | initial setup |
| `pbdump.py` | dump an embedded protobuf `FileDescriptorProto` from rodata, so message and field names/numbers are read from bytes rather than guessed | auth/quota pass |
| `xwalk.py` | cross-reference rodata strings to the functions that reference them | api pass |

`pbdump.py` is what makes field numbers in 04-api and 05-quota trustworthy: those tables
are decoded from the embedded descriptors, not inferred from accessor names.

## Method and its limits

No symbol table, no `.go.mod`, BOLT-reordered code. Names come from pclntab, addresses
from `0x6596000 + entryoff`, and string literals from alignment-independent RIP-relative
LEA scanning — because objdump alignment at a function entry is not trustworthy after
BOLT splitting (a fact several sections record explicitly when it bit them).

**Observed** means bytes, logs or live output. **Derived** means inferred from recovered
structure. **Unknown** is stated as unknown. No inference is presented as observation,
and §4 of [`08-integration-notes.md`](08-integration-notes.md) separates the two
explicitly.

`data/rpc_methods.txt` was first produced by regex over rodata and is contaminated; it was
regenerated from generated client/server method names and is now reliable (1,036
service/method pairs across 44 services).

## Deliberate restraint

The account owner's only constraint was not to get the account blocked. So: no repeated
auth attempts, no quota polling, no inference request issued, read-only with respect to
`~/.gemini/antigravity-cli/` and `~/.config/antigravity/` (SQLite inspected from copies).
