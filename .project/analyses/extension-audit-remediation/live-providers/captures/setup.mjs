import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
const scratch = process.env.QA_TMP;
if (!scratch || !scratch.startsWith('/tmp/pi-auth-live-')) throw new Error('QA_TMP must be a private QA directory');
const source = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME, '.pi', 'agent');
const dest = join(scratch, 'agent');
mkdirSync(dest, { recursive: true, mode: 0o700 });
let slots = {};
try {
  const raw = readFileSync(join(source, 'auth.json'), 'utf8');
  slots = JSON.parse(raw.replace(/^\uFEFF/, ''));
  writeFileSync(join(dest, 'auth.json'), raw, { mode: 0o600 });
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Cannot read or parse source auth.json');
}
for (const name of ['models-store.json']) {
  const path = join(source, name);
  if (existsSync(path)) { copyFileSync(path, join(dest, name)); chmodSync(join(dest, name), 0o600); }
}
const envs = { claude:['ANTHROPIC_OAUTH_TOKEN','ANTHROPIC_AUTH_TOKEN'], antigravity:[], google:[], synthetic:['SYNTHETIC_API_KEY'], opencode:['OPENCODE_API_KEY'], openai:['OPENAI_API_KEY'], 'openai-codex':[], xai:['XAI_API_KEY'], openrouter:['OPENROUTER_API_KEY'] };
const result = {sourceAuthPath:join(source,'auth.json'), copiedAuth:existsSync(join(dest,'auth.json')), copiedModelStore:existsSync(join(dest,'models-store.json')), providers:{}};
for (const [name, envNames] of Object.entries(envs)) {
  const slot = slots[name];
  const status = slot && typeof slot === 'object' ? {type: typeof slot.type === 'string' ? slot.type : 'unknown', usableFieldPresent: typeof (slot.key ?? slot.access) === 'string' && (slot.key ?? slot.access).length > 0, ...(slot.type === 'oauth' && Number.isFinite(slot.expires) ? {expired:slot.expires <= Date.now()} : {})} : {type:'missing'};
  result.providers[name] = {...status, envPresent:envNames.filter(key=>!!process.env[key])};
}
console.log(JSON.stringify(result,null,2));
