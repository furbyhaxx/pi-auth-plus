---
version: 1
id: "model-management-verbosity-live-probe"
title: "OpenAI subscription response verbosity in Pi"
description: "Live verification of low, medium, and high text verbosity through Pi's provider request hook"
type: "analysis"
created: "2026-10-28T10:41:45+01:00"
updated: "2026-10-28T10:42:35+01:00"
createdBy: "pi"
updatedBy: "pi"
document:
  type: "analysis"
  id: "model-management-verbosity-live-probe"
  title: "OpenAI subscription response verbosity in Pi"
  description: "Live verification of low, medium, and high text verbosity through Pi's provider request hook"
  status: "published"
  revision: 1
  created_at: "2026-10-28T10:41:45+01:00"
  updated_at: "2026-10-28T10:42:35+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "probe results"
      changes: ["Live and isolated probe evidence for M4 model management"]
---

# OpenAI subscription response verbosity in Pi

status: "qa-complete"
confidence: "high"

## Summary

- Pi-Bolt 1.4.0 accepted an extension's direct payload replacement for `text.verbosity`.
- Both `openai` ChatGPT OAuth and `openai-codex` legacy OAuth completed 2/2 requests at each of low, medium and high. The first route returned HTTP 200; the second completed through a path that did not expose an HTTP status to the extension.
- For this single prompt, both repetitions increased in length from low to medium to high on both routes. This is a small observational sample, not a guarantee about other prompts, models, reasoning levels, accounts or temperatures.
- A separate structured-output request on each route preserved `text.format` across the hook, completed, and returned valid JSON matching the supplied one-property schema.

## Reproduction and environment

- Local time: 2026-10-28T10:41:45+01:00 (Europe/Zurich). Pi: `1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`.
- The isolated `pi-bolt --no-extensions --offline --list-models`, filtered case-insensitively for `openai|codex`, listed 42 `openai` rows and 7 `openai-codex` rows. Model `gpt-5.6-luna` appeared under both routes. Catalog listing alone does not prove account entitlement; the completed requests below do. The bundled live models.dev CLI also resolved the canonical ID on 2026-10-28.
- `openai/gpt-5.6-luna`: `openai-responses`, `https://api.openai.com/v1/responses`, OAuth from the user's `openai` slot.
- `openai-codex/gpt-5.6-luna`: `openai-codex-responses`, `https://chatgpt.com/backend-api/codex/responses`. The normal Pi `openai-codex` slot was missing; this test copied the user's pi-quotas legacy Codex credential into a scratch `openai-codex` slot. It does not show that Pi automatically reads the legacy file.
- An isolated, mode-0600 scratch `auth.json` held only these two OAuth slots, with real access tokens and their real expiries but dummy refresh fields. Refresh was therefore not performed and cannot rotate the user's tokens. The relevant tokens were unexpired at the start. `HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, and `PI_CODING_AGENT_DIR` all pointed inside the scratch directory; `OPENAI_API_KEY` was removed from the child environment. No credential values are included here.
- User and built-in extensions were disabled with `--no-extensions`; the explicitly named probe still loaded. Skills, context files, prompt templates, MCP, tools and project approval were disabled. `--offline` disabled startup network operations, not the live inference requests. `--thinking off` yielded zero reported reasoning tokens in every completed call. A fixed system prompt avoided incidental differences.
- For each route, request order was low 1, medium 1, high 1, high 2, medium 2, low 2, then one medium structured request. Routes ran concurrently, each serially. Per-process timeout: 90 s. Prompt: `Explain what a mutex is.`

The actual command template, with the scratch environment described above, was:

```sh
PROBE_VERBOSITY="$V" PROBE_STRUCTURED=0 PROBE_LOG="$scratch/$route-$V-$rep.probe.jsonl" \
pi-bolt -p --mode json --no-session --no-extensions --no-skills \
  --no-prompt-templates --no-context-files --no-mcp --no-themes \
  --no-approve --offline --no-tools --thinking off \
  --system-prompt 'You are a helpful assistant.' \
  -e "$scratch/probe.ts" --model "$route/gpt-5.6-luna" \
  'Explain what a mutex is.'
```

Structured checks used the same command with `V=medium PROBE_STRUCTURED=1`. Responses were captured as JSONL, with the authoritative assistant `message_end` used for text and usage. The probe logged only model/provider/API, event keys, `text`, HTTP status and completion, never credentials or headers.

