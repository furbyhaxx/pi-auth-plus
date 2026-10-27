# Commands

Login and logout remain Pi's `/login <provider>` and `/logout <provider>`. `/auth` never
logs in or out; it reports status and points to the appropriate login.

## Dashboard and entry points

| Command | Behavior |
|---|---|
| `/auth` | Open Providers |
| `/auth providers` | Credential status, source and OAuth expiry |
| `/auth quotas [provider]` | Live quota detail; optional solo provider |
| `/auth tokens` | Open Tokens; this tab reports that token counting is unavailable |
| `/auth settings [key]` | All settings; optional dotted key selects that row |
| `/quotas [provider]` | Open Quotas, optionally solo |
| `/quota [provider]` | Same handler as `/quotas` |
| `/quotas reset [provider]` | List reset credits, then ask before spending one; default is first enabled reset-capable provider (`codex`) |
| `/quota reset [provider]` | Same reset flow |
| `/quota codex login [--device\|--browser]` | Codex OAuth login for the `codex` quota source; writes `<agentDir>/quotas-codex-auth.json`. Pending verification; see [Codex login](quotas.md#codex-login) |

`resets` aliases `reset`. Dashboard section names are case-insensitive and accept:

| Section | Aliases |
|---|---|
| `providers` | `provider`, `status`, `accounts`, `account` |
| `quotas` | `quota`, `usage`, `limits` |
| `tokens` | `token`, `count`, `counts` |
| `settings` | `setting`, `config`, `options` |

Provider arguments accept the [quota provider aliases](quotas.md#providers).
Unknown `/auth` sections show usage and nearby section names. An unrecognized bare
quota provider currently opens the unfiltered view; it does not validate as strictly as
the CLI or bus. Reset arguments reject unsupported/unknown providers and extra words.

Commands offer argument completion for dashboard sections and quota provider ids/reset.
There is no standalone `/tokens` command. There are no `/quota settings`, `show`,
`refresh` or `line` subcommands: use `/auth settings` and Quotas keys instead. The only
login subcommand is `/quota codex login`; every other provider uses Pi's `/login`.

Outside an interactive TUI, read-only dashboard commands render text. Quotas print
cached state without fetching on open. Settings print effective values and source scopes.
A reset without an interactive UI lists credits and spends nothing.

## Dashboard keys

Hints reflect Pi's configured bindings. Defaults below refer to the select, editor and
tab bindings; literal letter shortcuts are additional keys.

| Key | Action |
|---|---|
| Tab / Right | Next tab, unless the active view consumes Right for editing |
| Shift+Tab / Left | Previous tab, unless the active view consumes Left for editing |
| Up/Down | Scroll/select within active tab |
| Esc | Close, or cancel/discard in Settings first |

In Quotas, `k`/`j` also select providers, `r` forces selected refresh, `R` forces all,
`a` toggles solo, `p` cycles line position (saved to user scope), and `x` requests a
supported reset. Full details and safety rules: [quotas](quotas.md#quotas-tab).

## Settings keys

Edits are staged until saved; the panel shows the effective source scope and staged
values. Save or discard staged edits before opening a JSON list/rule editor.

| Key | Action |
|---|---|
| Up/Down or `k`/`j` | Select setting |
| Left/Right or `h`/`l` | Set boolean false/true, cycle enum, decrease/increase number |
| Enter | Toggle boolean/cycle enum, edit text/number, or open list/rules as JSON in Pi's editor |
| Space | Toggle boolean, advance enum or increase number |
| Backspace | Preview built-in default; stage removal of the key from the eventual save scope |
| Ctrl+S, then `u` / `p` / `r` | Save staged values to user / trusted project / current session |
| Enter during text/number edit | Validate and stage |
| Esc during edit/save prompt | Cancel edit/prompt |
| Esc in list with staged edits | Discard staged edits; press again to close |
| PageUp/PageDown | Page line-template preview when the template row is selected; also accepts editor page bindings |

JSON editing closes the dashboard, opens Pi's editor, asks for a save scope, then reopens
on the same row. Invalid JSON or wrong field shape saves nothing. Template editing has a
live preview and ignored-token diagnostics. Saving refuses malformed target files and
warns when higher-priority overrides hide a save. See [configuration](configuration.md).

## CLI flags

| Flag | Behavior |
|---|---|
| `--quotas-list [provider]` | Print quota table and exit before session startup |
| `--quotas-json [provider]` | Print normalized JSON and exit; wins over `--quotas-list` |
| `--synthetic-web-search` | Enable the Synthetic web-search tool for this run |

Quota flags use only user settings. Exit codes: 0 all requested providers `ok`, 1 degraded
or failed query, 2 unknown/disabled provider. There is no CLI reset or separate `--json`
modifier. See [CLI details](quotas.md#read-only-cli) for output, freshness and color rules.
