---
version: 2
id: "search-entitlement"
title: "Live hosted web-search entitlement probes"
description: "Live provider-hosted search entitlement probes with redacted complete SSE retry captures."
type: "analysis"
created: "2026-10-28T10:40:57+01:00"
updated: "2026-10-28T10:55:17+01:00"
createdBy: "analyst"
updatedBy: "analyst"
document:
  type: "analysis"
  id: "search-entitlement"
  title: "Live hosted web-search entitlement probes"
  description: "Live provider-hosted search entitlement probes with redacted complete SSE retry captures."
  status: "published"
  revision: 2
  created_at: "2026-10-28T10:40:57+01:00"
  updated_at: "2026-10-28T10:55:17+01:00"
  created_by: "analyst"
  updated_by: "analyst"
  changelog:
    - revision: 1
      reason: "Probe provider search entitlement"
      changes: ["Recorded single-request live results, request shapes, billing evidence and capture gaps"]
    - revision: 2
      reason: "Repeat the OpenAI and xAI probes with complete stream capture"
      changes: ["Confirmed completed search actions on both OpenAI OAuth routes", "Recorded final xAI usage and redacted full SSE captures"]
---

# Live hosted web-search entitlement probes

status: "qa-complete"
confidence: "high for the tested credentials, models and request forms"

## Summary

Claude Code, OpenAI ChatGPT-direct, legacy Codex and xAI OAuth credentials all executed hosted
search with cited or source URLs. Both OpenAI credentials also opened a known page without a
counted search; a second retry asking for an unknown recent release produced two completed search
actions and a final search counter of two on each route. Synthetic and OpenCode's documented
unauthenticated Exa MCP path returned direct hits. OpenRouter returned a citation and reported a
$0.001 charge, but the free model exhausted its output limit before emitting an answer.

## Test matrix

| Route | HTTP / time | Tool accepted | Search executed | Observed output and usage |
|---|---:|---|---|---|
| Claude Code OAuth, `claude-sonnet-5-5` | 200 / 3,708 ms | Yes | Yes: `server_tool_use` and `web_search_tool_result` | Search-result URLs and encrypted content; prose citation. `server_tool_use.web_search_requests: 1`; input 13,396 and output 220 tokens. |
| OpenAI ChatGPT-direct OAuth, `gpt-5.6-luna` | 200 / 13,173 ms, second retry | Yes | Yes: two completed `search` actions; `num_requests: 2` | Cited prose; input 16,873, output 257, total 17,130 tokens. Earlier retry opened a page and had `num_requests: 0`. |
| OpenAI legacy Codex OAuth, `gpt-5.6-luna` | 200 / 15,923 ms, second retry | Yes | Yes: two completed `search` actions; `num_requests: 2` | Cited prose; input 16,804, output 215, total 17,019 tokens. Earlier retry opened a page and had `num_requests: 0`. |
| xAI OAuth, `grok-4.7` | 200 / 5,644 ms, retry | Yes | Yes: two completed `search` actions and one `open_page` | Source URLs and cited prose; input 21,218, output 357, total 21,575 tokens; `web_search_calls: 3`. |
| Synthetic API key, `/v2/search` | 200 / 963 ms | N/A: direct endpoint | Yes: five result objects | Raw hits with title, URL, full page text and highlights; publication date when provided. No usage field observed. |
| OpenCode documented Exa MCP path | 200 / 1,458 ms | N/A: direct MCP tool call | Yes: one requested result | Unauthenticated SSE JSON-RPC result with title, URL and highlights; `_meta.searchTime: 1079.6`. No inference or OpenCode account was involved. |
| OpenRouter API key, `nvidia/nemotron-3.5-lightning:free` | 200 / 4,008 ms | Yes: `web` plugin | Yes: citation with source excerpt | `url_citation` annotation; no final prose (`content: null`, `finish_reason: length`). `usage.cost: 0.001`, prompt 560 and completion 256 tokens. |

Times measure from immediately before `fetch` until the response body was read. They are single
samples, not latency distributions. The initial run sent one search-bearing HTTP request per row.
The user subsequently authorized up to two additional attempts per OpenAI route and one xAI retry;
all five are reported below. Claude additionally received one unauthenticated `HEAD /api/hello`
preflight, HTTP 200. The xAI model chose three actions within its request; `max_output_tokens` did
not cap search actions.

