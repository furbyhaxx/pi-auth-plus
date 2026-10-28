import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const dir = "/tmp/pi-quota-attribution.FHUVNJtA";
let requests = 0;
const server = createServer((request, response) => {
  requests++;
  response.writeHead(429, { "content-type": "application/json", "x-probe-ratelimit": "redacted", "retry-after": "1" });
  response.end(JSON.stringify({ type: "error", error: { message: "mock throttled", type: "rate_limit_error" } }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const env = { ...process.env, HOME: `${dir}/home`, PI_CODING_AGENT_DIR: `${dir}/agent`, XDG_CONFIG_HOME: `${dir}/config`, XDG_CACHE_HOME: `${dir}/cache`, XDG_DATA_HOME: `${dir}/data`, XDG_STATE_HOME: `${dir}/state`, PI_TELEMETRY: "0", PROBE_MOCK_URL: `http://127.0.0.1:${server.address().port}` };
const args = ["--mode", "rpc", "--no-session", "-ne", "-nc", "-ns", "-np", "-na", "--offline", "--no-mcp", "--tools", "read", "--model", "mock-group/g", "-e", `${dir}/mock-429.ts`];
const child = spawn("pi-bolt", args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
let settled = 0;
let stderrBytes = 0;
const timeout = setTimeout(() => child.kill("SIGTERM"), 60000);
child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
const prompt = () => child.stdin.write(`${JSON.stringify({ type: "prompt", message: "Reply OK." })}\n`);
createInterface({ input: child.stdout }).on("line", (line) => {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event.type === "agent_end") console.log(JSON.stringify({ type: event.type, messages: event.messages?.filter((message) => message.role === "assistant").map(({ provider, model, api, stopReason }) => ({ provider, model, api, stopReason })) }));
  if (event.type === "agent_settled") { settled++; if (settled === 1) prompt(); else child.stdin.end(); }
});
child.on("exit", (code, signal) => { clearTimeout(timeout); server.close(); console.log(JSON.stringify({ type: "exit", code, signal, requests, settled, stderrBytes })); if (code !== 0 || settled !== 2 || requests !== 2) process.exitCode = 1; });
prompt();
