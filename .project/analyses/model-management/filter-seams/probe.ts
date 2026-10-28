import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const builtins = builtinProviders();
const builtin = builtins.find((provider) => provider.id === "openai");
if (!builtin) throw new Error("openai builtin is missing");
const builtinTarget = builtin.getModels()[0].id;
const extraTargets = Object.fromEntries(["anthropic", "openrouter"].map((id) => [id, builtins.find((provider) => provider.id === id).getModels()[0].id]));

function matchRules(model, rules) {
  let visible = true;
  for (const entry of rules) {
    const include = entry.startsWith("!");
    const pattern = include ? entry.slice(1) : entry;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    if (new RegExp(`^${escaped}$`).test(`${model.provider}/${model.id}`)) visible = include;
  }
  return visible;
}

function filter(rules, label) {
  let logged = false;
  return (models) => {
    if (!logged) {
      console.error(`${label} received=${models.map((model) => model.id).join(",")}`);
      logged = true;
    }
    return models.filter((model) => matchRules(model, rules));
  };
}

export function registerFixtureNative(pi, rules, label) {
  const native = {
    id: "fixture",
    name: "Fixture native shell",
    auth: { apiKey: {
      name: "Fixture key",
      check: async () => ({ type: "api_key", source: "fixture" }),
      resolve: async () => ({ auth: { apiKey: "dummy" }, source: "fixture" }),
    } },
    getModels: () => [],
    getAllModels: () => [],
    stream: () => { throw new Error("No requests in this probe"); },
    streamSimple: () => { throw new Error("No requests in this probe"); },
    filterModels: filter(rules, `${label}-chat`),
    filterAllModels: filter(rules, `${label}-all`),
  };
  pi.registerProvider(native);
}

export default function (pi) {
  const action = process.env.PROBE_ACTION ?? "discover";
  const config = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "filter-probe.json"), "utf8"));
  console.error(`FACTORY action=${action} builtin-target=${builtinTarget} rules=${JSON.stringify(config.rules)}`);
  console.error(`FACTORY extra-targets=${JSON.stringify(extraTargets)}`);
  console.error(`FACTORY typeof-isProjectTrusted=${typeof pi.isProjectTrusted}`);
  try {
    pi.getSettings();
    console.error("FACTORY getSettings=available");
  } catch (error) {
    console.error(`FACTORY getSettings=${error.message}`);
  }
  if (action === "named") {
    pi.registerProvider("openai", { filterModels: filter([`openai/${builtinTarget}`], "NAMED-openai-chat"), filterAllModels: filter([`openai/${builtinTarget}`], "NAMED-openai-all") });
    pi.registerProvider("fixture", { filterModels: filter(config.rules, "NAMED-fixture-chat"), filterAllModels: filter(config.rules, "NAMED-fixture-all") });
    for (const [provider, target] of Object.entries(extraTargets)) {
      pi.registerProvider(provider, { filterModels: filter([`${provider}/${target}`], `NAMED-${provider}-chat`) });
    }
    pi.registerProvider("ephemeral", { filterModels: filter(["ephemeral/hide"], "NAMED-ephemeral-chat") });
  }
  if (action === "native-builtin" || action === "native-builtin-virtual") {
    const oldChat = builtin.filterModels;
    const oldAll = builtin.filterAllModels;
    const nativeRules = [`openai/${builtinTarget}`, "openai/virtual-hide"];
    const chat = filter(nativeRules, "NATIVE-openai-chat");
    const all = filter(nativeRules, "NATIVE-openai-all");
    pi.registerProvider({
      ...builtin,
      filterModels: (models, credential) => chat(oldChat?.(models, credential) ?? models),
      filterAllModels: (models, credential) => all(oldAll?.(models, credential) ?? models),
    });
  }
  if (action === "native-all-only") {
    const oldAll = builtin.filterAllModels;
    const all = filter([`openai/${builtinTarget}`], "NATIVE-openai-all-only");
    pi.registerProvider({ ...builtin, filterAllModels: (models, credential) => all(oldAll?.(models, credential) ?? models) });
  }
  if (action === "native-custom" || action === "native-custom-virtual") {
    registerFixtureNative(pi, config.rules, "NATIVE-fixture");
  }
  if (action === "native-custom-virtual" || action === "native-builtin-virtual") {
    const provider = action === "native-custom-virtual" ? "fixture" : "openai";
    pi.registerVirtualModel({ provider, id: "virtual-hide", name: "Virtual hide", route: () => { throw new Error("No requests in this probe"); } });
    pi.registerVirtualModel({ provider: "virtual-only", id: "virtual-hide", name: "Virtual-only hide", route: () => { throw new Error("No requests in this probe"); } });
  }
  pi.on("session_start", async (_event, ctx) => {
    const selected = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
    const all = ctx.modelRegistry.getAll().filter((model) => model.provider === "fixture").map((model) => model.id).join(",");
    const available = ctx.modelRegistry.getAvailable().filter((model) => model.provider === "fixture").map((model) => model.id).join(",");
    const allTypes = (await ctx.modelRegistry.getAvailableOfType("chat", "fixture")).map((model) => model.id).join(",");
    console.error(`SESSION trusted=${ctx.isProjectTrusted()} selected=${selected} fixture-all=${all} fixture-available=${available} fixture-alltypes=${allTypes}`);
    if (action === "native-all-only") {
      const availableTarget = ctx.modelRegistry.getAvailable().some((model) => model.provider === "openai" && model.id === builtinTarget);
      const allTypesTarget = (await ctx.modelRegistry.getAvailableOfType("chat", "openai")).some((model) => model.id === builtinTarget);
      console.error(`SESSION all-only available-target=${availableTarget} alltypes-target=${allTypesTarget}`);
    }
  });
}
