# Token counts

pi-auth-plus counts the context of the current session for the selected model and shows
where every number comes from. Pi's own count takes the last reply's usage and estimates
everything after it at four characters per token; tool-result JSON in that tail is often
12-55 % above Pi's estimate. pi-auth-plus replaces that estimate with the best source
the model's provider offers.

## How a count is built

```
context = anchor + tail
  anchor  total usage of the last valid assistant reply on the current branch
  tail    every message after it, counted with the model's counter
```

Before the first reply, or after an invalidating context edit or compaction, there is no
anchor. For supported Claude contexts, the native endpoint counts the complete SDK-shaped
request, including framing, ordered system updates and tool definitions. Unsupported contexts
and other routes count contributions separately with their available counter.

A valid usage anchor remains authoritative. Contributions after it and the on-demand breakdown
are additive estimates; even endpoint-derived differences can omit framing or token boundaries.

Each count carries a source, from most to least authoritative:

| Source | Shown as | Meaning |
|---|---|---|
| `provider` | exact (usage) | Usage the provider reported for a real request |
| `count-endpoint` | count API | Native count of the supplied complete request; not billed usage |
| `tokenizer` | tokenizer estimate | The model's published tokenizer, run locally |
| `estimate` | estimate | Additive endpoint differences or measured character estimates |

A sum takes the weakest source of its parts.

## Sources per provider

| Provider | Anchor | Tail and first turn |
|---|---|---|
| `claude` | usage | Full native count without an anchor when supported; additive estimates otherwise |
| `synthetic`, `hf:` models | tokenizer recount when available, otherwise usage | tokenizer, or estimate when unavailable |
| `synthetic`, other models | usage | estimate |
| `antigravity`, gpt-oss | usage | gpt-oss tokenizer, or estimate when unavailable |
| `antigravity`, Gemini and Claude | usage | estimate |
| `openai`, `openai-codex`, `xai` | usage | estimate |
| any other provider | usage | estimate (4 / 3 characters for prose / JSON) |

Notes:

- **Claude.** Full native counts use the SDK's request serializer and the provider's
  subscription shaping, including `claude.replacePatterns`. API-key requests retain their
  native shaping. The effective session thinking level is included in request capture; a change
  invalidates the old report. Signed or redacted thinking, an unknown thinking setting on a
  reasoning model and projections requiring unsupported conversion fall back to labelled estimates.
  A count API response describes the supplied context; it does not include later request-hook
  additions or prove billed usage. Antigravity's Claude
  models never use this endpoint; they run on Google's route.
- **Synthetic.** Synthetic reports input tokens in a scaled unit (0.42x the real count
  for DeepSeek, 2.4x for gpt-oss), while its context limit applies to real tokens. For
  `hf:<org>/<repo>` models, the stored input usage of each reply is recounted with the
  model's tokenizer when available and the request can be counted. Pi's footer and
  auto-compaction then use the recount; framing and unsupported content can limit its
  accuracy. Output tokens and cost stay as reported by the provider after deduplication.
- Anthropic, Gemini, closed GPT and Grok routes use usage plus a measured estimate;
  the open gpt-oss model uses its published tokenizer.

## Tokenizer cache

Tokenizers are downloaded from Hugging Face the first time a model needs one:

- Location: `$XDG_CACHE_HOME/pi-auth-plus/tokenizers/` (default
  `~/.cache/pi-auth-plus/tokenizers/`).
- Token-count memoization is in memory and is not persisted; this disk cache stores
  tokenizer artifacts, not count results.
- A revision is resolved and pinned in the cache. Downloads are checked against the
  Hugging Face file identity; cached files are checked with SHA-256.
- After the download, counting runs offline. Selecting a model starts the download in
  the background.
- When the download fails or the files are absent, counts fall back to provider usage and
  estimates. A failed repository is retried after 10 minutes.

Delete the directory to force a fresh download.

## Tokens tab

`/tokens` (alias `/token`) opens the Tokens tab of `/auth`:

| Row | Content |
|---|---|
| Total, Context | The count, its source, and the percentage of the context window |
| Pi, Delta | Pi's own count and the difference |
| Anchor, Tail | The last reply's usage, and the messages after it |
| Breakdown | The full request split into system, tools, user, assistant and tool results |

The breakdown is counted when the tab opens and recounted on changes. On Claude its
baseline-subtracted pieces are labelled estimates, rather than complete native counts.
Authoritative full-request results are memoized in memory after authentication and effective
request shaping; changing authentication mode or request shape cannot reuse a stale total.
Unavailable results and estimates remain retryable. If native counting lacks authentication,
Recovery rows and full Help name the provider, endpoint and login command; estimates remain usable.
Restoring credentials clears that diagnostic after a successful recount.
Outside the TUI, `/tokens` prints the latest count without recounting.

## Footer

With `quotas.linePlacement = "below-editor-last"`, pi-auth-plus shows its context
percentage in its fallback footer. A leading `~` marks a character estimate. Other
placements, and footer hosts such as pi-workbench, keep their own context percentage.

`tokens.warningPercent` defaults to `70` and `tokens.errorPercent` to `90`. Each accepts
0–100%; the fallback footer uses warning color at or above the warning threshold and error
color at or above the error threshold. The warning value must be strictly less than the
error value. Saving a contradictory pair is rejected; conflicting loaded values inherit
from a lower scope. These thresholds change color, not token counts or context limits.

## Event bus

Other extensions read the same counts through `pi-auth-plus:v1:tokens:*`; see
[Token channels](events.md#token-channels).
