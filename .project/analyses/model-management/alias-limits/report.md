---
version: 1
id: "model-management-alias-limits"
title: "Pi 1.4 model aliases with independent limits"
description: "Source trace and isolated live and local tests of alias limits, authentication, request rewriting, and compaction."
type: "analysis"
created: "2026-10-28T11:00:15+01:00"
updated: "2026-10-28T11:01:42+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "analysis"
  id: "model-management-alias-limits"
  title: "Pi 1.4 model aliases with independent limits"
  description: "Source trace and isolated live and local tests of alias limits, authentication, request rewriting, and compaction."
  status: "published"
  revision: 1
  created_at: "2026-10-28T11:00:15+01:00"
  updated_at: "2026-10-28T11:01:42+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "probe results"
      changes: ["Live and isolated probe evidence for M4 model management"]
---

# Pi 1.4 model aliases with independent limits

status: "root-caused"
confidence: "high"

## Summary

A physical catalog entry with its own selectable ID, `contextWindow` and `maxTokens` makes Pi use those limits. To keep the same provider/login and upstream model ID, route the **request payload** to the upstream ID in the provider's streaming implementation, including the direct summarization path. Pi's `before_provider_request` event alone is insufficient: it is not invoked for compaction summaries.

A virtual model uses its selected limits only before any successful assistant response; the routed physical limits govern requests, later context usage and compaction. A duplicate provider can carry independent limits and the same wire ID, but compatibility registration does not share another provider's login. Native provider auth delegation can share request-time OAuth in principle; its startup availability and transport semantics require additional work.

**Live gap:** the wrapped OpenCode alias made a successful normal request and reached the small-window automatic-compaction threshold, but the summary request returned HTTP 429. Successful wrapped auto-compaction was confirmed against a local HTTP provider, not live. Anthropic and OpenAI Responses have source support for payload transformation but were not live-tested.

## Environment and source roots

- `pi-bolt --version`: `1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`; Bun `1.4.3`.
- `CA` = `/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-coding-agent@1.4.0@@@1/dist`.
- `AI` = `/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-ai@1.4.0@@@1/dist`.
- The live model `opencode/big-pickle` was present in the provider's [live model listing](https://opencode.ai/zen/v1/models) and in the models.dev provider catalog on 2026-10-28. These checks do not establish future availability.
- `HOME`, `PI_CODING_AGENT_DIR` and XDG config/cache/data/state were confined to `/tmp/pi-alias-limits.omI3NjYC/`; no user's auth file was copied or read. Only the test extension was loaded; the work directory was outside the repository. No repository `.pi/` content was touched. Temporary files and servers were removed after the experiments.

## Verdicts and causal trace

### A. Virtual alias to the physical model: no independent limits

1. A virtual entry takes the declared `contextWindow` and `maxTokens` (`CA/core/virtual-models.js:66-82`). Before any successful response, `_limitsModel()` falls back to the selected virtual entry; `getContextUsage()` calculates tokens divided by its window (`CA/core/agent-session.js:309-311,3500-3531`). The footer formats exactly that context result (`CA/modes/interactive/components/footer.js:133-175`).
2. `routedModel` uses the latest successful assistant response in the current conversation and looks up its physical catalog model (`CA/core/agent-session.js:1060-1065`; `CA/core/virtual-models.js:10-19`). Consequently, switching to a virtual model after an earlier physical response immediately uses that response's window, even before the virtual model makes its first request. If the named physical model is no longer in the catalog, lookup fails and the virtual selection is the fallback.
3. `resolveModel` ignores non-identity changes on the model object returned by `route()`: it looks up `route.model.provider` and `route.model.id` in the physical catalog and returns that canonical model (`CA/core/model-runtime.js:736-764`). Returning a copy with smaller limits cannot override the catalog.
4. For a new virtual request, Pi checks the **routed physical** window against projected tokens before dispatch (`CA/core/agent-session.js:417-421,433-483`). Before a later prompt and after a response, `_checkCompaction` uses the physical model resolved from that assistant message (`CA/core/agent-session.js:283-287,1480-1485,1559,2391-2405,2506`). Threshold is `contextTokens > contextWindow - reserveTokens` (`CA/core/compaction/compaction.js:173-176`).
5. Simple provider calls default the output budget to the routed model's `maxTokens` and clamp it to available context, less a 4,096-token safety reserve (`AI/api/simple-options.js:3-9,18-23`). An explicit caller output limit replaces that default before context clamping. Thus neither virtual output limit nor virtual window constrains the actual physical request.

