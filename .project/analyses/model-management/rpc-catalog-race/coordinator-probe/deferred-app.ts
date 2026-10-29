/*
---
document:
  type: "analysis"
  id: "catalog-coordinator-deferred-app"
  title: "Nonblocking deferred lifecycle experiment"
  description: "Defer one extension's startup handlers until captured preexisting refreshes settle."
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
      changes: ["Explore deferred registration, session replacement, and shutdown"]
---
*/
import app from "../../../../../src/index.ts";

export default async function (pi: any) {
  const g = globalThis as any;
  let lastState: any;
  let chain = Promise.resolve();
  let counter = 0;
  const api = new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "on") return (event: string, handler: (...args: any[]) => unknown) => {
        if (event !== "session_start") return target.on(event, handler);
        const number = ++counter;
        return target.on(event, (value: any, ctx: any) => {
          const state = g.__coordState;
          if (lastState !== state) { lastState = state; chain = Promise.resolve(); }
          const tracked = [...(g.__coordOps.get(ctx.modelRegistry.runtime) ?? [])]
            .filter((item: any) => item.options.allowNetwork !== false && !!item.options.signal);
          g.__coordEmit("app-queued", { number, reason: value.reason, tracked: tracked.length });
          chain = chain.then(async () => {
            await Promise.race([Promise.allSettled(tracked.map((item: any) => item.promise)), state.stoppedPromise]);
            if (state.stopped) { g.__coordEmit("app-skipped", { number }); return; }
            g.__coordEmit("app-run", { number });
            await handler(value, ctx);
            g.__coordEmit("app-finish", { number, stopped: state.stopped });
          }).catch((error: Error) => g.__coordEmit("app-error", { number, message: error.message }));
        });
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await app(api);
}
