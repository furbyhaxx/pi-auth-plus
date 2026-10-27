# pi-auth-plus

One [Pi](https://pi.dev) package for subscription and API-key providers, quota monitoring
and a shared `/auth` dashboard.

## Features

- `claude` (Pro/Max or API key), `antigravity` (Google OAuth), `synthetic`, and anonymous
  OpenCode Zen for Pi's builtin `opencode`. Login stays in Pi's `/login`.
- Quotas and credits for Claude, Antigravity, Synthetic, ChatGPT (`codex`), xAI,
  OpenRouter and DeepSeek: configurable status line, live panel and host-shared cache.
- `/auth` provider status and staged settings; `/quotas` and `/quota` open quota detail.
- ChatGPT reset credits with explicit approval, read-only quota CLI, and an extension bus.
- Optional Synthetic web search with highlights and full-page text files.

Token counting is not available in the Tokens tab.

## Install

```bash
pi install git:https://github.com/furbyhaxx/pi-auth-plus
```

Remove pi-claude-auth, pi-opencode-auth, pi-synthetic-auth, pi-antigravity-auth **and
pi-quotas** before loading it. Keeping pi-quotas loaded disables this package's session
quota engine. Anonymous OpenCode Zen requires Pi-Bolt.

## Documentation

- [Getting started and migration](docs/getting-started.md)
- [Quotas: providers, line templates, resets and CLI](docs/quotas.md)
- [Commands and keys](docs/commands.md)
- [Settings, files and environment](docs/configuration.md)
- [Event bus for extensions](docs/events.md)

## License

MIT, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
