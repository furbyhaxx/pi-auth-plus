/*
---
document:
  type: "analysis"
  id: "analysis-rpc-startup-delay-pre"
  title: "RPC startup delay private probe"
  description: "Guard and delay one host startup refresh, instrument cancellation and scoped registration."
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
      changes: ["Instrument isolated runtime refresh and prototype startup gate"]
---
*/
import { emit } from "../retry-probe/pre.ts";

const states = new WeakMap<object, any>();
const runtimes = new WeakMap<object, number>();
const signals = new WeakMap<object, number>();
let runtimeCount = 0;
let signalCount = 0;
let seenSession = false;
const id = (map: WeakMap<object, number>, object: any, next: () => number) => {
  if (!object) return 0;
  if (!map.has(object)) map.set(object, next());
  return map.get(object);
};
const runtimeId = (object: object) => id(runtimes, object, () => ++runtimeCount);
const signalId = (object: any) => id(signals, object, () => ++signalCount);
const canceled = () => ({ aborted: true, errors: new Map() });
const state = (runtime: any) => {
  let item = states.get(runtime);
  if (item) return item;
  let ready: () => void = () => {};
  const readyPromise = new Promise<void>((resolve) => { ready = resolve; });
  item = { id: runtimeId(runtime), pending: new Set<Promise<unknown>>(), stopped: new AbortController(), ready, readyPromise, session: false, post: false, conflict: false, startup: false, scope: undefined };
  states.set(runtime, item);
  const store = runtime.models?.modelsStore;
  if (typeof store?.write === "function") {
    const write = store.write;
    store.write = async function (provider: string, ...args: any[]) {
      if (provider === "synthetic") emit("store-write-start", { runtime: item.id, stopped: item.stopped.signal.aborted, aborted: !!args[1]?.signal?.aborted });
      const ms = provider === "synthetic" ? Number(process.env["STORE_DELAY_MS"] ?? "0") : 0;
      if (ms) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        emit("store-write-resume", { runtime: item.id, stopped: item.stopped.signal.aborted, aborted: !!args[1]?.signal?.aborted });
      }
      try {
        const result = await write.call(this, provider, ...args);
        if (provider === "synthetic") emit("store-write-finish", { runtime: item.id, stopped: item.stopped.signal.aborted });
        return result;
      } catch (error: any) {
        if (provider === "synthetic") emit("store-write-error", { runtime: item.id, stopped: item.stopped.signal.aborted, name: error?.name });
        throw error;
      }
    };
  }
  return item;
};
const waitUntil = (promise: Promise<unknown>, signal: AbortSignal) => new Promise<boolean>((resolve, reject) => {
  if (signal.aborted) return resolve(false);
  const abort = () => resolve(false);
  signal.addEventListener("abort", abort, { once: true });
  promise.then(() => { signal.removeEventListener("abort", abort); resolve(true); }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
});
const delay = (ms: number, signal: AbortSignal) => new Promise<boolean>((resolve) => {
  if (signal.aborted) return resolve(false);
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(true); }, ms);
  const abort = () => { clearTimeout(timer); resolve(false); };
  signal.addEventListener("abort", abort, { once: true });
});
const startupCaller = (stack: string[]) => {
  const caller = stack[1] ?? "";
  return /at main \(file:\/\/.*\/dist\/bundle\/chunks\/chunk-MM3LKT73\.js:1222:18193\)$/.test(caller)
    || /at main2 \(\/\$bunfs\/root\/entry-x282c8b9\.js:11261:25\)$/.test(caller);
};

