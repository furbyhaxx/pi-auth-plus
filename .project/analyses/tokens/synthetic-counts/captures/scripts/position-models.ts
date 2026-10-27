// Throwaway M3 probe: is the input count a scaled real count (position independent)
// or a truncation? And do other always-on models count with their own tokenizer?
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const URL = "https://api.synthetic.new/anthropic/v1/messages/count_tokens";
const DS = "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017";
const texts: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts.json", "utf8"));
const disc: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts-disc.json", "utf8"));

const prose = texts["prose-20000"] as string;
const hex = disc["disc:hex-20000"] as string;

async function count(model: string, text: string): Promise<{ n: number | string; ms: number }> {
	const started = performance.now();
	const res = await fetch(URL, {
		method: "POST",
		headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
		body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
	});
	const body = await res.text();
	const ms = Math.round(performance.now() - started);
	if (res.status !== 200) return { n: `HTTP ${res.status} ${body.slice(0, 120)}`, ms };
	return { n: (JSON.parse(body) as { input_tokens: number }).input_tokens, ms };
}

const cases: Array<{ name: string; model: string; text: string }> = [
	{ name: "pos:hex-then-prose", model: DS, text: hex + prose },
	{ name: "pos:prose-then-hex", model: DS, text: prose + hex },
	{ name: "model:gpt-oss-120b:prose", model: "hf:openai/gpt-oss-120b", text: prose },
	{ name: "model:gpt-oss-120b:hex", model: "hf:openai/gpt-oss-120b", text: hex },
	{ name: "model:GLM-4.7-Flash:prose", model: "hf:zai-org/GLM-4.7-Flash", text: prose },
	{ name: "model:GLM-4.7-Flash:hex", model: "hf:zai-org/GLM-4.7-Flash", text: hex },
	{ name: "model:Kimi-K3:prose", model: "hf:moonshotai/Kimi-K3", text: prose },
	{ name: "model:Kimi-K3:hex", model: "hf:moonshotai/Kimi-K3", text: hex },
	{ name: "model:Qwen3.8-27B:prose", model: "hf:Qwen/Qwen3.8-27B", text: prose },
	{ name: "model:Qwen3.8-27B:hex", model: "hf:Qwen/Qwen3.8-27B", text: hex },
	{ name: "model:syn-large-text:prose", model: "syn:large:text", text: prose },
];

const results = [];
for (const c of cases) {
	const r = await count(c.model, c.text);
	results.push({ name: c.name, model: c.model, chars: c.text.length, input_tokens: r.n, ms: r.ms });
	console.log(c.name, c.text.length, r.n, r.ms + "ms");
}
writeFileSync("/tmp/m3probe/position-models.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
