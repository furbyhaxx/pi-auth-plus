# Configuration

Use `/auth settings` to inspect effective values and their source, stage changes and
save to an explicit scope. Or edit JSON files and start a new session. External file
edits are not watched.

## Layers and files

Each key resolves from lowest to highest priority:

1. Built-in default.
2. User: `<agentDir>/auth-plus.json`.
3. Project: `<cwd>/.pi/auth-plus.json`, only when Pi trusts that project.
4. Runtime: memory in the current session.

`<agentDir>` is `PI_CODING_AGENT_DIR`, otherwise `~/.pi/agent`; a leading `~` in the
override expands to the home directory. `<cwd>` is Pi's active context working directory.
Home resolves from `HOME`, then `USERPROFILE`, then the operating system.

Files are partial JSON objects with nested sections, not dotted top-level keys:

```json
{
  "quotas": {
    "providers": ["claude", "codex"],
    "linePlacement": "below-editor-first",
    "percentDisplay": "remaining"
  },
  "synthetic": { "webSearch": true },
  "claude": {
    "replacePatterns": [
      { "match": "old phrase", "replacement": "new phrase" },
      { "match": "paragraph to remove" }
    ]
  }
}
```

Invalid fields warn and inherit the lower layer. Missing files contribute nothing.
Malformed files warn rather than replacing inherited settings. Saves merge changed keys
into the chosen scope, preserve unknown keys, and refuse to overwrite malformed files.
A higher layer can hide a saved value; the panel warns about shadowed changes. Backspace
previews the built-in default and stages removal of the key from the selected save scope;
after saving, any lower-priority value can become effective.
Runtime settings disappear with the session. The read-only quota CLI loads only user
settings; it cannot establish project trust.

## Settings catalog

Numbers must be finite JSON numbers; they are rounded to integers and clamped to the
listed range. Booleans must be JSON booleans; enum values are exact strings.

| Key | Default | Accepted values and effect |
|---|---|---|
| `quotas.refreshIntervalSec` | `60` | Number, 15–3600 seconds; ordinary endpoint freshness, with provider floors still applied. `0` clamps to 15; it does not disable polling. |
| `quotas.refreshOnRequest` | `true` | Boolean; refresh active provider after a turn, subject to freshness/floors. |
| `quotas.providers` | `[]` | Array of strings or comma/whitespace-separated string; provider ids or aliases. Empty means all quota sources. Unknown and quota-less names are ignored; a nonempty list with no recognized quota source enables none. Sources retain registry order, not list order. |
| `quotas.linePlacement` | `"below-editor-first"` | `"above-editor"`, `"below-editor-first"`, `"below-editor-last"`, `"off"`. Hiding the line does not disable refresh. |
| `quotas.percentDisplay` | `"used"` | `"used"` or `"remaining"`; affects broad line metrics and panel percentages. Explicit named used/remaining tokens keep their meaning; bars/colors remain based on used allowance. |
| `quotas.compactWidthCols` | `100` | Number, 40–220 columns; short identities below this width. Panel adjustment step: 5. |
| `quotas.alwaysShortIds` | `false` | Boolean; short line identities at every width. |
| `quotas.creditHealthyUsd` | `50` | Number, 5–500; balance at or above this is healthy. Panel step: 5. |
| `quotas.creditCriticalUsd` | `5` | Number, 0–100; balance at or below this is critical. |
| `quotas.lineTemplate` | Seven-provider template | Nonblank string, preserved verbatim; [default and grammar](quotas.md#template-reference). |
| `claude.replacePatterns` | `[]` | Array of literal text rules: nonblank `match`, optional string `replacement`. With a replacement, rewrite matching system-prompt text; without one, drop paragraphs containing the match. These are not regular expressions. One malformed rule rejects the field. |
| `synthetic.webSearch` | `false` | Boolean; offer `synthetic_web_search` at session start. Requires a Synthetic credential. `--synthetic-web-search` also enables it for one run. |

Credit thresholds are display thresholds only, without currency conversion. There is
no separate narrow line template. For interactive save/edit keys see
[commands](commands.md#settings-keys).

## Storage

| Location | Purpose |
|---|---|
| `<agentDir>/auth.json` | Pi's credentials, shared with `/login` and `/logout` |
| `<agentDir>/models.json` | Pi's model/provider overrides |
| `<agentDir>/models-store.json` | Pi's persisted dynamic catalogs; no separate catalog cache |
| `<agentDir>/quotas-codex-auth.json` | Codex quota credential written by `/quota codex login` (shared with pi-quotas); read when no Pi `openai-codex` login exists |
| `<agentDir>/cache/auth-plus/quotas.json` | Host-shared quota snapshots, headers, drainage, leases and backoff |
| `$XDG_STATE_HOME/pi-auth-plus/migrations.json` | Completed one-time carry-overs; default `~/.local/state/pi-auth-plus/migrations.json` |
| `$XDG_DATA_HOME/pi-auth-plus/` | Data directory; default `~/.local/share/pi-auth-plus/` |
| System temporary directory | Synthetic web-search full-page text files, returned by the tool |

Private cache directories use mode 0700 and cache files mode 0600. Web-search page files
use 0600. Never put credentials into `auth-plus.json`; it is a behavior settings file.

[Migration](getting-started.md#migrating) reads old `quotas.json` settings and
`cache/quotas-cache.json` history once, without rewriting legacy files.

## Environment variables

These are the variables read by this package, including its registered credential
configuration. Pi's built-in providers may support additional credential variables;
those remain Pi's settings.

| Variable | Effect |
|---|---|
| `PI_CODING_AGENT_DIR` | Agent directory override, including credentials, user settings and quota cache |
| `HOME`, `USERPROFILE` | Home resolution, in that order |
| `XDG_STATE_HOME` | State base directory, default `~/.local/state` |
| `XDG_DATA_HOME` | Data base directory, default `~/.local/share` |
| `ANTHROPIC_API_KEY` | API-key access for `claude`; subscription quota requires OAuth instead |
| `ANTHROPIC_CLAUDE_CODE_VERSION` | Overrides the Claude Code version reported by subscription requests; otherwise the newer of the bundled version and installed `claude --version` is used |
| `ANTHROPIC_BASE_URL` | Custom Claude subscription transport origin; only HTTP(S) without embedded credentials is accepted. Replaces origin, not request paths. |
| `ANTHROPIC_INSECURE` | `1` or `true` skips TLS verification only with an explicit custom `ANTHROPIC_BASE_URL`; requires Bun/Pi-Bolt. Avoid this; trust the endpoint's certificate instead. |
| `SYNTHETIC_API_KEY` | Synthetic API key |
| `OPENCODE_API_KEY` | OpenCode key; takes precedence over anonymous free-tier fallback |
| `NO_COLOR` | Any presence disables quota CLI color |
| `FORCE_COLOR` | Only `0` is handled: disables quota CLI color; other values do not force non-TTY color |

`SYNTHETIC_WEB_SEARCH` is not read. Use `synthetic.webSearch` or the CLI flag.
`XDG_CACHE_HOME` does not relocate the quota cache: it stays beneath the agent directory.
