/** Preserves Google tool-call signatures across OpenAI-compatible streams. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Fragment = { id?: string; signature?: string; ambiguous: boolean };
type Capture = { calls: Map<number, Fragment> };

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function gemini(model: string): boolean {
	return /(?:^|[/:_-])gemini(?:$|[/:_.-])/i.test(model);
}

function key(provider: string, model: string, id: string): string {
	return JSON.stringify([provider, model, id]);
}

export function registerCompatibleThoughtSignatures(pi: ExtensionAPI): void {
	const captures = new Map<string, Capture>();
	pi.on("session_start", () => captures.clear());
	pi.on("session_before_switch", () => captures.clear());
	pi.on("session_shutdown", () => captures.clear());

	pi.on("provider_stream_event", (event) => {
		if (
			event.api !== "openai-completions" ||
			!gemini(event.model) ||
			event.provider.length > 4096 ||
			event.model.length > 4096
		)
			return;
		const data = object(event.data);
		if (!data || typeof data["id"] !== "string" || !data["id"] || data["id"].length > 4096) return;
		const choices = data["choices"];
		const choice = Array.isArray(choices) ? object(choices[0]) : undefined;
		const delta = object(choice?.["delta"]);
		const calls = delta?.["tool_calls"];
		if (!Array.isArray(calls)) return;
		const captureKey = key(event.provider, event.model, data["id"]);
		let capture = captures.get(captureKey);
		if (!capture) {
			if (captures.size >= 32) {
				const oldest = captures.keys().next().value;
				if (oldest !== undefined) captures.delete(oldest);
			}
			capture = { calls: new Map() };
			captures.set(captureKey, capture);
		}
		for (const raw of calls) {
			const call = object(raw);
			const index = call?.["index"];
			if (!call || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) continue;
			let fragment = capture.calls.get(index);
			if (!fragment) {
				if (capture.calls.size >= 64) continue;
				fragment = { ambiguous: false };
				capture.calls.set(index, fragment);
			}
			const id = call["id"];
			const extra = object(call["extra_content"]);
			const google = object(extra?.["google"]);
			const signature = google?.["thought_signature"];
			if (typeof id === "string" && id) {
				if (id.length > 4096) fragment.ambiguous = true;
				else if (fragment.id && fragment.id !== id) fragment.ambiguous = true;
				else fragment.id = id;
			}
			if (typeof signature === "string" && signature) {
				if (signature.length > 65536) fragment.ambiguous = true;
				else if (fragment.signature && fragment.signature !== signature) fragment.ambiguous = true;
				else fragment.signature = signature;
			}
		}
	});

	pi.on("message_end", ({ message }) => {
		if (message.role !== "assistant" || message.api !== "openai-completions" || !message.responseId)
			return;
		const captureKey = key(message.provider, message.model, message.responseId);
		const capture = captures.get(captureKey);
		if (!capture) return;
		captures.delete(captureKey);
		const signatures = new Map<string, string | undefined>();
		for (const fragment of capture.calls.values()) {
			if (!fragment.id) continue;
			if (signatures.has(fragment.id)) signatures.set(fragment.id, undefined);
			else signatures.set(fragment.id, fragment.ambiguous ? undefined : fragment.signature);
		}
		const counts = new Map<string, number>();
		for (const block of message.content) {
			if (block.type === "toolCall") counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
		}
		let changed = false;
		const content = message.content.map((block) => {
			if (
				block.type !== "toolCall" ||
				block.thoughtSignature !== undefined ||
				counts.get(block.id) !== 1
			)
				return block;
			const signature = signatures.get(block.id);
			if (!signature) return block;
			changed = true;
			return { ...block, thoughtSignature: signature };
		});
		if (changed) return { message: { ...message, content } };
		return undefined;
	});

	pi.on("before_provider_request", ({ payload }, ctx) => {
		const model = ctx.model;
		const request = object(payload);
		if (
			model?.api !== "openai-completions" ||
			!gemini(model.id) ||
			request?.["model"] !== model.id ||
			!Array.isArray(request["messages"])
		)
			return;
		const signatures = new Map<string, string | undefined>();
		for (const message of ctx.sessionManager.buildSessionProjection().messages) {
			if (message.role !== "assistant") continue;
			for (const block of message.content) {
				if (block.type !== "toolCall") continue;
				// Pi also stores OpenRouter reasoning_details as JSON in this field.
				const signature =
					message.api === model.api &&
					message.provider === model.provider &&
					message.model === model.id &&
					typeof block.thoughtSignature === "string" &&
					block.thoughtSignature &&
					!/^(?:\s*\[|\s*\{)/.test(block.thoughtSignature)
						? block.thoughtSignature
						: undefined;
				if (signatures.has(block.id)) signatures.set(block.id, undefined);
				else signatures.set(block.id, signature);
			}
		}
		const counts = new Map<string, number>();
		for (const raw of request["messages"]) {
			const message = object(raw);
			if (message?.["role"] !== "assistant" || !Array.isArray(message["tool_calls"])) continue;
			for (const rawCall of message["tool_calls"]) {
				const id = object(rawCall)?.["id"];
				if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
			}
		}
		let changed = false;
		const messages = request["messages"].map((raw) => {
			const message = object(raw);
			if (message?.["role"] !== "assistant" || !Array.isArray(message["tool_calls"])) return raw;
			let messageChanged = false;
			const calls = message["tool_calls"].map((rawCall) => {
				const call = object(rawCall);
				const id = call?.["id"];
				if (!call || typeof id !== "string" || counts.get(id) !== 1) return rawCall;
				const signature = signatures.get(id);
				if (!signature) return rawCall;
				const extra = call["extra_content"] === undefined ? {} : object(call["extra_content"]);
				if (!extra) return rawCall;
				const google = extra["google"] === undefined ? {} : object(extra["google"]);
				if (!google || "thought_signature" in google) return rawCall;
				changed = true;
				messageChanged = true;
				return {
					...call,
					extra_content: { ...extra, google: { ...google, thought_signature: signature } },
				};
			});
			return messageChanged ? { ...message, tool_calls: calls } : raw;
		});
		if (changed) return { ...request, messages };
		return undefined;
	});
}
