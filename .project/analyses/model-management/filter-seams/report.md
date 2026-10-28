---
version: 1
id: "model-management-filter-seams"
title: "Pi 1.4 model visibility seams"
description: "Offline experiments on model visibility, provider composition, virtual models, trust, resolution and cycling."
type: "analysis"
created: "2026-10-28T10:44:48+01:00"
updated: "2026-10-28T10:48:07+01:00"
createdBy: "analyst"
updatedBy: "analyst"
document:
  type: "analysis"
  id: "model-management-filter-seams"
  title: "Pi 1.4 model visibility seams"
  description: "Offline experiments on model visibility, provider composition, virtual models, trust, resolution and cycling."
  status: "published"
  revision: 1
  created_at: "2026-10-28T10:44:48+01:00"
  updated_at: "2026-10-28T10:48:07+01:00"
  created_by: "analyst"
  updated_by: "analyst"
  changelog:
    - revision: 1
      reason: "probe results"
      changes: ["Live and isolated probe evidence for M4 model management"]
---

# Pi 1.4 model visibility seams

status: "root-caused"
confidence: "high"

## Summary

Pi 1.4.0 has no extension-level visibility hook that covers all required surfaces and provider sources.
The named `registerProvider(id, config)` overload silently ignores untyped `filterModels` and
`filterAllModels` properties. The native `registerProvider(provider)` overload can filter physical
availability, but replaces the provider, bypasses virtual entries, does not protect CLI resolution or
saved defaults, and conflicts with other extensions. Request a central, trust-aware model-visibility
predicate before implementing full product behavior. The probe's ordered rules implement only `*`
and leading `!`, enough to verify ordering; they are not a full gitignore implementation.

## Reproduction and environment

- Run `python3 .project/analyses/model-management/filter-seams/run.py > .project/analyses/model-management/filter-seams/raw-output-final.txt 2>&1`, then `python3 .project/analyses/model-management/filter-seams/verify.py`.
- Observed: `pi-bolt 1.4.0 (Pi-Bolt 1.0.7, linux-x64, JIT off)`, Bun 1.4.3, tmux 3.8. Every one of 33 CLI/RPC process invocations exited 0; 25/25 captured-behavior assertions passed. Each scenario ran once, not a flakiness-rate study. Two TUI sessions were driven in a 100-by-30 tmux PTY.
- The runner uses a fresh temporary HOME, `PI_CODING_AGENT_DIR`, cwd, XDG config/cache/data/state and TMPDIR; subprocess environment is an explicit allowlist, with dummy credentials only. It passes `--offline --no-extensions -e`, uses a read-only root and a writable scratch mount, masks the real user home with a tmpfs, and creates a separate Linux network namespace using `bwrap --unshare-net`. The recorded probe confirms the real Pi state path is hidden and `/proc/net/route` contains only the header, no routes. No LLM request, real credential, live network call, or repository `.pi/` file was used.
- The runner's temporary project has a scratch `.pi/settings.json` to exercise project trust; it was removed with the sandbox. Both tmux servers were killed. Latest temp root `/tmp/pi-filter-probe-l4osudhh` and its socket were confirmed absent.
- The complete commands, environment, inputs, stdout, stderr, exit status and PTY screens are embedded verbatim below. The fixture files are embedded and also present beside this report. The captured model IDs and metadata come from the installed binary and are test labels only, not verified claims about a provider's current service.

## Results

1. **Built-in named registration: no.** OpenAI, Anthropic and OpenRouter baseline and named-config probes all listed the selected model, and none called the supplied callback. `ProviderConfig` declares no such fields. A native wrapped OpenAI provider did remove its target from `--list-models` and the real `/model` selector, but `--model openai/<target>` still selected it without a model warning. That workaround replaces the native provider object, not merely its policy; in particular a freshly constructed built-in lacks Pi's runtime remote/personalized catalog wrapper.
2. **models.json and extension providers: named config no.** `fixture/hide` and `ephemeral/hide` remained visible. A replacement native provider shell under the models.json id did filter physical availability after the JSON overlay. That shell replaced provider behavior and is not a generic preservation of an arbitrary provider's auth, stream or refresh behavior. Rules `fixture/*`, `!fixture/keep`, `!fixture/third` left `keep` and `third` in the list and selector, and Ctrl+P switched from `keep` to `third`.
3. **Virtual models: no provider-level filter.** Both `fixture/virtual-hide` and `openai/virtual-hide` appeared although the filters excluded them. Virtual-only entries also appeared. The native callbacks received only physical model IDs; the all-types call returned the virtual entry as well. `unregisterVirtualModel` removes a known earlier queued virtual registration, but the reverse extension order leaves it visible. The registering extension can of course omit its own registration; it cannot generically prevent unknown or later registrations.
4. **Factory config: yes; trust: not through the factory API.** Synchronous `readFileSync` read the isolated agent-dir rule file before provider registration in every run, including `--list-models`. In the factory `typeof pi.isProjectTrusted` was `undefined` and `pi.getSettings()` threw `Extension runtime not initialized. Action methods cannot be called during extension loading.` Later `ctx.isProjectTrusted()` returned true with `--approve` and false with `--no-approve`. Global/CLI extension factories can run in the pre-trust pass before the decision, and are reused afterwards. Reading a trust file alone is not equivalent to Pi's effective trust decision, which can include overrides, defaults, events and prompting. The repo's current config architecture loads user/project layers at `session_start`; moving that load earlier is a separate product change.
5. **Hidden selection and defaults.** For native availability filtering, a saved `fixture/hide` was still selected with no model warning, and `--model fixture/hide` likewise selected it; the same occurred for the OpenAI target. RPC `set_model` rejected that ID and cycling used only visible entries. In a separate catalog-removal control, the saved default silently fell back to `fixture/extension-only`; explicit `--model fixture/hide` synthesized and selected the removed ID with `Warning: Model "hide" not found for provider "fixture". Using custom model id.`
6. **Composition: no automatic filter composition.** Native A then B showed A's hidden ID and hid B's; B then A did the reverse. Two named registrations merge defined properties, but that does not make unsupported filter properties active. At startup Pi drains all named registrations before all native registrations, regardless of extension CLI order: a native replacement discarded the named extension's `extension-only` model in both orders. After binding, the opposite overload also clears the existing native registration.

`filterAllModels` alone is insufficient for chat selection: the all-types query excluded the target,
but `getAvailable()` and `--list-models` retained it. If a native workaround is attempted for a
limited product scope, both existing provider policies need explicit preservation and composition.

## Root cause and evidence

The following installed 1.4.0 source paths are abbreviated as `D` =
`/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-coding-agent@1.4.0@@@1/dist` and `A` =
`/home/furbyhaxx/.bun/install/cache/@earendil-works/pi-ai@1.4.0@@@1/dist`.

- `D/core/extensions/types.d.ts:1358-1359,1414-1518`: the native-provider overload accepts a full `Provider`; named `ProviderConfig` has no visibility field. `D/core/provider-composer.js:425-430` forwards filter functions only from the base provider, never the named extension config.
- `A/models.js:310-334` calls `filterModels` for chat availability and `filterAllModels` for all-type availability. `D/core/virtual-models.js:95-120` peels virtual entries off before applying provider filters, then unconditionally appends them. `D/core/model-runtime.js:144-160` composes virtuals around the resulting provider.
- `D/core/model-resolver.js:308-315,368-373,383-402` resolves `--model` from unfiltered `getModels()`, permits a synthesized custom ID on a miss, and reads saved defaults through unfiltered `getModel()`. The selector `D/modes/interactive/components/model-selector.js:103-107` and cycling `D/core/agent-session.js:2081-2085` use the filtered availability snapshot, explaining the divergence.
- `D/core/model-runtime.js:635-640,665-679` makes native/named registrations mutually exclusive, whereas same-kind named configs merge defined keys. `D/core/agent-session-services.js:72-111` drains named, native and virtual queues in separate passes. `D/core/model-runtime.js:90-96` adds remote and OpenRouter personalized catalog wrappers around built-ins; a newly constructed provider used as the native replacement is not that runtime wrapper.
- `D/core/extensions/loader.js:115-144` initializes action methods as unavailable; `D/core/extensions/types.d.ts:238,1186,1518` puts `isProjectTrusted()` on the later context, not the factory argument. `D/core/resource-loader.js:349-365,549-555` performs the pre-trust load and reuses preloaded extensions.

