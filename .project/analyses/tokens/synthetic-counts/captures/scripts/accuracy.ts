// Throwaway M3 probe: for identical payloads, count_tokens vs the stream's own usage.
// Streams raw SSE to disk (no auth headers recorded).
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const MODEL = process.env.MODEL ?? "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017";
const BASE = "https://api.synthetic.new/anthropic";
const texts: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts.json", "utf8"));

const payloads = readFileSync("/tmp/m3probe/caps/payloads.jsonl", "utf8")
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));

const cases: Array<{ name: string; body: Record<string, unknown> }> = [
	{ name: "short-text", body: { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "What is the capital of France?" }] } },
	{ name: "prose-20k", body: { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: texts["prose-20000"] }] } },
	{ name: "json-20k", body: { model: MODEL, max_tokens: 16, messages: [{ role: "user", content: texts["json-20000"] }] } },
	{ name: "pi-request-1", body: { ...payloads[0], max_tokens: 16 } },
];

async function count(body: unknown): Promise<number | string> {
	const res = await fetch(`${BASE}/v1/messages/count_tokens`, {
		method: "POST",
		headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	if (res.status !== 200) return `HTTP ${res.status} ${text.slice(0, 200)}`;
	return (JSON.parse(text) as { input_tokens: number }).input_tokens;
}

function usageFromSse(sse: string): unknown[] {
	const out: unknown[] = [];
	for (const line of sse.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const data = line.slice(6).trim();
		if (data === "[DONE]") continue;
		try {
			const frame = JSON.parse(data) as { type?: string; usage?: unknown; message?: { usage?: unknown } };
			if (frame.type === "message_start" && frame.message?.usage) out.push({ frame: "message_start", usage: frame.message.usage });
			else if (frame.type === "message_delta" && frame.usage) out.push({ frame: "message_delta", usage: frame.usage });
		} catch {}
	}
	return out;
}

const results = [];
for (const c of cases) {
	const n = await count(c.body);
	const started = performance.now();
	const res = await fetch(`${BASE}/v1/messages`, {
		method: "POST",
		headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
		body: JSON.stringify({ ...c.body, stream: true }),
	});
	const sse = await res.text();
	const ms = Math.round(performance.now() - started);
	writeFileSync(`/tmp/m3probe/caps/stream-${MODEL.replace(/[^a-z0-9]+/gi, "-")}-${c.name}.sse`, sse);
	const usage = usageFromSse(sse);
	results.push({ name: c.name, model: MODEL, count_tokens: n, status: res.status, ms, usage });
	console.log(c.name, "count", n, "status", res.status, ms + "ms", JSON.stringify(usage));
}
writeFileSync(`/tmp/m3probe/accuracy-${MODEL.replace(/[^a-z0-9]+/gi, "-")}.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
