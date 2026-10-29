import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { redactText, redactValue } from "../../../../../src/core/redact/index.ts";
const root = resolve(import.meta.dir, "../../../../..");
const scratch = process.env.QA_TMP;
if (!scratch || !scratch.startsWith("/tmp/pi-auth-live-")) throw new Error("QA_TMP must be a private QA directory");
const target = import.meta.dir;
const runs = [
  {label:"claude",provider:"claude",model:"claude-haiku-5-5"},
  {label:"antigravity",provider:"antigravity",model:"claude-sonnet-5-5"},
  {label:"opencode-registered-final",provider:"opencode",model:"deepseek-v4.1-flash-free",tool:true,group:true},
  {label:"opencode-free",provider:"opencode",model:"big-pickle",tool:true},
  {label:"opencode-alternate",provider:"opencode",model:"cat-jam-free",tool:true},
  {label:"opencode-group",provider:"opencode",model:"big-pickle",tool:true,group:true},
  {label:"synthetic-group",provider:"synthetic",model:"syn:small:text",group:true},
  {label:"openai",provider:"openai",model:"gpt-6-luna"},
  {label:"xai",provider:"xai",model:"grok-4.7"},
];
const secrets: string[] = [];
function collect(value: unknown): void { if (typeof value === "string" && value.length >= 8) secrets.push(value); else if (value && typeof value === "object") for (const item of Object.values(value)) collect(item); }
try { collect(JSON.parse(readFileSync(join(scratch,"agent/auth.json"),"utf8"))); } catch {}
for (const [name,value] of Object.entries(process.env)) if (/(?:TOKEN|KEY|SECRET|PASSWORD|COOKIE)/i.test(name)) collect(value);
const suffix = process.env.QA_RUN_SUFFIX ?? "";
if (!/^[a-z0-9-]*$/.test(suffix)) throw new Error("Invalid QA_RUN_SUFFIX");
const selected = process.env.QA_ONLY ? new Set(process.env.QA_ONLY.split(",")) : undefined;
async function run(row: typeof runs[number]) {
  const work = join(scratch!,row.label + suffix); const agent = join(work,"agent"); mkdirSync(agent,{recursive:true,mode:0o700});
  for (const name of ["auth.json","models-store.json"]) { const src = join(scratch!,"agent",name); if (existsSync(src)) {copyFileSync(src,join(agent,name));chmodSync(join(agent,name),0o600);} }
  const config = {quotas:{refreshOnRequest:false}, models:{groups:row.group ? [{id:"live-qa",strategy:"sticky",triggers:[],members:[{provider:row.provider,id:row.model,tier:1}]}] : []}};
  writeFileSync(join(agent,"auth-plus.json"),JSON.stringify(config),{mode:0o600});
  const single = row.label === "opencode-registered-final";
  if (single) writeFileSync(join(agent,"settings.json"),JSON.stringify({retry:{enabled:false,maxRetries:0,provider:{maxRetries:0}},cacheWarming:"off"}),{mode:0o600});
  const capture = join(target,`${row.label}${suffix}.jsonl`);
  const env = {...process.env,HOME:work,XDG_CACHE_HOME:join(work,"cache"),XDG_STATE_HOME:join(work,"state"),XDG_CONFIG_HOME:join(work,"config"),PI_CODING_AGENT_DIR:agent,QA_CAPTURE:capture,QA_GROUP:row.group?"1":"0",QA_SINGLE_REQUEST:single?"1":"0",QA_REQUIRE_REGISTERED:single?"1":"0",QA_EXPECTED_MODEL:row.model};
  const args = ["--kill-after=3s","100s","/home/furbyhaxx/.local/bin/pi-bolt","-ne","-nc","-ns","-np","--no-themes","--no-mcp","--offline","--no-session","--mode","json","-e",join(target,"observe.ts"),"-e",join(root,"src/index.ts"),"-e",join(target,"group.ts"),"--provider",row.provider,"--model",row.model,"--thinking","off","--system-prompt","Reply briefly.",...(row.tool?["--tools","qa_noop"]:["--no-tools"]),"-p","Reply exactly OK. Do not use any tools."];
  const result = await new Promise<{code:number|null,signal:string|null,stdout:string,stderr:string}>((done) => {
    const child=spawn("timeout",args,{cwd:work,env,stdio:["ignore","pipe","pipe"]}); let stdout="",stderr="";
    child.stdout.on("data",chunk=>stdout+=chunk.toString()); child.stderr.on("data",chunk=>stderr+=chunk.toString());
    child.on("error",error=>done({code:null,signal:null,stdout,stderr:String(error)})); child.on("close",(code,signal)=>done({code,signal,stdout,stderr}));
  });
  try { collect(JSON.parse(readFileSync(join(agent,"auth.json"),"utf8"))); } catch {}
  const clean = {label:row.label,provider:row.provider,model:row.model,exitCode:result.code,signal:result.signal,stdout:redactText(result.stdout,secrets),stderr:redactText(result.stderr,secrets)};
  writeFileSync(join(target,`${row.label}${suffix}-process.json`),`${JSON.stringify(redactValue(clean,secrets),null,2)}\n`,{mode:0o600});
  let events: any[] = [];
  try { events = readFileSync(capture,"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line)); } catch {}
  const requests = events.filter(event=>event.event==="http_request").map(event=>({number:event.number,url:event.url,model:event.body?.model ?? null}));
  const responses = events.filter(event=>event.event==="http_response").map(event=>({number:event.number,status:event.status}));
  const end = events.filter(event=>event.event==="message_end").at(-1)?.message;
  const summary = {label:row.label,exitCode:result.code,signal:result.signal,requests,responses,group:events.find(event=>event.event==="group_selection") ?? null,assistant:end?{provider:end.provider,model:end.model,stopReason:end.stopReason,text:end.content?.filter((part:any)=>part.type==="text").map((part:any)=>part.text).join(""),usage:end.usage,errorMessage:end.errorMessage}:null,stderr:redactText(result.stderr,secrets).slice(0,1000)};
  console.log(JSON.stringify(redactValue(summary,secrets)));
}
await Promise.all(runs.filter(row => !selected || selected.has(row.label)).map(run));
