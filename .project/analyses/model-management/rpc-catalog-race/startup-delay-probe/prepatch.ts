/*
---
document:
  type: "analysis"
  id: "analysis-rpc-startup-delay-prepatch"
  title: "Unsupported prototype guard probe"
  description: "Install an isolated transparent prior patch to test guard rejection."
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
      changes: ["Test prior private prototype patch guard"]
---
*/
import { emit } from "../retry-probe/pre.ts";
export default async function () {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const prototype: any = ModelRuntime.prototype;
  const original = prototype.refresh;
  prototype.refresh = function unexpectedRefresh(...args: any[]) { return original.apply(this, args); };
  emit("prior-patch-installed");
}
