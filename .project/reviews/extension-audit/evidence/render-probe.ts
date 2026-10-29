import { KeybindingsManager, TUI_KEYBINDINGS } from "/mnt/Projects/furbyhaxx/pi-auth-plus/node_modules/@earendil-works/pi-tui";
import { ModelsView } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/ui/dashboard/models.ts";
import { compileModelRules, evaluateModelRules } from "/mnt/Projects/furbyhaxx/pi-auth-plus/src/models/rules/match.ts";
const keys = new KeybindingsManager(TUI_KEYBINDINGS);
const host = {theme:{fg: (_:unknown,s:string)=>s,bg: (_:unknown,s:string)=>s,bold:(s:string)=>s},keys,binding:()=>"key",refresh:()=>{},finish:()=>{}};
for (const ruleCount of [1, 10, 25, 50]) {
 const rules = Array.from({length:ruleCount},(_,i)=>`vendor/model-${i}*`);
 const catalog = Array.from({length:555},(_,i)=>({provider:"vendor",id:`model-${i}`,name:`Model ${i}`,contextWindow:100000}));
 let previous: readonly string[] | undefined;
 let compiled = compileModelRules([]), compilations=0;
 const view = new ModelsView(host,{rules:()=>rules,catalog:()=>catalog,evaluate:(input,provider,id)=>{if(input!==previous){previous=input;compiled=compileModelRules(input);compilations++;}return {visible:!evaluateModelRules(compiled,provider,id).hidden};},save:async()=>{}});
 for(let i=1;i<ruleCount;i++)view.handleInput("\x1b[B");
 for(let i=0;i<5;i++)view.render(140,30);
 const times=[];compilations=0;
 for(let i=0;i<30;i++){const start=performance.now();view.render(140,30);times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);
 console.log(JSON.stringify({catalog:catalog.length,rules:ruleCount,selectedRule:ruleCount-1,compilationsPerRender:compilations/30,p50ms:times[15],p95ms:times[28]}));
}