### B. Same upstream ID under a different provider: independent limits, separate auth by default

- The duplicate's physical model has its own provider and limits; Pi calculates usage and compaction from that entry and sends the original model ID. A real request with an explicitly configured anonymous OpenCode credential returned HTTP 200, requested 256 output tokens and produced 326/8,000 = 4.075% context usage.
- `registerProvider(name, config)` accepts `apiKey` as a **string** (literal, environment interpolation, or command), not a function or another provider reference (`CA/core/extensions/types.d.ts:1414-1422`). Credentials are resolved against the selected provider's ID (`AI/auth/resolve.js:14-35`). With source `opencode` configured but no credential for `opencode-copy`, `--list-models` omitted the copy. An environment variable can be shared where both providers support the same key; that does not share a stored OAuth slot.
- An extension can instead register a **native `Provider`** (`CA/core/extensions/types.d.ts:1358-1359`; `AI/models.d.ts:72-132`) whose `auth.apiKey.resolve` delegates to `ctx.modelRegistry.getProviderAuth(sourceId)` (`CA/core/model-registry.js:102-104`). In a local test, a fake expired OAuth credential was refreshed in the source slot; the duplicate's requests received its resolved auth and auto-compacted successfully. This demonstrates request-time delegation, not production-ready login parity. `getProviderAuth(provider)` is provider-level; model-specific configured headers require `getApiKeyAndHeaders(sourceModel)` (`CA/core/model-registry.js:34-59`). Preserve returned `baseUrl`, headers and environment as well as the credential.
- The native mock's `check()` deliberately claimed it was always configured so startup could select the duplicate before a session context existed. With no source login, `--list-models` still listed the copy. That is a false availability status, not an acceptable implementation. In Pi's startup, factories and registration drain and offline refresh occur before session creation (`CA/core/agent-session-services.js:48-110`). A production design must solve startup checks, login/logout changes, missing context, source filtering, provider-specific transport and cancellation; a copied provider ID can change provider-specific request behavior. A real OAuth account was not tested.

### C. Same-provider physical alias with payload rewrite: recommended with a stream-level wrapper

- `models.json` custom `models` entries are upserted into the base catalog (`CA/core/provider-composer.js:150-185`). Their `id` is normally the wire ID (`CA/core/model-config.js:33-46`), but a later transport transformation can change the wire payload. By contrast, `modelOverrides` modifies entries already present (`CA/core/provider-composer.js:54-76,353-369`).
- The live same-provider alias retained `opencode` auth and base URL; a request hook changed `big-pickle-short` to `big-pickle` in the chat body. HTTP 200, output cap 256, assistant message ID `big-pickle-short`, and usage 326/8,000 = 4.075% were observed. The same conversation's manual compaction then failed with HTTP 400, `Model is unavailable.`
- Reason: agent requests receive the extension `onPayload` hook via `CA/core/sdk.js:224-228,261-275`, but summary requests call `agent.streamFunction` with separately constructed options that omit `onPayload` (`CA/core/agent-session.js:2206-2209`; `CA/core/compaction/compaction.js:463-487`). The default summary therefore sends the alias ID unchanged. A local provider that accepts only `upstream` directly observed `upstream` for the regular call and `short` for automatic summary calls, which returned 400. The live 400 is consistent with this source trace; its raw request body was not captured.
- A provider-owned `streamSimple` wrapper that installs its own `onPayload`, invokes the caller's existing `onPayload` first, then rewrites only the matching alias, covers both agent and direct summary calls. In the local test every normal and summary request sent `upstream`, returned successfully, and automatic threshold compaction completed. The assistant retained alias ID `short`, the 8,000-token window and the 256-token output cap. Do not rewrite the `Model` passed to the underlying API to the upstream ID: that also changes the ID emitted on assistant messages and can defeat model matching and accounting.

