/*
---
document:
  type: "analysis"
  id: "analysis-rpc-startup-delay-trailing"
  title: "Trailing lifecycle handler probe"
  description: "Test whether a separately loaded later asynchronous startup handler races the gate."
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
      changes: ["Exercise later session-start work"]
---
*/
import { emit } from "../retry-probe/pre.ts";
export default function (pi: any) {
  pi.on("session_start", async (_event: unknown, ctx: any) => {
    const ms = Number(process.env["TRAILING_DELAY_MS"] ?? "0");
    emit("trailing-start", { ms });
    await new Promise((resolve) => setTimeout(resolve, ms));
    const result = pi.registerVirtualModel({ provider: "trailing-probe", id: "virtual", name: "probe", route: () => { throw new Error("not routed"); } });
    emit("trailing-registered", { visible: !!ctx.modelRegistry.find("trailing-probe", "virtual"), returnedUndefined: result === undefined });
  });
}
