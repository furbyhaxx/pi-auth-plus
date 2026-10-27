// Offline analysis for the M3 usage audit. Reads a session JSONL plus the probe's
// captures and prints, per assistant turn: persisted usage, raw provider usage,
// and Pi's own 4-chars/token estimate (estimateTokens) for the prompt before it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens } from "@earendil-works/pi-coding-agent";

const sessionPath = process.argv[2];
const capsDir = process.argv[3];

type Msg = {
	role: string;
	content: unknown;
	usage?: Record<string, number>;
	stopReason?: string;
	provider?: string;
	model?: string;
	api?: string;
};

const entries = readFileSync(sessionPath, "utf8")
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));
const messages: Msg[] = entries
	.filter((entry) => entry.type === "message")
	.map((entry) => entry.message as Msg);

type Cap = Record<string, unknown>;
const chatReqs: Cap[] = [];
for (const file of readdirSync(capsDir).sort()) {
	if (!file.includes("-req-")) continue;
	const cap = JSON.parse(readFileSync(join(capsDir, file), "utf8")) as Cap;
	cap.__at = Number(file.split("-")[0]);
	let body = cap.requestBody as Record<string, unknown> | undefined;
	if (!body || typeof body !== "object") continue;
	const envelope = body.request as Record<string, unknown> | undefined;
	if (envelope && (envelope.contents || envelope.systemInstruction)) body = envelope;
	if (!("messages" in body) && !("contents" in body) && !("input" in body)) continue;
	chatReqs.push(cap);
}
const msgEnds = readdirSync(capsDir)
	.filter((file) => file.includes("-m-") && file.startsWith("msgend-"))
	.sort()
	.map((file) => JSON.parse(readFileSync(join(capsDir, file), "utf8")) as Cap)
	.filter((cap) => cap.role === "assistant");

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

type CallStatus = number;

type Raw = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number | null;
	reasoning: number;
	startInput?: number;
	deltaInput?: number;
	/** Synthetic's anthropic shim reports cache_creation equal to the miss run; see startInput. */
	cacheWriteDuplicatesInput?: boolean;
	source: string;
	note?: string;
	/** True when input already counts the cached tokens (Google promptTokenCount). */
	inputIncludesCache?: boolean;
};

function sseEvents(body: string): Record<string, unknown>[] {
	const events: Record<string, unknown>[] = [];
	for (const line of body.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const payload = line.slice(6).trim();
		if (!payload || payload === "[DONE]") continue;
		try {
			events.push(JSON.parse(payload) as Record<string, unknown>);
		} catch {}
	}
	return events;
}

function anthropicRaw(body: string): Raw | undefined {
	const events = sseEvents(body);
	const start = events.find((event) => event.type === "message_start") as
		| { message?: { usage?: Record<string, unknown> } }
		| undefined;
	const delta = [...events].reverse().find((event) => event.type === "message_delta") as
		| { usage?: Record<string, unknown> }
		| undefined;
	if (!start && !delta) return undefined;
	const startUsage = start?.message?.usage ?? {};
	const deltaUsage = delta?.usage ?? {};
	const pick = (key: string) => deltaUsage[key] ?? startUsage[key];
	return {
		input: num(pick("input_tokens")),
		output: num(pick("output_tokens")),
		cacheRead: num(pick("cache_read_input_tokens")),
		cacheWrite: num(pick("cache_creation_input_tokens")),
		total: null,
		reasoning: num(
			((deltaUsage.output_tokens_details ?? {}) as Record<string, unknown>).thinking_tokens,
		),
		startInput: num(startUsage.input_tokens),
		deltaInput: num(deltaUsage.input_tokens),
		cacheWriteDuplicatesInput:
			num(deltaUsage.cache_creation_input_tokens) > 0 &&
			num(deltaUsage.cache_creation_input_tokens) === num(deltaUsage.input_tokens),
		source: "anthropic message_start + message_delta usage",
	};
}

function openaiChatRaw(body: string): Raw | undefined {
	const events = sseEvents(body);
	const usage = events.filter((event) => event.usage && typeof event.usage === "object").at(-1)
		?.usage as Record<string, unknown> | undefined;
	if (!usage) return undefined;
	const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
	const completion = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
	return {
		input: num(usage.prompt_tokens),
		output: num(usage.completion_tokens),
		cacheRead: num(details.cached_tokens),
		cacheWrite: num(details.cache_write_tokens),
		total: num(usage.total_tokens),
		reasoning: num(completion.reasoning_tokens),
		source: "openai chat.completions final usage chunk",
		inputIncludesCache: true,
	};
}

