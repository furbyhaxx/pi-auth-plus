# AGENTS.md - pi-auth-plus

**pi-auth-plus** combines and superseeds all my other pi/pi-bolt auth packages into a single, well written and optimized package with standardized architecture, workflows, UX and UI.



## Packages pi-auth-plus absorbs

- [pi-claude-auth](https://github.com/furbyhaxx/pi-claude-auth), [Local Checkout](../pi-claude-auth)
- [pi-opencode-auth](https://github.com/furbyhaxx/pi-opencode-auth), [Local Checkout](../pi-opencode-auth)
- [pi-synthetic-auth](https://github.com/furbyhaxx/pi-synthetic-auth), [Local Checkout](../pi-synthetic-auth)
- [pi-antigravity-auth](https://github.com/furbyhaxx/pi-antigravity-auth), [Local Checkout](../pi-antigravity-auth)
- [pi-quotas](https://git.viitrium.io/furbyhaxx/pi-quotas.git), [Local Checkout](../pi-quotas)

## Features

- **Providers**:
  - `claude`: Anthropic Claude Code Subscription oAuth
  - `antigravity`: Google Antigravity Subscription oAuth
  - `opencode`: Patches pi's builtin opencode provider to spoof the opencode cli to make free models work
  - `synthetic`: Add's the synthetic provider [Synthetic API Docs](https://dev.synthetic.new/docs/api/overview)
- **Quotas**: Adds subscription quota and pay-as-you-go/API credits reporting and monitoring
  - Providers:
    - antigravity
    - deepseek
    - codex/openai
    - claude
    - anthropic
    - synthetic
    - xai
    - grok
    - openrouter
  - Pi Extension Event Bus
  - CLI Flags
  - Configurable (status) widget
  - Interactive `/quota`/`/quotas`
- **Token Counting & Estimation**: 
  Pi's builtin token "counting" is more like a really inaccurate estimation that is really unstable and unpredictable.
  Most providers have either a native token counting endpoint (e.g. anthropic, openai, google, synthetic) and others have knows tokenizers.
  We leverage these, when a subscription provider has no access to the token counting endpoint, users can authenticate additionally using an API key that is only used for token counting, most providers have it for free. When unknown or unaccessible we use at least a good generic tokenizer to "estimate" tokens, everything is better as what Pi has built in.
  We even expose it over a pi extension event bus to make it available to other extensions.
  We persists and recalculate individual message tokens for transcript entries, branches, sessions, etc. per model/model family (configurable).
  e.g. the claude models from antigravity can use the anthropic/claude tokens and we do not recalculate them for the claude or anthropic provider so we reduce and de-duplicate token counts as much as possible.
  These can then be used to improve things like: token usage, compaction and similar context management and projection actions.

---

# Conventions

- Separate id's for subscription and api key providers, examples (API Key -> Subscription):
  - `openai` -> `codex`
  - `anthropic` -> `claude`
  - `google` -> `antigravity`
  - `xai` -> `grok`
  - `synthetic` is an exception as it only uses a single `synthetic` provider as behaviour does not differs
  

---

# How we catch up with subscription clients?

We maintain a collection of analyses and reports for individual applications in:
```
.project/
└── analyses/
    ├── antigravity-cli/
    ├── claude-code-cli/
    ├── opencode-cli/
    └── synthetic-api/
```
Which updated when a new version is released.
