/*
---
document:
  type: "analysis"
  id: "catalog-coordinator-registration-driver"
  title: "Synchronous virtual registration probe"
  description: "Compare immediate registration with delaying its private runtime method."
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
      changes: ["Measure synchronous registration visibility"]
---
*/
import driver from "../retry-probe/driver.ts";
import { emit } from "../retry-probe/pre.ts";

export default function (pi: any) {
  driver(pi);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sample: ReturnType<typeof setTimeout> | undefined;
  pi.on("session_start", (_event: unknown, ctx: any) => {
    const runtime = ctx.modelRegistry.runtime;
    const original = runtime.registerVirtualModel;
    if (process.env["REGISTRATION"] === "deferred") {
      runtime.registerVirtualModel = function (definition: any) {
        if (definition.provider !== "coordinator-probe") return original.call(runtime, definition);
        timer = setTimeout(() => { emit("registration-apply"); original.call(runtime, definition); }, 200);
      };
    }
    const result = pi.registerVirtualModel({
      provider: "coordinator-probe", id: "virtual", name: "probe",
      route: () => { throw new Error("routing is not exercised"); },
    });
    emit("registration-return", { returnedUndefined: result === undefined, visible: !!ctx.modelRegistry.find("coordinator-probe", "virtual") });
    sample = setTimeout(() => emit("registration-later", { visible: !!ctx.modelRegistry.find("coordinator-probe", "virtual") }), 400);
  });
  pi.on("session_shutdown", () => { if (timer) clearTimeout(timer); if (sample) clearTimeout(sample); });
}