function openaiResponsesRaw(body: string): Raw | undefined {
	const events = sseEvents(body);
	const completed = [...events].reverse().find((event) => event.type === "response.completed") as
		| { response?: { usage?: Record<string, unknown> } }
		| undefined;
	const usage = completed?.response?.usage;
	if (!usage) return undefined;
	const details = (usage.input_tokens_details ?? {}) as Record<string, unknown>;
	const outputDetails = (usage.output_tokens_details ?? {}) as Record<string, unknown>;
	return {
		input: num(usage.input_tokens),
		output: num(usage.output_tokens),
		cacheRead: num(details.cached_tokens),
		cacheWrite: num(details.cache_write_tokens),
		total: num(usage.total_tokens),
		reasoning: num(outputDetails.reasoning_tokens),
		source: "openai responses response.completed.usage",
		inputIncludesCache: true,
	};
}

function googleRaw(body: string): Raw | undefined {
	let meta: Record<string, unknown> | undefined;
	let occurrences = 0;
	for (const chunk of sseEvents(body)) {
		const candidate = (chunk.usageMetadata ??
			(chunk.response as Record<string, unknown> | undefined)?.usageMetadata) as
			| Record<string, unknown>
			| undefined;
		if (candidate) {
			meta = candidate;
			occurrences++;
		}
	}
	if (!meta) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: null, reasoning: 0, source: "google usageMetadata absent from every chunk" };
	return {
		input: num(meta.promptTokenCount),
		output: num(meta.candidatesTokenCount) + num(meta.thoughtsTokenCount),
		cacheRead: num(meta.cachedContentTokenCount),
		cacheWrite: 0,
		total: num(meta.totalTokenCount),
		reasoning: num(meta.thoughtsTokenCount),
		source: `google usageMetadata (last of ${occurrences} chunks)`,
		note: "promptTokenCount includes cachedContentTokenCount",
		inputIncludesCache: true,
	};
}

function rawFor(body: string, url: string, status: CallStatus = 200): Raw | undefined {
	if (status !== 200) return undefined;
	if (url.includes("/v1/messages")) return anthropicRaw(body);
	if (url.includes(":streamGenerateContent") || url.includes(":generateContent"))
		return googleRaw(body);
	if (body.includes("response.completed") || url.includes("/v1/responses"))
		return openaiResponsesRaw(body) ?? openaiChatRaw(body);
	if (body.includes("chat.completion")) return openaiChatRaw(body);
	return anthropicRaw(body) ?? googleRaw(body) ?? openaiChatRaw(body) ?? openaiResponsesRaw(body);
}

function expectedUsage(raw: Raw): {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
} {
	if (raw.inputIncludesCache) {
		return {
			input: Math.max(0, raw.input - raw.cacheRead - raw.cacheWrite),
			output: raw.output,
			cacheRead: raw.cacheRead,
			cacheWrite: raw.cacheWrite,
			totalTokens: raw.total ?? raw.input + raw.output,
		};
	}
	const input = raw.cacheWriteDuplicatesInput
		? Math.max(0, raw.input + raw.cacheRead + raw.cacheWrite - raw.input - raw.cacheRead)
		: raw.input;
	return {
		input,
		output: raw.output,
		cacheRead: raw.cacheRead,
		cacheWrite: raw.cacheWrite,
		totalTokens: input + raw.output + raw.cacheRead + raw.cacheWrite,
	};
}

function innerBody(raw: unknown): Record<string, unknown> {
	const body = raw as Record<string, unknown>;
	const envelope = body?.request as Record<string, unknown> | undefined;
	return envelope && (envelope.contents || envelope.systemInstruction) ? envelope : body;
}

function payloadChars(body: Record<string, unknown>): number {
	const system = body.system;
	const systemChars = Array.isArray(system)
		? (system as { text?: string }[]).reduce((sum, block) => sum + (block.text?.length ?? 0), 0)
		: typeof system === "string"
			? system.length
			: typeof body.systemInstruction === "object" && body.systemInstruction
				? JSON.stringify(body.systemInstruction).length
				: 0;
	const toolsChars = body.tools ? JSON.stringify(body.tools).length : 0;
	const messageChars = ((body.messages ?? body.contents ?? body.input ?? []) as unknown[]).reduce(
		(sum, entry) => sum + JSON.stringify(entry).length,
		0,
	);
	return systemChars + toolsChars + messageChars;
}

function contextTokens(usage: Record<string, number>): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function estimateSum(list: Msg[]): number {
	return list.reduce((sum, message) => sum + estimateTokens(message as never), 0);
}