## Test matrix

Counts are Unicode code points / whitespace-separated words / Pi's provider-reported output tokens, including Markdown syntax in the text counts. Both repetitions are shown separately; all 12 plain-text responses completed with stop reason `stop` and `response.completed`. No HTTP error or error body was observed.

| Route | Verbosity | Repetition 1 | Repetition 2 | Exposed HTTP status 1 / 2 | Completed |
|---|---|---:|---:|---|---:|
| `openai` | low | 459 / 68 / 103 | 431 / 66 / 88 | 200 / 200 | 2 / 2 |
| `openai` | medium | 818 / 123 / 178 | 753 / 119 / 169 | 200 / 200 | 2 / 2 |
| `openai` | high | 2719 / 437 / 581 | 1844 / 293 / 396 | 200 / 200 | 2 / 2 |
| `openai-codex` | low | 443 / 69 / 95 | 533 / 82 / 116 | not exposed / not exposed | 2 / 2 |
| `openai-codex` | medium | 838 / 130 / 181 | 859 / 140 / 193 | not exposed / not exposed | 2 / 2 |
| `openai-codex` | high | 1690 / 268 / 366 | 2363 / 400 / 545 | not exposed / not exposed | 2 / 2 |

Mean characters: `openai` low 445, medium 785.5, high 2,281.5; `openai-codex` low 488, medium 848.5, high 2,026.5. High/low mean character ratios are about 5.13 and 4.15, respectively. Differences include normal sampling variability, and these two observations per cell do not establish a statistical effect size.

Codex's `after_provider_response` hook did not fire, so no HTTP status is asserted for its successful calls. WebSocket transport is inferred from the successful completion, absence of the HTTP callback, and the installed Codex transport code: it tries WebSocket first and calls `onResponse` for the SSE HTTP fallback. No WebSocket handshake status was directly observed.

## Hook semantics and preservation

- `before_provider_request` receives an event with exactly `type` and `payload`; `ctx.model.provider` and `ctx.model.api` supplied the session route in these tests. Return the replacement payload object itself, not `{ payload: ... }`. `undefined` leaves the current payload unchanged. Each later handler sees the prior handler's returned value; the probe's second handler observed the override.
- The runner catches handler exceptions and reports them; design the production guard so unrelated payloads are untouched. `ctx.model` describes the session model and can differ for nested/helper requests. Neither it nor a matching model ID alone proves the actual request provider. The hook event has no headers or provider ID.
- The direct `openai-responses` requests had no `text` field before the normal probe; `openai-codex-responses` had `{"verbosity":"low"}`. The patch created or merged the object without replacing the surrounding payload.
- For the structured check, an earlier handler deliberately inserted a strict `text.format` JSON schema; the verbosity handler merged the object and a later handler observed both fields unchanged except for verbosity. Both backends produced parseable JSON with the required `explanation` string. This demonstrates that the injected schema survived the live path; it does not assert that the stock Pi CLI naturally generated a schema.
- A separate local Node assertion passed for retaining `text.format`, another arbitrary `text` property and unrelated top-level fields, overriding an existing verbosity, and initializing a missing `text` object. The arbitrary property was a synthetic-only test, not a live server acceptance claim.

Source anchors for this Pi version:

- `/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-coding-agent@1.4.0@@@1/dist/core/extensions/types.d.ts:692-710` and `runner.js:1066-1093`: event, direct return and chained transformations.
- `/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-coding-agent@1.4.0@@@1/dist/core/sdk.js:224-239`: callback wiring.
- `/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-ai@1.4.0@@@1/dist/api/openai-codex-responses.js:175-178,187-200,286,402`: payload replacement, transport and low default.
- `/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-ai@1.4.0@@@1/dist/api/openai-responses.js:144-163,261-274,309-313`: ordinary Responses payload and request path.

### Hook-order documentation discrepancy

A separate isolated Pi invocation against a dummy local endpoint logged `before_provider_headers` followed by `before_provider_request` on all four retry attempts. The installed `/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64/docs/extensions.md:94-100` and `/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-coding-agent@1.4.0@@@1/dist/core/model-runtime.js:469-489` agree. This contradicts `AGENTS.md:178-180`, which says the payload hook runs first; correct that guidance separately. The local dummy endpoint deliberately failed; its connection errors are unrelated to the live requests.

