/** Google stream part classification, signatures and terminal reasons. */
// Behaviour ported from pi-ai 1.4.0 api/google-shared.js (MIT).
import type { StopReason } from "@earendil-works/pi-ai";

/** Signatures alone do not mark a part as thinking. */
export function isThinkingPart(part: { thought?: unknown; thoughtSignature?: unknown }): boolean {
	return part.thought === true;
}

/** Preserve the last non-empty signature within one streamed block. */
export function retainThoughtSignature(
	existing: string | undefined,
	incoming: string | undefined,
): string | undefined {
	return typeof incoming === "string" && incoming.length > 0 ? incoming : existing;
}

/** Return the Gemini major version, including live model IDs. */
export function getGeminiMajorVersion(modelId: string): number | undefined {
	const match = modelId.toLowerCase().match(/^gemini(?:-live)?-(\d+)/);
	return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

/** Identify models whose function calls and responses need explicit IDs. */
export function requiresToolCallId(modelId: string): boolean {
	const version = getGeminiMajorVersion(modelId);
	return (
		modelId.startsWith("claude-") ||
		modelId.startsWith("gpt-oss-") ||
		(version !== undefined && version >= 3)
	);
}

/** Map raw finish reasons, treating unknown reasons as errors. */
export function mapStopReasonString(reason: string): StopReason {
	switch (reason) {
		case "STOP":
			return "stop";
		case "MAX_TOKENS":
			return "length";
		default:
			return "error";
	}
}
