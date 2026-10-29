import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { redactValue } from "../../../../../src/core/redact/index.ts";
export default function (pi: any): void {
  if (process.env.QA_GROUP !== "1") return;
  pi.on("session_start", async (_event: any, ctx: any) => {
    const model = ctx.modelRegistry.find("group", "live-qa");
    const physical = process.env.QA_REQUIRE_REGISTERED === "1" ? ctx.modelRegistry.find("opencode", process.env.QA_EXPECTED_MODEL) : undefined;
    const selected = model ? await pi.setModel(model) : false;
    if (process.env.QA_REQUIRE_REGISTERED === "1") Reflect.set(globalThis, "__qaRegisteredPhysical", Boolean(selected && physical));
    let secrets: string[] = [];
    try {
      const walk = (value: unknown): void => { if (typeof value === "string" && value.length >= 8) secrets.push(value); else if (value && typeof value === "object") for (const item of Object.values(value)) walk(item); };
      walk(JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, "auth.json"), "utf8")));
    } catch {}
    const record = redactValue({event:"group_selection",found:!!model,selected,provider:model?.provider,id:model?.id,...(process.env.QA_REQUIRE_REGISTERED === "1" ? {registeredPhysical:!!physical,physicalProvider:physical?.provider,physicalModel:physical?.id} : {})}, secrets);
    appendFileSync(process.env.QA_CAPTURE!, `${JSON.stringify(record)}\n`, {mode:0o600});
  });
}