## Recommended design and caveats

- For an explicitly configured override, return `{ ...payload, text: { ...payload.text, verbosity } }` after checking that the payload is the intended Responses request. Preserve all other fields and avoid sending this shape to incompatible APIs.
- Do not rely on `samplingParams` for Codex: its own body builder sets low unless its explicit `textVerbosity` option is supplied, and the CLI extension hook successfully changes the resulting body. The ordinary Responses builder does apply sampling parameters.
- Preserve the provider's natural behavior when the setting is unset; another extension may have already configured `text.format` or verbosity. The last payload-replacing hook wins.
- User extensions were intentionally disabled for isolation, so conflicts and handler ordering in the normal configured extension stack were not tested. Only one model, one simple prompt, off reasoning and two repetitions per level were tested.
- The brief explicitly required flat YAML frontmatter. This overrides the `AGENTS.md` development-artifact rule requiring a nested `document:` block.
- No reset credit was consumed, no key was created, and no token was revoked or refreshed. The source credential files and user `settings.json` had modification times earlier than this run; all live requests used the isolated store. Scratch files were removed after evidence capture.

## Captured hook evidence

### `openai`: ordinary medium request

```json
{"stage":"patch","eventKeys":["type","payload"],"model":"gpt-5.6-luna","provider":"openai","api":"openai-responses","beforeText":null,"afterText":{"verbosity":"medium"}}
{"stage":"chained","model":"gpt-5.6-luna","provider":"openai","api":"openai-responses","text":{"verbosity":"medium"}}
{"stage":"completed","provider":"openai","api":"openai-responses","model":"gpt-5.6-luna"}
```

### `openai`: structured medium request

```json
{"stage":"patch","eventKeys":["type","payload"],"model":"gpt-5.6-luna","provider":"openai","api":"openai-responses","beforeText":{"format":{"type":"json_schema","name":"mutex_explanation","strict":true,"schema":{"type":"object","properties":{"explanation":{"type":"string"}},"required":["explanation"],"additionalProperties":false}}},"afterText":{"format":{"type":"json_schema","name":"mutex_explanation","strict":true,"schema":{"type":"object","properties":{"explanation":{"type":"string"}},"required":["explanation"],"additionalProperties":false}},"verbosity":"medium"}}
{"stage":"chained","model":"gpt-5.6-luna","provider":"openai","api":"openai-responses","text":{"format":{"type":"json_schema","name":"mutex_explanation","strict":true,"schema":{"type":"object","properties":{"explanation":{"type":"string"}},"required":["explanation"],"additionalProperties":false}},"verbosity":"medium"}}
{"stage":"completed","provider":"openai","api":"openai-responses","model":"gpt-5.6-luna"}
```

HTTP statuses exposed: `200`; stop reason: `stop`; output tokens: 192. Parsed response has exactly one string key, `explanation`.

### `openai-codex`: ordinary medium request

```json
{"stage":"patch","eventKeys":["type","payload"],"model":"gpt-5.6-luna","provider":"openai-codex","api":"openai-codex-responses","beforeText":{"verbosity":"low"},"afterText":{"verbosity":"medium"}}
{"stage":"chained","model":"gpt-5.6-luna","provider":"openai-codex","api":"openai-codex-responses","text":{"verbosity":"medium"}}
{"stage":"completed","provider":"openai-codex","api":"openai-codex-responses","model":"gpt-5.6-luna"}
```

### `openai-codex`: structured medium request

```json
{"stage":"patch","eventKeys":["type","payload"],"model":"gpt-5.6-luna","provider":"openai-codex","api":"openai-codex-responses","beforeText":{"verbosity":"low","format":{"type":"json_schema","name":"mutex_explanation","strict":true,"schema":{"type":"object","properties":{"explanation":{"type":"string"}},"required":["explanation"],"additionalProperties":false}}},"afterText":{"verbosity":"medium","format":{"type":"json_schema","name":"mutex_explanation","strict":true,"schema":{"type":"object","properties":{"explanation":{"type":"string"}},"required":["explanation"],"additionalProperties":false}}}}
{"stage":"chained","model":"gpt-5.6-luna","provider":"openai-codex","api":"openai-codex-responses","text":{"verbosity":"medium","format":{"type":"json_schema","name":"mutex_explanation","strict":true,"schema":{"type":"object","properties":{"explanation":{"type":"string"}},"required":["explanation"],"additionalProperties":false}}}}
{"stage":"completed","provider":"openai-codex","api":"openai-codex-responses","model":"gpt-5.6-luna"}
```

