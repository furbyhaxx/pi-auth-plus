# Getting started

pi-auth-plus adds subscription/API-key providers, quota monitoring and one `/auth`
dashboard to Pi. Use Pi-Bolt (Bun) or stock Pi on Node >=22.19. Anonymous OpenCode Zen
requires Pi-Bolt; the other providers do not require Bun.

## Install

Remove the absorbed packages before loading pi-auth-plus: pi-claude-auth,
pi-opencode-auth, pi-synthetic-auth, pi-antigravity-auth and pi-quotas.

```sh
pi install git:https://github.com/furbyhaxx/pi-auth-plus
```

Restart Pi after changing packages. `/auth` opens Providers; `/auth quotas` opens the
quota view. Use `/model` to choose a provider/model, `--list-models` to inspect the
catalog, or `--model <provider>/<model>` to select one at startup. Providers register
before model resolution, so scoped models and session restore use the same ids.

## Sign-in

Use Pi's `/login` and `/logout`. The one exception is the `codex` quota credential below. Credentials stay in
Pi's `<agentDir>/auth.json`; OAuth refresh is handled through Pi. Check `/auth providers`
for stored credentials, environment/model-file sources and anonymous access.

| Provider | Login and credential |
|---|---|
| `claude` | `/login claude`: Claude Pro/Max OAuth with a pasted code, or API key (entered, created through the console flow, or `ANTHROPIC_API_KEY`). Subscription quota needs OAuth. API-key inference uses Pi's Anthropic path. |
| `antigravity` | `/login antigravity`: Google OAuth. One account; subscription turns have zero listed cost. |
| `synthetic` | `/login synthetic` with an API key, or `SYNTHETIC_API_KEY`. |
| `opencode`, `opencode-go` | Pi's `/login opencode` or `/login opencode-go` for keyed access. An environment/stored/model-file key wins over the anonymous fallback. Zen's anonymous free models work on Pi-Bolt only; stock Pi's HTTP client is refused with `429 FreeUsageLimitError`. |
| `codex` (ChatGPT quota) | Pi's `/login openai-codex` if present; otherwise `/quota codex login [--device\|--browser]`, which writes `<agentDir>/quotas-codex-auth.json`. Pi's `openai` login and OpenAI API keys cannot read ChatGPT usage. See [Codex login](quotas.md#codex-login). |
| `xai` | Pi's `/login xai` with a credential accepted by the Grok CLI billing service; a regular inference key need not grant billing access. |
| `openrouter` | Pi's `/login openrouter`; its API credential supplies credit and key-cap reporting. |
| `deepseek` | Pi's `/login deepseek` with an API key for balance reporting. |

`claude`, `antigravity` and `synthetic` provide model catalogs; OpenCode is a patch of
Pi's built-ins. The last four rows use Pi's providers for inference/auth; pi-auth-plus
adds quota sources rather than new inference providers. Quota aliases do not rename
Pi's login commands.

Synthetic's catalog refreshes through Pi and persists in Pi's model store. It skips
models without usable prices or tool support; a bundled catalog covers the first run.
Enable its optional `synthetic_web_search` tool with `synthetic.webSearch` in
[configuration](configuration.md), or `pi --synthetic-web-search`. The tool returns
highlights and a private temporary file containing each page's full text.

## Migrating

Remove old package entries with `pi remove <installed-source>`, using the same source
string that was installed. The startup conflict warning prints the exact command for
package entries. For direct `-e`/extension paths, stop loading that path instead.
Legacy files are never deleted or rewritten by carry-over.

### From pi-claude-auth

Existing `claude` credentials in Pi's `auth.json` carry over. Move replace patterns from
Pi's old `settings.json` to `claude.replacePatterns` in `auth-plus.json`; the old setting
is not read. Rules are literal matches with an optional replacement; omitting it drops
matching paragraphs. Subscription tool names follow the interactive Claude Code wire
format, without the old `mcp_` prefix. API-key access stays on Pi's Anthropic path.

### From pi-opencode-auth

Pi's existing OpenCode credentials, `OPENCODE_API_KEY` and model-file overrides remain
usable. No separate credential migration is needed. Remove the old extension so two
patches do not shape the same request. Anonymous Zen's Pi-Bolt requirement still applies.

### From pi-synthetic-auth

The existing `synthetic` credential carries over. Set `synthetic.webSearch` in
`auth-plus.json`, or pass `--synthetic-web-search`; neither the old
`websearch.synthetic` in Pi's `settings.json` nor `SYNTHETIC_WEB_SEARCH` is read.
Web search keeps results without a publication date.

### From pi-antigravity-auth

On first session start, an OAuth login under Pi's `google` slot is copied into an empty
`antigravity` slot under Pi's credential-file lock. The original `google` slot and any
existing `antigravity` login stay untouched. An old project suffix is stripped from the
copied refresh token; project discovery runs per session. A migration warning points to
`/login antigravity` if copying fails.

Select models under `antigravity`, not the fork's `google` id. There is one entry per
model family; Pi's thinking level selects the wire level. This is one-account access:
account pools, Claustrum vault data and fork-specific packages are not imported.

### From pi-quotas

Remove pi-quotas, then start a session. While it remains loaded, pi-auth-plus's session
quota engine, line and bus stay off to avoid double polling/cache writing. Duplicate
commands can be renamed by Pi to `/quota:1` and `/quota:2`; remove the conflict rather
than relying on those names.

Carry-over runs only after pi-quotas is removed:

- User `<agentDir>/quotas.json` fills unset `quotas.*` keys in
  `<agentDir>/auth-plus.json`.
- Trusted-project `<cwd>/.pi/quotas.json` fills unset keys in that project's
  `.pi/auth-plus.json`. Untrusted project settings are neither read nor migrated.
- `enabledProviders` becomes `quotas.providers`, resolving aliases to Pi ids.
  Unknown names warn and are skipped. Existing destination keys always win.
- `lineTemplate` is preserved verbatim; aliases still resolve. `lineTemplateNarrow`
  is not imported: one template wraps at every width.
- `<agentDir>/cache/quotas-cache.json` contributes drainage history to the new host
  cache. Compatible history merges with existing observations; old snapshots and
  endpoint freshness are not imported, so quotas are fetched afresh.

Completion markers record each settings source and the history carry-over once.
Malformed files warn and remain retryable after repair/restart. Later edits to old files
are not synchronized; edit `auth-plus.json` instead. Invalid field values are skipped,
so inspect the startup warning and `/auth settings` after migration. Numeric values use
the new catalog ranges (notably, interval `0` becomes 15 seconds).

pi-quotas' `<agentDir>/quotas-codex-auth.json` is read directly, so an existing Codex
quota login keeps working (pending verification, see [Codex login](quotas.md#codex-login));
project `.auth.json` credentials are not read. Reports use `codex` and `xai`; `openai`
and `grok` are accepted aliases, `cox` is not. The compact Synthetic id `syn` is a
display label, not an accepted input alias.

Replace `/quota settings` with `/auth settings`, `/quota refresh` with panel `r`/`R`,
and `/quota line` with panel `p` or the placement setting. `/quota codex login` keeps
its pi-quotas form. Scripts switch from `--list-quotas [--json]` to
`--quotas-list` or `--quotas-json`. There is no command-line reset spend; use the
[interactive reset flow](quotas.md#reset-credits). Integrations switch to the
[new bus contract](events.md).

## Next steps

- [Quotas](quotas.md): providers, templates, panel keys, resets, cache and CLI.
- [Commands](commands.md): dashboard tabs, aliases and keys.
- [Configuration](configuration.md): every setting, layer, path and environment variable.
- [Events](events.md): consuming quotas from another extension.
