# Commands

Login and logout remain Pi's `/login <provider>` and `/logout <provider>`. `/auth` never
logs in or out; it reports status and points to the appropriate login.

## Dashboard and entry points

| Command | Behavior |
|---|---|
| `/auth` | Open Providers |
| `/auth providers` | Credential status, source and OAuth expiry |
| `/auth quotas [provider]` | Live quota detail; optional solo provider |
| `/auth tokens` | Live context count, sources and full-request breakdown; see [Token counts](tokens.md) |
| `/auth models` | Visibility rules, catalog preview, overrides and aliases; see [Model management](models.md) |
| `/auth groups` | Configure and inspect virtual model groups; see [Model groups](models.md#model-groups) |
| `/auth settings [key]` | All settings; optional dotted key selects that row |
| `/quotas [provider]` | Open Quotas, optionally solo |
| `/quota [provider]` | Same handler as `/quotas` |
| `/tokens` | Open Tokens |
| `/token` | Same handler as `/tokens` |
| `/quotas reset [provider]` | List reset credits, then ask before spending one; default is first enabled reset-capable provider (`codex`) |
| `/quota reset [provider]` | Same reset flow |
| `/quota codex login [--device\|--browser]` | Codex OAuth login for the `codex` quota source; writes `<agentDir>/quotas-codex-auth.json`. See [Codex login](quotas.md#codex-login) |

Dashboard section names are case-insensitive and accept:

| Section | Aliases |
|---|---|
| `providers` | `provider`, `status`, `accounts`, `account` |
| `quotas` | `quota`, `usage`, `limits` |
| `tokens` | `token`, `count`, `counts` |
| `models` | `model`, `visibility` |
| `groups` | `group`, `routing`, `route` |
| `settings` | `setting`, `config`, `options` |

Provider arguments accept registered IDs, aliases and unambiguous provider labels; see the
[quota provider aliases](quotas.md#providers). Unknown `/auth quotas` and `/quota` targets
are rejected with usage and nearby names. Unknown `/auth` sections also show usage and
nearby section names. `resets` aliases `reset`; reset arguments reject unsupported/unknown
providers and extra words.

Completions suggest dashboard sections, quota provider names/aliases, settings keys, reset
forms and Codex login forms. `/tokens` and `/token` take no arguments. The quota
command has no `settings`, `show`, `refresh` or `line` subcommands; use `/auth settings`
and Quotas keys instead. Codex quota login accepts both:
`/quota codex login [--device|--browser]` and `/quota login codex [--device|--browser]`.
Every other provider uses Pi's `/login`.

Outside an interactive TUI, read-only dashboard commands render text. Quotas print
cached state without fetching on open; Tokens prints the latest count without recounting.
Settings print effective values and source scopes; Models prints the rules and hidden count;
Groups prints configured groups and their members.
A reset without an interactive UI lists credits and spends nothing.

## Dashboard keys

Hints reflect Pi's configured bindings. Defaults below refer to the select, editor and
tab bindings; literal letter shortcuts are additional keys.

| Key | Action |
|---|---|
| Tab / Right | Next tab, unless the active view consumes Right for editing |
| Shift+Tab / Left | Previous tab, unless the active view consumes Left for editing |
| Up/Down | Scroll/select within active tab |
| Esc | Cancel an edit/prompt, back out, or close; drafts require confirmation before discard |

Tabs retain their staged edits and nested editor state when you switch away and back. Esc or
Ctrl+C at the dashboard asks before discarding drafts across tabs; backing out of a nested
editor asks before discarding that editor's draft. Navigation and close are protected while a
save is in progress.

In Quotas, `k`/`j` also select providers, `r` forces selected refresh, `R` forces all,
`a` toggles solo, `p` opens the line-placement chooser and asks for an explicit save scope,
and `x` requests a supported reset. Full details and safety rules:
[quotas](quotas.md#quotas-tab).

## Settings keys

Edits are staged until saved; the panel shows each effective source scope and staged
values. Enter on `quotas.providers` or `openai.verbosityProviders` opens a typed provider
selector; custom IDs can be added and unknown IDs removed. An empty quota-provider list
means all quota sources. Enter on `claude.replacePatterns` opens ordered literal match and
replacement rows; omitting a replacement drops matching paragraphs. Add rewrite or drop
rules, then edit, reorder or remove them using the editor's hint keys. Its Apply key
(stated in the hint row) stages the collection back into Settings; save those drafts
separately. Enter on `models.rules` or `models.aliases` opens Models, and Enter on
`models.groups` opens Groups.

| Key | Action |
|---|---|
| Up/Down or `k`/`j` | Select setting |
| Left/Right or `h`/`l` | Set boolean false/true, cycle enum, decrease/increase number |
| Enter | Toggle boolean/cycle enum, edit text/number, open a typed collection editor, or navigate to Models/Groups |
| Space | Toggle boolean, advance enum or increase number |
| Backspace | Preview built-in default; stage removal of the key from the eventual save scope |
| Save key shown in hints, then `u` / `p` / `r` | Save staged values to user / trusted project / current session |
| Enter during text/number edit | Validate and stage |
| Esc during edit/save prompt | Cancel the current edit/prompt |
| Esc when backing out with nested drafts | Confirm before discarding the nested draft |
| PageUp/PageDown | Page line-template preview when the template row is selected; also accepts editor page bindings |

Saving to a scope reports keys still shadowed by a higher-priority scope and any
post-commit warnings. File saves preserve unknown keys and refuse malformed target files;
project saves require a trusted project. Template editing has a live preview and
ignored-token diagnostics. See [configuration](configuration.md).

## CLI flags

| Flag | Behavior |
|---|---|
| `--quotas-list [provider]` | Print quota table and exit before session startup |
| `--quotas-json [provider]` | Print normalized JSON and exit; wins over `--quotas-list` |
| `--synthetic-web-search` | Enable the Synthetic web-search tool for this run |

Quota flags use only user settings. Exit codes: 0 all requested providers `ok`, 1 degraded
or failed query, 2 unknown/disabled provider. There is no CLI reset or separate `--json`
modifier. See [CLI details](quotas.md#read-only-cli) for output, freshness and color rules.
