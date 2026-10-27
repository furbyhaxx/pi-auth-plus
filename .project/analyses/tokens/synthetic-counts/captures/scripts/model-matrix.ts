// Throwaway M3 probe: count_tokens across every always-on model in the live catalog.
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const URL = "https://api.synthetic.new/anthropic/v1/messages/count_tokens";
const catalog = JSON.parse(readFileSync("/tmp/m3probe/models-v1.json", "utf8")) as {
	data: Array<{ id: string; always_on: boolean; context_length: number; pricing: Record<string, string> }>;
};
const texts: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts.json", "utf8"));
const prose = texts["prose-20000"] as string;

const results = [];
for (const row of catalog.data.filter((r) => r.always_on)) {
	const out: Record<string, unknown> = { model: row.id, context_length: row.context_length };
	for (const [shape, content] of [["short", "What is the capital of France?"], ["prose-20k", prose]] as const) {
		const res = await fetch(URL, {
			method: "POST",
			headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
			body: JSON.stringify({ model: row.id, messages: [{ role: "user", content }] }),
		});
		const text = await res.text();
		out[shape] = { status: res.status, body: text.slice(0, 200) };
	}
	results.push(out);
	console.log(JSON.stringify(out));
}
writeFileSync("/tmp/m3probe/model-matrix.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