HTTP statuses exposed: `none`; stop reason: `stop`; output tokens: 132. Parsed response has exactly one string key, `explanation`.

## Probe extension

This is the temporary extension used for every live call:

```ts
import { appendFileSync } from "node:fs";

const log = (entry: unknown) => appendFileSync(process.env.PROBE_LOG!, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
const schemaFormat = {
  type: "json_schema",
  name: "mutex_explanation",
  strict: true,
  schema: {
    type: "object",
    properties: { explanation: { type: "string" } },
    required: ["explanation"],
    additionalProperties: false,
  },
};

export default function (pi: any) {
  if (process.env.PROBE_STRUCTURED === "1") {
    pi.on("before_provider_request", (event: any) => ({
      ...event.payload,
      text: { ...event.payload.text, format: schemaFormat },
    }));
  }
  pi.on("before_provider_request", (event: any, ctx: any) => {
    const next = {
      ...event.payload,
      text: { ...event.payload.text, verbosity: process.env.PROBE_VERBOSITY },
    };
    log({ stage: "patch", eventKeys: Object.keys(event), model: event.payload.model, provider: ctx.model?.provider, api: ctx.model?.api, beforeText: event.payload.text ?? null, afterText: next.text });
    return next;
  });
  pi.on("before_provider_request", (event: any, ctx: any) => {
    log({ stage: "chained", model: event.payload.model, provider: ctx.model?.provider, api: ctx.model?.api, text: event.payload.text });
  });
  pi.on("after_provider_response", (event: any) => log({ stage: "http", status: event.status }));
  pi.on("provider_stream_event", (event: any) => {
    if (event.data?.type === "response.completed") log({ stage: "completed", provider: event.provider, api: event.api, model: event.model });
  });
}
```

For the local-only hook-order check, this separate extension was run with the same isolation flags and `--model order-probe/unit`; its deliberately closed local endpoint resulted in four retries, each logging headers before payload:

```ts
import { appendFileSync } from "node:fs";

export default function (pi: any) {
  const log = (name: string) => appendFileSync(process.env.ORDER_LOG!, `${name}\n`, { mode: 0o600 });
  pi.registerProvider("order-probe", {
    baseUrl: "http://127.0.0.1:9",
    apiKey: "local-test-only",
    api: "openai-responses",
    models: [{ id: "unit", name: "Unit", reasoning: false, input: ["text"], contextWindow: 4096, maxTokens: 256, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  pi.on("before_provider_headers", () => log("before_provider_headers"));
  pi.on("before_provider_request", (event: any) => {
    log("before_provider_request");
    return event.payload;
  });
}
```

## Captured assistant responses

These are the complete assistant text blocks used for the table. Structured outputs are separate from the plain-text matrix.

### openai / low / 1 / text

````text
A **mutex** (mutual exclusion) is a synchronization mechanism that ensures only one thread or process can access a shared resource at a time.

A thread **locks** the mutex before accessing the resource and **unlocks** it afterward. Other threads attempting to lock it must wait until it becomes available.

```text
lock(mutex)
  access shared data
unlock(mutex)
```

Mutexes help prevent **race conditions**, but must be used carefully to avoid **deadlocks**.
````

### openai / low / 2 / text

````text
A **mutex** (short for *mutual exclusion*) is a synchronization mechanism that ensures only one thread or process can access a shared resource at a time.

A thread **locks** the mutex before accessing the resource and **unlocks** it afterward. Other threads attempting to lock it must wait until it becomes available.

This prevents **race conditions**, such as two threads modifying the same data simultaneously and corrupting it.
````

### openai / medium / 1 / text

````text
A **mutex** (short for **mutual exclusion**) is a synchronization mechanism used in concurrent programming to ensure that only one thread or process accesses a shared resource at a time.

It works like a lock:

1. A thread **locks** the mutex before accessing shared data.
2. Other threads trying to lock it must wait.
3. The thread finishes its work and **unlocks** the mutex.
4. Another waiting thread can then acquire it.