Ruled out: a misspelled named-config hook, lack of credentials, missing `models.json` overlay, missing
factory file access, or a TUI-only rendering issue. Hypotheses were tested differentially against
baseline, native-provider, models.json, extension-provider, CLI/RPC and real TUI probes.

## Recommended smallest upstream seam

Add a composable **global** extension registration, available in a factory and evaluated only after
project trust has been resolved:

```ts
interface ExtensionAPI {
  registerModelVisibilityFilter(
    predicate: (
      identity: { provider: string; id: string },
      context: { cwd: string; projectTrusted: boolean },
    ) => boolean,
  ): () => void;
}
```

`false` hides an identity; `true` keeps it eligible. Compose independent extensions by intersection,
while a single extension evaluates its own ordered rules with last-match-wins. Evaluate the predicates
on the complete composed catalog, including extension/native providers, all model types and virtual
models, after every relevant registration or refresh. Preserve authentication and provider-specific
availability policies; visibility should not require prior authentication, so first-use `--api-key`
still works. Use the same policy for listing, picker, scope/cycling, user-requested model resolution, RPC and saved
or resumed selection, without removing internal provider models that virtual routers or helpers may need. For a hidden explicit `provider/id`, reject with a visibility error before fuzzy
matching or custom-ID fallback; a missing or hidden saved default should produce a clear warning and
choose a visible fallback, or report that no eligible model exists. Apply the predicate to a synthesized
custom ID too. This prevents the catalog-removal fallback observed above from reopening a hidden ID.

The callback's final trust context lets the extension read trusted project configuration without
guessing from a trust file or relying on `session_start`; `cwd` must follow the actual session cwd.
Avoid changing provider registrations, auth, streams, dynamic catalogs or virtual model ownership.

Regression test: exercise ordered hide/reinclude rules across built-in, models.json, extension-native
and extension-named providers, plus virtual-only and mixed providers; assert CLI listing, exact and
unknown/synthesized `--model`, `/model`, cycling, RPC, saved default, scoped and restored sessions,
catalog refresh and extension load order. Cover `--api-key`, trusted/untrusted project config and
the absence of visible choices.

## Open questions and limitations

- Decide the precise glob semantics for nested slash-containing model IDs; the fixture tests only
  the stated ordered hide/reinclude behavior, not full gitignore syntax.
- The built-in native replacement probe imports `@earendil-works/pi-ai/providers/all`, which the installed loader aliases but the repo's `AGENTS.md:119-120` does not list among permitted imports. It was not checked with the Pi-Bolt AOT compiler.
- Dynamic late re-registration, real authenticated network catalog refresh, restoring a session,
  non-chat selection surfaces and all built-in providers were not live-tested. The common source
  paths support the stated inference but do not substitute for those future regression tests.
- The user-required flat YAML frontmatter conflicts with the repository's `AGENTS.md` requirement for
  nested `document:` metadata; the higher-priority requested flat schema is used. The models-dev
  skill asks for live model-data lookups, but the no-network requirement takes precedence; concrete
  IDs in the capture are observations of the installed catalog only.
- No source, repository `.pi/`, credential store, git index, commit or upstream issue was changed.
  No process was left running. BLOCKERS: none.

## Verification output

```text
$ python3 .project/analyses/model-management/filter-seams/verify.py
PASS all CLI commands exit zero
PASS builtin baseline visible
PASS named builtin hook ignored
PASS anthropic builtin named hook ignored
PASS openrouter builtin named hook ignored
PASS named models.json hook ignored
PASS named extension hook ignored
PASS native builtin filters listing
PASS filterAllModels alone does not filter chat listing
PASS ordered native rules hide and restore
PASS native virtual rules are bypassed
PASS all-types hook also bypasses virtual
PASS unregister virtual ordering matters
PASS RPC set denies filtered, cycle excludes it
PASS hidden saved default still selected
PASS hidden custom --model still selected
PASS hidden builtin --model still selected
PASS removed default falls back
PASS removed explicit ID reconstructed
PASS factory cannot read context
PASS trust differs in session
PASS native last writer wins
PASS native loses named provider settings in either order
PASS TUI selector and Ctrl+P
PASS builtin TUI omits exact target
25/25 assertions passed
```


## Probe fixtures

### probe.ts

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const builtins = builtinProviders();
const builtin = builtins.find((provider) => provider.id === "openai");
if (!builtin) throw new Error("openai builtin is missing");
const builtinTarget = builtin.getModels()[0].id;
const extraTargets = Object.fromEntries(["anthropic", "openrouter"].map((id) => [id, builtins.find((provider) => provider.id === id).getModels()[0].id]));

function matchRules(model, rules) {
  let visible = true;
  for (const entry of rules) {
    const include = entry.startsWith("!");
    const pattern = include ? entry.slice(1) : entry;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    if (new RegExp(`^${escaped}$`).test(`${model.provider}/${model.id}`)) visible = include;
  }
  return visible;
}

function filter(rules, label) {
  let logged = false;
  return (models) => {
    if (!logged) {
      console.error(`${label} received=${models.map((model) => model.id).join(",")}`);
      logged = true;
    }
    return models.filter((model) => matchRules(model, rules));
  };
}

export function registerFixtureNative(pi, rules, label) {
  const native = {
    id: "fixture",
    name: "Fixture native shell",
    auth: { apiKey: {
      name: "Fixture key",
      check: async () => ({ type: "api_key", source: "fixture" }),
      resolve: async () => ({ auth: { apiKey: "dummy" }, source: "fixture" }),
    } },
    getModels: () => [],
    getAllModels: () => [],
    stream: () => { throw new Error("No requests in this probe"); },
    streamSimple: () => { throw new Error("No requests in this probe"); },
    filterModels: filter(rules, `${label}-chat`),
    filterAllModels: filter(rules, `${label}-all`),
  };
  pi.registerProvider(native);
}

