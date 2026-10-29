/*
---
document:
  type: "analysis"
  id: "analysis-rpc-startup-delay-post"
  title: "RPC startup delay lifecycle driver"
  description: "Record lifecycle readiness and drive isolated refresh operations."
  status: "published"
  revision: 1
  version: 1
  created: "2026-10-28T16:51:56+01:00"
  updated: "2026-10-28T17:01:32+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T16:51:56+01:00"
  updated_at: "2026-10-28T17:01:32+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Drive test refreshes and sample registry"]
---
*/
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import driver from "../retry-probe/driver.ts";
import { emit } from "../retry-probe/pre.ts";

export default function (pi: any) {
  driver(pi);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
    timers.add(timer);
  };
  pi.on("session_start", (_event: unknown, ctx: any) => {
    emit("post-session", { mode: ctx.mode, groupVisible: !!ctx.modelRegistry.find("group", "race-group") });
    (globalThis as any).__startupDelayReady?.(ctx.modelRegistry.runtime);
    const action = process.env["ACTION"];
    if (action === "early-other" || action === "early-same") later(100, () => {
      const signal = new AbortController().signal;
      const options = action === "early-other" ? { signal } : { signal, providers: ["synthetic"] };
      emit("lookalike-start", { action });
      void ctx.modelRegistry.refresh(options).then((result: any) => emit("lookalike-finish", { aborted: result.aborted }));
    });
    if (action === "later-other" || action === "later-same") later(250, () => {
      const provider = action === "later-same" ? "synthetic" : "probe-other";
      const result = pi.registerVirtualModel({ provider, id: "probe-virtual", name: "probe", route: () => { throw new Error("not routed"); } });
      emit("registration-return", { provider, returnedUndefined: result === undefined, visible: !!ctx.modelRegistry.find(provider, "probe-virtual") });
    });
    if (action === "later-provider") later(250, () => {
      const result = pi.registerProvider("scope-provider", {
        api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "isolated-dummy-key",
        models: [{ id: "probe", name: "probe", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128, maxTokens: 32 }],
      });
      emit("registration-return", { provider: "scope-provider", returnedUndefined: result === undefined, visible: !!ctx.modelRegistry.find("scope-provider", "probe") });
    });
    if (action === "later-config") later(250, () => {
      const config = { providers: { "side-provider": { api: "openai-completions", baseUrl: "https://example.invalid", apiKey: "isolated-dummy-key", models: [{ id: "side-model" }] } } };
      writeFileSync(join(process.env["PI_CODING_AGENT_DIR"]!, "models.json"), JSON.stringify(config));
      const result = pi.registerVirtualModel({ provider: "probe-other", id: "probe-virtual", name: "probe", route: () => { throw new Error("not routed"); } });
      emit("registration-return", { provider: "probe-other", returnedUndefined: result === undefined, visible: !!ctx.modelRegistry.find("probe-other", "probe-virtual") });
      later(500, () => emit("config-sample", { sideVisible: !!ctx.modelRegistry.find("side-provider", "side-model") }));
    });
    if (action === "later-error") later(250, () => {
      const model = ctx.modelRegistry.getAll().find((m: any) => m.provider === "synthetic");
      try {
        pi.registerVirtualModel({ provider: "synthetic", id: model.id, name: "conflict", route: () => { throw new Error("not routed"); } });
        emit("registration-error-check", { threw: false });
      } catch (error: any) { emit("registration-error-check", { threw: true, name: error?.name, message: error?.message }); }
    });
  });
  pi.on("session_shutdown", () => { for (const timer of timers) clearTimeout(timer); timers.clear(); });
}
