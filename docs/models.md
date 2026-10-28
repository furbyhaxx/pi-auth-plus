# Model management

Open `/auth models` to edit visibility rules and model overrides. The catalog preview
includes hidden models, so they can be shown again without editing a file.

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