## Method and capture limitation

Bun on Linux ran `timeout 110s bun /tmp/pi-search-entitlement.y16Lehv6/probe.ts` from
`/mnt/Projects/furbyhaxx/pi-auth-plus` on 2026-10-28 at approximately 10:39 Europe/Zurich. The
script read credentials in memory from `/home/furbyhaxx/.pi/agent/auth.json` and the legacy Codex
file, checked expiry, did not refresh or write credentials, and redacted credential values from its
output. All relevant OAuth credentials were unexpired. The `openai-codex` auth.json slot was absent;
the Codex row used the separately stored legacy credential and account ID. No resets, keys,
revocations or account changes were requested. Temporary script and output were removed afterward.

The script reused `shapeBody`, `shapeHeaders`, and `shapeUrl` from
`src/families/anthropic/request.ts:70`, `:112`, and `:141`, and the installed Claude version. To
preserve Anthropic's required server-tool name, it inserted the hosted tool **after** `shapeBody`:
that function otherwise applies `wireToolName` to every tool definition at `request.ts:28-41` and
`:88-93`, changing `web_search` to `WebSearch`. This is a material integration requirement; a
literal pass through the current transform was not tested. The session/device identity was
freshly generated for this probe and the stored account UUID was used without printing it. The
other requests follow the installed Pi Responses body/header conventions and the Synthetic
endpoint at `src/families/synthetic/web-search.ts:11,87-91`.

**Capture failure:** both OpenAI responses contained SSE bytes but exposed no `content-type` header
to Bun's fetch. The script selected its JSON/non-SSE branch using that header, saved only the first
1,500 characters, and discarded the rest. In particular, `web_search.num_requests: 0` below is the
*initial in-progress event*, not a final count. For xAI, a separate eight-element output cap
retained search actions and SSE event counts but discarded the final message and completed-response
usage object. These were instrumentation gaps, not observed provider rejections. Per the original
one-request-per-route constraint, the initial run did not retry; the user subsequently authorized
the retries documented below.

## Redacted wire evidence

The following are field excerpts of the actual requests and responses. Omitted fields and
`[REDACTED]` markers are not literal wire values. Encrypted search and reasoning content is
represented only by type and length. No rejected HTTP response occurred.

### Claude Code OAuth

```http
POST https://api.anthropic.com/v1/messages?beta=true
Authorization: [REDACTED]
anthropic-version: 2023-06-01
User-Agent: claude-cli/2.1.312 (external, cli)
x-app: cli
x-claude-code-session-id: [REDACTED]
```

The request used the `claude-code-20250219`, `oauth-2025-04-20` and other betas from the project
shaper, with its billing/identity system blocks. Its relevant body fields were:

```json
{"model":"claude-sonnet-5-5","max_tokens":768,"messages":[{"role":"user","content":"Search the web for a current headline on news.ycombinator.com, cite the source URL, and give one short sentence."}],"tools":[{"type":"web_search_20260318","name":"web_search","allowed_callers":["direct"],"max_uses":1}]}
```

Response excerpts, HTTP 200:

```json
{"type":"server_tool_use","name":"web_search","input":{"query":"news.ycombinator.com front page today"}}
{"type":"web_search_result","title":"2026-10-27 front","url":"https://news.ycombinator.com/front","encrypted_content":"[encrypted; 2868 chars]","page_age":"10 days ago"}
{"type":"text","text":"\"Ghostty 1.4\" (ghostty.org) drew 961 points and 297 comments.","citations":[{"type":"web_search_result_location","url":"https://news.ycombinator.com/front","title":"2026-10-27 front","encrypted_index":"[encrypted; 200 chars]"}]}
{"usage":{"input_tokens":13396,"output_tokens":220,"server_tool_use":{"web_search_requests":1,"web_fetch_requests":0}}}
```

At least eight result objects were returned; the capture limits arrays to eight. The cited page was
labelled October 27, so this establishes search execution, not the requested headline's freshness.
Anthropic documents that encrypted content must be preserved unchanged for continuation; the
redaction here must never be used as a continuation payload.

### OpenAI ChatGPT-direct and legacy Codex

Both body excerpts used this user message, `stream: true`, `store: false`, `reasoning.effort:
"none"`, `tool_choice: "auto"`, and `include: ["reasoning.encrypted_content"]`:

```json
{"model":"gpt-5.6-luna","input":[{"role":"user","content":[{"type":"input_text","text":"Search the web for a current headline on news.ycombinator.com, cite the source URL, and give one short sentence."}]}],"tools":[{"type":"web_search"}]}
```

- Direct: `POST https://api.openai.com/v1/responses`; bearer credential from the `openai` OAuth
  slot. `max_output_tokens` was omitted, matching the Pi direct-login path.
- Legacy: `POST https://chatgpt.com/backend-api/codex/responses`; bearer and
  `chatgpt-account-id` redacted; `originator: pi`, `OpenAI-Beta: responses=experimental`,
  `session-id` and `x-client-request-id`. Extra body fields: `instructions: "You are a helpful
  assistant."`, `text.verbosity: "low"`, and `parallel_tool_calls: true`.

Both HTTP 200 streams started with this **in-progress** event; shown as selected fields:

```sse
event: response.created
data: {"type":"response.created","response":{"status":"in_progress","tools":[{"type":"web_search","search_context_size":"medium"}],"tool_usage":{"web_search":{"num_requests":0}}}}
```

The original capture's omitted final events cannot establish execution or accounting. The
separately authorized complete-stream retries below establish both for these credentials.

### xAI OAuth

```http
POST https://api.x.ai/v1/responses
Authorization: [REDACTED]
```

```json
{"model":"grok-4.7","input":[{"role":"user","content":[{"type":"input_text","text":"Search the web for a current headline on news.ycombinator.com, cite the source URL, and give one short sentence."}]}],"stream":true,"store":false,"max_output_tokens":512,"reasoning":{"effort":"low"},"include":["reasoning.encrypted_content"],"tools":[{"type":"web_search"}],"tool_choice":"auto"}
```

Selected SSE output-item fields, HTTP 200:

```json
{"type":"web_search_call","status":"completed","action":{"type":"search","query":"site:news.ycombinator.com","sources":[{"type":"url","url":"https://news.ycombinator.com/item?id=50221676"}]}}
{"type":"web_search_call","status":"completed","action":{"type":"search","query":"Hacker News front page top stories","sources":[{"type":"url","url":"https://orangebot.ai/hacker-news-top-stories"},{"type":"url","url":"https://news.ycombinator.com/front?day=2026-10-27"}]}}
{"type":"web_search_call","status":"completed","action":{"type":"open_page","url":"https://news.ycombinator.com/"}}
{"type":"reasoning","status":"completed","encrypted_content":"[encrypted; 9863 chars]"}
```

The initial stream contained three `response.web_search_call.completed`, one
`response.output_text.annotation.added`, and one `response.completed` event. Its array cap
discarded the annotation's contents and final `usage`; the separately authorized retry below
captured those fields.

### Synthetic

```http
POST https://api.synthetic.new/v2/search
Authorization: [REDACTED]
Content-Type: application/json
```

```json
{"query":"Hacker News current headlines October 28 2026"}
```

Selected response fields, HTTP 200, five result rows:

```json
{"results":[{"url":"https://news.ycombinator.com/front?day=2026-10-28","title":"2026-10-28 front | Hacker News","text":"2026-10-28 front | Hacker News\n\nGit for the US Code (lexifina.com)\n\n249 points by alansaber 7 hours ago | 121 comments","highlights":["2026-10-28 front | Hacker News\n\nGit for the US Code (lexifina.com)"]}]}
```

`text` and `highlights` are shortened excerpts; another captured hit had `published:
"2026-10-28T00:00:00.000Z"`. There was no response `usage` field. Search billing for this
account was not measured.

### OpenCode's documented Exa MCP search

OpenCode's [tool documentation](https://opencode.ai/docs/tools/) describes search via Exa or
Parallel without an API key. Its [Exa implementation](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/core/src/plugin/websearch/exa.ts)
uses the MCP endpoint and `web_search_exa` tool. This is a third-party direct MCP search, **not**
a hosted inference feature or a test of an OpenCode free model's OAuth entitlement.

