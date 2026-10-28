---
document:
  type: "analysis"
  id: "ANA-TOOLNAME-0001"
  title: "A removed tool name in a transcript blocked every Claude request"
  description: "Root cause and live evidence for the ToolNameCollisionError raised by a tool call to a tool Pi no longer registers"
  status: "published"
  revision: 1
  created_at: "2026-10-28T15:29:39+01:00"
  updated_at: "2026-10-28T15:29:39+01:00"
  created_by: "orchestrator"
  updated_by: "orchestrator"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["root cause, fix and live before/after evidence"]
---

# A removed tool name in a transcript blocked every Claude request

## Symptom

One session failed on every Claude turn, in interactive and print mode alike:

```
claude: tools "agent" and "Agent" share a wire name; rename one of them
```

Other sessions were unaffected, and the same session kept working on non-Claude
providers.

## Root cause

`toolNameRestorer` received one flat list: the live tools from `getCurrentTools()` plus every
`toolCall` name found in the transcript's assistant messages (`transcriptToolNames()` in
`src/families/anthropic/provider.ts`). Two entries folded onto the same Claude wire name:

| Source | Pi name | `wireToolName()` |
|---|---|---|
| live tool (pi-workbench subagents) | `agent` | `Agent` |
| transcript history (removed `pi-bolt-subagents` tool) | `Agent` | `Agent` |

The restorer threw `ToolNameCollisionError`. History names only exist so that outbound
blocks keep their Pi name; a response never dispatches them, because dispatch is resolved
against the live tool list. A name from a removed tool therefore could not have been
ambiguous, yet it blocked the whole session permanently.

## Fix

`toolNameRestorer(current, earlier)` keeps two lists. Live tools are registered first and
still throw on a shared wire name. Earlier transcript names only fill slots that are still
free, so a live tool always wins and a duplicate history name is dropped.

## Live evidence

Model `claude`.

**Before** (build with the old restorer, transcript unchanged):

```
$ pi --print --session /tmp/livecheck/broken.jsonl --provider claude --model claude-haiku-5-5 \
    "Reply with exactly: OK"
claude: tools "agent" and "Agent" share a wire name; rename one of them
```

**After** (`pi-bolt compile` of the fixed source, the same byte-identical transcript):

```
$ md5sum broken2.jsonl
32e5892607cbb5b88ef0ad505f52da02  broken2.jsonl

$ pi --print --session /tmp/livecheck/broken2.jsonl --provider claude --model claude-haiku-5-5 \
    "Reply with exactly: OK"
OK
```

The transcript carries 92 `Agent` tool calls and 92 matching tool results, 2372 entries,
last compaction at ~92k tokens. No request or response body is reproduced here: the OAuth
credential stays inside Pi, and the reply was the single word above.

The session itself was also repaired for readers on older builds by renaming the historical
tool name to `bolt_agent` (see the nukular-ai workspace, session `01a17cc9`).

## Guard

`tests/families/anthropic/tool-names.test.ts` and `tests/families/anthropic/provider.test.ts`
reproduce the case: a transcript with an `Agent` call next to a live `agent` tool must stream,
must send exactly one `Agent` tool definition, and a streamed `tool_use` named `Agent` must
restore to `agent`. Both fail on the pre-fix restorer with the production error.
