---
document:
  type: "analysis"
  id: "ANALYSIS-AGY-TRACKING"
  title: "Antigravity CLI — upstream client tracking"
  description: "Pinned agy version, the client surface we imitate, and the live-verification log"
  status: "published"
  revision: 3
  created_at: "2026-10-27T09:59:34+01:00"
  updated_at: "2026-10-27T10:28:00+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      at: "2026-10-27T09:59:34+01:00"
      note: "Initial analysis of agy 1.4.8."
    - revision: 2
      at: "2026-10-27T10:20:00+01:00"
      note: "Filled in the observed user agent and header surface, added the wire-capture verification row, and narrowed the static-only note to the inference path."
    - revision: 3
      at: "2026-10-27T10:28:00+01:00"
      note: "Added the observed inference and telemetry request heads, including the Bearer scheme and the finding that the x-goog-* header set is not sent. Narrowed the static-only note to request bodies."
---

# Antigravity CLI — upstream client tracking

We imitate Google's Antigravity CLI (`agy`) in the `antigravity` provider. It changes
without notice, so this file records what we are pinned to, what we imitate, and when we
last proved it still works.

Full reverse-engineering dossier: [`1.4.8/`](1.4.8/README.md).

## Pinned version

| field | value |
|---|---|
| client | Google Antigravity CLI (`agy`) |
| pinned version | **1.4.8** |
| binary sha256 | `70b1d27f1812f5ebccc8f13daf2209112447413437dd1ab6d87c58b8a04fe35b` |
| binary size | 228,897,168 bytes |
| observed via | `agy --version`, `sha256sum` |
| pinned in `src/` | **not yet** — scaffold only; the family has not landed |
| analysis baseline | [`1.4.8/`](1.4.8/README.md) |

Because the version is not yet pinned in code, the "where it is pinned" column above is
empty by fact, not by omission. Fill it in when `families/google/` lands, and reference
`1.4.8/08-integration-notes.md` from the pinning constant's comment.

## Surface we imitate

| surface | what we reproduce | analysis |
|---|---|---|
| OAuth clients | `consumer` client id + secret, `gcp` client id + secret, PKCE S256, `prompt=consent`, remote redirect `https://antigravity.google/oauth-callback` | [`02-auth.md`](1.4.8/02-auth.md) §2–4 |
| OAuth scopes | the 7-scope set (`cloud-platform`, `userinfo.email`, `userinfo.profile`, `cclog`, `experimentsandconfigs`, `aicode`, `openid`) | [`02-auth.md`](1.4.8/02-auth.md) §4 |
| token lifecycle | `expires_in 3599`, `expiry = now + 3599` | [`02-auth.md`](1.4.8/02-auth.md) §6 |
| model ids | `<family>-<thinking-level>`; Vertex ids `gpt-oss-120b-maas`, `gpt-oss-20b-maas`; `anthropic_version vertex-2023-10-16` | [`03-models.md`](1.4.8/03-models.md), [`04-api.md`](1.4.8/04-api.md) §7.3 |
| endpoints | `daily-cloudcode-pa.googleapis.com` `:loadCodeAssist`, `:fetchAvailableModels`, `:retrieveUserQuotaSummary`; Vertex `publishers/anthropic/models/{model}:streamRawPredict`; Vertex MaaS `endpoints/openapi/chat/completions` | [`04-api.md`](1.4.8/04-api.md) §2–4 |
| body shape | `GetChatMessageRequest` → `GenerateContentRequest`; Anthropic Messages wire for Claude, OpenAI chat-completions wire for GPT-OSS; SSE decode | [`04-api.md`](1.4.8/04-api.md) §6–7 |
| request metadata | `exa.codeium_common_pb.Metadata` (`ide_name`, `extension_version`, `session_id`, `device_fingerprint`, `user_tier_id`, `product_name`, `environment_type`, …) | [`04-api.md`](1.4.8/04-api.md) §6.2 |
| quota caching | 300 s cache, 60 s floor, 5 s repaint; `reset_time` authoritative, `window` display-only | [`05-quota.md`](1.4.8/05-quota.md) §8 |
| user agent / headers | `antigravity/cli/1.4.8 (aidev_client; os_type=linux; arch=amd64; cl=1007749967; auth_method=consumer)`; `Authorization: Bearer <oauth token>`; `Content-Type: application/json`; the inference call sends exactly seven headers and **none** of the `x-goog-*` set; `X-Cloudaicompanion-Trace-Id` is response-only; no quota or rate-limit headers exist | [`04-api.md`](1.4.8/04-api.md) §8.1 |

## Last live verification

| date | what was verified | evidence |
|---|---|---|
| 2026-10-27 | binary identity, `agy --version` 1.4.8, `agy models` catalogue (13 of 26 advertised ids), updater manifest for `linux_amd64`, `install.sh` contents, on-disk state layout, 107 klog call sites | [`1.4.8/evidence/`](1.4.8/evidence/) |
| 2026-10-27 | **wire data**: exact `User-Agent`, response header set, and full bodies of `loadCodeAssist`, `fetchUserInfo`, `fetchAvailableModels`, `retrieveUserQuotaSummary` from `agy -v=5`; real context windows, output caps and thinking budgets; five quota buckets across three groups with their reset times | [`1.4.8/evidence/live-2026-10-27/`](1.4.8/evidence/live-2026-10-27/) |
| 2026-10-27 | **inference and telemetry request heads**, captured behind a local TLS-terminating proxy during one `agy -p` turn: the seven-header inference request with `Authorization: Bearer`, the Clearcut batch to `play.googleapis.com/log`, `aicode.googleapis.com/v1alpha:fetchConfig`, `www.googleapis.com/oauth2/v2/userinfo` | [`inference-request-headers.txt`](1.4.8/evidence/live-2026-10-27/inference-request-headers.txt), [`all-request-heads-masked.txt`](1.4.8/evidence/live-2026-10-27/all-request-heads-masked.txt) |

Still static: the request *bodies* (converter output, streaming encode) and everything about how
the loopback language-server hop is framed. Request and response **heads** are observed. See
[`08-integration-notes.md`](1.4.8/08-integration-notes.md) §4 for the exact split.

## Change discipline

Per `AGENTS.md`: bumping the pinned version requires, in the same change,

1. a `1.4.9/report.md`-style delta recording what changed (or an updated revision of
   `1.4.8/` if only our understanding changed),
2. refreshed fixtures (`tests/fixtures/`),
3. a live verification with captured evidence,
4. the row above updated.

Regenerating the symbol inventory after a bump is one command:

```bash
python3 .project/analyses/antigravity-cli/1.4.8/tools/goresym.py --bin ~/.local/bin/agy init
```
