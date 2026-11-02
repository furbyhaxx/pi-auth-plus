---
document:
  type: "analysis"
  id: "quotas-signed-out-providers"
  title: "Signed-out providers leave the quota surfaces"
  description: "Why the quota line printed 'login' items for providers without a credential, and the rule that now omits them from the line, the Quotas tab and the summaries while /auth providers keeps the login hint."
  status: "published"
  revision: 1
  created_at: "2026-11-02T15:40:00+01:00"
  updated_at: "2026-11-02T15:40:00+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["line, tab and summary omit needs-auth providers; captures at 140/80/57/36 columns"]
---

# Signed-out providers leave the quota surfaces

After the pig host fixes (`.project/analyses/pig-host/report.md`) the line read:

```text
openrouter: 7.98$ · deepseek: 8.89$ · codex: 36% (1r) · claude: 5h/? 7d/34% · antigravity: gem/login arg/login · synthetic: 8% · xai: login
```

`antigravity` and `xai` have no credential in `~/.pig/agent/auth.json`, so their snapshots
carry `needsAuth`. Every renderer treated that as a value to print (`login`, and the literal
`gem/` `arg/` from the template around the two window tokens), which is noise in a line whose job
is usage.

## Rule

A provider whose effective snapshot reports `needsAuth` has no quota to report, so it is omitted
from:

- the quota line (`{all}`, `{in-use}`, and explicit `{provider:…}` tokens),
- the Quotas tab provider list,
- the plain-text `/quotas` summary.

It stays visible where it is the point of the surface:

- `/auth providers` lists every provider with its sign-in state and `/login` hint,
- `/quotas <provider>` and the tab opened on that provider (`/quotas <provider>`, `solo`) show
  the provider and its needs-auth hint, because the user asked for it.

`quotas.hideSignedOut` (default `true`) controls the rule; `false` restores the old `login` text.

Only a missing credential hides a provider. A signed-in provider that failed (`error`), is
stale, rate-limited or still loading keeps its row — otherwise a network failure would look like
a signed-out account.

## Implementation

The line is template-driven, so dropping the token alone would leave the literal text around it.
`renderLineTemplate` builds a per-segment `dropped` flag: a segment that references a hidden
provider is dropped whole, and `{all}`/`{in-use}` never select hidden views. Providers seen in
separate ` · ` segments are unaffected, which is what the default template does. The Quotas tab
filters its provider list in `#providers()` and keeps the solo path; the summary filters only the
unfiltered list and says `no quota provider is signed in; /auth providers lists them with a login
hint` when nothing remains.

`hideSignedOut` lives on `LineConfig` and is optional there: a direct caller that does not set it
keeps the old behaviour, and the settings catalog (`quotaLineConfig`) supplies the default.

## Evidence

Captures in `captures/` (pig 0.5.3 + Pi 1.4.0, no pi-workbench, installed from the working tree).

`line-140-show-signed-out.txt` (`quotas.hideSignedOut: false`):

```text
openrouter: 7.98$ · deepseek: 8.89$ · codex: 36% (1r) · claude: 5h/? 7d/34% · antigravity: gem/login arg/login · synthetic: 8% · xai: login
```

`line-140-hide-signed-out.txt` (default):

```text
openrouter: 7.98$ · deepseek: 8.89$ · codex: 36% (1r) · claude: 5h/? 7d/34% · synthetic: 8%
```

`line-narrow-hide-signed-out.txt` at 80/57/36 columns keeps the same five providers and wraps
inside each width. `quotas-text.txt` shows `/quotas` without the two providers and
`/quotas xai` still reporting `needs auth`.

Also verified: the Quotas tab starts at Synthetic and lists Synthetic, Claude, Codex, OpenRouter,
DeepSeek; `/auth providers` still shows `Antigravity not signed in · /login antigravity` and
`xAI not signed in · /login xai`; `just check` (1247 tests) green.
