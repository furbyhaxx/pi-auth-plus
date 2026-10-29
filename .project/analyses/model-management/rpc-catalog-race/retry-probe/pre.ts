/*
---
document:
  type: "analysis"
  id: "analysis-rpc-catalog-retry-transport"
  title: "RPC catalog retry probe transport"
  description: "Isolated fake transport and delayed implicit refresh instrumentation."
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
      changes: ["Create an isolated reproducible transport"]
    - revision: 2
      reason: "probe refinement"
      changes: ["Exercise persistence and composed-publication timing"]
---
*/
import { appendFileSync } from "node:fs";

export const emit = (event: string, details: Record<string, unknown> = {}) => {
  appendFileSync(process.env["RACE_TRACE"]!, `${JSON.stringify({ event, at: Date.now(), ...details })}\n`);
};

const rows = ["race-visible", "race-hidden"].map((id) => ({
  id, name: id, always_on: true, context_length: 100000, max_output_length: 4096,
  supported_features: ["tools"], pricing: { prompt: "0", completion: "0" },
}));
let fetches = 0;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.synthetic.new" || url.pathname !== "/v1/models") {
    emit("blocked-other-network", { host: url.hostname, path: url.pathname });
    return new Response("blocked by isolated probe", { status: 503 });
  }
  const number = ++fetches;
  emit("fetch-start", { number });
  if (process.env["FAIL_FIRST"] === "1" && number === 1) {
    emit("fetch-fail", { number });
    return new Response("isolated failure", { status: 503 });
  }
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return await new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      emit("fetch-resolve", { number });
      resolve(new Response(JSON.stringify({ data: rows }), { status: 200 }));
    }, Number(process.env["FETCH_DELAY_MS"] ?? "800"));
    const abort = () => {
      clearTimeout(timer);
      emit("fetch-abort", { number, reason: signal?.reason?.name ?? "unknown", message: signal?.reason?.message ?? "" });
      reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
};

export default function (pi: any) {
  pi.on("session_start", (_event: unknown, ctx: any) => {
    emit("before-session", { mode: ctx.mode });
    const runtime = ctx.modelRegistry.runtime;
    if (!runtime?.refresh) { emit("no-refresh-spy"); return; }
    if (["publish-race", "persist-race"].includes(process.env["ACTION"] ?? "") && runtime.models?.publishProviderModels) {
      const publish = runtime.models.publishProviderModels.bind(runtime.models);
      runtime.models.publishProviderModels = (provider: string, generation: number, signal: AbortSignal, publication: any) => {
        const outer = process.env["ACTION"] === "publish-race" && publication.update && (globalThis as any).__probeNetworkDone;
        const persist = process.env["ACTION"] === "persist-race" && publication.persist && !(globalThis as any).__persistDelayed;
        if (provider === "synthetic" && (outer || persist)) {
          (globalThis as any).__probeNetworkDone = false;
          (globalThis as any).__persistDelayed = true;
          const kind = outer ? "outer" : "persist";
          emit(`${kind}-publish-delayed`);
          return new Promise((resolve) => setTimeout(resolve, 400)).then(() => publish(provider, generation, signal, publication)).then(
            (accepted) => { emit(`${kind}-publish-finished`, { accepted }); return accepted; },
            (error) => { emit(`${kind}-publish-error`, { name: error.name }); throw error; },
          );
        }
        return publish(provider, generation, signal, publication);
      };
    }
    const refresh = runtime.refresh.bind(runtime);
    runtime.refresh = (options: any) => {
      emit("registry-refresh", { allowNetwork: options?.allowNetwork ?? "default", providers: options?.providers ?? "all" });
      const delay = Number(process.env["DELAY_IMPLICIT_MS"] ?? "0");
      if (delay > 0 && options?.allowNetwork === false && !options?.providers) {
        emit("delay-implicit-refresh", { delay });
        return new Promise((resolve) => setTimeout(resolve, delay)).then(() => refresh(options));
      }
      return refresh(options);
    };
  });
}
