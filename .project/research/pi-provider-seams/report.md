---
document:
  type: "research"
  id: "pi-provider-seams"
  title: "Pi 1.4 provider seams"
  description: "Verified Pi 1.4.0 startup, provider, catalog, auth, event, request and token-counting extension seams."
  status: "published"
  revision: 2
  created_at: "2026-10-27T09:58:49+01:00"
  updated_at: "2026-10-27T10:17:31+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Initial provider-seam research"]
    - revision: 2
      reason: "source verification and corrections"
      changes: ["Verified against installed Pi 1.4.0 and corrected request-hook filtering, first-run catalogs, and token usage persistence"]
---

# Pi 1.4 provider seams

Read this report before changing provider registration in pi-auth-plus.

## Evidence roots

- `iCA`: `/mnt/Projects/furbyhaxx/pi-auth-plus/node_modules/@earendil-works/pi-coding-agent/dist/`
- `iAI`: `/mnt/Projects/furbyhaxx/pi-auth-plus/node_modules/@earendil-works/pi-ai/dist/`
- `pkgCA`: `/mnt/Projects/furbyhaxx/pi-auth-plus/node_modules/@earendil-works/pi-coding-agent/`
- `pkgAI`: `/mnt/Projects/furbyhaxx/pi-auth-plus/node_modules/@earendil-works/pi-ai/`
- `CA`: `/mnt/Projects/nukular/nukular-ai/.references/pi/packages/coding-agent/src/`
- `AI`: `/mnt/Projects/nukular/nukular-ai/.references/pi/packages/ai/src/`
- `refCA`: `/mnt/Projects/nukular/nukular-ai/.references/pi/packages/coding-agent/`
- `refAI`: `/mnt/Projects/nukular/nukular-ai/.references/pi/packages/ai/`
- `BOLT`: `/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/`

Both installed packages and both reference-checkout manifests report version `1.4.0` (`pkgCA:package.json:3`, `pkgAI:package.json:3`, `refCA:package.json:3`, `refAI:package.json:3`). The installed package manifests ship `dist`, not TypeScript `src` (`pkgCA:package.json:23-29`, `pkgAI:package.json:54-56`); the installed packages have no package-source `src/` tree. Treat installed `dist` as authoritative where it differs from the same-version-labelled checkout.

## 1. Startup registration and resolution

**Verdict: confirmed.**

- Pi awaits each extension factory. Provider registrations made during loading are queued, committed after the factory succeeds, then drained into `ModelRuntime` after resource reload; startup runs a cache-only model refresh before resolving scopes, `--model`, session restore and `--list-models` (`CA:core/extensions/loader.ts:263-265,459-467,533-544,627-632`; `CA:core/agent-session-services.ts:69-111`; `iCA:main.js:602-678,720-724`).
- `session_start` is later, when the selected mode binds extensions (`CA:core/agent-session.ts:3318-3334`; `CA:modes/interactive/interactive-mode.ts:1975`; `CA:modes/print-mode.ts:76`; `CA:modes/rpc/rpc-mode.ts:319`). Later registrations apply immediately but cannot retroactively affect earlier model resolution or restoration (`CA:core/extensions/runner.ts:417-445`).

**Consequence:** register all providers synchronously in the factory (or await registration setup before it returns). `session_start` is too late for startup flags, scoped models, `--model`, `--list-models` and restored sessions.

## 2. Re-registration and builtin overlays

**Verdict: confirmed, with shallow-merge detail.**

- A repeated `registerProvider(id, config)` shallow-merges defined top-level keys into the prior extension config; `undefined` is ignored, so it cannot clear an existing `oauth`, `streamSimple` or `headers` key (`iCA:core/model-runtime.js:665-687`). To clear a prior extension value, unregister that extension provider and register the complete desired config again (`iCA:core/model-runtime.js:684-687`).
- A matching builtin id is deliberately composed as a base provider plus the extension overlay. Without `models`, its catalog remains; supplying `models` replaces the base models. Builtin provider refresh still runs, then the extension refresh runs too. The builtin stream remains for APIs it supports (`CA:core/model-runtime.ts:309-320`; `CA:core/provider-composer.ts:346-355,587-640`).
- OpenCode's builtin API streams add `x-opencode-session`; overriding the provider while retaining the builtin stream preserves that wrapper (`AI:providers/opencode.ts:17-24`; `AI:providers/opencode-headers.ts:10-24`). A custom stream can bypass it.