function anchorOf(list: Msg[]): { index: number; usage: Record<string, number> } | undefined {
	for (let i = list.length - 1; i >= 0; i--) {
		const message = list[i];
		if (message.role !== "assistant" || !message.usage) continue;
		if (message.stopReason === "aborted" || message.stopReason === "error") continue;
		if (contextTokens(message.usage) > 0) return { index: i, usage: message.usage };
	}
	return undefined;
}

/** Pi's live number: estimateProjectedContextTokens, i.e. anchor usage + estimated tail. */
function piLive(list: Msg[]): { live: number; whole: number; anchor: number | null; tail: number } {
	const anchor = anchorOf(list);
	const whole = estimateSum(list);
	if (!anchor) return { live: whole, whole, anchor: null, tail: whole };
	const tail = estimateSum(list.slice(anchor.index + 1));
	return { live: contextTokens(anchor.usage) + tail, whole, anchor: contextTokens(anchor.usage), tail };
}

const assistantIndexes = messages
	.map((message, index) => (message.role === "assistant" ? index : -1))
	.filter((index) => index >= 0);

/** A new Pi process means a possibly different system prompt, so tails only count within one. */
const runStart: boolean[] = chatReqs.map((cap, position) => {
	if (position === 0) return true;
	const previous = Number(chatReqs[position - 1].__at ?? 0);
	return Number(cap.__at ?? 0) - previous > 6000;
});

const turns = chatReqs.map((cap, position) => {
	const body = cap.requestBody as Record<string, unknown>;
	const url = String(cap.url);
	const rawBody = typeof cap.responseBody === "string" ? cap.responseBody : "";
	const raw = rawFor(rawBody, url, Number(cap.status));
	const assistantIndex = assistantIndexes[position];
	const prefix = assistantIndex === undefined ? messages : messages.slice(0, assistantIndex);
	const estimate = piLive(prefix);
	const assistant = assistantIndex === undefined ? undefined : messages[assistantIndex];
	const persisted = assistant?.usage ? contextTokens(assistant.usage) : null;
	const realPrompt = raw
		? raw.cacheWriteDuplicatesInput
			? raw.input + raw.cacheRead
			: raw.inputIncludesCache
				? raw.input
				: raw.input + raw.cacheRead + raw.cacheWrite
		: null;
	const tailReal =
		realPrompt !== null && estimate.anchor !== null && !runStart[position]
			? realPrompt - estimate.anchor
			: null;
	const expected = raw ? expectedUsage(raw) : null;
	const mapping = expected && assistant?.usage
		? {
				expected,
				persisted: {
					input: assistant.usage.input,
					output: assistant.usage.output,
					cacheRead: assistant.usage.cacheRead,
					cacheWrite: assistant.usage.cacheWrite,
					totalTokens: assistant.usage.totalTokens,
				},
				matches:
					expected.input === assistant.usage.input &&
					expected.output === assistant.usage.output &&
					expected.totalTokens === assistant.usage.totalTokens,
			}
		: null;
	return {
		position,
		mapping,
		url,
		status: cap.status,
		model: body.model,
		maxTokens: body.max_tokens ?? body.max_output_tokens ?? body.maxOutputTokens,
		chars: payloadChars(innerBody(cap.requestBody)),
		raw,
		persisted: assistant?.usage ?? null,
		persistedTotal: persisted,
		estimate,
		realPrompt,
		tailReal,
		liveErrorPct:
			realPrompt !== null && estimate.live > 0
				? Number((((estimate.live - realPrompt) / realPrompt) * 100).toFixed(1))
				: null,
		wholeErrorPct:
			realPrompt !== null && estimate.whole > 0
				? Number((((estimate.whole - realPrompt) / realPrompt) * 100).toFixed(1))
				: null,
		tailErrorPct:
			tailReal !== null && tailReal > 0
				? Number((((estimate.tail - tailReal) / tailReal) * 100).toFixed(1))
				: estimate.tail === 0 && tailReal === 0
					? 0
					: null,
	};
});

console.log(
	JSON.stringify(
		{
			session: sessionPath,
			messageCount: messages.length,
			persistedAssistant: messages
				.filter((message) => message.role === "assistant")
				.map((message) => ({
					provider: message.provider,
					api: message.api,
					model: message.model,
					stopReason: message.stopReason,
					usage: message.usage,
				})),
			messageEnd: msgEnds.map((cap) => ({
				provider: cap.provider,
				api: cap.api,
				model: cap.model,
				stopReason: cap.stopReason,
				usage: cap.usage,
			})),
			turns,
		},
		null,
		2,
	),
);
