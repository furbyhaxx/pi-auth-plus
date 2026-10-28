# Model management

Open `/auth models` to edit visibility rules, model overrides and aliases; open
`/auth groups` to configure virtual model groups. The catalog preview includes hidden
models, so they can be shown again without editing a file.

## Visibility rules

All models are listed by default. Each rule matches `provider/model-id`; a matching rule
hides the model, and a leading `!` shows it again. The **last matching rule wins**.
A leading `#` disables a rule. Rules are ordered: move the more specific exception below
the rule it overrides.

```json
{
  "models": {
    "rules": [
      "openrouter/*",
      "!openrouter/google/*",
      "synthetic/hf:example/*"
    ]
  }
}
```

`*` normally matches within one slash-separated segment; `**` crosses slashes.
A provider-wide rule such as `openrouter/*` also matches nested model IDs. Escape a
literal `*`, `!`, `#`, or backslash with `\` (twice inside JSON strings).

In the Models tab:

- `a` adds a rule, Enter edits one, Space enables/disables it, `d` deletes it, and
  Shift+Up/Down reorders it.
- `v` switches between rules and the catalog. In the catalog, `h` appends an exact
  hide/show rule for the selected model.
- Ctrl+S followed by `u`, `p`, or `r` saves rules to user, trusted project, or the
  current session. Escape discards staged changes.

User rules apply during startup, including `--list-models`; trusted-project rules apply
when the session starts. Set `models.rulesScope` to `"user"` to ignore project rules while
still allowing runtime changes. As with other list settings, a project or runtime rule list
replaces the lower-scope list; include any rules you want to keep. If an existing selection
becomes hidden when session rules
are applied, `models.hiddenDefault` controls whether to warn and keep it or select an
available fallback. A model hidden by a user rule may not resolve when explicitly named
with `--model`, because user rules apply before session startup. If another extension owns
a provider's catalog or stream, a warning identifies detected conflicts. Pi does not expose
other extensions' registrations during startup, so a built-in provider's configuration may
already have been merged before a conflict is detected. Avoid rules for providers another
extension customizes.

In RPC mode, startup catalog refresh coordination is available for verified Pi builds.
If coordination is unavailable while rules or groups are configured, pi-auth-plus warns:
Pi still uses its cached catalog, and a later model refresh can fetch an updated catalog.
The coordinator does not run in offline mode.

## Model overrides

Select a model in the catalog and press Enter. Name, context and output limits,
reasoning, input types, and token costs can be staged individually. OpenAI Responses
and Codex Responses models also offer response verbosity; `inherit` uses the global
setting. Enter edits a text or numeric field, Left/Right changes an option, and Backspace
stages removal of the selected override. Ctrl+S saves the staged changes; Escape discards
them and returns to the catalog.

Overrides are stored in Pi's **user** `<agentDir>/models.json`, not in project settings.
The editor preserves comments and unrelated settings, refuses malformed or conflicting
files, and saves all staged fields in one locked update. Another writer that ignores the
lock can still race the final filesystem replacement. Changes refresh the catalog; if a
selected model cannot be refreshed, reselect it. Adjusting displayed limits does not
change the provider's actual limits.

## Aliases

In the Models catalog, select a source model, press Enter, and use its alias controls
to add or edit an alias. Set an ID and optionally a display name, context window and
output limit. Blank optional fields inherit from the source. Ctrl+S saves to user,
trusted-project or runtime scope; `d` stages removal of an existing alias. The alias
appears under the same provider, but requests use the source model ID. Alias editing
is available for providers owned by pi-auth-plus. The source must exist and the alias ID
must not collide with another model in that provider.

Aliases are stored in `models.aliases` as a list. A higher-scope list replaces the
lower-scope list. For example:

```json
{
  "models": {
    "aliases": [
      { "provider": "antigravity", "source": "gemini-4-argon", "id": "fast" }
    ]
  }
}
```

## Model groups

Groups are virtual models named `group/<id>`. Open `/auth groups`, press `a` to add
a group or Enter to edit one, and add members as `provider/model-id` from the catalog.
In the group editor, Enter edits a field, Left/Right changes options, `d` removes a
member, and Shift+Up/Down reorders members. Ctrl+S stages the group; Ctrl+S again in
the group list saves to user, trusted-project or runtime scope. Escape discards staged
changes. As with aliases, a higher-scope `models.groups` list replaces the lower list.

Each member has a positive priority tier: routing first considers healthy members in
the lowest available tier. If none is known to be healthy, it falls back to the remaining
members. Within the chosen tier:

- `sticky` retains the previous member when available; otherwise it picks the first.
- `failover` picks the first member in group order.
- `random` picks a member randomly.
- `balance` estimates remaining requests using recent token usage, model rates and
  available USD credits when all candidates have comparable data. It estimates switched
  models without cache reuse; for the previous model, recent cache usage is only an estimate
  and does not guarantee a future cache hit. Otherwise it compares plan-wide quota headroom
  when all candidates have comparable fractions, or rotates in order. Credit fractions and
  usage window fractions are not compared with each other. Zero-cost models, model-specific
  windows and reset times can make the comparison incomplete.

Cost labels (`included`, `free`, `paid`) are informational and do not exclude a member.
Optional thinking maps translate a group thinking level for a member, for example
`low=high`; the result is clamped to the member's supported levels. The group context
window defaults to the smallest available member window; an optional cap can lower it.
It does not change the members' actual limits.

By default, groups can switch members on rate-limit, quota or authentication errors
before any output. Each trigger can be disabled in the editor. A cross-provider switch
can lose prompt-cache reuse and thinking signatures. Existing tool calls are not replayed.

```json
{
  "models": {
    "groups": [
      {
        "id": "auto",
        "strategy": "sticky",
        "members": [
          { "provider": "antigravity", "id": "gemini-4-argon", "tier": 1 },
          { "provider": "synthetic", "id": "hf:example/model", "tier": 2 }
        ]
      }
    ]
  }
}
```
