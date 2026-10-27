/** Removes harness fingerprints and supplies the Claude Code system identity. */
import type { TextRule } from "../../core/config/fields.ts";

/** Anthropic's Claude Agent SDK identity, without cache-control metadata. */
export const CLAUDE_CODE_IDENTITY =
	"You are a Claude agent, built on Anthropic's Claude Agent SDK.";

const IDENTITY_PREFIXES = [
	"You are OpenCode",
	"You are an expert coding assistant operating inside",
	"You are operating inside `Pi`",
];
const REMOVAL_ANCHORS = [
	"github.com/anomalyco/opencode",
	"opencode.ai/docs",
	"github.com/opensec-git/Pi-Bolt",
	"earendil-works/pi",
	"pi-coding-agent",
];
const REPLACEMENTS = [
	{ match: "if OpenCode honestly", replacement: "if the assistant honestly" },
	{
		match: "Here is some useful information about the environment you are running in:",
		replacement: "Environment context you are running in:",
	},
];
const PARAGRAPHS = /\n\n+/;

/** A system text block, retaining caller metadata such as cache_control. */
export interface SystemBlock {
	type: string;
	text: string;
	[key: string]: unknown;
}

/** Drops branded paragraphs, then applies built-in and caller literal rewrites in order. */
export function sanitizeSystemText(text: string, rules: readonly TextRule[]): string {
	let result = text
		.split(PARAGRAPHS)
		.filter(
			(paragraph) =>
				!IDENTITY_PREFIXES.some((prefix) => paragraph.includes(prefix)) &&
				!REMOVAL_ANCHORS.some((anchor) => paragraph.includes(anchor)) &&
				!rules.some((rule) => rule.replacement === undefined && paragraph.includes(rule.match)),
		)
		.join("\n\n");
	for (const rule of REPLACEMENTS) {
		result = result.replace(rule.match, () => rule.replacement);
	}
	for (const rule of rules) {
		const replacement = rule.replacement;
		if (replacement !== undefined) result = result.replace(rule.match, () => replacement);
	}
	return result.trim();
}

function systemBlock(value: unknown, rules: readonly TextRule[]): SystemBlock {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const type = "type" in value && typeof value.type === "string" ? value.type : "text";
		const text = "text" in value && typeof value.text === "string" ? value.text : "";
		return { ...value, type, text: sanitizeSystemText(text, rules) };
	}
	return { type: "text", text: sanitizeSystemText(String(value), rules) };
}

/** Normalizes system formats and prepends the identity once, preserving block metadata. */
export function withClaudeCodeIdentity(system: unknown, rules: readonly TextRule[]): SystemBlock[] {
	const identity: SystemBlock = { type: "text", text: CLAUDE_CODE_IDENTITY };
	if (system == null) return [identity];
	if (typeof system !== "string" && typeof system !== "object") return [identity];
	const blocks = Array.isArray(system)
		? system.map((value: unknown) => {
				if (
					typeof value === "string" ||
					(typeof value === "object" &&
						value !== null &&
						"type" in value &&
						value.type === "text" &&
						"text" in value &&
						typeof value.text === "string")
				)
					return systemBlock(value, rules);
				return { type: "text", text: String(value) };
			})
		: [systemBlock(system, rules)];
	if (blocks[0]?.text === CLAUDE_CODE_IDENTITY) return blocks;
	return [identity, ...blocks];
}
