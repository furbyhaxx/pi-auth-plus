// Throwaway M3 probe: discriminate a real tokenizer (scaled) from a char-based
// estimator, plus position/overhead effects and remaining 500 candidates.
import { readFileSync, writeFileSync } from "node:fs";

const auth = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/auth.json`, "utf8"));
const key: string = auth["synthetic"].key;
const URL = "https://api.synthetic.new/anthropic/v1/messages/count_tokens";
const MODEL = "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017";
const texts: Record<string, string> = JSON.parse(readFileSync("/tmp/m3probe/texts.json", "utf8"));

function rnd(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
}
const r = rnd(11);
const words = "the quick brown fox jumps over lazy dog while parsing tokens into smaller pieces of text".split(" ");
const uniqueWords: string[] = [];
for (let i = 0; i < 800; i++) uniqueWords.push(words[Math.floor(r() * words.length)] + (i % 7 === 0 ? String(Math.floor(r() * 99999)) : ""));
const randProse = Array.from({ length: 4000 }, () => uniqueWords[Math.floor(r() * uniqueWords.length)]).join(" ").slice(0, 20000);
const hex = Array.from({ length: 20000 }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
const jp = "東京は日本の首都であり、世界でも有数の大都市です。トークナイザーは日本語の文章をどのように分割するのでしょうか。".repeat(40).slice(0, 4000);
const emoji = "🙂🙃😀😃😄😁😆😅🤣😂🚀🌍🔥✨🎉".repeat(300).slice(0, 4000);
const mixed = (texts["json-20000"] as string).slice(0, 10000) + jp + (texts["prose-20000"] as string).slice(0, 6000);

const shapes: Array<{ name: string; text: string; body: unknown }> = [
	{ name: "disc:random-prose-20000", text: randProse, body: { model: MODEL, messages: [{ role: "user", content: randProse }] } },
	{ name: "disc:hex-20000", text: hex, body: { model: MODEL, messages: [{ role: "user", content: hex }] } },
	{ name: "disc:japanese-4000", text: jp, body: { model: MODEL, messages: [{ role: "user", content: jp }] } },
	{ name: "disc:emoji-4000", text: emoji, body: { model: MODEL, messages: [{ role: "user", content: emoji }] } },
	{ name: "disc:mixed-20000", text: mixed, body: { model: MODEL, messages: [{ role: "user", content: mixed }] } },
	{ name: "pos:user-prose-5000", text: texts["prose-5000"] as string, body: { model: MODEL, messages: [{ role: "user", content: texts["prose-5000"] }] } },
	{ name: "pos:system-prose-5000", text: texts["prose-5000"] as string, body: { model: MODEL, system: texts["prose-5000"], messages: [{ role: "user", content: "hi" }] } },
	{ name: "pos:assistant-prose-5000", text: texts["prose-5000"] as string, body: { model: MODEL, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: texts["prose-5000"] }, { role: "user", content: "go" }] } },
	{ name: "pos:system-array-2-blocks", text: texts["prose-5000"] as string, body: { model: MODEL, system: [{ type: "text", text: (texts["prose-5000"] as string).slice(0, 2500) }, { type: "text", text: (texts["prose-5000"] as string).slice(2500) }], messages: [{ role: "user", content: "hi" }] } },
	{ name: "ovh:empty-content", text: "", body: { model: MODEL, messages: [{ role: "user", content: [] }] } },
	{ name: "ovh:three-empty", text: "", body: { model: MODEL, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] } },
];

const extraText: Record<string, string> = { "disc:random-prose-20000": randProse, "disc:hex-20000": hex, "disc:japanese-4000": jp, "disc:emoji-4000": emoji, "disc:mixed-20000": mixed };
writeFileSync("/tmp/m3probe/texts-disc.json", JSON.stringify(extraText));

async function call(url: string, body: unknown): Promise<{ status: number; body: string; ms: number }> {
	const started = performance.now();
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, body: text.slice(0, 400), ms: Math.round(performance.now() - started) };
}

const results = [];
for (const s of shapes) {
	const res = await call(URL, s.body);
	results.push({ name: s.name, chars: s.text.length, status: res.status, body: res.body, ms: res.ms });
	console.log(s.name, s.text.length, res.status, res.body);
}

// Remaining 500 candidates: odd shapes and a very large body.
const candidates: Array<{ name: string; body: unknown }> = [
	{ name: "500c:image-in-tool-result", body: { model: MODEL, messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==" } }] }] }] } },
	{ name: "500c:unknown-block-type", body: { model: MODEL, messages: [{ role: "user", content: [{ type: "wat", text: "x" }] }] } },
	{ name: "500c:system-in-messages", body: { model: MODEL, messages: [{ role: "system", content: "you are terse" }, { role: "user", content: "hi" }] } },
	{ name: "500c:200k-text", body: { model: MODEL, messages: [{ role: "user", content: (texts["prose-20000"] as string).repeat(10) }] } },
	{ name: "500c:thinking-signature-long", body: { model: MODEL, messages: [{ role: "user", content: "q" }, { role: "assistant", content: [{ type: "thinking", thinking: "step", signature: "A".repeat(1000) }, { type: "text", text: "a" }] }] } },
];
for (const c of candidates) {
	const res = await call(URL, c.body);
	results.push({ name: c.name, chars: JSON.stringify(c.body).length, status: res.status, body: res.body, ms: res.ms });
	console.log(c.name, res.status, res.body);
}
writeFileSync("/tmp/m3probe/disc-results.json", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
