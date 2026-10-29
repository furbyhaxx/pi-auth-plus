export default async function audit(pi) {
 let phase = "factory";
 globalThis.fetch = async (url) => {
  console.error("AUDIT_FETCH " + JSON.stringify({phase,url:String(url)}));
  return new Response("offline audit blocks network",{status:503});
 };
 pi.on("session_start",()=>{phase="session_start";});
 const {default:authPlus} = await import("/mnt/Projects/furbyhaxx/pi-auth-plus/src/index.ts");
 await authPlus(pi);
}
