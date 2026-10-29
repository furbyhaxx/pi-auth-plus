/*
---
document:
  type: "analysis"
  id: "catalog-coordinator-probe-pre"
  title: "Catalog coordinator early runtime observer"
  description: "Isolated early interception and lifecycle barrier experiment."
  status: "published"
  revision: 1
  version: 1
  created: "2026-10-28T16:32:57+01:00"
  updated: "2026-10-28T16:32:57+01:00"
  createdBy: "pi"
  updatedBy: "pi"
  created_at: "2026-10-28T16:32:57+01:00"
  updated_at: "2026-10-28T16:32:57+01:00"
  created_by: "pi"
  updated_by: "pi"
  changelog:
    - revision: 1
      reason: "document creation"
      changes: ["Observe in-flight runtime operations and test early tracking"]
---
*/
import { emit } from "../retry-probe/pre.ts";

const ops = new WeakMap<object, Set<any>>();
const installed = new WeakSet<object>();
const signals = new WeakMap<object, number>();
const runtimes = new WeakMap<object, number>();
let nextRuntime = 0;
const runtimeId = (runtime: object) => {
  if (!runtimes.has(runtime)) runtimes.set(runtime, ++nextRuntime);
  return runtimes.get(runtime);
};
let nextSignal = 0;
let enteredResolve: (() => void) | undefined;
const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
const id = (signal: any) => {
  if (!signal) return 0;
  if (!signals.has(signal)) signals.set(signal, ++nextSignal);
  return signals.get(signal);
};
const globalProbe = globalThis as any;
globalProbe.__coordOps = ops;
globalProbe.__coordEmit = emit;

export default async function (pi: any) {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const prototype: any = ModelRuntime.prototype;
  const original = prototype.refresh;
  emit("prototype-install", { name: ModelRuntime.name });
  prototype.refresh = function (options: any = {}) {
    const runtime = this as any;
    const models = runtime.models;
    if (!installed.has(models)) {
      installed.add(models);
      const store = models.modelsStore;
      if (typeof store?.write === "function") {
        const write = store.write;
        store.write = async function (provider: string, ...args: any[]) {
          if (provider === "synthetic") emit("store-write-start", { runtime: runtimeId(runtime), provider });
          const result = await write.call(this, provider, ...args);
          if (provider === "synthetic") emit("store-write-finish", { runtime: runtimeId(runtime), provider });
          return result;
        };
      }
      const base = models.refresh;
      models.refresh = function (actual: any = {}) {
        const isNetwork = actual.allowNetwork === true && !!actual.signal;
        if (isNetwork) emit("models-enter", { signal: id(actual.signal), controllers: models.refreshControllers?.size ?? -1 });
        const delay = isNetwork ? Number(process.env["COORD_GATE_MS"] ?? "0") : 0;
        if (!delay) return base.call(this, actual);
        emit("models-gate", { delay, signal: id(actual.signal) });
        enteredResolve?.();
        return new Promise((resolve) => setTimeout(resolve, delay)).then(() => {
          emit("models-gate-release", { signal: id(actual.signal), aborted: actual.signal?.aborted });
          return base.call(models, actual);
        });
      };
    }
    const implicitDelay = globalProbe.__coordSession && options.allowNetwork === false && !options.providers
      ? Number(process.env["COORD_DELAY_IMPLICIT_MS"] ?? "0") : 0;
    if (implicitDelay) emit("delay-implicit", { delay: implicitDelay, sameRuntime: runtime === globalProbe.__coordRuntime });
    const operation = implicitDelay
      ? new Promise((resolve) => setTimeout(resolve, implicitDelay)).then(() => original.call(runtime, options))
      : original.call(runtime, options);
    const set = ops.get(runtime) ?? new Set();
    ops.set(runtime, set);
    const item = { options, promise: operation };
    set.add(item);
    const interesting = options.allowNetwork !== false && !!options.signal;
    if (interesting) {
      emit("outer-start", { runtime: runtimeId(runtime), signal: id(options.signal), providers: options.providers ?? "all", explicitNetwork: options.allowNetwork ?? "default" });
      options.signal.addEventListener("abort", () => emit("outer-signal-abort", { signal: id(options.signal), reason: options.signal.reason?.name }), { once: true });
    }
    void operation.then(
      (result: any) => { set.delete(item); if (interesting) emit("outer-finish", { runtime: runtimeId(runtime), signal: id(options.signal), aborted: result.aborted }); },
      (error: any) => { set.delete(item); if (interesting) emit("outer-error", { signal: id(options.signal), name: error?.name }); },
    );
    return operation;
  };
  pi.on("session_start", async (_event: unknown, ctx: any) => {
    if (process.env["COORD_WAIT_GATE"] === "1") {
      await Promise.race([entered, new Promise((resolve) => setTimeout(resolve, 2000))]);
    }
    const late = Number(process.env["COORD_LATE_MS"] ?? "0");
    if (late) await new Promise((resolve) => setTimeout(resolve, late));
    globalProbe.__coordSession = true;
    let stop: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => { stop = resolve; });
    globalProbe.__coordState = { stopped: false, stop, stoppedPromise: stopped };
    const runtime = ctx.modelRegistry.runtime;
    globalProbe.__coordRuntime = runtime;
    const set = ops.get(runtime);
    const active = [...(set ?? [])].filter((item: any) => item.options.allowNetwork !== false && !!item.options.signal);
    const controllers = runtime.models?.refreshControllers;
    emit("session-snapshot", {
      samePrototype: Object.getPrototypeOf(runtime) === prototype,
      runtime: runtimeId(runtime),
      tracked: active.length,
      controllers: controllers?.size ?? -1,
      syntheticController: controllers?.has("synthetic") ?? false,
      syntheticControllerSignal: id(controllers?.get("synthetic")?.signal),
      signalIds: active.map((item: any) => id(item.options.signal)),
      promiseFields: Object.entries(runtime).filter(([, value]) => value instanceof Promise).map(([key]) => key),
      signalFields: Object.entries(runtime).filter(([, value]) => value instanceof AbortSignal).map(([key]) => key),
      keys: Object.keys(runtime).filter((key) => /refresh|pending|operation|signal/i.test(key)),
    });
    if (process.env["COORD_BARRIER"] === "1") {
      emit("barrier-start", { tracked: active.length });
      await Promise.allSettled(active.map((item: any) => item.promise));
      emit("barrier-done");
    }
  });
  pi.on("session_shutdown", (_event: any) => {
    const state = globalProbe.__coordState;
    if (state) { state.stopped = true; state.stop?.(); }
    emit("pre-shutdown", { reason: _event.reason });
  });
}
