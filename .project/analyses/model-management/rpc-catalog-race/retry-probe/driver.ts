/*
---
document:
  type: "analysis"
  id: "analysis-rpc-catalog-retry-driver"
  title: "RPC catalog retry experiment driver"
  description: "Exercise cancellation, competition, bounds and registry persistence in isolation."
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
      changes: ["Exercise controlled conflicts and cancellations"]
    - revision: 2
      reason: "probe refinement"
      changes: ["Add offline, publication and pre-aborted refresh scenarios"]
---
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { emit } from "./pre.ts";

export default function (pi: any) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };
  pi.on("session_start", (_event: unknown, ctx: any) => {
    emit("driver-session", { mode: ctx.mode });
    const action = process.env["ACTION"] ?? "none";
    if (action === "cancel") later(250, () => {
      const controller = new AbortController();
      emit("user-refresh-start");
      void ctx.modelRegistry.refresh({ providers: ["synthetic"], force: true, signal: controller.signal }).then(
        (result: any) => emit("user-refresh-finish", { aborted: result.aborted, errors: [...result.errors.keys()] }),
      );
      later(150, () => { emit("user-cancel"); controller.abort(); });
    });
    if (action === "manual") later(250, () => {
      emit("manual-refresh-start");
      void ctx.modelRegistry.refresh({ providers: ["synthetic"], force: true }).then(
        (result: any) => emit("manual-refresh-finish", { aborted: result.aborted, errors: [...result.errors.keys()] }),
      );
    });
    if (action === "publish-race" || action === "persist-race") later(950, () => {
      emit("publish-race-offline-refresh");
      void ctx.modelRegistry.refresh({ providers: ["synthetic"], allowNetwork: false }).then(
        (result: any) => emit("publish-race-finish", { aborted: result.aborted }),
      );
    });
    if (action === "pre-aborted") later(150, () => {
      const controller = new AbortController();
      controller.abort();
      emit("pre-aborted-refresh-start");
      void ctx.modelRegistry.refresh({ providers: ["synthetic"], signal: controller.signal }).then(
        (result: any) => emit("pre-aborted-refresh-finish", { aborted: result.aborted, errors: [...result.errors.keys()] }),
      );
    });
    if (action === "overlap") later(100, () => {
      emit("competing-refresh-start");
      void ctx.modelRegistry.refresh({ providers: ["synthetic"] }).then(
        (result: any) => emit("competing-refresh-finish", { aborted: result.aborted, errors: [...result.errors.keys()] }),
      );
    });
    if (action === "storm") for (const ms of [100, 250, 400, 550, 700]) later(ms, () => {
      emit("storm-refresh", { ms });
      void ctx.modelRegistry.refresh({ providers: ["synthetic"], allowNetwork: false }).then(
        (result: any) => emit("storm-finish", { ms, aborted: result.aborted }),
      );
    });
    if (action === "offline-trigger") later(50, () => {
      const controller = new AbortController();
      emit("forced-offline-network-start");
      void ctx.modelRegistry.refresh({ providers: ["synthetic"], allowNetwork: true, signal: controller.signal }).then(
        (result: any) => emit("forced-offline-network-finish", { aborted: result.aborted }),
      );
      later(150, () => { emit("forced-offline-network-cancel"); controller.abort(); });
    });
    if (action === "offline-kick") later(50, () => {
      emit("offline-kick");
      void ctx.modelRegistry.refresh({ providers: ["synthetic"] }).then(
        (result: any) => emit("offline-kick-finish", { aborted: result.aborted, errors: [...result.errors.keys()] }),
      );
    });
    later(Number(process.env["SAMPLE_MS"] ?? "2200"), () => {
      const models = ctx.modelRegistry.getAll();
      const ids = models.filter((model: any) => model.provider === "synthetic").map((model: any) => model.id);
      const available = ctx.modelRegistry.getAvailable().filter((model: any) => model.provider === "synthetic").map((model: any) => model.id);
      const storePath = join(process.env["PI_CODING_AGENT_DIR"]!, "models-store.json");
      const store = existsSync(storePath) ? readFileSync(storePath, "utf8") : "";
      emit("sample", { visible: ids.includes("race-visible"), hidden: ids.includes("race-hidden"), availableVisible: available.includes("race-visible"), storedVisible: store.includes("race-visible"), storedHidden: store.includes("race-hidden") });
    });
  });
  pi.on("session_shutdown", () => { for (const timer of timers) clearTimeout(timer); timers.clear(); emit("driver-shutdown"); });
}
