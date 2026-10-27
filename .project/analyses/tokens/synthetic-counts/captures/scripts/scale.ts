// Throwaway M3 probe: how does count_tokens scale with text length, and where do
// the accepted shapes stop being accepted?
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const URL = "https://api.synthetic.new/anthropic/v1/messages/count_tokens";
const MODEL = "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017";
const texts: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts.json", "utf8"));
const payloads = readFileSync("/tmp/m3probe/caps/payloads.jsonl", "utf8")
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));
const p1 = payloads[0];

type Case = { name: string; chars: number; body: unknown };
const cases: Case[] = [];
for (const [name, text] of Object.entries(texts)) {
	if (name === "pi-system") continue;
	cases.push({ name: `user:${name}`, chars: text.length, body: { model: MODEL, messages: [{ role: "user", content: [{ type: "text", text }] }] } });
}
cases.push({ name: "system:pi-system", chars: texts["pi-system"].length, body: { model: MODEL, system: texts["pi-system"], messages: [{ role: "user", content: "hi" }] } });
cases.push({ name: "system:pi-system-json-message", chars: texts["pi-system"].length + texts["json-20000"].length, body: { model: MODEL, system: texts["pi-system"], messages: [{ role: "user", content: [{ type: "text", text: texts["json-20000"] }] }] } });
cases.push({ name: "pi-request-1-verbatim", chars: JSON.stringify(p1).length, body: p1 });
cases.push({ name: "pi-request-1-no-tools", chars: 0, body: (({ tools, ...rest }: Record<string, unknown>) => rest)(p1) });

async function call(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string; error?: string; ms: number }> {
	const started = performance.now();
	try {
		const res = await fetch(URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"anthropic-version": "2023-06-01",
				"x-api-key": key,
				...headers,
			},
			body: JSON.stringify(body),
		});
		const text = await res.text();
		return { status: res.status, body: text, ms: Math.round(performance.now() - started) };
	} catch (error) {
		return { status: 0, body: "", error: String(error), ms: Math.round(performance.now() - started) };
	}
}

const results = [];
for (const c of cases) {
	const r = await call(c.body);
	results.push({ name: c.name, chars: c.chars, bytes: JSON.stringify(c.body).length, ...r });
	console.log(c.name, c.chars, r.status, r.ms + "ms", r.body.slice(0, 120));
}

// 500 triggers under test: beta headers, query parameter, a model that is not always-on,
// an unknown model, a missing model, and the Anthropic cache_control/billing shapes.
const triggers: Array<{ name: string; body: unknown; headers?: Record<string, string>; query?: string }> = [
	{ name: "500beta-header", body: { model: MODEL, messages: [{ role: "user", content: "hi" }] }, headers: { "anthropic-beta": "token-counting-2024-11-01" } },
	{ name: "500beta-query", body: { model: MODEL, messages: [{ role: "user", content: "hi" }] }, query: "?beta=true" },
	{ name: "500non-always-on-model", body: { model: "hf:deepseek-ai/DeepSeek-V3-0324", messages: [{ role: "user", content: "hi" }] } },
	{ name: "500unknown-model", body: { model: "hf:nope/Nope-1", messages: [{ role: "user", content: "hi" }] } },
	{ name: "500missing-model", body: { messages: [{ role: "user", content: "hi" }] } },
	{ name: "500system-blocks-cache-control", body: { model: MODEL, system: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }] } },
	{ name: "500empty-messages", body: { model: MODEL, messages: [] } },
	{ name: "500tool-result-string", body: { model: MODEL, messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "plain string" }] }] } },
];
for (const t of triggers) {
	const started = performance.now();
	const res = await fetch(URL + (t.query ?? ""), {
		method: "POST",
		headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key, ...(t.headers ?? {}) },
		body: JSON.stringify(t.body),
	});
	const text = await res.text();
	results.push({ name: t.name, bytes: JSON.stringify(t.body).length, status: res.status, body: text, ms: Math.round(performance.now() - started) });
	console.log(t.name, res.status, text.slice(0, 160));
}
writeFileSync("/tmp/m3probe/scale-results.json", JSON.stringify({ at: new Date().toISOString(), model: MODEL, results }, null, 2));
