// Throwaway M3 probe: reject the "byte-size cap" explanation. A payload that is SMALLER in
// bytes than an accepted one, but bigger in real DeepSeek tokens than the 524288 limit.
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const MODEL = "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017";
const disc: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts-disc.json", "utf8"));
const hex = disc["disc:hex-20000"] as string;

const target = Number(process.env.TARGET_CHARS ?? 1_050_000);
let text = "";
while (text.length < target) text += hex;
text = text.slice(0, target);
writeFileSync("/tmp/m3probe/big-hex.txt", text);
const body = { model: MODEL, max_tokens: 1, messages: [{ role: "user", content: text }] };
const bytes = JSON.stringify(body).length;
console.log("chars", text.length, "bytes", bytes);

const countRes = await fetch("https://api.synthetic.new/anthropic/v1/messages/count_tokens", {
	method: "POST",
	headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
	body: JSON.stringify(body),
});
const countText = await countRes.text();
 console.log("count_tokens", countRes.status, countText.slice(0, 200));

const started = performance.now();
const res = await fetch("https://api.synthetic.new/anthropic/v1/messages", {
	method: "POST",
	headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
	body: JSON.stringify({ ...body, stream: true, thinking: { type: "disabled" } }),
});
const sse = await res.text();
writeFileSync("/tmp/m3probe/caps/big-hex.sse", sse);
writeFileSync("/tmp/m3probe/big-hex.json", JSON.stringify({ at: new Date().toISOString(), chars: text.length, bytes, count_status: countRes.status, count_body: countText.slice(0, 200), messages_status: res.status, ms: Math.round(performance.now() - started), body: sse.slice(0, 600) }, null, 2));
console.log("messages", res.status, Math.round(performance.now() - started) + "ms", sse.slice(0, 400));