**Consequence:** patch `opencode` without `models` unless pi-auth-plus owns its catalog. Re-registration does not deep-merge a previous extension `headers` object. Use `unregisterProvider` before replacing prior extension fields; omitting a key is not removal.

## 3. `streamSimple`, API ids and delegation

**Verdict: confirmed.**

- The extension stream is selected only when `model.api === extension.api`. Otherwise Pi uses the base provider's stream for a supported API, then the global API-provider registry; a custom `streamSimple` without a matching `api` is bypassed (`iCA:core/provider-composer.js:376-390`; `CA:core/provider-composer.ts:587-607`). Pi's `Api` type accepts custom strings (`AI:types.ts:64-76`).
- Pi's builtin stream factories and API registry are exported from `pi-ai/compat` (`iAI:compat.d.ts:12-21,51-52`). A custom provider can delegate to a builtin API stream and pass adapted options through.
- Provider `streamSimple` options carry `onPayload`, `onResponse` and stream-event callbacks; custom implementations must forward/invoke them if they want those agent-level hooks to run (`CA:core/extensions/types.ts:1944-1957`; `CA:core/sdk.ts:374-426`).

**Consequence:** set `api` on the provider and models to the same ID for custom streaming. Use an existing Pi `api` when its protocol fits; when wrapping a builtin stream, preserve options and required wrappers.

## 4. Dynamic model catalogs

**Verdict: confirmed, with first-run constraint.**

- `refreshModels` receives `stored`, `allowNetwork`, `force`, `credential`, `signal` and `publish`. Startup calls refresh with `allowNetwork:false`; the core runs the offline restore phase first, then resolves credentials and performs a network phase only when allowed and a credential is available (`iAI:models.d.ts:9-42`; `CA:core/agent-session-services.ts:69-111`; `AI:models.ts:545-596`). The default store is `<agentDir>/models-store.json` (`CA:core/model-runtime.ts:218-227`).
- `checkedAt` is stored metadata, not a universal extension TTL: provider code decides freshness and must honor `force`. The builtin remote catalog uses a four-hour window and persists its own `checkedAt` (`AI:models-store.ts:3-9`; `CA:core/remote-catalog-provider.ts:14-16,135-141`). A provider persists through `publish({ persist: { models, checkedAt } })`; returning a model list updates the composed catalog but does not by itself persist it (`CA:core/provider-composer.ts:618-640`; `AI:models.ts:516-542,1145-1154`).
- Dynamic providers start with an empty list before a refresh unless they define static models. On the first offline pass, `stored` is `undefined`; a provider with no static/local fallback and no stored catalog remains empty until a later allowed network refresh (`AI:models.ts:174-180,553-562,589-596`; `CA:core/provider-composer.ts:346-355`).
- Interactive mode refreshes catalogs in the background after startup and when the model selector opens; `/model` search and login also refresh. RPC refreshes in the background. Pi's `--list-models` exits before those mode refreshes, and print (`-p`) has no Pi catalog network-refresh phase (`CA:modes/interactive/interactive-mode.ts:1151-1158,5229-5233`; `CA:modes/interactive/components/model-selector.ts:158,184-193`; `iCA:main.js:720-724,768-772`; `CA:modes/print-mode.ts:76-79`).

**Consequence:** ship a bundled/static first-run fallback; restore `context.stored?.models` when network is disallowed; fetch and persist only when allowed. No remote-only catalog can appear in first-run `--list-models` or print mode before it has been cached.

## 5. `/login`, `/logout` and credentials

**Verdict: confirmed.**

