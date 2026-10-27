// Throwaway M3 probe: pin down the 500 on some always-on models (short vs long text).
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const URL = "https://api.synthetic.new/anthropic/v1/messages/count_tokens";
const texts: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts.json", "utf8"));

const models = ["hf:moonshotai/Kimi-K3", "hf:Qwen/Qwen3.8-27B", "hf:zai-org/GLM-4.7-Flash", "hf:openai/gpt-oss-120b", "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017"];
const bodies: Array<{ label: string; build: () => unknown }> = [
	{ label: "short", build: () => ({ messages: [{ role: "user", content: "What is the capital of France?" }] }) },
	{ label: "prose-20k", build: () => ({ messages: [{ role: "user", content: texts["prose-20000"] }] }) },
	{ label: "system+short", build: () => ({ system: "You are terse.", messages: [{ role: "user", content: "What is the capital of France?" }] }) },
];

const results = [];
for (const model of models) {
	for (const b of bodies) {
		const body = { model, ...(b.build() as Record<string, unknown>) };
		const res = await fetch(URL, {
			method: "POST",
			headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
			body: JSON.stringify(body),
		});
		const text = await res.text();
		results.push({ model, shape: b.label, status: res.status, body: text.slice(0, 300) });
		console.log(model, b.label, res.status, text.slice(0, 120).replace(/\n/g, " "));
	}
}
writeFileSync("/tmp/m3probe/model-500.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
