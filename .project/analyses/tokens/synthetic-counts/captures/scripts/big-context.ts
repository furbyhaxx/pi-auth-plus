// Throwaway M3 probe: which count does the provider enforce against context_length?
// One payload whose real DeepSeek tokenizer count exceeds 524288 while Synthetic's own
// count stays well below it.
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const MODEL = "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017";
const BASE = "https://api.synthetic.new/anthropic";
const texts: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts.json", "utf8"));

const src = texts["prose-40000"] as string;
const target = Number(process.env.TARGET_CHARS ?? 2_100_000);
let text = "";
while (text.length < target) text += src;
text = text.slice(0, target);
writeFileSync("/tmp/m3probe/big.txt", text);
const body = { model: MODEL, max_tokens: 1, messages: [{ role: "user", content: text }] };
console.log("payload chars", text.length, "bytes", JSON.stringify(body).length);

const countRes = await fetch(`${BASE}/v1/messages/count_tokens`, {
	method: "POST",
	headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
	body: JSON.stringify(body),
});
const countText = await countRes.text();
console.log("count_tokens", countRes.status, countText.slice(0, 300));

const started = performance.now();
const res = await fetch(`${BASE}/v1/messages`, {
	method: "POST",
	headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
	body: JSON.stringify({ ...body, stream: true, thinking: { type: "disabled" } }),
});
const ms = Math.round(performance.now() - started);
const sse = await res.text();
writeFileSync("/tmp/m3probe/caps/big-context.sse", sse);
const head = sse.split("\n").filter((l) => l.startsWith("data:")).slice(0, 3);
writeFileSync("/tmp/m3probe/big-context.json", JSON.stringify({ at: new Date().toISOString(), chars: text.length, count_tokens_status: countRes.status, count_tokens_body: countText.slice(0, 300), messages_status: res.status, ms, head }, null, 2));
console.log("messages", res.status, ms + "ms");
console.log(head.join("\n").slice(0, 1200));