- `/login` offers registered providers with `auth.oauth` or `auth.apiKey`; Pi invokes that auth method's login flow and stores its returned credential. `/logout` lists stored credential slots and deletes the selected slot (`CA:modes/interactive/interactive-mode.ts:5784-5812,5871-5878,6311-6330`; `AI:models.ts:775-840`). The extension OAuth config supplies `name`, `login`, `refreshToken` and `getApiKey`; the API-key path has a default secret prompt unless the inherited auth method supplies its own login (`CA:core/extensions/types.ts:1975-1987`; `CA:core/provider-composer.ts:358-375,428-485`).
- File-backed credentials are keyed by provider id in `<agentDir>/auth.json`; writes use mode `0600` and the storage implementation locks updates (`CA:core/auth-storage.ts:37,64-78,104-108,348-350`). `/logout` removes the stored credential, not environment variables or configured keys (`CA:modes/interactive/interactive-mode.ts:6015-6018`).
- Stored OAuth is refreshed during auth resolution when expired or within five minutes of expiry, before provider requests. Catalog refresh resolves an expired OAuth credential before its network phase (`AI:auth/resolve.ts:102-175`; `AI:models.ts:627-645`). Stored credentials own the provider; environment/config fallback is used when none is stored (`AI:auth/resolve.ts:28-32,46-92`). API key values support literals, `$ENV`/`${ENV}` interpolation and a leading `!command` (`CA:core/resolve-config-value.ts:138-150`).

**Consequence:** define auth on the provider and rely on Pi's login/logout and auth storage. Do not introduce a second credential file. Expect a stored credential to take precedence over ambient API-key configuration until logged out.

## 6. Token estimation and correction seams

**Verdict: corrected. There is no public estimator-replacement hook, and Pi has two separate estimators.**

- `pi-ai` estimates text at 3.5 characters/token and uses that for API-side context clamping; coding-agent compaction estimates at 4 characters/token. Both use the latest applicable assistant `usage` and estimate only later messages (`AI:utils/estimate.ts:15-110`; `AI:api/simple-options.ts:18-21`; `CA:core/compaction/compaction.ts:140-219,294-320`).
- Assistant usage can be emitted by the provider stream. `message_end` handlers run in sequence and may return a same-role replacement; Pi replaces the message in place before appending it to session history, so corrected `usage` persists (`CA:core/extensions/runner.ts:1151-1188`; `CA:core/agent-session.ts:1147-1159,1286-1290,1334-1352`).
- `session_before_compact` can cancel compaction or supply a `CompactionResult`; it does not replace token estimation. `ctx.getContextUsage()` is read-only (`CA:core/extensions/types.ts:359-360,784-789,1511-1514`; `CA:core/agent-session.ts:2856-2863`).

**Consequence:** set authoritative usage on assistant messages in the provider stream; use `message_end` to correct builtin messages. Mark tokenizer-derived counts as estimates; use compaction hooks only for compaction behavior, not estimator replacement.

## 7. `pi.events` semantics

**Verdict: confirmed.**

- `pi.events` wraps one Node `EventEmitter`: `emit` synchronously calls `emitter.emit`; listeners are registered in order. Each listener is an async wrapper that awaits its handler, but the emitter does not await returned promises; handler failures are caught and logged (`CA:core/event-bus.ts:1-32`).
- A resource loader creates one bus shared by extensions it loads. Extension invalidation unsubscribes that extension's subscriptions. This is separate from `pi.on` lifecycle events, whose runner awaits handlers sequentially (`CA:core/resource-loader.ts:403-408,734-775`; `CA:core/extensions/loader.ts:196-205`; `CA:core/extensions/runner.ts:1096-1124`).

**Consequence:** use `pi.events` for fire-and-forget notifications, not request/response or completion ordering. Use awaited lifecycle handlers where Pi provides them; resubscribe after extension reload.

## 8. Request/response hooks and transport wrapping

**Verdict: corrected. Hooks exist, but the provider-specific filtering stated in the repo guidance is not explicit in these event payloads.**

