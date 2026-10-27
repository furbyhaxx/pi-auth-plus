import { readFileSync, writeFileSync } from "node:fs";
const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const res = await fetch("https://api.synthetic.new/anthropic/v1/messages", {
	method: "POST",
	headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
	body: JSON.stringify({
		model: "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017",
		max_tokens: 1200,
		thinking: { type: "disabled" },
		messages: [{ role: "user", content: "Write a compact JSON object with keys alpha..zeta, each mapped to a 25-word English sentence about rivers. No markdown fences, no commentary." }],
	}),
});
const body = (await res.json()) as { content?: Array<{ type: string; text?: string }>; usage?: unknown; stop_reason?: string };
const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
writeFileSync("/tmp/m3probe/gen2-output.txt", text);
writeFileSync("/tmp/m3probe/gen2-result.json", JSON.stringify({ at: new Date().toISOString(), status: res.status, usage: body.usage, stop_reason: body.stop_reason, chars: text.length }, null, 2));
console.log(JSON.stringify({ status: res.status, usage: body.usage, chars: text.length }));