Example:

```text
lock(mutex)
shared_counter += 1
unlock(mutex)
```

Without the mutex, two threads might modify `shared_counter` simultaneously and overwrite each other’s changes, causing a **race condition**.

A mutex should be unlocked reliably—often using a language’s automatic cleanup mechanism—to avoid **deadlocks**, where other threads wait forever for a lock that is never released.
````

### openai / medium / 2 / text

````text
A **mutex** (“mutual exclusion”) is a synchronization mechanism that ensures only **one thread or process at a time** can access a shared resource or critical section of code.

Typical usage:

1. A thread **locks** the mutex before accessing shared data.
2. Other threads trying to lock it must wait.
3. The owning thread finishes its work and **unlocks** the mutex.
4. Another waiting thread can then proceed.

Example:

```text
lock(mutex)
shared_counter += 1
unlock(mutex)
```

Without a mutex, two threads might modify the same data simultaneously, causing a **race condition** and possibly corrupting the result.

A mutex differs from a **semaphore** in that a mutex generally has an owner: the thread that locks it is responsible for unlocking it.
````

### openai / high / 1 / text

````text
A **mutex**—short for **mutual exclusion**—is a synchronization mechanism used in concurrent programming to ensure that only **one thread or process at a time** can access a shared resource or critical section of code.

### Why it is needed

If multiple threads modify shared data simultaneously, their operations can interfere with one another, causing a **race condition**. For example, suppose two threads both increment the same counter:

```text
counter = counter + 1
```

Although this looks like one operation, it typically involves:

1. Reading `counter`
2. Adding `1`
3. Writing the result back

If two threads do this at the same time, one update may overwrite the other.

A mutex prevents this by requiring a thread to **lock** the mutex before entering the critical section and **unlock** it afterward:

```text
lock(mutex)

counter = counter + 1

unlock(mutex)
```

While one thread holds the lock, another thread attempting to lock the same mutex must wait until the mutex is unlocked.

### Common properties

- **Mutual exclusion:** Only one thread can hold the mutex at a time.
- **Blocking:** Other threads generally wait if the mutex is already locked.
- **Ownership:** The thread that locks a mutex is typically responsible for unlocking it.
- **Scope:** A mutex protects whatever shared resource or code is associated with it.

### Example in pseudocode

```text
mutex m
shared_data = 0

function update():
    lock(m)
    shared_data = shared_data + 1
    unlock(m)
```

In real code, it is important to unlock the mutex even if an error or exception occurs. Many languages provide a scoped or automatic-locking construct for this purpose:

```text
lock_guard guard(mutex)
shared_data = shared_data + 1
```

The lock is then released automatically when `guard` goes out of scope.

### Mutex versus semaphore

A mutex is generally used to protect a resource so that **one owner** accesses it at a time. A semaphore is usually a counter that allows up to a specified number of threads to access a resource concurrently. A binary semaphore can resemble a mutex, but it may have different ownership and usage semantics.

### Potential problems

Incorrect mutex use can lead to:

- **Deadlock:** Two or more threads wait forever for locks held by one another.
- **Starvation:** A thread waits indefinitely because others repeatedly acquire the mutex first.
- **Contention:** Many threads spend time waiting for the same lock.
- **Forgetting to unlock:** Other threads may remain blocked indefinitely.

In short, a mutex is like a **single key to a shared room**: a thread must take the key before entering and return it when finished, ensuring that only one thread uses the protected resource at a time.
````

### openai / high / 2 / text

````text
A **mutex**—short for **mutual exclusion**—is a synchronization mechanism used in concurrent programming to ensure that only one thread or process accesses a shared resource at a time.

### Basic idea

Imagine several threads sharing a variable, file, or data structure. If two threads modify it simultaneously, their operations can interfere with each other and produce incorrect results. A mutex acts like a lock:

1. A thread **locks** the mutex before accessing the shared resource.
2. Other threads trying to lock it must wait.
3. The thread uses or modifies the resource.
4. It **unlocks** the mutex when finished.
5. One waiting thread can then acquire the lock.

### Example

```text
lock(mutex)

shared_counter = shared_counter + 1

unlock(mutex)
```

The code between `lock` and `unlock` is called the **critical section**. The mutex ensures that only one thread executes that section at a time.

