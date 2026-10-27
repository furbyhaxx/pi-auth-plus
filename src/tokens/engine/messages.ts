/** Model-visible message segments and persisted-usage anchor selection. */
import type { SessionEntry, SessionProjection } from "@earendil-works/pi-coding-agent";
import { textKind } from "../estimate/index.ts";
import type { TextKind, TokenCount, ToolSchema } from "../types.ts";

type Message = SessionProjection["messages"][number];

/** One independently memoizable text segment or a labelled image estimate. */
export type Segment =
	| { readonly text: string; readonly kind: TextKind }
	| { readonly image: TokenCount };

// Pi budgets 4800 characters per image at four characters per token.
const IMAGE: Segment = { image: { tokens: 1200, source: "estimate" } };

function text(text: string, kind: TextKind = "prose"): Segment {
	return { text, kind };
}

/** Extracts the text sent by Pi's convertToLlm, without importing its runtime. */
export function messageSegments(message: Message): readonly Segment[] {
	switch (message.role) {
		case "bashExecution": {
			if (message.excludeFromContext) return [];
			let rendered = `Ran \`${message.command}\`\n`;
			rendered += message.output ? `\`\`\`\n${message.output}\n\`\`\`` : "(no output)";
			if (message.cancelled) rendered += "\n\n(command cancelled)";
			else if (
				message.exitCode !== null &&
				message.exitCode !== undefined &&
				message.exitCode !== 0
			)
				rendered += `\n\nCommand exited with code ${message.exitCode}`;
			if (message.truncated && message.fullOutputPath)
				rendered += `\n\n[Output truncated. Full output: ${message.fullOutputPath}]`;
			return [text(rendered)];
		}
		case "branchSummary":
			return [
				text(
					`The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${message.summary}</summary>`,
				),
			];
		case "compactionSummary":
			return [
				text(
					`The conversation history before this point was compacted into the following summary:\n\n<summary>\n${message.summary}\n</summary>`,
				),
			];
		default: {
			const segments: Segment[] = [];
			const content =
				typeof message.content === "string"
					? [{ type: "text" as const, text: message.content }]
					: message.content;
			for (const block of content) {
				switch (block.type) {
					case "text":
						segments.push(
							text(block.text, message.role === "toolResult" ? textKind(block.text) : "prose"),
						);
						break;
					case "thinking":
						segments.push(text(block.thinking));
						break;
					case "toolCall":
						segments.push(text(block.name, "json"), text(JSON.stringify(block.arguments), "json"));
						break;
					case "image":
						segments.push(IMAGE);
						break;
				}
			}
			if (message.role === "system") {
				for (const section of Object.values(message.sections ?? {})) {
					if (section) segments.push(text(section));
				}
				if (message.toolsAdded) segments.push(text(JSON.stringify(message.toolsAdded), "json"));
			}
			return segments;
		}
	}
}

/** The prompt segments and tools the transcript's system messages currently declare. */
export interface SystemState {
	readonly segments: readonly Segment[];
	readonly tools: readonly ToolSchema[];
	readonly messages: number;
}

/** Replays system messages like Pi's getCurrentSystemMessage; undefined when the transcript has none. */
export function currentSystem(messages: readonly Message[]): SystemState | undefined {
	const content: Segment[] = [];
	const sections = new Map<string, string>();
	const tools = new Map<string, ToolSchema>();
	let count = 0;
	for (const message of messages) {
		if (message.role !== "system") continue;
		count++;
		const blocks =
			typeof message.content === "string"
				? [{ type: "text" as const, text: message.content }]
				: (message.content ?? []);
		for (const block of blocks) if (block.text) content.push(text(block.text));
		for (const [name, value] of Object.entries(message.sections ?? {})) {
			if (value === null) sections.delete(name);
			else sections.set(name, value);
		}
		for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
		for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
	}
	if (count === 0) return undefined;
	return {
		segments: [...content, ...[...sections.values()].filter(Boolean).map((value) => text(value))],
		tools: [...tools.values()],
		messages: count,
	};
}

/** Finds Pi's last valid usage, excluding usage invalidated by a later context edit or compaction. */
export function usageAnchor(
	projection: SessionProjection,
	branch: readonly SessionEntry[],
): { readonly index: number; readonly tokens: number } | undefined {
	let invalidatingIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry?.type === "compaction" || entry?.type === "context_edit") {
			invalidatingIndex = i;
			break;
		}
	}
	for (let index = projection.messages.length - 1; index >= 0; index--) {
		const message = projection.messages[index];
		if (
			message?.role !== "assistant" ||
			message.stopReason === "aborted" ||
			message.stopReason === "error"
		)
			continue;
		const usage = message.usage;
		if (!usage) continue;
		const tokens =
			usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		if (!(tokens > 0)) continue;
		let offset = 0;
		let sourceId: string | undefined;
		for (const entry of projection.entries) {
			offset += entry.messages.length;
			if (index < offset) {
				sourceId = entry.sourceEntry.id;
				break;
			}
		}
		const sourceIndex = sourceId ? branch.findIndex((entry) => entry.id === sourceId) : -1;
		return sourceIndex > invalidatingIndex ? { index, tokens } : undefined;
	}
	return undefined;
}
