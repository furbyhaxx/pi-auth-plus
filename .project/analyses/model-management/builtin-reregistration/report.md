---
document:
  type: "analysis"
  id: "analysis-model-management-builtin-reregistration"
  title: "Hiding built-in provider models by re-registering the provider"
  description: "Probe of pi.registerProvider(<builtin>, { models }) from the extension factory as the enforcement path for model rules on providers pi-auth-plus does not own"
  status: "final"
  revision: 1
  created_at: "2026-10-28T13:30:00+01:00"
  updated_at: "2026-10-28T13:30:00+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Offline and live probes on pi-bolt (pi-coding-agent 1.4.0) for openai and openrouter"]
---

# Hiding built-in models by re-registering the provider

User idea (2026-10-28): instead of waiting for a Pi visibility hook, re-register the built-in
provider with the filtered model list. This report tests it. The earlier `filter-seams/` probe
rejected a *native* provider replacement; this one uses the *named* `registerProvider(id,
{ models })` overload, which keeps Pi's own provider object, auth and stream.

## Verdict

Works for catalog-backed built-ins, with three caveats. Adopted for S2 as the enforcement path
for providers that have at least one active hide rule.

| Check | Result |
|---|---|
| Hidden ids gone from `--list-models` (offline and online) | yes, openai 44 -> 33, openrouter 394 -> 357 |
| Kept ids still work live | yes, `openai/gpt-5.6-luna` and `openrouter/openai/gpt-5-mini` answered `ok` |
| `modelOverrides` from `models.json` still applied | yes, `gpt-5.6-luna` context 123K from override |
| Catalog parity for kept models (openai) | exact, once the merge keys on `type:id` |
| Catalog parity (openrouter) | no: 10+ extra models (`auto`, `:free`, `:batch`, `*-contributor`) |
| Explicit `--model openai/gpt-4o` on a hidden id | not selected, but misleading error `No API key found for vercel-ai-gateway.` |

## How the probe built the list

The factory has no getter for Pi's composed catalog (`extensions/loader.js` runtime stub:
`getSettings` and friends are `notInitialized`; no catalog accessor). So the probe rebuilds it:

1. Bundled models: `getModels(provider)` from `@earendil-works/pi-ai`.
2. Remote catalog: `models-store.json` under `PI_CODING_AGENT_DIR`, entries for the provider.
3. Merge keyed on `${type ?? "chat"}:${id}`; store wins.
4. Drop hidden ids, then `pi.registerProvider(provider, { models })`.

Probe sources: `/tmp/rereg-probe.ts` (bundled only), `/tmp/rereg-probe2.ts` (id-keyed merge),
`/tmp/rereg-probe3.ts` (type:id merge, the correct one). All runs used an isolated
`PI_CODING_AGENT_DIR`/`HOME`/XDG set; live runs copied only the `openai` and `openrouter`
credentials, and the scratch dir was deleted afterwards.

## Findings

1. **Bundled-only list loses remote models.** Without the store merge, openai dropped from 44
   to 32 entries, including a store-only test id `gpt-9-probe`. The merge is mandatory.
2. **The store holds same-id entries of different types.** `openai/gpt-6-luna` exists as
   `type: "chat"` (openai-responses, 272K) and `type: "classifier"` (openai-decisions). An
   id-keyed merge let the classifier replace the chat entry, so `gpt-6-luna` vanished from the
   list. Keying on `type:id` gives exact openai parity (diff empty except intended hides).
3. **OpenRouter loses personalization.** Pi wraps built-in openrouter with
   `withPersonalizedCatalog(provider, personalizeOpenRouterCatalog, ...)`
   (`core/model-runtime.js:90-96`). The rebuilt list is the raw store, so models the account
   personalization would drop reappear (e.g. `auto`, `minimax/minimax-m3.1-flash:free`,
   `meta/muse-spark-1.3-contributor`, mistral `:batch`). Not yet tested: calling
   `personalizeOpenRouterCatalog` from the extension.
4. **Hidden explicit ids fail closed but confusingly.** `--model openai/gpt-4o` does not select
   the hidden model; Pi resolves the id elsewhere and errors on the missing
   `vercel-ai-gateway` key. A hidden id in a saved default would hit the same path.

## Gaps (not observed)

- Behaviour after an in-session `refreshModels` / catalog refresh: does the remote wrapper
  overwrite the re-registered list, and does a new remote model appear? Needs a refresh-event
  probe; the S2 design re-registers on refresh as a precaution.
- Interaction with another extension that also re-registers the same built-in (named configs
  merge defined keys, so the last `models` wins).
- Pi-Bolt AOT compile of the `@earendil-works/pi-ai` `getModels` import.

## Recommendation

- Use re-registration only for providers with at least one active hide rule; leave the rest
  untouched so Pi's wrappers stay in charge.
- Merge bundled + store on `type:id`. Re-run on catalog refresh.
- OpenRouter: spike `personalizeOpenRouterCatalog` before enabling; until then the panel marks
  openrouter rules as `re-reg (raw)`.
- The user subsequently ruled out filing an upstream Pi hook request; handle these limitations
  locally and expose any remaining gaps honestly.
