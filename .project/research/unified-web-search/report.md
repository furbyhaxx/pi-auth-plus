---
version: 1
id: "unified-web-search"
title: "Authenticated provider search feasibility"
description: "Documented search mechanisms, result types and unverified credential paths for a shared search interface."
type: "research"
created: "2026-10-28T10:06:29+01:00"
updated: "2026-10-28T10:15:32+01:00"
createdBy: "researcher"
updatedBy: "pi"
document:
  type: "research"
  id: "unified-web-search"
  title: "Authenticated provider search feasibility"
  description: "Documented search mechanisms, result types and unverified credential paths for a shared search interface."
  status: "published"
  revision: 2
  created_at: "2026-10-28T10:06:29+01:00"
  updated_at: "2026-10-28T10:15:32+01:00"
  created_by: "researcher"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "Investigate provider search mechanisms"
      changes: ["Surveyed Synthetic, OpenAI, Anthropic and xAI documentation"]
    - revision: 2
      reason: "Validate evidence and distinguish documented APIs from untested subscription access"
      changes: ["Removed unsupported assertions about account entitlement, latency and legal restrictions", "Separated direct results from search-grounded answers"]
---

# Authenticated provider search feasibility

Sources checked on 2026-10-28. This assesses the listed mechanisms, not every possible endpoint
or provider. No authenticated search call was made in this investigation.

## Mechanisms

| Provider | Documented mechanism | Result shape |
|---|---|---|
| Synthetic | Dedicated `POST /v2/search`, already used by pi-auth-plus | Search hits with URL, title, highlights, page text and optional publication date [1] |
| OpenAI | Hosted `web_search` tool in a Responses model request | Model-generated answer with citation annotations; optional list of consulted URLs [2] |
| Anthropic | Hosted `web_search_*` tool in a Messages model request | Model answer and citations; search-result blocks include title, URL, age and `encrypted_content` [3] |
| xAI | Hosted `web_search` tool in a Responses model request | Model-generated answer with citations and a list of encountered source URLs [4, 5] |

The Synthetic path does not require a model inference turn. The other three mechanisms run
inside provider model requests; those requests can incur model usage and search charges, and their
models may decide whether or how to search. Their documented outputs should not be presented as
identical to Synthetic's direct search hits. Anthropic requires the encrypted result content to be
returned unchanged when continuing the relevant conversation; the API decrypts it server-side [3].
OpenAI and xAI expose source URLs and answer citations in the cited interfaces, rather than
promising a uniform set of full pages and search snippets. Both provider APIs and terms may change.

## Credentials and cost

- The existing Synthetic tool resolves its configured Synthetic credential and calls the search
  endpoint directly [1]. This establishes the implementation path, not that every subscription
  includes it.
- The public OpenAI, Anthropic and xAI documentation describes their developer API search tools.
  **UNVERIFIED:** whether each of the user's ChatGPT-direct, Codex, Claude Code and xAI login
  credentials may invoke the corresponding search tool, which models support it, and how that
  specific account is charged or quota-limited. An authenticated inference request alone does not
  establish search entitlement. Account plans and endpoint grants are distinct.
- Provider search may consume additional model tokens, tool-call charges or subscription quotas.
  Check the current provider pricing and the actual account entitlement before use; do not silently
  fail over from an included backend to a separately billed one.
- When displaying provider answers, preserve citations and comply with the provider's current
  display and usage terms. Anthropic explicitly documents citation requirements [3]. No conclusion
  about the legality of a cross-provider adapter was established by this investigation.

## Design implications

A single Pi tool could route to adapters with a common envelope identifying `backend`, result kind,
sources and any answer text, while preserving provider-specific metadata and citation links. A
caller must be able to tell direct search hits from a model-synthesized answer; missing snippets or
page text must remain missing, not invented. Model-driven adapters require an extra model request
and can add latency or cost. Configurable backend order, enablement, limits and paid-fallback
behavior would be required.

Alternatively, native hosted tools could be enabled only in each provider's own inference request.
That may avoid an extra model call, but it depends on Pi's stream and tool-result compatibility and
is not a generic cross-provider search-results interface. Neither approach has been implemented or
verified with subscription credentials here.

## Sources

1. `src/families/synthetic/web-search.ts` — current standalone search request and result parser.
2. [OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search) — Responses tool, citations and source inclusion.
3. [Anthropic web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) — tool versions, result blocks, encrypted content, citations and `max_uses`.
4. [xAI web search](https://docs.x.ai/developers/tools/web-search) — hosted search mechanism.
5. [xAI citations](https://docs.x.ai/developers/tools/citations) — source lists and inline citations.
6. [xAI pricing](https://docs.x.ai/developers/pricing) — current API search charges.
7. `.project/analyses/quotas/openai-chatgpt-login.md` — prior successful ordinary inference with the ChatGPT-direct login, not a search test.
8. `.project/analyses/claude-code-cli/tracking.md` — prior Claude Code OAuth inference evidence, not a search test.
