/*
---
document:
  type: "analysis"
  id: "catalog-coordinator-queue-driver"
  title: "Cancellation-aware refresh queue probe"
  description: "Test caller cancellation while waiting and active, without restarting a request."
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
      changes: ["Exercise waiting and active caller aborts"]
---
*/
import driver from "../retry-probe/driver.ts";
import { emit } from "../retry-probe/pre.ts";

export default function (pi: any) {
  driver(pi);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  let active: AbortController | undefined;
  let waiting: AbortController | undefined;
  const later = (ms: number, f: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); f(); }, ms);
    timers.add(timer);
  };
  pi.on("session_start", (_event: unknown, ctx: any) => {
    if (process.env["QUEUE_CANCEL"] === "none") return;
    stopped = false;
    later(250, () => {
      active = new AbortController();
      waiting = new AbortController();
      const activeSignal = active.signal;
      const waitingSignal = process.env["QUEUE_CANCEL"] === "deadline"
        ? AbortSignal.any([waiting.signal, AbortSignal.timeout(150)]) : waiting.signal;
      if (process.env["QUEUE_CANCEL"] === "deadline") {
        waitingSignal.addEventListener("abort", () => emit("queue-wait-deadline", { reason: waitingSignal.reason?.name }), { once: true });
      }
      emit("queue-active-start");
      const operation = ctx.modelRegistry.refresh({ providers: ["synthetic"], force: true, signal: activeSignal });
      void operation.then((result: any) => emit("queue-active-finish", { aborted: result.aborted }));
      emit("queue-wait-start");
      const aborted = new Promise<void>((resolve) => {
        if (waitingSignal.aborted) resolve();
        else waitingSignal.addEventListener("abort", () => resolve(), { once: true });
      });
      void (async () => {
        await Promise.race([operation, aborted]);
        if (stopped || waitingSignal.aborted) { emit("queue-wait-aborted", { stopped }); return; }
        emit("queue-offline-start");
        const result = await ctx.modelRegistry.refresh({ allowNetwork: false, providers: ["synthetic"], signal: waitingSignal });
        emit("queue-offline-finish", { aborted: result.aborted });
      })();
      if (process.env["QUEUE_CANCEL"] !== "deadline") later(150, () => {
        if (process.env["QUEUE_CANCEL"] === "waiting") {
          emit("queue-cancel-waiting");
          waiting?.abort();
        } else {
          emit("queue-cancel-active");
          active?.abort();
        }
      });
    });
  });
  pi.on("session_shutdown", () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    active?.abort();
    waiting?.abort();
  });
}
