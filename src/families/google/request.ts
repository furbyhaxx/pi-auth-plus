/** Antigravity request envelopes, transcript shaping and per-session trajectory metadata. */
import { randomUUID } from "node:crypto";
import {
	getCurrentSystemPrompt,
	getCurrentTools,
	type Model,
	normalizeContext,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { convertMessages, convertTools } from "./convert.ts";
import { thinkingConfig, type WireLevel } from "./levels.ts";
import { toGeminiSchema } from "./schema.ts";

const ENVELOPE_USER_AGENT = "antigravity";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 256;

interface Session {
	conversation: string;
	trajectory: string;
	accessed: number;
	timestamp: number;
	usedClaude: boolean;
	usedNonGemini: boolean;
}

/** Injectable identity and time sources for request metadata. */
export interface RequestSessionOptions {
	readonly now?: () => number;
	readonly uuid?: () => string;
}

/** Metadata labels ordered like the captured CLI payload. */
export interface RequestLabels {
	cascade_id: string;
	last_step_index: string;
	model_enum: string;
	request_id: string;
	root_cascade_id: string;
	trajectory_id: string;
	used_claude: string;
	used_claude_conservative: string;
	used_non_gemini_model: string;
}

/** Own one store per provider; keys are Pi session ids or first-message timestamps. */
export class RequestSessions {
	private readonly entries = new Map<string, Session>();
	private readonly now: () => number;
	private readonly uuid: () => string;

	constructor(options: RequestSessionOptions = {}) {
		this.now = options.now ?? Date.now;
		this.uuid = options.uuid ?? randomUUID;
	}

	/** Begin one logical request before transport retries choose credentials. */
	begin(key: string, model: string, modelEnum: string, step: number) {
		const now = this.now();
		for (const [entryKey, entry] of this.entries) {
			if (entryKey !== key && now - entry.accessed > SESSION_TTL_MS) this.entries.delete(entryKey);
		}
		let session = this.entries.get(key);
		if (!session) {
			if (this.entries.size >= MAX_SESSIONS) {
				let oldestKey: string | undefined;
				let oldestTime = Infinity;
				for (const [entryKey, entry] of this.entries) {
					if (entry.accessed < oldestTime) {
						oldestKey = entryKey;
						oldestTime = entry.accessed;
					}
				}
				if (oldestKey !== undefined) this.entries.delete(oldestKey);
			}
			session = {
				conversation: this.uuid(),
				trajectory: this.uuid(),
				accessed: now,
				timestamp: 0,
				usedClaude: false,
				usedNonGemini: false,
			};
			this.entries.set(key, session);
		}
		session.accessed = now;
		session.timestamp = Math.max(now, session.timestamp + 1);
		session.usedClaude ||= model.startsWith("claude-");
		session.usedNonGemini ||= model.startsWith("claude-") || model.startsWith("gpt-");
		const requestId = `agent/${session.conversation}/${session.timestamp}/${session.trajectory}/${step + 1}`;
		const labels: RequestLabels = {
			cascade_id: session.conversation,
			last_step_index: String(step),
			model_enum: modelEnum,
			request_id: requestId,
			root_cascade_id: session.conversation,
			trajectory_id: session.trajectory,
			used_claude: String(session.usedClaude),
			used_claude_conservative: String(session.usedClaude),
			used_non_gemini_model: String(session.usedNonGemini),
		};
		// FNV-1a signed 64-bit hash of the fork's empty workspace URI.
		return { requestId, labels, sessionId: "-3750763034362895579" };
	}
}

/** The fallback avoids sharing all sessions through the leading system timestamp (0). */
export function requestSessionKey(
	context: TranscriptContext,
	options: SimpleStreamOptions,
): string {
	const first = context.messages.find((message) => message.role !== "system");
	return options.sessionId || (first ? `message:${first.timestamp}` : "__default__");
}

function claudeContext(
	context: TranscriptContext,
	model: Model<"google-generative-ai">,
): TranscriptContext {
	const latestAssistant = context.messages.findLastIndex((message) => message.role === "assistant");
	const latest = context.messages[latestAssistant];
	const open =
		latest?.role === "assistant" &&
		latest.content.some((block) => block.type === "toolCall") &&
		!context.messages.slice(latestAssistant + 1).some((message) => message.role === "user");
	return normalizeContext({
		messages: context.messages.map((message, index) => {
			if (message.role !== "assistant") return message;
			const preserve =
				open &&
				index === latestAssistant &&
				message.provider === model.provider &&
				message.model === model.id;
			// 08-integration-notes §3 is unverified; Anthropic tool loops require the latest signed thinking.
			if (preserve)
				return {
					...message,
					content: message.content.filter(
						(block) => block.type !== "thinking" || Boolean(block.thinkingSignature),
					),
				};
			return {
				...message,
				content: message.content
					.filter((block) => block.type !== "thinking")
					.map((block) => {
						if (block.type === "text") {
							const { textSignature: _signature, ...text } = block;
							return text;
						}
						if (block.type === "toolCall") {
							const { thoughtSignature: _signature, ...call } = block;
							return call;
						}
						return block;
					}),
			};
		}),
	});
}

function validatedToolConfig(model: string, hasTools: boolean) {
	return hasTools && !model.startsWith("gemini-4-argon")
		? { functionCallingConfig: { mode: "VALIDATED" } }
		: undefined;
}

/** Inputs for one logical request; build once and reuse the body for transport retries. */
export interface BuildRequestOptions {
	readonly model: Model<"google-generative-ai">;
	readonly context: TranscriptContext;
	readonly options: SimpleStreamOptions;
	readonly level: WireLevel;
	readonly project: string;
	readonly sessions: RequestSessions;
}

/** Build the ordered Cloud Code envelope without credential or network work. */
export function buildRequest({
	model,
	context,
	options,
	level,
	project,
	sessions,
}: BuildRequestOptions) {
	const source = model.id.startsWith("claude-") ? claudeContext(context, model) : context;
	const contents = convertMessages(model, source);
	const system = getCurrentSystemPrompt(source.messages);
	const converted = convertTools(getCurrentTools(source.messages), false, false);
	const tools = converted?.map((tool) => ({
		functionDeclarations: tool.functionDeclarations.map((declaration) => {
			const { parametersJsonSchema, ...rest } = declaration;
			return {
				...rest,
				parameters: toGeminiSchema(parametersJsonSchema, {
					moveNumericConstraintsToDescription: model.id.startsWith("gpt-oss-"),
				}),
			};
		}),
	}));
	const toolConfig = validatedToolConfig(model.id, Boolean(tools?.length));
	const metadata = sessions.begin(
		requestSessionKey(context, options),
		model.id,
		level.modelEnum,
		// Native agy CLI 1.3.5 native-argon-low capture: text = 0, tool continuation = 2.
		contents.length - 1,
	);
	const request = {
		contents,
		...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
		...(tools ? { tools } : {}),
		...(toolConfig ? { toolConfig } : {}),
		labels: metadata.labels,
		generationConfig: {
			maxOutputTokens: options.maxTokens ?? model.maxTokens,
			thinkingConfig: thinkingConfig(level.thinking),
		},
		sessionId: metadata.sessionId,
	};
	return {
		body: {
			project,
			requestId: metadata.requestId,
			request,
			model: level.id,
			userAgent: ENVELOPE_USER_AGENT,
			requestType: "agent",
		},
		requestId: metadata.requestId,
	};
}
