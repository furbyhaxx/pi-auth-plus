/** Derives Claude Code's billing system block from the first user message. */
import { createHash } from "node:crypto";

const SALT = "59cf53e54c78";
const SAMPLE_POSITIONS = [4, 7, 20];

function digest(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function firstText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	for (const block of content) {
		if (block !== null && typeof block === "object" && block.type === "text") {
			return typeof block.text === "string" ? block.text : "";
		}
	}
	return "";
}

/** Returns no billing block without a user message; a user without text hashes the empty string. */
export function billingBlock(messages: unknown, version: string): string | undefined {
	if (!Array.isArray(messages)) return undefined;
	const user: unknown = messages.find(
		(message: unknown) =>
			typeof message === "object" &&
			message !== null &&
			"role" in message &&
			message.role === "user",
	);
	if (typeof user !== "object" || user === null) return undefined;
	const text = firstText("content" in user ? user.content : undefined);
	// Indexing samples UTF-16 code units, including lone surrogates, rather than code points.
	const sample = SAMPLE_POSITIONS.map((position) => text[position] ?? "0").join("");
	const suffix = digest(`${SALT}${sample}${version}`).slice(0, 3);
	return `x-anthropic-billing-header: cc_version=${version}.${suffix}; cc_entrypoint=cli;`;
}