```http
POST https://mcp.exa.ai/mcp
Accept: application/json, text/event-stream
Content-Type: application/json
```

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_search_exa","arguments":{"query":"Hacker News current headlines October 28 2026","numResults":1}}}
```

Selected SSE response, HTTP 200:

```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Title: 2026-10-28 front | Hacker News\nURL: https://news.ycombinator.com/front?day=2026-10-28\nPublished: N/A\nAuthor: N/A\nHighlights:\n2026-10-28 front | Hacker News\n\nGit for the US Code (lexifina.com)","_meta":{"searchTime":1079.6}}]}}
```

The source's usual `numResults` is eight; this probe requested one. Separately,
[OpenCode Console hosted search](https://raw.githubusercontent.com/anomalyco/opencode/dev/services/www/src/docs/content/console/websearch.mdx)
requires workspace enablement and reports $0.01 per successful search; it was not tested because
no OpenCode Console credential was configured.

### OpenRouter

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: [REDACTED]
```

```json
{"model":"nvidia/nemotron-3.5-lightning:free","messages":[{"role":"user","content":"Search the web for a current headline on news.ycombinator.com, cite the source URL, and give one short sentence."}],"max_tokens":256,"stream":false,"plugins":[{"id":"web","engine":"parallel","mode":"turbo","max_results":1}]}
```

Selected response fields, HTTP 200:

```json
{"finish_reason":"length","message":{"content":null,"annotations":[{"type":"url_citation","url_citation":{"url":"https://news.ycombinator.com/item?id=50218633","title":"Hacker reverses Samsung TV, finds on-board AI listening ..."}}]}}
{"usage":{"prompt_tokens":560,"completion_tokens":256,"total_tokens":816,"cost":0.001,"completion_tokens_details":{"reasoning_tokens":256}}}
```

