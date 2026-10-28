import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const dir = "/tmp/pi-quota-attribution.FHUVNJtA";
const count = Number(process.argv[2] ?? "2");
const args = ["--mode", "rpc", "--no-session", "-ne", "-nc", "-ns", "-np", "-na", "--offline", "--no-mcp", "--tools", "read", "--model", "probe-group/g", "-e", `${dir}/probe.ts`];
const child = spawn("pi-bolt", args, { cwd: dir, env: { ...process.env, HOME: `${dir}/home`, PI_CODING_AGENT_DIR: `${dir}/agent`, XDG_CONFIG_HOME: `${dir}/config`, XDG_CACHE_HOME: `${dir}/cache`, XDG_DATA_HOME: `${dir}/data`, XDG_STATE_HOME: `${dir}/state`, PI_TELEMETRY: "0" }, stdio: ["pipe", "pipe", "pipe"] });
let sent = 0;
let settled = 0;
let stderrBytes = 0;
let done = false;
const timeout = setTimeout(() => { console.log(JSON.stringify({ type: "timeout", sent, settled })); child.kill("SIGTERM"); }, 90000);
child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
const prompt = () => {
  sent++;
  child.stdin.write(`${JSON.stringify({ id: `p${sent}`, type: "prompt", message: "Reply with the single word OK. Do not use tools." })}\n`);
};
createInterface({ input: child.stdout }).on("line", (line) => {
  let event;
  try { event = JSON.parse(line); } catch { console.log(JSON.stringify({ type: "non-json-output", bytes: line.length })); return; }
  if (event.type === "response" && event.command === "prompt") console.log(JSON.stringify({ type: "prompt-response", id: event.id, success: event.success, disposition: event.data?.disposition }));
  if (event.type === "agent_end") console.log(JSON.stringify({ type: "agent_end", messages: event.messages?.map((m) => ({ role: m.role, provider: m.provider, model: m.model, api: m.api, stopReason: m.stopReason })) }));
  if (event.type === "agent_settled") {
    settled++;
    console.log(JSON.stringify({ type: "agent_settled", settled, aborted: event.aborted }));
    if (settled < count) prompt();
    else { done = true; child.stdin.end(); }
  }
});
child.on("error", (error) => { console.log(JSON.stringify({ type: "spawn-error", name: error.name })); });
child.on("exit", (code, signal) => { clearTimeout(timeout); console.log(JSON.stringify({ type: "exit", code, signal, sent, settled, stderrBytes })); if (!done || code !== 0) process.exitCode = 1; });
prompt();