### Why mutexes are needed

Without a mutex, this operation:

```text
counter = counter + 1
```

may actually involve several steps:

1. Read `counter`
2. Add 1
3. Write the result back

If two threads do this simultaneously, both might read the same old value and overwrite each other’s updates. This is a **race condition**.

### Important characteristics

- A mutex usually has **ownership**: the thread that locks it is expected to unlock it.
- If a thread tries to lock an already-locked mutex, it typically **blocks** until the mutex becomes available.
- A mutex should always be released, including when errors occur. Many languages provide automatic lock-management constructs for this reason.
- Incorrect use can cause a **deadlock**, where threads wait indefinitely for locks held by one another.

A mutex protects access to a resource; it does not make the resource inherently safe or guarantee fairness among waiting threads.
````

### openai / medium / 1 / json

````json
{"explanation":"A mutex (short for “mutual exclusion”) is a synchronization mechanism that ensures only one thread or process can access a shared resource at a time. A thread locks the mutex before entering a critical section, uses the resource, and unlocks it afterward. If another thread tries to lock an already-locked mutex, it waits until the mutex is released. This prevents race conditions, such as two threads simultaneously modifying the same data and corrupting it.\n\nExample:\n```text\nlock(mutex)\nshared_counter += 1\nunlock(mutex)\n```\n\nA mutex must be unlocked reliably—often using a language’s scoped lock or `defer` mechanism—to avoid deadlocks. Mutexes are different from read-write locks, which can allow multiple simultaneous readers, and from semaphores, which generally manage a count of available resources rather than exclusive ownership."}
````

### openai-codex / low / 1 / text

````text
A **mutex** (short for *mutual exclusion*) is a synchronization mechanism that ensures only one thread or process can access a shared resource at a time.

A thread:

1. **Locks** the mutex before accessing the resource.
2. Uses the resource.
3. **Unlocks** the mutex afterward.

Other threads attempting to lock it must wait until it becomes available. This prevents race conditions, such as two threads modifying the same data simultaneously.
````

### openai-codex / low / 2 / text

````text
A **mutex** (mutual exclusion lock) is a synchronization tool that ensures only one thread or process can access a shared resource at a time.

A thread **locks** the mutex before entering a critical section and **unlocks** it afterward. If another thread tries to lock it while it’s already locked, that thread waits until the mutex is released.

```text
lock(mutex)
  access shared data
unlock(mutex)
```

Mutexes help prevent race conditions, such as two threads modifying the same variable simultaneously and corrupting its value.
````

### openai-codex / medium / 1 / text

````text
A **mutex** (short for **mutual exclusion**) is a synchronization mechanism used in concurrent programming to ensure that only one thread or process accesses a shared resource at a time.

A typical pattern is:

1. A thread **locks** the mutex before accessing shared data.
2. It reads or modifies the data.
3. It **unlocks** the mutex afterward.
4. Other threads trying to lock it must wait until it becomes available.

Example:

```text
lock(mutex)
shared_counter += 1
unlock(mutex)
```

Without the mutex, two threads might update `shared_counter` simultaneously and overwrite each other’s changes, causing a **race condition**.

A mutex generally has ownership: the thread that locks it is expected to unlock it. It differs from a semaphore, which is usually a counter that can allow multiple threads to access a resource concurrently.
````

### openai-codex / medium / 2 / text

````text
A **mutex** (“mutual exclusion”) is a synchronization mechanism used to ensure that only one thread or process accesses a shared resource at a time.

Think of it like a key to a room:

1. A thread **locks** the mutex before entering a critical section.
2. Other threads trying to lock it must wait.
3. The thread performs its work.
4. It **unlocks** the mutex, allowing another thread to proceed.

Example:

```text
lock(mutex)
    shared_counter += 1
unlock(mutex)
```

Without the mutex, two threads might read and update `shared_counter` simultaneously, causing a **race condition** and an incorrect result.

A mutex differs from a regular lock in that it generally has **ownership**: the thread that locks it is expected to unlock it. It should be held only as long as necessary, since forgetting to unlock it can cause other threads to wait indefinitely.
````

### openai-codex / high / 1 / text

````text
A **mutex**—short for **mutual exclusion**—is a synchronization mechanism used in concurrent programming to ensure that only **one thread or process at a time** can access a shared resource or critical section of code.

