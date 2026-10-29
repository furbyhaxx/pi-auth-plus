import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
const dir = "/tmp/pi-guard-correlation.k1ejpwE7";
const mode = process.argv[2];
const root = `${dir}/${mode}-root`;
for (const name of ["home", "agent", "config", "cache", "state", "data"]) mkdirSync(`${root}/${name}`, {recursive:true});
writeFileSync(`${root}/agent/settings.json`, JSON.stringify({retry:{enabled:true,maxRetries:1,baseDelayMs:20,provider:{maxRetries:0,timeoutMs:10000}},compaction:{enabled:false,keepRecentTokens:1,reserveTokens:256},cacheWarming:"off"}));
const log = event => appendFileSync(`${dir}/${mode}.http.jsonl`, `${JSON.stringify(event)}\n`);
let throttled = false;
let requests = 0;
const server = createServer((req,res) => {
  let body="";
  req.on("data", c => body+=c);
  req.on("end", () => {
    requests++;
    let p; try { p=JSON.parse(body); } catch { res.writeHead(500).end(); return; }
    const path=req.url ?? "";
    const input=JSON.stringify(p.messages ?? []);
    const tag=input.includes("SLOW") ? "SLOW" : input.includes("FAST") ? "FAST" : input.includes("OPENCODE physical API") ? "OPENCODE_API" : input.includes("OPENCODE virtual side") ? "OPENCODE_SIDE" : input.includes("IMPOSTOR") ? "IMPOSTOR" : input.includes("RETRY_ME") ? "RETRY_ME" : "OTHER";
    log({path,tag,model:p.model,env:JSON.stringify(p.messages ?? []).includes("<env>"),effort:p.reasoning_effort ?? null,client:req.headers["x-opencode-client"] ?? null,userAgent:(req.headers["user-agent"] ?? "").startsWith("opencode/") ? "opencode" : "other",session:!!req.headers["x-opencode-session"],modelHeader:req.headers["x-probe-model"] ?? null});
    if(path.includes("opencode") && tag==="RETRY_ME" && !throttled) {
      throttled=true;res.writeHead(429,{"content-type":"application/json"});res.end(JSON.stringify({error:{message:"rate limit exceeded",type:"rate_limit_error"}}));return;
    }
    const finish = () => {
      res.writeHead(200,{"content-type":"text/event-stream", "cache-control":"no-cache"});
      if(path.includes("synthetic")) {
        const events=[
          {type:"message_start",message:{id:"msg_mock",type:"message",role:"assistant",model:p.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0,cache_creation_input_tokens:10,cache_read_input_tokens:0}}},
          {type:"content_block_start",index:0,content_block:{type:"text",text:""}},
          {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"OK"}},
          {type:"content_block_stop",index:0},
          {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{input_tokens:10,output_tokens:5,cache_creation_input_tokens:10,cache_read_input_tokens:0}},
          {type:"message_stop"},
        ];
        for(const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      } else {
        const chunk=(delta,reason=null) => ({id:"chatcmpl-mock",object:"chat.completion.chunk",created:1,model:p.model,choices:[{index:0,delta,finish_reason:reason}]});
        res.write(`data: ${JSON.stringify(chunk({role:"assistant",content:"OK"}))}\n\n`);
        res.write(`data: ${JSON.stringify(chunk({},"stop"))}\n\n`);
        res.write("data: [DONE]\n\n");
      }
      res.end();
    };
    if(tag==="SLOW") setTimeout(finish,150); else finish();
  });
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const args=["--mode","rpc","--no-session","-ne","-nc","-ns","-np","-na","--offline","--no-mcp","--tools","read","--model","probe-group/g","-e",`${dir}/probe.ts`];
const env={PATH:process.env.PATH, HOME:`${root}/home`,PI_CODING_AGENT_DIR:`${root}/agent`,XDG_CONFIG_HOME:`${root}/config`,XDG_CACHE_HOME:`${root}/cache`,XDG_STATE_HOME:`${root}/state`,XDG_DATA_HOME:`${root}/data`,PI_TELEMETRY:"0",PROBE_MODE:mode,PROBE_MOCK_URL:`http://127.0.0.1:${server.address().port}`};
const child=spawn("pi-bolt",args,{cwd:root,env,stdio:["pipe","pipe","pipe"]});
const timer=setTimeout(()=>{ console.error("timeout");child.kill("SIGTERM");server.close(); },45000);
let settled=0, compact=false, stderr="";
child.stderr.on("data",c=>stderr+=c);
const send = x => child.stdin.write(`${JSON.stringify(x)}\n`);
createInterface({input:child.stdout}).on("line",line=>{
  let e;try{e=JSON.parse(line)}catch{return;}
  if(e.type==="auto_retry_start") console.log(JSON.stringify({type:e.type,attempt:e.attempt}));
  if(e.type==="agent_end") console.log(JSON.stringify({type:e.type,messages:e.messages?.filter(m=>m.role==="assistant").map(m=>({provider:m.provider,model:m.model,stop:m.stopReason,usage:m.usage}))}));
  if(e.type==="agent_settled") {
    settled++;
    if(settled===1) send({id:"p2",type:"prompt",message:"IMPOSTOR"});
    else if(settled===2) send({id:"p3",type:"prompt",message:"FORCE_SYNTHETIC"});
    else if(settled===3) send({id:"c",type:"compact"});
  }
  if(e.type==="response" && e.command==="compact") {compact=e.success;console.log(JSON.stringify({type:"compact-response",success:e.success,error:e.error ?? null,usage:e.data?.usage ?? null}));child.stdin.end();}
});
child.on("exit",(code,signal)=>{ clearTimeout(timer);server.close();console.log(JSON.stringify({type:"exit",code,signal,requests,settled,compact,stderrBytes:stderr.length,stderr:stderr.slice(0,1500)}));if(code!==0||settled!==3||!compact) process.exitCode=1; });
send({id:"p1",type:"prompt",message:"RETRY_ME"});