export default function (pi) {
  const action = process.env.PROBE_ACTION ?? "discover";
  const config = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "filter-probe.json"), "utf8"));
  console.error(`FACTORY action=${action} builtin-target=${builtinTarget} rules=${JSON.stringify(config.rules)}`);
  console.error(`FACTORY extra-targets=${JSON.stringify(extraTargets)}`);
  console.error(`FACTORY typeof-isProjectTrusted=${typeof pi.isProjectTrusted}`);
  try {
    pi.getSettings();
    console.error("FACTORY getSettings=available");
  } catch (error) {
    console.error(`FACTORY getSettings=${error.message}`);
  }
  if (action === "named") {
    pi.registerProvider("openai", { filterModels: filter([`openai/${builtinTarget}`], "NAMED-openai-chat"), filterAllModels: filter([`openai/${builtinTarget}`], "NAMED-openai-all") });
    pi.registerProvider("fixture", { filterModels: filter(config.rules, "NAMED-fixture-chat"), filterAllModels: filter(config.rules, "NAMED-fixture-all") });
    for (const [provider, target] of Object.entries(extraTargets)) {
      pi.registerProvider(provider, { filterModels: filter([`${provider}/${target}`], `NAMED-${provider}-chat`) });
    }
    pi.registerProvider("ephemeral", { filterModels: filter(["ephemeral/hide"], "NAMED-ephemeral-chat") });
  }
  if (action === "native-builtin" || action === "native-builtin-virtual") {
    const oldChat = builtin.filterModels;
    const oldAll = builtin.filterAllModels;
    const nativeRules = [`openai/${builtinTarget}`, "openai/virtual-hide"];
    const chat = filter(nativeRules, "NATIVE-openai-chat");
    const all = filter(nativeRules, "NATIVE-openai-all");
    pi.registerProvider({
      ...builtin,
      filterModels: (models, credential) => chat(oldChat?.(models, credential) ?? models),
      filterAllModels: (models, credential) => all(oldAll?.(models, credential) ?? models),
    });
  }
  if (action === "native-all-only") {
    const oldAll = builtin.filterAllModels;
    const all = filter([`openai/${builtinTarget}`], "NATIVE-openai-all-only");
    pi.registerProvider({ ...builtin, filterAllModels: (models, credential) => all(oldAll?.(models, credential) ?? models) });
  }
  if (action === "native-custom" || action === "native-custom-virtual") {
    registerFixtureNative(pi, config.rules, "NATIVE-fixture");
  }
  if (action === "native-custom-virtual" || action === "native-builtin-virtual") {
    const provider = action === "native-custom-virtual" ? "fixture" : "openai";
    pi.registerVirtualModel({ provider, id: "virtual-hide", name: "Virtual hide", route: () => { throw new Error("No requests in this probe"); } });
    pi.registerVirtualModel({ provider: "virtual-only", id: "virtual-hide", name: "Virtual-only hide", route: () => { throw new Error("No requests in this probe"); } });
  }
  pi.on("session_start", async (_event, ctx) => {
    const selected = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
    const all = ctx.modelRegistry.getAll().filter((model) => model.provider === "fixture").map((model) => model.id).join(",");
    const available = ctx.modelRegistry.getAvailable().filter((model) => model.provider === "fixture").map((model) => model.id).join(",");
    const allTypes = (await ctx.modelRegistry.getAvailableOfType("chat", "fixture")).map((model) => model.id).join(",");
    console.error(`SESSION trusted=${ctx.isProjectTrusted()} selected=${selected} fixture-all=${all} fixture-available=${available} fixture-alltypes=${allTypes}`);
    if (action === "native-all-only") {
      const availableTarget = ctx.modelRegistry.getAvailable().some((model) => model.provider === "openai" && model.id === builtinTarget);
      const allTypesTarget = (await ctx.modelRegistry.getAvailableOfType("chat", "openai")).some((model) => model.id === builtinTarget);
      console.error(`SESSION all-only available-target=${availableTarget} alltypes-target=${allTypesTarget}`);
    }
  });
}
```

### ext-provider.ts

```typescript
export default function (pi) {
  const model = (id) => ({ id, name: id, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 });
  pi.registerProvider("ephemeral", { baseUrl: "https://fixture.invalid/v1", api: "openai-completions", apiKey: "$PROBE_KEY", models: [model("hide"), model("keep")] });
}
```

### ext-a.ts

```typescript
import { registerFixtureNative } from "./probe.ts";
export default function (pi) { registerFixtureNative(pi, ["fixture/hide"], "EXT-A"); }
```

### ext-b.ts

```typescript
import { registerFixtureNative } from "./probe.ts";
export default function (pi) { registerFixtureNative(pi, ["fixture/keep"], "EXT-B"); }
```

### ext-override.ts

```typescript
export default function (pi) {
  const model = (id) => ({ id, name: id, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 });
  pi.registerProvider("fixture", { baseUrl: "https://fixture.invalid/v1", api: "openai-completions", apiKey: "$PROBE_KEY", models: [model("extension-only")] });
}
```

### virtual-register.ts

```typescript
export default function (pi) {
  pi.registerVirtualModel({ provider: "virtual-extra", id: "hidden", name: "Virtual hidden", route: () => { throw new Error("No requests in this probe"); } });
}
```

### virtual-remove.ts

```typescript
export default function (pi) { pi.unregisterVirtualModel("virtual-extra", "hidden"); }
```

### run.py

```python
#!/usr/bin/env python3
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
PI_INSTALL = "/home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64"
RULES = ["fixture/*", "!fixture/keep", "!fixture/third"]

def model(mid):
    return {"id": mid, "name": mid, "reasoning": False, "input": ["text"], "contextWindow": 8192, "maxTokens": 1024}

