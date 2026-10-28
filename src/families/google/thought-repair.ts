/** Repair missing Google thought signatures in a request payload. */

const dummySignature = "skip_thought_signature_validator";

type RecordValue = Record<string, unknown>;
type Repair = { payload: unknown; repaired: number };

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSignature(value: unknown): boolean {
	return value !== undefined && value !== null && value !== "";
}

function isNativeUserInput(value: unknown): boolean {
	if (!isRecord(value) || value["role"] !== "user" || !Array.isArray(value["parts"])) return false;
	return value["parts"].some((part: unknown) => {
		if (
			!isRecord(part) ||
			"functionResponse" in part ||
			"function_response" in part ||
			"functionCall" in part ||
			"function_call" in part
		)
			return false;
		return Object.keys(part).some(
			(key) => !["thought", "thoughtSignature", "thought_signature"].includes(key),
		);
	});
}

function repairNative(
	contents: unknown[],
	end: number,
	history: boolean,
): { contents: unknown[]; repaired: number } | undefined {
	const lastUser = history
		? contents.slice(0, end).findIndex(isNativeUserInput)
		: contents.slice(0, end).findLastIndex(isNativeUserInput);
	if (lastUser < 0) return undefined;
	let repaired = 0;
	const result = contents.map((content: unknown, index: number) => {
		if (
			index <= lastUser ||
			index >= end ||
			!isRecord(content) ||
			content["role"] !== "model" ||
			!Array.isArray(content["parts"])
		)
			return content;
		const parts: unknown[] = content["parts"];
		const firstCall = parts.findIndex((part) => isRecord(part) && "functionCall" in part);
		if (firstCall < 0) return content;
		const call = parts[firstCall];
		if (
			!isRecord(call) ||
			!isRecord(call["functionCall"]) ||
			hasSignature(call["thoughtSignature"]) ||
			hasSignature(call["thought_signature"])
		)
			return content;
		repaired++;
		return {
			...content,
			parts: parts.map((part, i) =>
				i === firstCall ? { ...call, thoughtSignature: dummySignature } : part,
			),
		};
	});
	return repaired ? { contents: result, repaired } : undefined;
}

function isChatUserInput(value: unknown): boolean {
	if (!isRecord(value) || value["role"] !== "user") return false;
	const content = value["content"];
	if (typeof content === "string") return content.length > 0;
	return (
		Array.isArray(content) &&
		content.some(
			(part: unknown) =>
				isRecord(part) &&
				typeof part["type"] === "string" &&
				!["tool_result", "function_response"].includes(part["type"]),
		)
	);
}

function hasEncryptedSignature(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.some(
			(detail: unknown) =>
				isRecord(detail) &&
				detail["type"] === "reasoning.encrypted" &&
				detail["format"] === "google-gemini-v1" &&
				typeof detail["data"] === "string" &&
				detail["data"].length > 0,
		)
	);
}

function repairChat(
	messages: unknown[],
	end: number,
	history: boolean,
): { messages: unknown[]; repaired: number } | undefined {
	const lastUser = history
		? messages.slice(0, end).findIndex(isChatUserInput)
		: messages.slice(0, end).findLastIndex(isChatUserInput);
	if (lastUser < 0) return undefined;
	let repaired = 0;
	const result = messages.map((message: unknown, index: number) => {
		if (
			index <= lastUser ||
			index >= end ||
			!isRecord(message) ||
			(message["role"] !== "assistant" && message["role"] !== "model") ||
			!Array.isArray(message["tool_calls"]) ||
			hasEncryptedSignature(message["reasoning_details"])
		)
			return message;
		const calls: unknown[] = message["tool_calls"];
		const call = calls[0];
		if (!isRecord(call)) return message;
		const extra = call["extra_content"];
		if (extra !== undefined && !isRecord(extra)) return message;
		const google = extra?.["google"];
		if (google !== undefined && !isRecord(google)) return message;
		if (hasSignature(google?.["thought_signature"])) return message;
		repaired++;
		const patched = {
			...call,
			extra_content: { ...extra, google: { ...google, thought_signature: dummySignature } },
		};
		return { ...message, tool_calls: calls.map((item, i) => (i === 0 ? patched : item)) };
	});
	return repaired ? { messages: result, repaired } : undefined;
}

/** Repair eligible calls in the latest turn or the requested history prefix. */
export function repairThoughtSignaturePayload(
	payload: unknown,
	options: { readonly prefixLength?: number; readonly history?: boolean } = {},
): Repair | undefined {
	let parsed: unknown = payload;
	if (typeof payload === "string") {
		try {
			parsed = JSON.parse(payload);
		} catch {
			return undefined;
		}
	}
	if (!isRecord(parsed)) return undefined;
	let result: Repair | undefined;
	if (Array.isArray(parsed["contents"])) {
		const repaired = repairNative(
			parsed["contents"],
			options.prefixLength ?? parsed["contents"].length,
			options.history ?? false,
		);
		if (repaired)
			result = { payload: { ...parsed, contents: repaired.contents }, repaired: repaired.repaired };
	} else if (isRecord(parsed["request"]) && Array.isArray(parsed["request"]["contents"])) {
		const request = parsed["request"];
		const contents = request["contents"];
		if (!Array.isArray(contents)) return undefined;
		const repaired = repairNative(
			contents,
			options.prefixLength ?? contents.length,
			options.history ?? false,
		);
		if (repaired)
			result = {
				payload: { ...parsed, request: { ...request, contents: repaired.contents } },
				repaired: repaired.repaired,
			};
	} else if (Array.isArray(parsed["messages"])) {
		const repaired = repairChat(
			parsed["messages"],
			options.prefixLength ?? parsed["messages"].length,
			options.history ?? false,
		);
		if (repaired)
			result = { payload: { ...parsed, messages: repaired.messages }, repaired: repaired.repaired };
	}
	if (!result) return undefined;
	return typeof payload === "string"
		? { ...result, payload: JSON.stringify(result.payload) }
		: result;
}