export default async function (pi: any) {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const prototype: any = ModelRuntime.prototype;
  const original = prototype.refresh;
  const rpcArg = process.argv.includes("--mode") && process.argv[process.argv.indexOf("--mode") + 1] === "rpc";
  const marker = Symbol.for("pi-auth-plus.analysis.startup-delay-probe.v1");
  const installed = prototype[marker];
  emit("probe-install", { name: ModelRuntime.name, refreshName: original?.name, rpcArg, reused: !!installed });
  if ((installed && original !== installed.refresh) || (!installed && (typeof original !== "function" || original.name !== "refresh")) || ["registerProvider", "registerVirtualModel"].some((method) => typeof prototype[method] !== "function")) {
    emit("guard-rejected", { reason: "unsupported or previously patched prototype" });
    return;
  }
  if (!installed) {
  for (const method of ["registerProvider", "registerVirtualModel"]) {
    const base = prototype[method];
    prototype[method] = function (...args: any[]) {
      const s = state(this);
      const previous = s.scope;
      const provider = method === "registerProvider" ? args[0] : args[0]?.provider;
      s.scope = typeof provider === "string" && provider ? { method, provider } : undefined;
      try { return base.apply(this, args); }
      finally { s.scope = previous; }
    };
  }
  prototype.refresh = function (options: any = {}) {
    const runtime = this as any;
    const s = state(runtime);
    const keys = Object.keys(options).sort();
    const signal = options.signal;
    const stack = signal ? new Error().stack?.split("\n").slice(1, 7).map((x: string) => x.trim()) ?? [] : [];
    const candidate = rpcArg && !seenSession && !s.startup && keys.length === 1 && keys[0] === "signal" && !!signal && startupCaller(stack);
    if (signal) emit("refresh-call", { runtime: s.id, keys, signal: signalId(signal), seenSession, aborted: signal.aborted, candidate, stack });
    if (candidate) s.startup = true;
    if (candidate && process.env["PROTOTYPE"] === "delay") {
      const ownerSignal = AbortSignal.any([signal, s.stopped.signal]);
      signal.addEventListener("abort", () => emit("startup-caller-abort", { runtime: s.id, signal: signalId(signal), reason: signal.reason?.name }), { once: true });
      emit("startup-held", { runtime: s.id, signal: signalId(signal), pendingOffline: s.pending.size });
      return (async () => {
        if (!await waitUntil(s.readyPromise, ownerSignal)) { emit("startup-skipped", { runtime: s.id, reason: "aborted-before-ready" }); return canceled(); }
        const ms = Number(process.env["RELEASE_DELAY_MS"] ?? "0");
        if (!await delay(ms, ownerSignal)) { emit("startup-skipped", { runtime: s.id, reason: "aborted-in-delay" }); return canceled(); }
        while (s.pending.size) {
          emit("startup-drain", { runtime: s.id, pending: s.pending.size });
          if (!await waitUntil(Promise.allSettled([...s.pending]), ownerSignal)) { emit("startup-skipped", { runtime: s.id, reason: "aborted-draining" }); return canceled(); }
        }
        if (ownerSignal.aborted || s.conflict) { emit("startup-skipped", { runtime: s.id, reason: ownerSignal.aborted ? "aborted-before-entry" : "overlap" }); return canceled(); }
        emit("startup-enter", { runtime: s.id, originalSignal: signalId(signal), forwardedSignal: signalId(ownerSignal), sameSignal: signal === ownerSignal });
        const result = await original.call(runtime, { ...options, signal: ownerSignal });
        emit("startup-finish", { runtime: s.id, aborted: result.aborted, stopped: s.stopped.signal.aborted });
        return result;
      })();
    }
    if (s.startup && !candidate && options.allowNetwork !== false) {
      s.conflict = true;
      emit("overlap-seen", { runtime: s.id, keys, signal: signalId(signal) });
    }
    const narrow = process.env["NARROW"] === "1" && s.post && s.scope && keys.length === 1 && keys[0] === "allowNetwork" && options.allowNetwork === false;
    const forwarded = narrow ? { ...options, providers: [s.scope.provider] } : options;
    if (s.scope && options.allowNetwork === false && !options.providers) emit("registration-implicit", { runtime: s.id, method: s.scope.method, provider: s.scope.provider, narrowed: !!narrow });
    const ms = s.session && !s.post && options.allowNetwork === false && !options.providers ? Number(process.env["DELAY_IMPLICIT_MS"] ?? "0") : 0;
    if (ms) emit("implicit-delay", { runtime: s.id, ms });
    const operation = ms ? new Promise((resolve) => setTimeout(resolve, ms)).then(() => original.call(runtime, forwarded)) : original.call(runtime, forwarded);
    if (signal) void operation.then((result: any) => emit("refresh-finish", { runtime: s.id, signal: signalId(signal), aborted: result.aborted }), (error: any) => emit("refresh-error", { runtime: s.id, signal: signalId(signal), name: error?.name }));
    if (options.allowNetwork === false) {
      s.pending.add(operation);
      emit("offline-start", { runtime: s.id, providers: forwarded.providers ?? "all", pending: s.pending.size, delayed: ms });
      void operation.then(() => { s.pending.delete(operation); emit("offline-finish", { runtime: s.id, pending: s.pending.size }); }, () => { s.pending.delete(operation); emit("offline-error", { runtime: s.id, pending: s.pending.size }); });
    }
    return operation;
  };
  Object.defineProperty(prototype, marker, { value: { refresh: prototype.refresh } });
  }
  (globalThis as any).__startupDelayReady = (runtime: object) => {
    const s = state(runtime);
    s.post = true;
    emit("startup-ready", { runtime: s.id, pendingOffline: s.pending.size });
    s.ready();
  };
  pi.on("session_start", (_event: any, ctx: any) => {
    seenSession = true;
    const runtime = ctx.modelRegistry.runtime;
    const s = state(runtime);
    s.session = true;
    if (!s.snapshotSpy) {
      s.snapshotSpy = true;
      for (const method of ["updateModelSnapshot", "queueAvailabilityRefresh"]) {
        const base = runtime[method];
        if (typeof base !== "function") continue;
        runtime[method] = function (...args: any[]) {
          if (s.stopped.signal.aborted) emit("post-shutdown-runtime-work", { runtime: s.id, method });
          return base.apply(this, args);
        };
      }
    }
    emit("probe-session", { runtime: s.id, mode: ctx.mode });
  });
  pi.on("session_shutdown", (event: any, ctx: any) => {
    const s = state(ctx.modelRegistry.runtime);
    s.stopped.abort();
    emit("probe-shutdown", { runtime: s.id, reason: event.reason });
  });
}
