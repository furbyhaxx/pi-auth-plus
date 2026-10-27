# Replay matrix (2026-10-27, big-pickle, Europe/Zurich)

All requests: `POST`, model `big-pickle`, `Authorization: Bearer public` unless noted.
Bodies: `minimal` = `{"model":"big-pickle","messages":[{"role":"user","content":"Reply with exactly: pong"}],"max_tokens":16,"stream":false}`;
`cli` = the byte-exact body of `cli-2.1.2-opencode-big-pickle-200.json`; `pi` = the byte-exact body of
`pi-with-patch-identity-headers-429.json`.

Two transports appear because curl cannot reproduce the CLI verdict at all (see report):

- `direct` — curl straight to `https://opencode.ai`.
- `proxy` — curl to the local Bun logging proxy (`tools/proxy.ts`), which re-issued the request with
  Bun's `fetch` and rewrote `/probe/*` to `/inference/openai/v1/chat/completions`.
  Every request's content was identical to the direct case; only the HTTP client differed.

| # | transport | user-agent | x-opencode-client | other request headers | system prompt | body | status |
|---|---|---|---|---|---|---|---|
| 01 | direct | opencode/latest/2.1.2/cli | cli | project hash, session trio | — | minimal | 429 |
| 02 | direct | opencode/latest/2.1.2/cli | — | — | — | minimal | 429 |
| 03 | direct | opencode/latest/2.1.2/cli | cli | project hash, session trio | CLI | cli | 429 |
| 04 | direct | opencode/latest/2.1.2/cli | cli | project hash, session trio (no auth) | — | minimal | 429 |
| 05 | direct | opencode/latest/2.1.2/cli | — | — (no auth) | — | minimal | 429 |
| 06 | proxy | opencode/latest/2.1.2/cli | cli | project hash, session trio | CLI | cli | **200** |
| 07 | proxy | opencode/1.18.18 | cli | project `global`, `x-opencode-request`, session, accept json | Pi | pi | 429 |
| 08 | proxy | opencode/latest/2.1.2/cli | cli | as 07 | Pi | pi | 429 |
| 09 | proxy | opencode/latest/2.1.2/cli | cli | — | CLI | cli | 429 |
| 10 | proxy | opencode/latest/2.1.2/cli | cli | auth | CLI | cli | 429 |
| 11 | proxy | opencode/latest/2.1.2/cli | cli | project hash | CLI | cli | 429 |
| 12 | proxy | opencode/latest/2.1.2/cli | cli | session trio | CLI | cli | **200** |
| 13 | proxy | opencode/latest/2.1.2/cli | cli | `x-opencode-session-id` only | CLI | cli | 429 |
| 14 | proxy | opencode/latest/2.1.2/cli | cli | `x-session-affinity` only | CLI | cli | **200** |
| 15 | proxy | opencode/1.18.18 | cli | project `global`, `x-opencode-request`, `x-opencode-session`, `x-session-affinity` | CLI | cli | **200** |
| 16 | proxy | opencode/latest/2.1.2/cli | cli | `x-session-affinity` with Pi's session value | CLI | cli | **200** |
| 17 | proxy | — (curl) | — | `x-session-affinity` only | CLI | cli | 429 |
| 18 | proxy | opencode/latest/2.1.2/cli | cli | `X-Session-Id` only | CLI | cli | **200** |
| 19 | proxy | — (curl) | cli | `x-session-affinity` | CLI | cli | 429 |
| 20 | proxy | — (curl) | **pi** | `x-session-affinity` | CLI | cli | 429 |
| 21 | proxy | opencode/1.18.18 | cli | `x-session-affinity: not-a-session` | CLI | cli | 429 |
| 22 | proxy | opencode/1.18.18 | cli | `x-session-affinity` with Pi's value, path `/inference/v1/chat/completions` | CLI | cli | **200** |
| 23 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` + `x-stainless-*` | Pi | pi | 429 |
| 24 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi | cli | **200** |
| 25 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi minus `reasoning_effort` | pi | 429 |
| 26 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi, `max_completion_tokens` | pi | 429 |
| 27 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI system message inside Pi's body | pi | **200** |
| 28 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi, CLI tools | pi | 429 |
| 29 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | `You are an AI agent running in OpenCode.` | pi | 429 |
| 30 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | `OpenCode` | pi | 429 |
| 31 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi + `You are running in OpenCode.` | pi | 429 |
| 32 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI prompt chars 0–4325 | pi | 429 |
| 33 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI prompt chars 4325–8650 | pi | **200** |
| 34 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI prompt chars 4325–6487 | pi | 429 |
| 35 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI prompt chars 6487–8650 | pi | **200** |
| 36 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI prompt chars 6487–7568 | pi | 429 |
| 37 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI prompt chars 7568–8650 | pi | **200** |
| 38 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi + `opencode` | pi | 429 |
| 39 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | `You are an AI agent running in opencode.` | pi | 429 |
| 40 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI prompt chars 7568–8109 (skills) | pi | 429 |
| 41 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | CLI prompt chars 8109–8650 (env block) | pi | **200** |
| 42 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi + `<env>…Working directory…</env>` | pi | **200** |
| 43 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi + `Here is some useful information…` | pi | 429 |
| 44 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi + empty `<env></env>` | pi | 429 |
| 45 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi + `<env>Working directory: /tmp</env>` | pi | **200** |
| 46 | proxy | opencode/1.18.18 | cli | as 07 + `x-session-affinity` | Pi + bare `Working directory: /tmp` | pi | 429 |
| 47 | proxy | opencode/1.18.18 | cli | `x-session-affinity: ses_x` | CLI | cli | 429 |
| 48 | proxy | opencode/1.18.18 | cli | `x-session-affinity: ses_` + 26×`a` | CLI | cli | 429 |
| 49 | proxy | opencode/1.18.18 | cli | `x-session-affinity: ses_<12 hex><12 alnum>` (24 chars) | CLI | cli | 429 |
| 50 | proxy | opencode/1.18.18 | cli | `x-session-affinity: ses_<12 hex>B2ivyxwvf5Aic7` | CLI | cli | **200** |

Notes:

- 06 vs 03 is the only transport pair with identical content: 200 through the proxy, 429 direct.
- 09–50 all carry the CLI's full body except where the column says `pi`.
- 12, 14, 18 show that one affinity header plus `x-opencode-client: cli` and an `opencode/` user agent
  is enough for the header side; 13 shows `x-opencode-session-id` is not the checked one.
- 24 → 27 isolate the system message: the same headers and the same `pi` body pass only once the
  system message changes.