A sketch of the critical wrapper, with `underlying` being the provider's faithful existing implementation and `aliasToWire` an explicit mapping:

```ts
streamSimple(model, context, options) {
  return underlying.streamSimple(model, context, {
    ...options,
    onPayload: async (payload, payloadModel) => {
      const transformed = (await options?.onPayload?.(payload, payloadModel)) ?? payload;
      const wireId = aliasToWire.get(model.id);
      return wireId ? { ...transformed, model: wireId } : transformed;
    },
  });
}
```

This is a mechanism sketch, not a complete generic provider implementation. The wrapper must preserve the original provider's other shaping, transport, `onResponse`, stream-event callbacks, cancellation and non-alias behavior. Registering a compatibility `streamSimple` intercepts only the configured `api`; the extension's `models` array, if supplied, **replaces** the entire provider catalog (`CA/core/provider-composer.js:188-194,376-390`; `CA/core/extensions/types.d.ts:1435-1449`). It also supersedes earlier `models.json` additions in the composition order. An owned/dynamic family must append and retain aliases in its complete static and refreshed catalog; generic modification of every built-in/third-party provider is not established. Reusing a bare API implementation can silently bypass provider-specific stream wrappers.

For `openai-completions`, `anthropic-messages` and `openai-responses`, Pi builds a body containing `model.id`, invokes `onPayload`, and sends the returned body (`AI/api/openai-completions.js:187-197,568-578`; `AI/api/anthropic-messages.js:438-445,919-923`; `AI/api/openai-responses.js:138-149,263-273`). Normal-request rewriting is therefore source-confirmed for all three, but only OpenAI-compatible chat was tested live and locally. The provider still validates the final model, body and auth. Pi may compute compatibility or provider-specific headers from the **alias** before rewriting: for example OpenRouter cache-control and developer-role heuristics inspect `model.id` (`AI/api/openai-completions.js:1266-1269`), and Copilot handling depends on `model.provider` (`AI/api/anthropic-messages.js:783-786`). Copy all model metadata and explicitly verify each provider. Responses may omit `max_output_tokens`, and when included floors it at 16 (`AI/api/openai-responses.js:16-17,272-273`), so exact wire max-output behavior is API/compat dependent.

## Experiments and observed results

### Live Pi-Bolt RPC

The historical commands below used scripts and agent directories under the isolated temporary root shown above. The scripts were removed after use. Each process used `--offline --no-extensions --no-mcp --no-skills --no-themes --no-prompt-templates --no-context-files --no-approve --no-session`, the explicitly loaded temporary test extension, one `read` tool, and `--mode rpc`. The alias was upserted in the temporary `models.json` with the OpenCode base URL, API `openai-completions`, context 8,000 and maximum output 256. The extension added the OpenCode CLI identity and environment block, reported only model ID/output cap/status, and did not print request credentials. `get_session_stats` measured the same `getContextUsage()` used by the default footer.

```text
python3 /tmp/pi-alias-limits.omI3NjYC/rpc_probe.py A alias-router/big-pickle-small
python3 /tmp/pi-alias-limits.omI3NjYC/rpc_probe.py B opencode-copy/big-pickle
python3 /tmp/pi-alias-limits.omI3NjYC/rpc_probe.py C opencode/big-pickle-short
WRAP=1 FAKE_USAGE=1 python3 /tmp/pi-alias-limits.omI3NjYC/rpc_probe.py W opencode/big-pickle-short
```

| Probe | Observed result |
|---|---|
| A, virtual route returning a physical-model copy with 8,000/256 | Before: 0/8,000; HTTP 200 with upstream model and max 32,000; after: 326/200,000 = 0.163%. |
| B, duplicate provider with an explicitly supplied anonymous credential | HTTP 200 with upstream ID and max 256; after: 326/8,000 = 4.075%. This does not establish automatic credential reuse. |
| C, same-provider alias with event-only rewrite | Two normal requests returned HTTP 200 with upstream ID and max 256; first response 326/8,000 = 4.075%. Manual compaction failed: `Summarization failed: 400 ... Model is unavailable.` |
| W, same-provider stream wrapper | Normal request returned HTTP 200. The test replaced its reported input usage with **4,000 synthetic tokens** to cross the 2,000-token threshold; Pi emitted `compaction_start: threshold`. The live summary returned `429 FreeUsageLimitError`; no successful live compaction was observed, and the cause of that 429 was not isolated. |

