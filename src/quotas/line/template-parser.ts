/** Owns template syntax, optional groups and validated token styles. */
import type { ThemeToken } from "@earendil-works/pi-coding-agent";
import type { Color } from "@earendil-works/pi-tui";
import { hexColor } from "./format.ts";
import { plainText } from "./values.ts";

/** Fixed fields, in addition to named window percentages. */
export const TEMPLATE_FIELDS = [
	"id",
	"name",
	"short",
	"tier",
	"credits",
	"pct",
	"wins",
	"rst",
	"r",
	"bar",
	"credits-remaining",
	"resets-available",
] as const;
/** A provider metric or identity requested by a token. */
export type TemplateField =
	| (typeof TEMPLATE_FIELDS)[number]
	| `window-${string}-used-percent`
	| `window-${string}-remaining-percent`;
/** Validated concrete colors, theme tokens and text attributes. */
export interface TokenStyle {
	fg?: Color | ThemeToken;
	bg?: Color | ThemeToken;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
}
/** A literal, break, optional group or resolved provider token. */
export type TemplatePart =
	| { kind: "text"; text: string }
	| { kind: "sep" }
	| { kind: "group"; parts: readonly TemplatePart[] }
	| { kind: "all"; short: boolean }
	| {
			kind: "provider";
			id: string;
			alias: string;
			fields: readonly TemplateField[] | undefined;
			style?: TokenStyle;
	  };
/** Parsed tokens, explicit Pi ids and ignored malformed syntax. */
export interface CompiledTemplate {
	parts: readonly TemplatePart[];
	explicit: ReadonlySet<string>;
	unknown: readonly string[];
}
const TOKENS: readonly ThemeToken[] = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"scrollbarTrack",
	"scrollbarThumb",
	"selectedBg",
	"searchMatchBg",
	"searchMatchText",
	"userMessageBg",
	"userMessageText",
	"customMessageBg",
	"customMessageText",
	"customMessageLabel",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"bashMode",
];
function parseStyle(source: string): TokenStyle | undefined {
	const style: TokenStyle = {};
	for (const raw of source.split(",")) {
		const entry = raw.trim();
		if (
			entry === "bold" ||
			entry === "italic" ||
			entry === "underline" ||
			entry === "strikethrough"
		) {
			style[entry] = true;
			continue;
		}
		const match = /^(fg|bg)=(.+)$/.exec(entry);
		if (!match) return undefined;
		const value = match[2] ?? "";
		const color = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
			? hexColor(value)
			: TOKENS.find((token) => token === value);
		if (!color) return undefined;
		if (match[1] === "fg") style.fg = color;
		else style.bg = color;
	}
	return style;
}
function isField(value: string): value is TemplateField {
	return (
		TEMPLATE_FIELDS.some((field) => field === value) ||
		/^window-[a-z0-9]+(?:-[a-z0-9]+)*-(?:used|remaining)-percent$/.test(value)
	);
}
function token(
	body: string,
	resolve: (token: string) => string | undefined,
): TemplatePart | undefined {
	const pieces = body.split("|");
	if (pieces.length > 2) return undefined;
	const [base = "", styleSource] = pieces;
	const style = styleSource === undefined ? undefined : parseStyle(styleSource);
	if (styleSource !== undefined && !style) return undefined;
	const args = base.split(":");
	if (args.length > 2) return undefined;
	const alias = (args[0] ?? "").trim().toLowerCase();
	const rawFields = args[1];
	if (alias === "sep")
		return rawFields === undefined && style === undefined ? { kind: "sep" } : undefined;
	if (alias === "all")
		return style === undefined && (rawFields === undefined || rawFields === "short")
			? { kind: "all", short: rawFields === "short" }
			: undefined;
	const id = resolve(alias);
	if (!id) return undefined;
	const fields = rawFields?.split(",").map((field) => field.trim().toLowerCase());
	if (fields && !fields.every(isField)) return undefined;
	return {
		kind: "provider",
		id,
		alias,
		fields: fields?.filter(isField),
		...(style ? { style } : {}),
	};
}
/** Parses the quota grammar, resolving provider names through the supplied registry adapter. */
export function parseTemplate(
	source: string,
	resolve: (token: string) => string | undefined,
): CompiledTemplate {
	const unknown: string[] = [];
	const explicit = new Set<string>();
	let index = 0;
	function parts(nested: boolean, depth: number): TemplatePart[] {
		const result: TemplatePart[] = [];
		const text = (value: string) => {
			const clean = plainText(value);
			const last = result.at(-1);
			if (last?.kind === "text") last.text += clean;
			else if (clean) result.push({ kind: "text", text: clean });
		};
		while (index < source.length) {
			const char = source[index];
			if (char === "\\" && /[[\]{}\\]/.test(source[index + 1] ?? "")) {
				text(source[index + 1] ?? "");
				index += 2;
				continue;
			}
			if (source.startsWith(" · ", index)) {
				result.push({ kind: "sep" });
				index += 3;
				continue;
			}
			if (char === "]") {
				index++;
				if (nested) return result;
				unknown.push("]");
				continue;
			}
			if (char === "[") {
				const start = index++;
				if (depth >= 64) {
					unknown.push(source.slice(start));
					index = source.length;
					break;
				}
				result.push({ kind: "group", parts: parts(true, depth + 1) });
				continue;
			}
			if (char === "{") {
				const start = index++;
				const close = source.indexOf("}", index);
				const open = source.indexOf("{", index);
				if (close < 0 || (open >= 0 && open < close)) {
					const end = open >= 0 ? open : source.length;
					unknown.push(source.slice(start, end));
					index = end;
					continue;
				}
				const parsed = token(source.slice(index, close), resolve);
				index = close + 1;
				if (parsed) {
					result.push(parsed);
					if (parsed.kind === "provider") explicit.add(parsed.id);
				} else unknown.push(source.slice(start, index));
				continue;
			}
			if (char === "}") {
				unknown.push("}");
				index++;
				continue;
			}
			text(char ?? "");
			index++;
		}
		if (nested) unknown.push("[");
		return result;
	}
	return { parts: parts(false, 0), explicit, unknown };
}
