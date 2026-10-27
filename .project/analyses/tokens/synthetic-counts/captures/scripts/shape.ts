// Throwaway M3 probe: which request shapes does Synthetic's count_tokens accept?
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const slot = auth["synthetic"];
const key: string = slot.key;
if (typeof key !== "string" || key.length === 0) throw new Error("no synthetic key in auth.json");

const URL = "https://api.synthetic.new/anthropic/v1/messages/count_tokens";
const MODEL = "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017";

const payloads = readFileSync("/tmp/m3probe/caps/payloads.jsonl", "utf8")
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));

const p1 = payloads[0];
const p2 = payloads[1];

const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const cases: Array<{ name: string; body: unknown }> = [
	{ name: "01-text-only", body: { model: MODEL, messages: [{ role: "user", content: "What is the capital of France?" }] } },
	{ name: "02-text-array", body: { model: MODEL, messages: [{ role: "user", content: [{ type: "text", text: "What is the capital of France?" }] }] } },
	{ name: "03-text-system", body: { model: MODEL, system: "You are terse.", messages: [{ role: "user", content: "What is the capital of France?" }] } },
	{ name: "04-max-tokens-temperature-stream", body: { model: MODEL, max_tokens: 16, temperature: 0.3, top_p: 0.9, stop_sequences: ["END"], stream: false, messages: [{ role: "user", content: "What is the capital of France?" }] } },
	{ name: "05-metadata", body: { model: MODEL, metadata: { user_id: "probe" }, messages: [{ role: "user", content: "What is the capital of France?" }] } },
	{ name: "06-tools", body: { model: MODEL, tools: p1.tools, messages: [{ role: "user", content: "What is the capital of France?" }] } },
	{ name: "07-thinking-disabled", body: { model: MODEL, thinking: { type: "disabled" }, messages: [{ role: "user", content: "What is the capital of France?" }] } },
	{ name: "08-thinking-enabled", body: { model: MODEL, thinking: { type: "enabled", budget_tokens: 1024 }, messages: [{ role: "user", content: "What is the capital of France?" }] } },
	{
		name: "09-assistant-tool-use + tool_result",
		body: {
			model: MODEL,
			messages: [
				{ role: "user", content: [{ type: "text", text: "Read the fixture." }] },
				{ role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "read", input: { path: "/tmp/fixture.json" } }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "hello world" }] }] },
			],
		},
	},
	{
		name: "10-thinking-block",
		body: {
			model: MODEL,
			messages: [
				{ role: "user", content: "What is the capital of France?" },
				{ role: "assistant", content: [{ type: "thinking", thinking: "France, capital, Paris.", signature: "probe" }, { type: "text", text: "Paris." }] },
				{ role: "user", content: "And of Italy?" },
			],
		},
	},
	{ name: "11-image", body: { model: MODEL, messages: [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image", source: { type: "base64", media_type: "image/png", data: png } }] }] } },
	{ name: "12-pi-request-1-verbatim", body: p1 },
	{ name: "13-pi-request-2-verbatim", body: p2 },
	{
		name: "14-pi-request-1-minus-stream-maxthinking",
		body: (() => {
			const { stream, thinking, max_tokens, ...rest } = p1 as Record<string, unknown>;
			return rest;
		})(),
	},
	{
		name: "15-pi-request-1-minus-tools",
		body: (() => {
			const { tools, ...rest } = p1 as Record<string, unknown>;
			return rest;
		})(),
	},
	{
		name: "16-pi-request-1-flat-text",
		body: {
			model: MODEL,
			system: p1.system.map((b: { text: string }) => b.text).join("\n\n"),
			tools: p1.tools,
			messages: p1.messages.map((m: { role: string; content: unknown }) => ({
				role: m.role,
				content: typeof m.content === "string" ? m.content : m.content.map((b: { text?: string }) => b.text ?? "").join("\n"),
			})),
		},
	},
];

async function call(body: unknown): Promise<{ status: number; body: string; ms: number }> {
	const started = performance.now();
	const res = await fetch(URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"anthropic-version": "2023-06-01",
			"x-api-key": key,
		},
		body: JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, body: text, ms: Math.round(performance.now() - started) };
}

const results: unknown[] = [];
for (const c of cases) {
	const r = await call(c.body);
	results.push({ name: c.name, bytes: JSON.stringify(c.body).length, ...r });
	console.log(c.name, r.status, r.ms + "ms", r.body.slice(0, 200));
}
writeFileSync("/tmp/m3probe/shape-results.json", JSON.stringify({ at: new Date().toISOString(), model: MODEL, results }, null, 2));
console.log("wrote shape-results.json");
