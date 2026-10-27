# pi-auth-plus

One [Pi](https://pi.dev) package for subscription and API-key providers that behave like Pi
builtins, plus quota monitoring and accurate token counting.

> Status: providers (M1). Quotas and token counting are not in yet; see
> [the roadmap](.project/plans/roadmap.md).

## Features

- Providers: `claude` (Pro/Max or API key), `antigravity` (Google OAuth), `synthetic`, and
  anonymous OpenCode Zen for Pi's builtin `opencode`. Log in with Pi's `/login`.

Planned:

- Quotas and credits for every supported vendor, in the footer and a panel.
- Token counting from each vendor's own counting source.
- One `/auth` dashboard: provider status, quotas, tokens, settings.

## Install

```bash
pi install git:https://github.com/furbyhaxx/pi-auth-plus
```

pi-auth-plus replaces pi-claude-auth, pi-opencode-auth, pi-synthetic-auth,
pi-antigravity-auth and pi-quotas. Remove those before installing it.

## License

MIT, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
