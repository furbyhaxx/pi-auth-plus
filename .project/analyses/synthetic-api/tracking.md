---
document:
  type: "analysis"
  id: "synthetic-api-tracking"
  title: "Synthetic API tracking"
  description: "The Synthetic API surface pi-auth-plus depends on, where it is pinned and when it was last verified live."
  status: "published"
  revision: 1
  created_at: "2026-10-27T10:45:33+01:00"
  updated_at: "2026-10-27T10:45:33+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["native provider and catalog landed"]
---

# Synthetic API tracking

Synthetic is a native API with no client impersonation, so there is no version to pin; this
file tracks the endpoints and response shape the family parses.

| field | value |
|---|---|
| pinned in | `src/families/synthetic/catalog.ts` (`BASE_URL`, `CATALOG_URL`, `parseCatalog`) |
| first-run snapshot | `assets/synthetic/models.json` (14 models; same bytes as `tests/fixtures/synthetic/models.json`) |
| last live verification | 2026-10-27, Pi 1.4.0 on Pi-Bolt 1.0.5 and on stock Node: `synthetic/hf:zai-org/GLM-5.3-Flash` answers; catalog refresh persisted; `synthetic_web_search` called |

## Surface

- Inference: `https://api.synthetic.new/anthropic`, Anthropic Messages via Pi's
  `anthropic-messages`, `Authorization` from the Pi credential or `SYNTHETIC_API_KEY`.
- Catalog: `GET https://api.synthetic.new/v1/models`, public, `{ data: [...] }`. Used fields:
  `id`, `name`, `hugging_face_id`, `always_on`, `context_length`, `max_output_length`,
  `supported_features` (`tools`, `reasoning`), `input_modalities` (`image`), and the price
  strings `pricing.prompt`, `completion`, `input_cache_reads` and `input_cache_writes`.
- Search: `POST https://api.synthetic.new/v2/search`, `{ "query": "..." }` with the bearer key.
  The response is `{ results: [{ url, title, text, highlights: string[], published }] }`, and
  `published` can be `null` (2 of 5 on 2026-10-27). `text` runs to about 106 KB per page. A bad key
  gets `401 {"error":"Invalid API Key."}`. Fixture: `tests/fixtures/synthetic/search.json`.
- Prices are strings in mixed units; values below 0.001 are read as per-token and scaled to
  dollars per million tokens.

## History

| date | change |
|---|---|
| 2026-10-27 | native provider; catalog through `refreshModels` with a 4 h TTL |
| 2026-10-27 | web-search tool; live search verified in Pi-Bolt and stock Pi |
