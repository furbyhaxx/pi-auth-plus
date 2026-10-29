/*
---
document:
  type: "analysis"
  id: "analysis-rpc-catalog-retry-candidate"
  title: "RPC catalog bounded retry candidate"
  description: "Instrument a real provider and experimentally retry interrupted catalogs."
  status: "published"
  revision: 2
  version: 1
  created: "2026-10-28T15:32:19+01:00"
  updated: "2026-10-28T15:45:36+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T15:32:19+01:00"
  updated_at: "2026-10-28T15:45:36+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Probe bounded retry and interruption provenance"]
    - revision: 2
      reason: "probe refinement"
      changes: ["Capture publication exceptions and completion"]
---
*/
import app from "../../../../../src/index.ts";
import { emit } from "./pre.ts";

export default async function (pi: any) {
  let registry: any;
  let stopped = false;
  let pending = false;
  let active = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let phase = 0;
  const enabled = process.env["CANDIDATE"] === "1";
  const maxAttempts = Number(process.env["MAX_ATTEMPTS"] ?? "3");
  const retryMs = Number(process.env["RETRY_TIMEOUT_MS"] ?? "15000");

  const schedule = () => {
    if (!enabled || stopped || !registry || !pending || active || timer) return;
    if (attempts >= maxAttempts) { emit("retry-exhausted", { attempts }); pending = false; return; }
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped || !pending) return;
      pending = false;
      active = true;
      const number = ++attempts;
      controller = new AbortController();
      const current = controller;
      deadline = setTimeout(() => { emit("retry-deadline", { number }); current.abort(); }, retryMs);
      emit("retry-start", { number, timeoutMs: retryMs });
      void registry.refresh({ providers: ["synthetic"], signal: current.signal }).then(
        (result: any) => emit("retry-finish", { number, aborted: result.aborted, errors: [...result.errors.keys()] }),
        (error: Error) => emit("retry-error", { number, name: error.name, message: error.message }),
      ).finally(() => {
        if (deadline) clearTimeout(deadline);
        deadline = undefined;
        controller = undefined;
        active = false;
        schedule();
      });
    }, 0);
  };
  const mark = (kind: string, number: number, details: Record<string, unknown> = {}) => {
    emit(kind, { phase: number, hasRegistry: !!registry, retryActive: active, ...details });
    if (!enabled || stopped) return;
    pending = true;
    schedule();
  };
  const wrap = (original: (ctx: any) => Promise<unknown>) => async (ctx: any) => {
    if (!ctx.allowNetwork) return original(ctx);
    const number = ++phase;
    emit("network-phase", { phase: number, hasRegistry: !!registry, retryActive: active });
    let marked = false;
    const interrupted = () => {
      if (marked) return;
      marked = true;
      mark("phase-abort", number, { reason: ctx.signal.reason?.name ?? "unknown", message: ctx.signal.reason?.message ?? "" });
    };
    if (ctx.signal.aborted) interrupted();
    else ctx.signal.addEventListener("abort", interrupted, { once: true });
    const wrapped = { ...ctx, publish: async (publication: unknown) => {
      try {
        const accepted = await ctx.publish(publication);
        emit("publish", { phase: number, accepted });
        if (!accepted && !marked) { marked = true; mark("publish-rejected", number); }
        return accepted;
      } catch (error) {
        emit("publish-error", { phase: number, name: error instanceof Error ? error.name : "unknown" });
        throw error;
      }
    } };
    try {
      const value = await original(wrapped);
      emit("phase-complete", { phase: number });
      if (process.env["ACTION"] === "publish-race") (globalThis as any).__probeNetworkDone = true;
      return value;
    } catch (error) {
      emit("phase-error", { phase: number, name: error instanceof Error ? error.name : "unknown" });
      throw error;
    } finally {
      ctx.signal.removeEventListener("abort", interrupted);
    }
  };
  const api = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerProvider") return (name: any, config?: any) => {
        if (name === "synthetic" && config?.refreshModels) {
          emit("instrument-provider");
          return target.registerProvider(name, { ...config, refreshModels: wrap(config.refreshModels) });
        }
        return target.registerProvider(name, config);
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await app(api);
  pi.on("session_start", (_event: unknown, ctx: any) => {
    stopped = false;
    registry = ctx.modelRegistry;
    emit("candidate-session", { pending, attempts });
    schedule();
  });
  pi.on("session_shutdown", () => {
    stopped = true;
    pending = false;
    if (timer) clearTimeout(timer);
    if (deadline) clearTimeout(deadline);
    controller?.abort();
    registry = undefined;
    emit("candidate-shutdown", { active, attempts });
  });
}