- `before_provider_request` carries only `payload`; `before_provider_headers` carries only headers; `after_provider_response` carries status and headers. `provider_stream_event` additionally carries provider, API and model (`CA:core/extensions/types.ts:900-929`). The handler context exposes `ctx.model`, but that is the selected session model, not an explicit per-request identifier; routing or helper calls can differ (`CA:core/extensions/types.ts:325-360`; `CA:core/agent-session.ts:3497-3498`).
- Pi wires payload, response and stream-event callbacks through the Agent `streamFn`; header transforms are wired into provider request options. A direct `ModelRuntime.streamSimple` call has no implicit extension hooks unless its caller passes the corresponding options (`CA:core/sdk.ts:353-426`; `CA:core/model-runtime.ts:731-756`).

**Consequence:** a provider-owned fetch/stream wrapper is the reliable seam for shaping or observing that provider's traffic. Custom `streamSimple` code must forward callback options if it wants Pi's agent hooks too. For a builtin patch such as `opencode`, a hook can inspect the session model, but the event itself cannot guarantee provider-id filtering for each request.

## 9. Other registration constraints

**Verdict: confirmed.**

- Registering an existing provider id overlays its builtin; a new id composes without a base (`CA:core/model-runtime.ts:309-320`). Provider IDs are global across extensions too: another extension registering the same id merges into the existing extension config (`CA:core/model-runtime.ts:936-947`). Do not rely on a provider with no explicit auth failing: composition synthesizes a generic API-key login prompt unless the provider is OAuth-only (`CA:core/provider-composer.ts:428-442,534-542,583-585`). Duplicate model IDs across providers can be ambiguous; use `provider/id` to disambiguate (`iCA:core/model-resolver.js:333-353`). A known provider with an unknown model ID resolves to a custom model based on that provider's model defaults (`iCA:core/model-resolver.js:355-374`).
- Installed Pi 1.4.0 parses a `provider/` prefix at the first slash (`iCA:core/model-resolver.js:60-69`). The same-version-labelled checkout now matches the longest known provider id, so do not assume slash-containing provider IDs work in the installed build (`CA:core/model-resolver.ts:127-140`). `registerVirtualModel` is the explicit selectable virtual-model/alias seam (`CA:core/extensions/types.ts:1907-1918`).
- Provider `compat` is merged with per-model `compat`; configured headers overlay model headers, with extension headers over `models.json` headers (`CA:core/provider-composer.ts:128-137,249,400-405,708-720`).
- Pi-Bolt requires literal imports, embedded file assets, light factories and a 256 KB bytecode ceiling per function/module. It recommends type-only imports from `pi-coding-agent`; value imports from `pi-ai` and `typebox` are free (`BOLT:PLUGINS.md:166-177,269-292,312-313,393-398`).

**Consequence:** avoid accidental builtin ids, keep model ids unambiguous and slash-free where practical, and make provider initialization AOT-safe. Recheck the installed resolver before relying on slash-containing provider IDs after an upgrade.

## Startup order

```text
CLI parse (--offline / PI_OFFLINE)
  -> createAgentSessionServices
     -> resourceLoader.reload()
        -> await extension factories; queue registerProvider calls
     -> drain queued provider registrations into ModelRuntime
     -> modelRuntime.refresh({ allowNetwork: false })  [restore models-store only]
  -> resolve scoped models and --model
  -> create session and restore its saved provider/model
  -> --list-models prints and exits (no later network refresh)
  -> mode startup
     -> interactive: session_start, then background catalog refresh
     -> RPC: background catalog refresh
     -> -p: session_start, no Pi catalog network refresh
```

Evidence: `CA:core/extensions/loader.ts:627-632`; `CA:core/agent-session-services.ts:69-111`; `iCA:main.js:602-678,720-724,768-772`; `CA:modes/interactive/interactive-mode.ts:1151-1158`; `CA:modes/print-mode.ts:76-79`.

## Open questions

1. **UNVERIFIED:** whether every non-Agent direct `ModelRuntime.streamSimple` call site forwards `onPayload`/`onResponse` callbacks. The hooks are wired through the Agent path only; inspect individual helper call sites before depending on them.
2. Recheck the installed `provider/` parsing rule on the next Pi upgrade; the installed 1.4.0 dist and same-version-labelled source checkout already differ (section 9).