def main():
    with tempfile.TemporaryDirectory(prefix="pi-filter-probe-") as tmp_name:
        tmp = Path(tmp_name)
        for item in ("home", "agent", "config", "cache", "data", "state", "runtime", "tmp", "project", "project/.pi", "pi-install"):
            (tmp / item).mkdir(parents=True, exist_ok=True)
        agent = tmp / "agent"
        (agent / "models.json").write_text(json.dumps({"providers": {"fixture": {"baseUrl": "https://fixture.invalid/v1", "apiKey": "$PROBE_KEY", "api": "openai-completions", "models": [model("hide"), model("keep"), model("third")]}}}))
        (agent / "filter-probe.json").write_text(json.dumps({"rules": RULES}))
        (tmp / "project/.pi/settings.json").write_text(json.dumps({"defaultThinkingLevel": "high"}))
        env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp / "home"), "PI_CODING_AGENT_DIR": str(agent), "XDG_CONFIG_HOME": str(tmp / "config"), "XDG_CACHE_HOME": str(tmp / "cache"), "XDG_DATA_HOME": str(tmp / "data"), "XDG_STATE_HOME": str(tmp / "state"), "XDG_RUNTIME_DIR": str(tmp / "runtime"), "TMPDIR": str(tmp / "tmp"), "TERM": "xterm-256color", "LC_ALL": "C", "PROBE_KEY": "dummy", "PI_OFFLINE": "1", "PI_SKIP_VERSION_CHECK": "1"}
        pi = str(tmp / "pi-install/pi")
        sandbox = ["bwrap", "--unshare-net", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--bind", str(tmp), str(tmp), "--ro-bind", PI_INSTALL, str(tmp / "pi-install"), "--tmpfs", "/home/furbyhaxx", "--chdir", str(tmp / "project"), "--"]
        print(f"# Temp root: {tmp}")
        print(f"# Base environment (env -i equivalent): {shlex.join([f'{k}={v}' for k, v in env.items()])}")
        print(f"# Sandbox prefix: {shlex.join(sandbox)}")
        network_check = sandbox + ["/usr/bin/python3", "-c", "import os; print('host-pi-state-visible=' + str(os.path.exists('/home/furbyhaxx/.pi'))); print('net-namespace=' + os.readlink('/proc/self/ns/net')); print(open('/proc/net/route').read(), end='')"]
        print("$ " + shlex.join(network_check))
        print(subprocess.run(network_check, env=env, check=True, text=True, capture_output=True, timeout=5).stdout)
        print(f"# models.json: {(agent / 'models.json').read_text()}")
        print(f"# filter-probe.json: {(agent / 'filter-probe.json').read_text()}")
        print(f"# project/.pi/settings.json: {(tmp / 'project/.pi/settings.json').read_text()}")
        def settings(provider="fixture", model_id="keep"):
            data = {"defaultProvider": provider, "defaultModel": model_id, "theme": "dark"}
            (agent / "settings.json").write_text(json.dumps(data))
            print(f"# settings.json: {json.dumps(data, sort_keys=True)}")
        def cmd(label, action, args, exts=("probe.ts",), openai=False, stdin=None, extra_env=None):
            run_env = dict(env, PROBE_ACTION=action)
            if openai:
                run_env["OPENAI_API_KEY"] = "dummy"
            if extra_env:
                run_env.update(extra_env)
            command = sandbox + [pi, "--offline", "--no-extensions"]
            for ext in exts:
                command += ["-e", str(HERE / ext)]
            command += list(args)
            print(f"\n## {label}")
            print(f"$ PROBE_ACTION={shlex.quote(action)}" + (" OPENAI_API_KEY=dummy" if openai else "") + (" " + shlex.join([f'{k}={v}' for k, v in extra_env.items()]) if extra_env else "") + " " + shlex.join(command))
            if stdin is not None:
                print(f"stdin: {stdin!r}")
            result = subprocess.run(command, env=run_env, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=25)
            print(f"exit: {result.returncode}\nstdout:\n{result.stdout}stderr:\n{result.stderr}")
            return result
        settings()
        discover = cmd("discover baseline", "discover", ["--list-models", "fixture"], openai=True)
        found = re.search(r"builtin-target=([^ ]+)", discover.stderr)
        if not found:
            raise RuntimeError("Discovery failed")
        target = found.group(1)
        extra_targets = json.loads(re.search(r"extra-targets=(\{.*\})", discover.stderr).group(1))
        cmd("builtin baseline", "discover", ["--list-models", target], openai=True)
        for provider, key in [("anthropic", "ANTHROPIC_API_KEY"), ("openrouter", "OPENROUTER_API_KEY")]:
            cmd(f"{provider} baseline", "discover", ["--list-models", extra_targets[provider]], extra_env={key:"dummy"})
            cmd(f"{provider} named config", "named", ["--list-models", extra_targets[provider]], extra_env={key:"dummy"})
        cmd("named config builtin", "named", ["--list-models", target], openai=True)
        cmd("named config models.json", "named", ["--list-models", "fixture"])
        cmd("extension-registered baseline", "discover", ["--list-models", "ephemeral"], exts=("ext-provider.ts", "probe.ts"))
        cmd("named config extension-registered", "named", ["--list-models", "ephemeral"], exts=("ext-provider.ts", "probe.ts"))
        cmd("native builtin", "native-builtin", ["--list-models", target], openai=True)
        cmd("native builtin filterAllModels only", "native-all-only", ["--list-models", target], openai=True)
        cmd("native custom", "native-custom", ["--list-models", "fixture"])
        cmd("native custom virtuals", "native-custom-virtual", ["--list-models", "virtual-hide"])
        cmd("native builtin virtuals", "native-builtin-virtual", ["--list-models", "virtual-hide"], openai=True)
        cmd("virtual register then unregister", "discover", ["--list-models", "virtual-extra"], exts=("virtual-register.ts", "virtual-remove.ts"))
        cmd("virtual unregister then register", "discover", ["--list-models", "virtual-extra"], exts=("virtual-remove.ts", "virtual-register.ts"))
        rpc = "\n".join(json.dumps(x) for x in [
            {"type":"get_state", "id":"state"},
            {"type":"set_model", "provider":"fixture", "modelId":"hide", "id":"set-hidden"},
            {"type":"cycle_model", "id":"cycle-1"},
            {"type":"cycle_model", "id":"cycle-2"},
            {"type":"cycle_model", "id":"cycle-3"},
        ]) + "\n"
        cmd("native custom RPC keep default, set hidden, cycle", "native-custom", ["--no-approve", "--no-session", "--mode", "rpc"], stdin=rpc)
        state = json.dumps({"type":"get_state", "id":"state"}) + "\n"
        cmd("native custom virtual filterAllModels", "native-custom-virtual", ["--no-approve", "--no-session", "--mode", "rpc"], stdin=state)
        cmd("native builtin filterAllModels only RPC", "native-all-only", ["--no-approve", "--no-session", "--mode", "rpc"], openai=True, stdin=state)
        settings("fixture", "hide")
        cmd("native custom hidden saved default", "native-custom", ["--no-approve", "--no-session", "--mode", "rpc"], stdin=state)
        cmd("catalog removed saved default", "discover", ["--no-approve", "--no-session", "--mode", "rpc"], exts=("ext-override.ts", "probe.ts"), stdin=state)
        settings()
        cmd("catalog removed explicit --model", "discover", ["--no-approve", "--no-session", "--mode", "rpc", "--model", "fixture/hide"], exts=("ext-override.ts", "probe.ts"), stdin=state)
        cmd("native custom hidden --model", "native-custom", ["--no-approve", "--no-session", "--mode", "rpc", "--model", "fixture/hide"], stdin=state)
        cmd("native builtin hidden --model", "native-builtin", ["--no-approve", "--no-session", "--mode", "rpc", "--model", f"openai/{target}"], openai=True, stdin=state)
        cmd("trust implicit pre-trust list", "discover", ["--list-models", "fixture"])
        cmd("trust approved", "discover", ["--approve", "--no-session", "--mode", "rpc"], stdin=state)
        cmd("trust rejected", "discover", ["--no-approve", "--no-session", "--mode", "rpc"], stdin=state)
        cmd("native order A then B", "discover", ["--list-models", "fixture"], exts=("ext-a.ts", "ext-b.ts"))
        cmd("native order B then A", "discover", ["--list-models", "fixture"], exts=("ext-b.ts", "ext-a.ts"))
        cmd("named override baseline", "discover", ["--list-models", "fixture"], exts=("ext-override.ts",))
        cmd("named override then native", "discover", ["--list-models", "fixture"], exts=("ext-override.ts", "ext-a.ts"))
        cmd("native then named override", "discover", ["--list-models", "fixture"], exts=("ext-a.ts", "ext-override.ts"))
        tui_env = dict(env, PROBE_ACTION="native-custom-virtual", TMUX_TMPDIR=str(tmp / "tmp"))
        sock = str(tmp / "tmux.sock")
        pi_command = sandbox + [pi, "--offline", "--no-extensions", "-e", str(HERE / "probe.ts"), "--no-approve", "--no-session"]
        terminal_command = ["tmux", "-S", sock]
        launch = terminal_command + ["new-session", "-d", "-x", "100", "-y", "30", "exec " + shlex.join(["timeout", "20"] + pi_command)]
        def tmux(*args):
            return subprocess.run(terminal_command + list(args), env=tui_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5, check=True).stdout
        print("\n## real TUI: /model and Ctrl+P")
        print("$ PROBE_ACTION=native-custom-virtual " + shlex.join(launch))
        try:
            subprocess.run(launch, env=tui_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5, check=True)
            time.sleep(1)
            print("$ tmux send-keys -l /model; tmux send-keys Enter")
            tmux("send-keys", "-l", "/model")
            tmux("send-keys", "Enter")
            time.sleep(1)
            print("--- pane /model ---\n" + tmux("capture-pane", "-p", "-S", "-100"))
            print("$ tmux send-keys Escape; wait; tmux send-keys C-p")
            tmux("send-keys", "Escape")
            time.sleep(0.5)
            tmux("send-keys", "C-p")
            time.sleep(0.5)
            print("--- pane after cycle ---\n" + tmux("capture-pane", "-p", "-S", "-100"))
        finally:
            subprocess.run(terminal_command + ["kill-server"], env=tui_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        builtin_env = dict(env, PROBE_ACTION="native-builtin", OPENAI_API_KEY="dummy", TMUX_TMPDIR=str(tmp / "tmp"))
        builtin_command = sandbox + [pi, "--offline", "--no-extensions", "-e", str(HERE / "probe.ts"), "--no-approve", "--no-session"]
        launch_builtin = terminal_command + ["new-session", "-d", "-x", "100", "-y", "30", "exec " + shlex.join(["timeout", "20"] + builtin_command)]
        print("\n## real TUI: builtin filtered /model")
        print("$ PROBE_ACTION=native-builtin OPENAI_API_KEY=dummy " + shlex.join(launch_builtin))
        try:
            subprocess.run(launch_builtin, env=builtin_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5, check=True)
            time.sleep(1)
            print(f"$ tmux send-keys -l /model; tmux send-keys Enter; wait; tmux send-keys -l {target}")
            subprocess.run(terminal_command + ["send-keys", "-l", "/model"], env=builtin_env, check=True, timeout=5)
            subprocess.run(terminal_command + ["send-keys", "Enter"], env=builtin_env, check=True, timeout=5)
            time.sleep(1)
            subprocess.run(terminal_command + ["send-keys", "-l", target], env=builtin_env, check=True, timeout=5)
            time.sleep(0.5)
            screen = subprocess.run(terminal_command + ["capture-pane", "-p", "-S", "-100"], env=builtin_env, check=True, timeout=5, text=True, stdout=subprocess.PIPE).stdout
            print("--- pane builtin /model ---\n" + screen)
        finally:
            subprocess.run(terminal_command + ["kill-server"], env=builtin_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        print(f"# cleanup: tmux servers stopped; temporary directory {tmp} removed by TemporaryDirectory")

if __name__ == "__main__":
    main()
```

### verify.py

```python
#!/usr/bin/env python3
from pathlib import Path
import json
import re

raw = (Path(__file__).resolve().parent / "raw-output-final.txt").read_text()
parts = re.split(r"^## (.+)$", raw, flags=re.MULTILINE)
sections = dict(zip(parts[1::2], parts[2::2]))
checks = []
def check(name, result):
    checks.append((name, bool(result)))

def has_row(section, provider, model):
    return bool(re.search(rf"^{re.escape(provider)}\s+{re.escape(model)}\s+", sections[section], re.MULTILINE))

first = re.search(r"builtin-target=([^ ]+)", sections["discover baseline"]).group(1)
extra = json.loads(re.search(r"extra-targets=(\{.*\})", sections["discover baseline"]).group(1))
check("all CLI commands exit zero", len(re.findall(r"^exit: 0$", raw, re.MULTILINE)) == 33 and not re.search(r"^exit: [1-9]|Traceback", raw, re.MULTILINE))
check("builtin baseline visible", has_row("builtin baseline", "openai", first))
check("named builtin hook ignored", has_row("named config builtin", "openai", first) and "NAMED-openai-chat received" not in sections["named config builtin"])
for provider in ("anthropic", "openrouter"):
    check(f"{provider} builtin named hook ignored", has_row(f"{provider} baseline", provider, extra[provider]) and has_row(f"{provider} named config", provider, extra[provider]) and f"NAMED-{provider}-chat received" not in sections[f"{provider} named config"])
check("named models.json hook ignored", has_row("named config models.json", "fixture", "hide") and "NAMED-fixture-chat received" not in sections["named config models.json"])
check("named extension hook ignored", has_row("named config extension-registered", "ephemeral", "hide") and "NAMED-ephemeral-chat received" not in sections["named config extension-registered"])
check("native builtin filters listing", not has_row("native builtin", "openai", first) and "NATIVE-openai-chat received=" in sections["native builtin"])
check("filterAllModels alone does not filter chat listing", has_row("native builtin filterAllModels only", "openai", first) and "available-target=true alltypes-target=false" in sections["native builtin filterAllModels only RPC"])
check("ordered native rules hide and restore", not has_row("native custom", "fixture", "hide") and has_row("native custom", "fixture", "keep") and has_row("native custom", "fixture", "third"))
check("native virtual rules are bypassed", has_row("native custom virtuals", "fixture", "virtual-hide") and has_row("native builtin virtuals", "openai", "virtual-hide"))
check("all-types hook also bypasses virtual", "fixture-alltypes=keep,third,virtual-hide" in sections["native custom virtual filterAllModels"])
check("unregister virtual ordering matters", not has_row("virtual register then unregister", "virtual-extra", "hidden") and has_row("virtual unregister then register", "virtual-extra", "hidden"))
check("RPC set denies filtered, cycle excludes it", '"id":"set-hidden","type":"response","command":"set_model","success":false' in sections["native custom RPC keep default, set hidden, cycle"] and '"id":"cycle-1","type":"response","command":"cycle_model","success":true,"data":{"model":{"id":"third"' in sections["native custom RPC keep default, set hidden, cycle"])
check("hidden saved default still selected", "selected=fixture/hide" in sections["native custom hidden saved default"])
check("hidden custom --model still selected", "selected=fixture/hide" in sections["native custom hidden --model"])
check("hidden builtin --model still selected", f"selected=openai/{first}" in sections["native builtin hidden --model"])
check("removed default falls back", "selected=fixture/extension-only" in sections["catalog removed saved default"])
check("removed explicit ID reconstructed", "selected=fixture/hide" in sections["catalog removed explicit --model"] and "Using custom model id" in sections["catalog removed explicit --model"])
check("factory cannot read context", "typeof-isProjectTrusted=undefined" in sections["trust approved"] and "Extension runtime not initialized" in sections["trust approved"])
check("trust differs in session", "SESSION trusted=true" in sections["trust approved"] and "SESSION trusted=false" in sections["trust rejected"])
check("native last writer wins", has_row("native order A then B", "fixture", "hide") and not has_row("native order A then B", "fixture", "keep") and not has_row("native order B then A", "fixture", "hide") and has_row("native order B then A", "fixture", "keep"))
check("native loses named provider settings in either order", has_row("named override baseline", "fixture", "extension-only") and not has_row("named override then native", "fixture", "extension-only") and not has_row("native then named override", "fixture", "extension-only"))
tui = sections["real TUI: /model and Ctrl+P"]
check("TUI selector and Ctrl+P", "virtual-hide [fixture]" in tui and "third [fixture]" in tui and not re.search(r"^\s*hide \[fixture\]", tui, re.MULTILINE) and "Switched to third" in tui)
builtin_tui = sections["real TUI: builtin filtered /model"]
check("builtin TUI omits exact target", "[openai]" in builtin_tui and not re.search(rf"^\s*(?:→\s*)?(?:✓\s*)?{re.escape(first)}\s+\[openai\]", builtin_tui, re.MULTILINE))
failed = [name for name, passed in checks if not passed]
for name, passed in checks:
    print(("PASS " if passed else "FAIL ") + name)
print(f"{len(checks) - len(failed)}/{len(checks)} assertions passed")
if failed:
    raise SystemExit(1)
```

## Complete raw commands and outputs

```text
# Temp root: /tmp/pi-filter-probe-l4osudhh
# Base environment (env -i equivalent): PATH=/usr/bin:/bin HOME=/tmp/pi-filter-probe-l4osudhh/home PI_CODING_AGENT_DIR=/tmp/pi-filter-probe-l4osudhh/agent XDG_CONFIG_HOME=/tmp/pi-filter-probe-l4osudhh/config XDG_CACHE_HOME=/tmp/pi-filter-probe-l4osudhh/cache XDG_DATA_HOME=/tmp/pi-filter-probe-l4osudhh/data XDG_STATE_HOME=/tmp/pi-filter-probe-l4osudhh/state XDG_RUNTIME_DIR=/tmp/pi-filter-probe-l4osudhh/runtime TMPDIR=/tmp/pi-filter-probe-l4osudhh/tmp TERM=xterm-256color LC_ALL=C PROBE_KEY=dummy PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1
# Sandbox prefix: bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project --
$ bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /usr/bin/python3 -c 'import os; print('"'"'host-pi-state-visible='"'"' + str(os.path.exists('"'"'/home/furbyhaxx/.pi'"'"'))); print('"'"'net-namespace='"'"' + os.readlink('"'"'/proc/self/ns/net'"'"')); print(open('"'"'/proc/net/route'"'"').read(), end='"'"''"'"')'
host-pi-state-visible=False
net-namespace=net:[4026533024]
Iface	Destination	Gateway 	Flags	RefCnt	Use	Metric	Mask		MTU	Window	IRTT

# models.json: {"providers": {"fixture": {"baseUrl": "https://fixture.invalid/v1", "apiKey": "$PROBE_KEY", "api": "openai-completions", "models": [{"id": "hide", "name": "hide", "reasoning": false, "input": ["text"], "contextWindow": 8192, "maxTokens": 1024}, {"id": "keep", "name": "keep", "reasoning": false, "input": ["text"], "contextWindow": 8192, "maxTokens": 1024}, {"id": "third", "name": "third", "reasoning": false, "input": ["text"], "contextWindow": 8192, "maxTokens": 1024}]}}}
# filter-probe.json: {"rules": ["fixture/*", "!fixture/keep", "!fixture/third"]}
# project/.pi/settings.json: {"defaultThinkingLevel": "high"}
# settings.json: {"defaultModel": "keep", "defaultProvider": "fixture", "theme": "dark"}

## discover baseline
$ PROBE_ACTION=discover OPENAI_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models fixture
exit: 0
stdout:
provider  model  context  max-out  thinking  images
fixture   hide   8.2K     1.0K     no        no
fixture   keep   8.2K     1.0K     no        no
fixture   third  8.2K     1.0K     no        no
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## builtin baseline
$ PROBE_ACTION=discover OPENAI_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models gpt-4
exit: 0
stdout:
provider  model              context  max-out  thinking  images
openai    gpt-4              8.2K     8.2K     no        no
openai    gpt-4-turbo        128K     4.1K     no        yes
openai    gpt-4.1            1.0M     32.8K    no        yes
openai    gpt-4.1-mini       1.0M     32.8K    no        yes
openai    gpt-4.1-nano       1.0M     32.8K    no        yes
openai    gpt-4o             128K     16.4K    no        yes
openai    gpt-4o-2024-05-13  128K     4.1K     no        yes
openai    gpt-4o-2024-08-06  128K     16.4K    no        yes
openai    gpt-4o-2024-11-20  128K     16.4K    no        yes
openai    gpt-4o-mini        128K     16.4K    no        yes
openai    gpt-5.4            272K     128K     yes       yes
openai    gpt-5.4-mini       400K     128K     yes       yes
openai    gpt-5.4-nano       400K     128K     yes       yes
openai    gpt-5.4-pro        1.1M     128K     yes       yes
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## anthropic baseline
$ PROBE_ACTION=discover ANTHROPIC_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models claude-fable-5
exit: 0
stdout:
provider   model             context  max-out  thinking  images
anthropic  claude-fable-5    1M       128K     yes       yes
anthropic  claude-fable-5-1  1M       128K     yes       yes
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## anthropic named config
$ PROBE_ACTION=named ANTHROPIC_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models claude-fable-5
exit: 0
stdout:
provider   model             context  max-out  thinking  images
anthropic  claude-fable-5    1M       128K     yes       yes
anthropic  claude-fable-5-1  1M       128K     yes       yes
stderr:
FACTORY action=named builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## openrouter baseline
$ PROBE_ACTION=discover OPENROUTER_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models anthropic/claude-fable-5
exit: 0
stdout:
provider    model                             context  max-out  thinking  images
openrouter  anthropic/claude-fable-5          1M       128K     yes       yes
openrouter  anthropic/claude-fable-5:batch    1M       128K     yes       yes
openrouter  anthropic/claude-fable-5.1        1M       128K     yes       yes
openrouter  anthropic/claude-fable-5.1:batch  1M       128K     yes       yes
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## openrouter named config
$ PROBE_ACTION=named OPENROUTER_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models anthropic/claude-fable-5
exit: 0
stdout:
provider    model                             context  max-out  thinking  images
openrouter  anthropic/claude-fable-5          1M       128K     yes       yes
openrouter  anthropic/claude-fable-5:batch    1M       128K     yes       yes
openrouter  anthropic/claude-fable-5.1        1M       128K     yes       yes
openrouter  anthropic/claude-fable-5.1:batch  1M       128K     yes       yes
stderr:
FACTORY action=named builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## named config builtin
$ PROBE_ACTION=named OPENAI_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models gpt-4
exit: 0
stdout:
provider  model              context  max-out  thinking  images
openai    gpt-4              8.2K     8.2K     no        no
openai    gpt-4-turbo        128K     4.1K     no        yes
openai    gpt-4.1            1.0M     32.8K    no        yes
openai    gpt-4.1-mini       1.0M     32.8K    no        yes
openai    gpt-4.1-nano       1.0M     32.8K    no        yes
openai    gpt-4o             128K     16.4K    no        yes
openai    gpt-4o-2024-05-13  128K     4.1K     no        yes
openai    gpt-4o-2024-08-06  128K     16.4K    no        yes
openai    gpt-4o-2024-11-20  128K     16.4K    no        yes
openai    gpt-4o-mini        128K     16.4K    no        yes
openai    gpt-5.4            272K     128K     yes       yes
openai    gpt-5.4-mini       400K     128K     yes       yes
openai    gpt-5.4-nano       400K     128K     yes       yes
openai    gpt-5.4-pro        1.1M     128K     yes       yes
stderr:
FACTORY action=named builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## named config models.json
$ PROBE_ACTION=named bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models fixture
exit: 0
stdout:
provider  model  context  max-out  thinking  images
fixture   hide   8.2K     1.0K     no        no
fixture   keep   8.2K     1.0K     no        no
fixture   third  8.2K     1.0K     no        no
stderr:
FACTORY action=named builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## extension-registered baseline
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-provider.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models ephemeral
exit: 0
stdout:
provider   model  context  max-out  thinking  images
ephemeral  hide   8.2K     1.0K     no        no
ephemeral  keep   8.2K     1.0K     no        no
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## named config extension-registered
$ PROBE_ACTION=named bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-provider.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models ephemeral
exit: 0
stdout:
provider   model  context  max-out  thinking  images
ephemeral  hide   8.2K     1.0K     no        no
ephemeral  keep   8.2K     1.0K     no        no
stderr:
FACTORY action=named builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## native builtin
$ PROBE_ACTION=native-builtin OPENAI_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models gpt-4
exit: 0
stdout:
provider  model              context  max-out  thinking  images
openai    gpt-4-turbo        128K     4.1K     no        yes
openai    gpt-4.1            1.0M     32.8K    no        yes
openai    gpt-4.1-mini       1.0M     32.8K    no        yes
openai    gpt-4.1-nano       1.0M     32.8K    no        yes
openai    gpt-4o             128K     16.4K    no        yes
openai    gpt-4o-2024-05-13  128K     4.1K     no        yes
openai    gpt-4o-2024-08-06  128K     16.4K    no        yes
openai    gpt-4o-2024-11-20  128K     16.4K    no        yes
openai    gpt-4o-mini        128K     16.4K    no        yes
openai    gpt-5.4            272K     128K     yes       yes
openai    gpt-5.4-mini       400K     128K     yes       yes
openai    gpt-5.4-nano       400K     128K     yes       yes
openai    gpt-5.4-pro        1.1M     128K     yes       yes
stderr:
FACTORY action=native-builtin builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-openai-chat received=gpt-4,gpt-4-turbo,gpt-4.1,gpt-4.1-mini,gpt-4.1-nano,gpt-4o,gpt-4o-2024-05-13,gpt-4o-2024-08-06,gpt-4o-2024-11-20,gpt-4o-mini,gpt-5,gpt-5-chat-latest,gpt-5-mini,gpt-5-nano,gpt-5-pro,gpt-5.1,gpt-5.2,gpt-5.2-pro,gpt-5.3-codex,gpt-5.3-codex-spark,gpt-5.4,gpt-5.4-mini,gpt-5.4-nano,gpt-5.4-pro,gpt-5.5,gpt-5.5-pro,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-6-astra,gpt-6-luna,gpt-6-sol,gpt-6.1-sol,gpt-daybreak-blue-latest,gpt-daybreak-red-latest,gpt-realtime-2.1,o1,o1-pro,o3,o3-mini,o3-pro,o4-mini


## native builtin filterAllModels only
$ PROBE_ACTION=native-all-only OPENAI_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models gpt-4
exit: 0
stdout:
provider  model              context  max-out  thinking  images
openai    gpt-4              8.2K     8.2K     no        no
openai    gpt-4-turbo        128K     4.1K     no        yes
openai    gpt-4.1            1.0M     32.8K    no        yes
openai    gpt-4.1-mini       1.0M     32.8K    no        yes
openai    gpt-4.1-nano       1.0M     32.8K    no        yes
openai    gpt-4o             128K     16.4K    no        yes
openai    gpt-4o-2024-05-13  128K     4.1K     no        yes
openai    gpt-4o-2024-08-06  128K     16.4K    no        yes
openai    gpt-4o-2024-11-20  128K     16.4K    no        yes
openai    gpt-4o-mini        128K     16.4K    no        yes
openai    gpt-5.4            272K     128K     yes       yes
openai    gpt-5.4-mini       400K     128K     yes       yes
openai    gpt-5.4-nano       400K     128K     yes       yes
openai    gpt-5.4-pro        1.1M     128K     yes       yes
stderr:
FACTORY action=native-all-only builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## native custom
$ PROBE_ACTION=native-custom bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models fixture
exit: 0
stdout:
provider  model  context  max-out  thinking  images
fixture   keep   8.2K     1.0K     no        no
fixture   third  8.2K     1.0K     no        no
stderr:
FACTORY action=native-custom builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-fixture-chat received=hide,keep,third


## native custom virtuals
$ PROBE_ACTION=native-custom-virtual bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models virtual-hide
exit: 0
stdout:
provider      model         context  max-out  thinking  images
fixture       virtual-hide  0        0        no        yes
virtual-only  virtual-hide  0        0        no        yes
stderr:
FACTORY action=native-custom-virtual builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-fixture-chat received=hide,keep,third


## native builtin virtuals
$ PROBE_ACTION=native-builtin-virtual OPENAI_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models virtual-hide
exit: 0
stdout:
provider      model         context  max-out  thinking  images
openai        virtual-hide  0        0        no        yes
virtual-only  virtual-hide  0        0        no        yes
stderr:
FACTORY action=native-builtin-virtual builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-openai-chat received=gpt-4,gpt-4-turbo,gpt-4.1,gpt-4.1-mini,gpt-4.1-nano,gpt-4o,gpt-4o-2024-05-13,gpt-4o-2024-08-06,gpt-4o-2024-11-20,gpt-4o-mini,gpt-5,gpt-5-chat-latest,gpt-5-mini,gpt-5-nano,gpt-5-pro,gpt-5.1,gpt-5.2,gpt-5.2-pro,gpt-5.3-codex,gpt-5.3-codex-spark,gpt-5.4,gpt-5.4-mini,gpt-5.4-nano,gpt-5.4-pro,gpt-5.5,gpt-5.5-pro,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-6-astra,gpt-6-luna,gpt-6-sol,gpt-6.1-sol,gpt-daybreak-blue-latest,gpt-daybreak-red-latest,gpt-realtime-2.1,o1,o1-pro,o3,o3-mini,o3-pro,o4-mini


## virtual register then unregister
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/virtual-register.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/virtual-remove.ts --list-models virtual-extra
exit: 0
stdout:
No models matching "virtual-extra"
stderr:


## virtual unregister then register
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/virtual-remove.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/virtual-register.ts --list-models virtual-extra
exit: 0
stdout:
provider       model   context  max-out  thinking  images
virtual-extra  hidden  0        0        no        yes
stderr:


## native custom RPC keep default, set hidden, cycle
$ PROBE_ACTION=native-custom bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc
stdin: '{"type": "get_state", "id": "state"}\n{"type": "set_model", "provider": "fixture", "modelId": "hide", "id": "set-hidden"}\n{"type": "cycle_model", "id": "cycle-1"}\n{"type": "cycle_model", "id": "cycle-2"}\n{"type": "cycle_model", "id": "cycle-3"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"keep","name":"keep","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-966f-7006-b557-8f82e3044121","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
{"id":"set-hidden","type":"response","command":"set_model","success":false,"error":"Model not found: fixture/hide"}
{"id":"cycle-1","type":"response","command":"cycle_model","success":true,"data":{"model":{"id":"third","name":"third","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isScoped":false}}
{"id":"cycle-2","type":"response","command":"cycle_model","success":true,"data":{"model":{"id":"keep","name":"keep","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isScoped":false}}
{"id":"cycle-3","type":"response","command":"cycle_model","success":true,"data":{"model":{"id":"third","name":"third","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isScoped":false}}
stderr:
FACTORY action=native-custom builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-fixture-chat received=hide,keep,third
NATIVE-fixture-all received=hide,keep,third
SESSION trusted=false selected=fixture/keep fixture-all=hide,keep,third fixture-available=keep,third fixture-alltypes=keep,third


## native custom virtual filterAllModels
$ PROBE_ACTION=native-custom-virtual bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"keep","name":"keep","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-9699-77a2-824d-d88430d01095","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=native-custom-virtual builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-fixture-chat received=hide,keep,third
NATIVE-fixture-all received=hide,keep,third
SESSION trusted=false selected=fixture/keep fixture-all=hide,keep,third,virtual-hide fixture-available=keep,third,virtual-hide fixture-alltypes=keep,third,virtual-hide


## native builtin filterAllModels only RPC
$ PROBE_ACTION=native-all-only OPENAI_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"keep","name":"keep","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-96c2-7012-9bab-660b1a9b6a26","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=native-all-only builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
SESSION trusted=false selected=fixture/keep fixture-all=hide,keep,third fixture-available=hide,keep,third fixture-alltypes=hide,keep,third
NATIVE-openai-all-only received=gpt-4,gpt-4-turbo,gpt-4.1,gpt-4.1-mini,gpt-4.1-nano,gpt-4o,gpt-4o-2024-05-13,gpt-4o-2024-08-06,gpt-4o-2024-11-20,gpt-4o-mini,gpt-5,gpt-5-chat-latest,gpt-5-mini,gpt-5-nano,gpt-5-pro,gpt-5.1,gpt-5.2,gpt-5.2-pro,gpt-5.3-codex,gpt-5.3-codex-spark,gpt-5.4,gpt-5.4-mini,gpt-5.4-nano,gpt-5.4-pro,gpt-5.5,gpt-5.5-pro,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-6-astra,gpt-6-luna,gpt-6-sol,gpt-6.1-sol,gpt-daybreak-blue-latest,gpt-daybreak-red-latest,gpt-realtime-2.1,o1,o1-pro,o3,o3-mini,o3-pro,o4-mini,gpt-6-luna
SESSION all-only available-target=true alltypes-target=false

# settings.json: {"defaultModel": "hide", "defaultProvider": "fixture", "theme": "dark"}

## native custom hidden saved default
$ PROBE_ACTION=native-custom bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"hide","name":"hide","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-96f2-7005-a3e3-d7162854f1bf","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=native-custom builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-fixture-chat received=hide,keep,third
NATIVE-fixture-all received=hide,keep,third
SESSION trusted=false selected=fixture/hide fixture-all=hide,keep,third fixture-available=keep,third fixture-alltypes=keep,third


## catalog removed saved default
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-override.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"extension-only","name":"extension-only","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024,"api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1"},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-971d-7718-ba91-9db1cda3a75e","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
SESSION trusted=false selected=fixture/extension-only fixture-all=extension-only fixture-available=extension-only fixture-alltypes=extension-only

# settings.json: {"defaultModel": "keep", "defaultProvider": "fixture", "theme": "dark"}

## catalog removed explicit --model
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-override.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc --model fixture/hide
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"hide","name":"hide","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024,"api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1"},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-974f-7784-af94-90e441cecf6c","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
Warning: Model "hide" not found for provider "fixture". Using custom model id.
SESSION trusted=false selected=fixture/hide fixture-all=extension-only fixture-available=extension-only fixture-alltypes=extension-only


## native custom hidden --model
$ PROBE_ACTION=native-custom bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc --model fixture/hide
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"hide","name":"hide","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-977a-76e0-8980-eef3da51e443","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=native-custom builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-fixture-chat received=hide,keep,third
NATIVE-fixture-all received=hide,keep,third
SESSION trusted=false selected=fixture/hide fixture-all=hide,keep,third fixture-available=keep,third fixture-alltypes=keep,third


## native builtin hidden --model
$ PROBE_ACTION=native-builtin OPENAI_API_KEY=dummy bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc --model openai/gpt-4
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"gpt-4","name":"GPT-4","api":"openai-responses","provider":"openai","baseUrl":"https://api.openai.com/v1","reasoning":false,"input":["text"],"cost":{"input":30,"output":60,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":8192,"compat":{"supportsStrictMode":true},"type":"chat"},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-97a8-756a-ae2b-39db077709c5","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=native-builtin builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
NATIVE-openai-chat received=gpt-4,gpt-4-turbo,gpt-4.1,gpt-4.1-mini,gpt-4.1-nano,gpt-4o,gpt-4o-2024-05-13,gpt-4o-2024-08-06,gpt-4o-2024-11-20,gpt-4o-mini,gpt-5,gpt-5-chat-latest,gpt-5-mini,gpt-5-nano,gpt-5-pro,gpt-5.1,gpt-5.2,gpt-5.2-pro,gpt-5.3-codex,gpt-5.3-codex-spark,gpt-5.4,gpt-5.4-mini,gpt-5.4-nano,gpt-5.4-pro,gpt-5.5,gpt-5.5-pro,gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-6-astra,gpt-6-luna,gpt-6-sol,gpt-6.1-sol,gpt-daybreak-blue-latest,gpt-daybreak-red-latest,gpt-realtime-2.1,o1,o1-pro,o3,o3-mini,o3-pro,o4-mini
SESSION trusted=false selected=openai/gpt-4 fixture-all=hide,keep,third fixture-available=hide,keep,third fixture-alltypes=hide,keep,third


## trust implicit pre-trust list
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --list-models fixture
exit: 0
stdout:
provider  model  context  max-out  thinking  images
fixture   hide   8.2K     1.0K     no        no
fixture   keep   8.2K     1.0K     no        no
fixture   third  8.2K     1.0K     no        no
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.


## trust approved
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --approve --no-session --mode rpc
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"keep","name":"keep","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-97fb-744d-9486-b84d990139ea","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
SESSION trusted=true selected=fixture/keep fixture-all=hide,keep,third fixture-available=hide,keep,third fixture-alltypes=hide,keep,third


## trust rejected
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session --mode rpc
stdin: '{"type": "get_state", "id": "state"}\n'
exit: 0
stdout:
{"id":"state","type":"response","command":"get_state","success":true,"data":{"model":{"id":"keep","name":"keep","api":"openai-completions","provider":"fixture","baseUrl":"https://fixture.invalid/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":8192,"maxTokens":1024},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a181e8-9823-76a9-8892-be52d9ed9fdc","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
stderr:
FACTORY action=discover builtin-target=gpt-4 rules=["fixture/*","!fixture/keep","!fixture/third"]
FACTORY extra-targets={"anthropic":"claude-fable-5","openrouter":"anthropic/claude-fable-5"}
FACTORY typeof-isProjectTrusted=undefined
FACTORY getSettings=Extension runtime not initialized. Action methods cannot be called during extension loading.
SESSION trusted=false selected=fixture/keep fixture-all=hide,keep,third fixture-available=hide,keep,third fixture-alltypes=hide,keep,third


## native order A then B
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-a.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-b.ts --list-models fixture
exit: 0
stdout:
provider  model  context  max-out  thinking  images
fixture   hide   8.2K     1.0K     no        no
fixture   third  8.2K     1.0K     no        no
stderr:
EXT-B-chat received=hide,keep,third


## native order B then A
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-b.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-a.ts --list-models fixture
exit: 0
stdout:
provider  model  context  max-out  thinking  images
fixture   keep   8.2K     1.0K     no        no
fixture   third  8.2K     1.0K     no        no
stderr:
EXT-A-chat received=hide,keep,third


## named override baseline
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-override.ts --list-models fixture
exit: 0
stdout:
provider  model           context  max-out  thinking  images
fixture   extension-only  8.2K     1.0K     no        no
stderr:


## named override then native
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-override.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-a.ts --list-models fixture
exit: 0
stdout:
provider  model  context  max-out  thinking  images
fixture   keep   8.2K     1.0K     no        no
fixture   third  8.2K     1.0K     no        no
stderr:
EXT-A-chat received=hide,keep,third


## native then named override
$ PROBE_ACTION=discover bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-a.ts -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/ext-override.ts --list-models fixture
exit: 0
stdout:
provider  model  context  max-out  thinking  images
fixture   keep   8.2K     1.0K     no        no
fixture   third  8.2K     1.0K     no        no
stderr:
EXT-A-chat received=hide,keep,third


## real TUI: /model and Ctrl+P
$ PROBE_ACTION=native-custom-virtual tmux -S /tmp/pi-filter-probe-l4osudhh/tmux.sock new-session -d -x 100 -y 30 'exec timeout 20 bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session'
$ tmux send-keys -l /model; tmux send-keys Enter
--- pane /model ---
 Pi-Bolt can explain its own features and look up its docs. Ask it how to use or extend Pi-Bolt.

[Extensions]
  probe.ts

 This project is not trusted. Project .pi resources and packages are ignored. Use /trust to save a
 trust decision, then restart pi-bolt.

 Warning: tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys
 on` to ~/.tmux.conf and restart tmux.

────────────────────────────────────────────────────────────────────────────────────────────────────

Only showing models from configured providers. Use /login to add providers.

>

→ ✓ keep [fixture] · default
    third [fixture]
    virtual-hide [fixture]
    virtual-hide [virtual-only]

  Model Name: keep

  Model catalogs refreshed.

  Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel
────────────────────────────────────────────────────────────────────────────────────────────────────
/tmp/pi-filter-probe-l4osudhh/project
0.0%/8.2k (auto)                                                                      (fixture) keep

$ tmux send-keys Escape; wait; tmux send-keys C-p
--- pane after cycle ---

 ▀▀█  v1.4.0
 █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more
 Press ctrl+o to show full startup help and loaded resources.

 Pi-Bolt can explain its own features and look up its docs. Ask it how to use or extend Pi-Bolt.

[Extensions]
  probe.ts

 This project is not trusted. Project .pi resources and packages are ignored. Use /trust to save a
 trust decision, then restart pi-bolt.

 Warning: tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys
 on` to ~/.tmux.conf and restart tmux.

 Switched to third








────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────
/tmp/pi-filter-probe-l4osudhh/project
0.0%/8.2k (auto)                                                                     (fixture) third


## real TUI: builtin filtered /model
$ PROBE_ACTION=native-builtin OPENAI_API_KEY=dummy tmux -S /tmp/pi-filter-probe-l4osudhh/tmux.sock new-session -d -x 100 -y 30 'exec timeout 20 bwrap --unshare-net --ro-bind / / --proc /proc --dev /dev --bind /tmp/pi-filter-probe-l4osudhh /tmp/pi-filter-probe-l4osudhh --ro-bind /home/furbyhaxx/.pi-bolt/pi-bolt-linux-x64 /tmp/pi-filter-probe-l4osudhh/pi-install --tmpfs /home/furbyhaxx --chdir /tmp/pi-filter-probe-l4osudhh/project -- /tmp/pi-filter-probe-l4osudhh/pi-install/pi --offline --no-extensions -e /mnt/Projects/furbyhaxx/pi-auth-plus/.project/analyses/model-management/filter-seams/probe.ts --no-approve --no-session'
$ tmux send-keys -l /model; tmux send-keys Enter; wait; tmux send-keys -l gpt-4
--- pane builtin /model ---

 Warning: tmux extended-keys is off. Modified Enter keys may not work. Add `set -g extended-keys
 on` to ~/.tmux.conf and restart tmux.

────────────────────────────────────────────────────────────────────────────────────────────────────

Only showing models from configured providers. Use /login to add providers.

> gpt-4

→   gpt-4-turbo [openai]
    gpt-4.1 [openai]
    gpt-4.1-mini [openai]
    gpt-4.1-nano [openai]
    gpt-4o [openai]
    gpt-4o-2024-05-13 [openai]
    gpt-4o-2024-08-06 [openai]
    gpt-4o-2024-11-20 [openai]
    gpt-4o-mini [openai]
    gpt-5.4 [openai]
  (1/13)

  Model Name: GPT-4 Turbo

  Model catalogs refreshed.

  Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel
────────────────────────────────────────────────────────────────────────────────────────────────────
/tmp/pi-filter-probe-l4osudhh/project
0.0%/8.2k (auto)                                                                      (fixture) keep

# cleanup: tmux servers stopped; temporary directory /tmp/pi-filter-probe-l4osudhh removed by TemporaryDirectory
```