### Basic idea

A mutex has two main operations:

1. **Lock**: A thread acquires the mutex before accessing shared data.
2. **Unlock**: The thread releases the mutex after it is finished.

If another thread tries to acquire the mutex while it is already locked, that thread typically waits until the mutex becomes available.

```text
lock(mutex)

    // Only one thread can execute this section at a time
    shared_counter = shared_counter + 1

unlock(mutex)
```

### Why mutexes are needed

Without a mutex, two threads might read and modify the same data simultaneously, causing a **race condition**. For example, if two threads both increment a counter:

1. Both read the value `0`.
2. Both calculate `1`.
3. Both write back `1`.

The expected result, `2`, is lost. A mutex prevents this by ensuring the increment happens atomically with respect to other threads.

### Important properties

- A mutex is generally **exclusive**: only its owner may unlock it.
- It protects a **critical section**, not necessarily an entire program.
- The lock should be released even if an error occurs; many languages provide automatic techniques such as RAII or `defer` for this.
- Holding a mutex too long can reduce performance.
- Acquiring multiple mutexes in inconsistent orders can cause a **deadlock**, where threads wait for one another indefinitely.

A mutex is therefore a tool for making access to shared, mutable resources safe in multithreaded or multiprocess programs.
````

### openai-codex / high / 2 / text

````text
A **mutex**—short for **mutual exclusion**—is a synchronization mechanism used in concurrent programming to ensure that only **one thread or process at a time** can access a shared resource or critical section of code.

### Why mutexes are needed

When multiple threads access shared data simultaneously, their operations can interfere with one another. For example, suppose two threads both increment a shared counter:

```text
counter = counter + 1
```

Although this looks like one operation, it usually involves:

1. Reading `counter`
2. Adding `1`
3. Writing the result back

If two threads do this at the same time, they might both read the same old value and overwrite each other’s updates. This is called a **race condition**.

### How a mutex works

A mutex has two fundamental operations:

- **Lock**: A thread acquires the mutex before entering the critical section.
- **Unlock**: The thread releases the mutex after leaving the critical section.

Only one thread can hold the mutex at a time. Other threads attempting to acquire it must wait until it is released.

Pseudocode:

```text
lock(mutex)

counter = counter + 1

unlock(mutex)
```

A safer pattern ensures the mutex is released even if an error occurs:

```text
with mutex:
    counter = counter + 1
```

### Example

Without a mutex:

```text
Thread A: reads counter = 0
Thread B: reads counter = 0
Thread A: writes counter = 1
Thread B: writes counter = 1
```

The expected result is `2`, but the actual result is `1`.

With a mutex:

```text
Thread A: locks mutex
Thread A: reads and updates counter to 1
Thread A: unlocks mutex

Thread B: locks mutex
Thread B: reads and updates counter to 2
Thread B: unlocks mutex
```

### Important considerations

- A mutex protects a **critical section**, not necessarily an entire program.
- Code should hold a mutex for as short a time as practical.
- Failing to unlock a mutex can cause other threads to wait forever; this is called a **deadlock** or, more specifically, a lock leak.
- Acquiring multiple mutexes in inconsistent orders can also cause deadlocks.
- A mutex is generally intended for mutual exclusion, whereas a **semaphore** can allow a limited number of threads to access a resource simultaneously.

In short, a mutex is like a key to a room: a thread must obtain the key before entering, and it must return the key when it leaves.
````

### openai-codex / medium / 1 / json

````json
{"explanation":"A mutex (short for “mutual exclusion”) is a synchronization mechanism that ensures only one thread or process can access a shared resource at a time. A thread locks the mutex before entering a critical section, uses the resource, and then unlocks it. If another thread tries to lock an already-locked mutex, it must wait until the mutex is released. This prevents race conditions, such as two threads modifying the same data simultaneously and corrupting it. A mutex should always be unlocked reliably—typically using a construct such as a `lock` statement or RAII—to avoid deadlocks."}
````

## Open questions / follow-ups

- Test normal extension coexistence, helper-model calls and concurrent requests before selecting a provider-matching strategy.
- Test other models, reasoning settings and prompts if a broader behavioral guarantee or recommended default is needed.
- Correct the hook-order statement in `AGENTS.md:178-180`.
- BLOCKERS: none.