All 256 output tokens were reasoning; a user-facing prose answer was not produced. The citation
also contained a source excerpt. The single search cost is explicitly reported by usage; OpenRouter
[documents](https://openrouter.ai/docs/guides/features/web-search) Parallel Turbo at $0.001 per
request. Its newer [server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search)
is recommended by the provider and supports `max_uses`; that newer API was not tested.

## Authorized complete-stream retries

On 2026-10-28 at approximately 10:51 Europe/Zurich, Bun ran `timeout 110s bun
/tmp/pi-search-retry.8sIp2hIQ/retry.mjs`, followed by the same command with `--second`. The first
command made one request to each of the two OpenAI routes and xAI. Since the OpenAI responses
opened the known Hacker News URL without a counted search, the second command made one additional
request to each OpenAI route, changing only the prompt to request a recent release found by a web
search query. No second xAI request was sent. All five requests used unexpired credentials; no
credential was refreshed or written. The parser consumed each response body through EOF, regardless
of missing `content-type`, and retained every SSE frame. The scratch script and its output were
removed after the redacted captures were saved.

| Retry | HTTP / latency | Completed hosted actions | Citations | Final usage |
|---|---:|---|---|---|
| ChatGPT-direct, known page | 200 / 5,078 ms | `open_page` × 1 | `https://news.ycombinator.com/` | 6,874 input, 75 output, 6,949 total; `web_search.num_requests: 0` |
| Legacy Codex, known page | 200 / 4,246 ms | `open_page` × 1 | `https://news.ycombinator.com/` | 6,884 input, 77 output, 6,961 total; `web_search.num_requests: 0` |
| ChatGPT-direct, open-ended search | 200 / 13,173 ms | `search` × 2 | `https://spark.apache.org/news/?utm_source=openai` | 16,873 input, 257 output, 17,130 total; `web_search.num_requests: 2` |
| Legacy Codex, open-ended search | 200 / 15,923 ms | `search` × 2 | `https://wisevoter.com/world/2026/10/28/scribus-releases-software-updates-milestone?utm_source=openai` | 16,804 input, 215 output, 17,019 total; `web_search.num_requests: 2` |
| xAI | 200 / 5,644 ms | `search` × 2; `open_page` × 1 | `https://news.ycombinator.com/` | 21,218 input, 357 output, 21,575 total; `server_side_tool_usage_details.web_search_calls: 3` |

Each action above was a `web_search_call` output item with `status: "completed"`. Each stream
ended with `response.completed`, `response.status: "completed"`, and a `url_citation`
annotation. The second-retry prompt was: `Search the web for the name and release date of an
open-source software version announced in the last 48 hours. Use a web search query and cite the
announcement.` The endpoints, model, authentication, header names and non-prompt body fields
matched the first retry and the original request excerpts above. Each legacy retry used a fresh
session ID.

Selected OpenAI second-retry SSE fields:

```json
{"type":"response.output_item.done","item":{"type":"web_search_call","status":"completed","action":{"type":"search","query":"open source software version release announcement October 2026"}}}
{"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","title":"News | Apache Spark","url":"https://spark.apache.org/news/?utm_source=openai"}}
{"type":"response.completed","response":{"status":"completed","tool_usage":{"web_search":{"num_requests":2}},"usage":{"input_tokens":16873,"output_tokens":257,"total_tokens":17130}}}
```

The legacy Codex retry likewise returned two completed `search` actions and `num_requests: 2`.
The direct and Codex known-page retries returned a completed `open_page` action but a zero search
counter, so a completed hosted tool call alone is not proof of an actual search query. The two
OpenAI search items each carried multiple query strings; the counter was two action requests, not
a count of those strings. Citations are model output, not independently verified claims about the
named releases.

Selected xAI final fields:

```json
{"type":"response.output_text.annotation.added","annotation":{"type":"url_citation","url":"https://news.ycombinator.com/","start_index":113,"end_index":149,"title":"1"}}
{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":21218,"output_tokens":357,"total_tokens":21575,"num_sources_used":0,"num_server_side_tools_used":3,"cost_in_usd_ticks":241507600,"server_side_tool_usage_details":{"web_search_calls":3,"x_search_calls":0,"x_posts_fetched":0,"x_users_fetched":0,"code_interpreter_calls":0,"file_search_calls":0,"mcp_calls":0,"document_search_calls":0,"image_generation_calls":0}}}}
```

The xAI output included source URLs and a citation even though `num_sources_used` was zero. Its
`web_search_calls: 3` counts the two search actions and the one open-page action in this response.
`cost_in_usd_ticks` is reported as returned; the unit conversion and whether the subscription is
charged separately were not verified.

Complete redacted frame captures are:

- `captures/openai-direct.events.jsonl` — 23 frames, known-page retry.
- `captures/openai-direct-attempt2.events.jsonl` — 35 frames, open-ended retry.
- `captures/legacy-codex.events.jsonl` — 23 frames, known-page retry.
- `captures/legacy-codex-attempt2.events.jsonl` — 25 frames, open-ended retry.
- `captures/xai.events.jsonl` — 77 frames, xAI retry.

The captures preserve all frames and response fields except redactions of credentials, session and
account identifiers, safety identifiers, and opaque encrypted/signature content. They are evidence,
not replayable conversation payloads. A credential-value scan found zero matches in each capture.

## Recommendation and follow-ups

- Candidate backends supported by actual execution: Claude, OpenAI direct, legacy Codex and xAI
  OAuth hosted search, Synthetic direct search, and OpenRouter's separately billed plugin.
  Present generated answers with citations separately from raw search hits and preserve
  Anthropic's opaque content for conversation continuation. For Claude, exclude vendor server
  tools from the generic name rewrite before integration.
- OpenCode's public Exa MCP endpoint is an observed direct search option, but it is an Exa service
  without OpenCode credentials, not proof of a free-model-hosted search entitlement.
- Count OpenAI `search` and `open_page` separately, and do not infer query execution from a hosted
  tool call alone. The tested xAI usage counter includes both types. A one-sentence prompt did not
  prevent xAI from making three tool actions. Subscription accounting for Claude, OpenAI, xAI and
  Synthetic was not independently established.
- Results can be stale: Claude cited an October 27 page during the October 28 probe. `AGENTS.md`
  limits OpenRouter live verification to classifiers; the user explicitly authorized this search
  probe and a trivial cost, so the higher-priority request prevailed.

## Sources

- Anthropic [web search documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), checked 2026-10-28: current version `web_search_20260318`, direct `allowed_callers`, encrypted results and search usage.
- OpenAI [web search documentation](https://developers.openai.com/api/docs/guides/tools-web-search), checked 2026-10-28: Responses `web_search`, actions and citations.
- xAI [web search documentation](https://docs.x.ai/developers/tools/web-search), checked 2026-10-28: Responses `web_search`.
- `.project/references/models.md`: project-approved model IDs. `grok-4.7` and `claude-sonnet-5-5` were also checked against the live models.dev catalog and provider documentation.
- `.project/research/unified-web-search/report.md`: preceding documentation-only research.
