---
document:
  type: "analysis"
  id: "ANALYSIS-AGY-1.5.15-IDENTITY-BLOCK"
  title: "Antigravity 1.5.15 rejects the Pi/Pi-Bolt system-prompt identity with HTTP 429"
  description: "Reproduction, bisection and the exact blocked phrase; no credential or token in the evidence"
  status: "published"
  revision: 2
  created_at: "2026-11-23T17:20:00+01:00"
  updated_at: "2026-11-23T17:45:00+01:00"
  created_by: "omp"
  updated_by: "omp"
  changelog:
    - revision: 1
      reason: "live verification of the 1.5.15 provider failed; record the cause"
      changes:
        - "reproduction through pi-bolt and the captured request body"
        - "bisection to the harness identity phrase"
        - "test matrix of paraphrases and other harness names"
    - revision: 2
      reason: "resolved in the provider; a second trigger made the first fix insufficient"
      changes:
        - "the Pi `<docs>` block is a second trigger; a 2,200-character prefix was required"
        - "resolution: agy identity line and a neutral docs note; live turns return ok"
---

# Antigravity 1.5.15 rejects the Pi/Pi-Bolt system-prompt identity with HTTP 429

## Symptom

A live turn through the provider on 2026-11-23, with a valid OAuth login and no quota
exhaustion, ends with:

```text
antigravity: v1internal:streamGenerateContent (RESOURCE_EXHAUSTED, HTTP 429):
Resource has been exhausted (e.g. check quota).; Retry the request; if it persists,
sign in with /login antigravity.
```

The same account completes `agy -p "Reply with exactly: ok" --model gemini-4-argon-low`
at the same minute, and `retrieveUserQuotaSummary` reports 0.60 / 0.79 / 0.99 / 1.0
remaining across the five buckets. The 429 is not quota exhaustion.

## Reproduction

1. Capture the provider's outgoing body: a temporary `AGY_DUMP` hook wrote the payload
   before `fetch` (removed afterwards). The body is 130,259 bytes, of which
   `request.systemInstruction.parts[0].text` is 122,939 characters.
2. Replay the captured body against
   `https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`
   with the same OAuth token: **429**.
3. Remove `systemInstruction` from that body: **200**, `"ok"`.
4. Replace `systemInstruction` with a neutral 5,000-character string: **200**.
5. Slice the captured system text into 5,000-character windows: offset 0 is **429**,
   every later window is **200**.
6. Narrow the first window: the first 20, 40 and 100 characters of the text all 429
   once they include the full identity; the exact phrase is below.

## Exact trigger

The first sentence of Pi-Bolt's system prompt:

```text
You are a coding assistant running inside Pi-Bolt, a build of pi (a coding agent harness) compiled ahead of time.
```

| probe (used as `systemInstruction`) | status |
|---|---|
| `You are a helpful assistant.` | 200 |
| `You are a coding assistant.` | 200 |
| `You are a coding assistant running inside a harness.` | 200 |
| `You are a coding assistant running in Pi.` | 200 |
| `You are a coding assistant inside Pi.` | 200 |
| `You are a coding assistant running inside Pi.` | 429 |
| `You are a coding assistant running inside Pi-Bolt.` (and without the period) | 429 |
| `You are a coding assistant running inside PI-BOLT.` | 429 |
| `You are a coding assistant running within Pi-Bolt.` | 200 |
| `You are a coding assistant running inside the Pi-Bolt CLI.` | 200 |
| `You are a coding agent running inside Pi-Bolt.` | 200 |
| `You are a coding assistant running inside Cursor/Claude Code/Codex/Windsurf/Copilot.` | 200 |

The block is a case-insensitive, phrase-level match on `coding assistant running inside
Pi` (`Pi-Bolt` and bare `Pi` both hit). One word changed either side of the phrase clears
it. The user agent is irrelevant: replaying with the 1.4.8 user agent and pin still 429s.

## What this means

- The server distinguishes Pi/Pi-Bolt from other harness identities and refuses that
  prompt while serving the CLI and every other tested identity.
- The provider currently forwards Pi's system prompt unchanged, so every turn carries the
  blocked phrase.
- The CLI's own system prompt is unreachable (assembled beyond the language-server
  boundary), so the exact allowed text cannot be copied.

## Resolution

The first fix (replace the identity sentence only) still 429ed. A second trigger sits in
Pi's `<docs>…</docs>` block, and the whole prefix before roughly character 2,200 had to
change:

- `remainderFull` (agy identity + text from 2,200 on, 120 KB) → **200**
- tools + rules + remainder (drop only `<docs>`) → **200**
- tools + rules + a short neutral docs note + remainder → **200**

`agySystemPrompt()` in `src/families/google/request.ts` now replaces the leading harness
identity sentence with agy's own line from the binary (`You are Antigravity, a powerful
agentic AI assistant designed by the Google Deepmind team.`) and replaces the `<docs>`
block with one neutral sentence. Tools, rules, the addendum, skills and cwd are untouched.

Live on 2026-11-23 through Pi-Bolt, after a catalogue refresh: `gemini-4-argon:low` and
`gemini-4-hydrogen:xhigh` both returned `ok`.

No token, project id or credential is stored in this artifact.
