/** Pi transcript and tool conversion to the Antigravity Google wire format. */
// Behaviour ported from pi-ai 1.4.0 api/google-shared.js and utils/sanitize-unicode.js (MIT).
import {
	collapseSystemMessages,
	type ImageContent,
	type Model,
	type TextContent,
	type Tool,
	type TranscriptContext,
	withoutInitialSystemMessage,
} from "@earendil-works/pi-ai";
import { getGeminiMajorVersion, requiresToolCallId } from "./parts.ts";
import { transformMessages } from "./transform.ts";

interface InlineData {
	mimeType: string;
	data: string;
}
interface Part {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	inlineData?: InlineData;
	functionCall?: { name: string; args: Record<string, unknown>; id?: string };
	functionResponse?: {
		name: string;
		response: { error: string } | { output: string };
		parts?: Part[];
		id?: string;
	};
}
interface Content {
	role: "user" | "model";
	parts: Part[];
}

function sanitizeSurrogates(text: string): string {
	return text.replace(
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
		"",
	);
}

const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;
function isValidThoughtSignature(signature: string | undefined): boolean {
	if (!signature) return false;
	if (signature.length % 4 !== 0) return false;
	return base64SignaturePattern.test(signature);
}
function resolveThoughtSignature(
	isSameProviderAndModel: boolean,
	signature: string | undefined,
): string | undefined {
	return isSameProviderAndModel && isValidThoughtSignature(signature) ? signature : undefined;
}
function supportsMultimodalFunctionResponse(modelId: string): boolean {
	const geminiMajorVersion = getGeminiMajorVersion(modelId);
	if (geminiMajorVersion !== undefined) {
		return geminiMajorVersion >= 3;
	}
	return true;
}
/** Convert a transcript, preserving valid same-model signatures and repairing tool turns. */
export function convertMessages(
	model: Model<"google-generative-ai">,
	context: TranscriptContext,
): Content[] {
	const conversation = withoutInitialSystemMessage(collapseSystemMessages(context).messages);
	const contents: Content[] = [];
	const normalizeToolCallId = (id: string): string => {
		if (!requiresToolCallId(model.id)) return id;
		return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
	};
	const transformedMessages = transformMessages(conversation, model, normalizeToolCallId);
	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				contents.push({
					role: "user",
					parts: [{ text: sanitizeSurrogates(msg.content) }],
				});
			} else {
				const parts: Part[] = msg.content.map((item) => {
					if (item.type === "text") {
						return { text: sanitizeSurrogates(item.text) };
					} else {
						return {
							inlineData: {
								mimeType: item.mimeType,
								data: item.data,
							},
						};
					}
				});
				if (parts.length === 0) continue;
				contents.push({
					role: "user",
					parts,
				});
			}
		} else if (msg.role === "assistant") {
			const parts: Part[] = [];
			const isSameProviderAndModel = msg.provider === model.provider && msg.model === model.id;
			for (const block of msg.content) {
				if (block.type === "text") {
					const thoughtSignature = resolveThoughtSignature(
						isSameProviderAndModel,
						block.textSignature,
					);
					if ((!block.text || block.text.trim() === "") && !thoughtSignature) continue;
					parts.push({
						text: sanitizeSurrogates(block.text),
						...(thoughtSignature && { thoughtSignature }),
					});
				} else if (block.type === "thinking") {
					if (isSameProviderAndModel) {
						const thoughtSignature = resolveThoughtSignature(
							isSameProviderAndModel,
							block.thinkingSignature,
						);
						if ((!block.thinking || block.thinking.trim() === "") && !thoughtSignature) continue;
						parts.push({
							thought: true,
							text: sanitizeSurrogates(block.thinking),
							...(thoughtSignature && { thoughtSignature }),
						});
					} else {
						if (!block.thinking || block.thinking.trim() === "") continue;
						parts.push({
							text: sanitizeSurrogates(block.thinking),
						});
					}
				} else if (block.type === "toolCall") {
					const thoughtSignature = resolveThoughtSignature(
						isSameProviderAndModel,
						block.thoughtSignature,
					);
					const part: Part = {
						functionCall: {
							name: block.name,
							args: block.arguments ?? {},
							...(requiresToolCallId(model.id) ? { id: block.id } : {}),
						},
						...(thoughtSignature && { thoughtSignature }),
					};
					parts.push(part);
				}
			}
			if (parts.length === 0) continue;
			contents.push({
				role: "model",
				parts,
			});
		} else if (msg.role === "toolResult") {
			const textContent = msg.content.filter((c): c is TextContent => c.type === "text");
			const textResult = textContent.map((c) => c.text).join("\n");
			const imageContent = model.input.includes("image")
				? msg.content.filter((c): c is ImageContent => c.type === "image")
				: [];
			const hasText = textResult.trim().length > 0;
			const hasImages = imageContent.length > 0;
			const modelSupportsMultimodalFunctionResponse = supportsMultimodalFunctionResponse(model.id);
			const responseValue = hasText
				? sanitizeSurrogates(textResult)
				: hasImages
					? "(see attached image)"
					: "";
			const imageParts: Part[] = imageContent.map((imageBlock) => ({
				inlineData: {
					mimeType: imageBlock.mimeType,
					data: imageBlock.data,
				},
			}));
			const includeId = requiresToolCallId(model.id);
			const functionResponsePart: Part = {
				functionResponse: {
					name: msg.toolName,
					response: msg.isError ? { error: responseValue } : { output: responseValue },
					...(hasImages && modelSupportsMultimodalFunctionResponse && { parts: imageParts }),
					...(includeId ? { id: msg.toolCallId } : {}),
				},
			};
			const lastContent = contents[contents.length - 1];
			if (lastContent?.role === "user" && lastContent.parts?.some((p) => p.functionResponse)) {
				lastContent.parts.push(functionResponsePart);
			} else {
				contents.push({
					role: "user",
					parts: [functionResponsePart],
				});
			}
			if (hasImages && !modelSupportsMultimodalFunctionResponse) {
				contents.push({
					role: "user",
					parts: [{ text: "Tool result image:" }, ...imageParts],
				});
			}
		}
	}
	return contents;
}

/** Convert tools without strict sampling, as required by Cloud Code Assist. */
export function convertTools(
	tools: Tool[],
	_useParameters: false = false,
	_supportsStrictMode: false = false,
) {
	if (tools.length === 0) return undefined;
	return [
		{
			functionDeclarations: tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parametersJsonSchema: tool.parameters,
			})),
		},
	];
}