For these tests `compaction.reserveTokens=6000` and `keepRecentTokens=0`. Pi defaults are 16,384 and 20,000 respectively (`CA/core/settings-defaults.js:8-12`); leaving reserve larger than an 8,000-token context makes the nominal threshold negative. Set a suitable per-model override when testing or deploying a small alias (`CA/core/settings-manager.js:643-671`).

### Local HTTP provider and synthetic OAuth

The local server emulated streaming OpenAI chat, returned a synthetic usage of 4,002 context tokens, accepted only the upstream wire ID and validated a fake refreshed source credential. Two short RPC prompts were sent in each case; source auth expired initially. The historical commands were:

```text
python3 /tmp/pi-alias-limits.omI3NjYC/mock_probe.py virtual router/short
python3 /tmp/pi-alias-limits.omI3NjYC/mock_probe.py bare source/short
python3 /tmp/pi-alias-limits.omI3NjYC/mock_probe.py wrapped source/short
python3 /tmp/pi-alias-limits.omI3NjYC/mock_probe.py copy copy/upstream
python3 /tmp/pi-alias-limits.omI3NjYC/mock_probe.py switch source/upstream
```

- Virtual: 4,002/200,000 = 2.001%, wire max 1,024, and no compaction; the advertised virtual limits were 8,000/256.
- Switch: after a physical response, selecting the virtual alias before its first response still showed 4,002/200,000.
- Event-only alias: 4,002/8,000 = 50.025%; normal bodies used `upstream`, summary bodies used `short`, and threshold compaction failed with HTTP 400. One retry occurred before the next normal request, demonstrating the pre-prompt check.
- Wrapped alias: every normal and summary body used `upstream` with max 256; threshold compaction completed successfully. Context usage then reported `{tokens:null, contextWindow:8000, percent:null}` until a post-compaction response, as intended by `CA/core/agent-session.js:3507-3525`.
- Native duplicate with delegated source auth: fake source OAuth refresh succeeded, all three observed bodies used `upstream` with max 256 and valid delegated auth, and threshold compaction completed. The unconditional startup `check` caveat above applies.

These mock results establish Pi's control flow, not real vendor acceptance, billing, latency, or actual tokenization.

## Recommended implementation and regression checks

1. For a provider whose full catalog and transport can be owned faithfully, add a distinct physical same-provider model entry, copy the upstream model's metadata, override only the intended independent limits, and retain the original model. Carry the entry through catalog refreshes and detect ID collisions.
2. Rewrite the alias to the upstream ID inside the provider-owned stream, after invoking the caller's payload hook, for both normal and direct summary requests. Retain the alias on the Pi model and assistant messages. Preserve all provider-specific transport and OAuth details. For a built-in provider whose catalog or stream cannot be extended without replacing another owner's registration, do not claim generic support; a Pi-native alias/catalog-extension seam or provider-specific integration is needed.
3. Regression-test first response, previous physical response followed by selection, RPC context percentage, pre-request and post-response threshold checks, manual and automatic summary requests, output cap, source credential refresh/logout, catalog refresh and original model retention. Cover Anthropic and Responses separately; include provider-specific ID heuristics and multi-API providers.

## Open questions / follow-ups

- Live completion of wrapped OpenCode summary generation is **UNVERIFIED**: its automatic attempt reached HTTP 429. Determine whether this was rate limiting, free-tier request shape/tool requirements, or other provider policy before attributing a cause.
- Real OAuth reuse under a duplicate ID, and the same-provider wrapper against Anthropic and Responses, are **UNVERIFIED**. Native provider delegation also needs truthful availability before session creation.
- The brief requires flat YAML frontmatter; this conflicts with the repository `AGENTS.md` rule requiring a nested `document:` block. The requested flat frontmatter is used.
