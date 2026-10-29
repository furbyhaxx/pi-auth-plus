/** Owns memoized quota templates and preferred-break rendering from cached snapshots. */
import type { ThemeStyle } from "@earendil-works/pi-coding-agent";
import type { QuotaView } from "../engine.ts";
import type { ProviderQuotaSnapshot, QuotaWindow } from "../types.ts";
import { gradientColor, type LineTheme } from "./format.ts";
import {
	type CompiledTemplate,
	parseTemplate,
	type TemplateField,
	type TemplatePart,
	type TokenStyle,
} from "./template-parser.ts";
import type { LineConfig } from "./values.ts";
import { clamp01, creditStress, formatPercent, formatResetCountdown, plainText } from "./values.ts";

export {
	type CompiledTemplate,
	TEMPLATE_FIELDS,
	type TemplateField,
	type TemplatePart,
} from "./template-parser.ts";

const caches = new WeakMap<(token: string) => string | undefined, Map<string, CompiledTemplate>>();
/** Compiles a template with a resolver-scoped, bounded cache. */
export function compileLineTemplate(
	source: string,
	resolve: (token: string) => string | undefined,
): CompiledTemplate {
	let cache = caches.get(resolve);
	if (!cache) {
		cache = new Map();
		caches.set(resolve, cache);
	}
	const hit = cache.get(source);
	if (hit) return hit;
	const compiled = parseTemplate(source, resolve);
	if (cache.size >= 16) cache.clear();
	cache.set(source, compiled);
	return compiled;
}
/** Selects marked windows, falling back to the first two as in pi-quotas. */
export function selectImportantWindows(snapshot: ProviderQuotaSnapshot): QuotaWindow[] {
	const important = snapshot.windows.filter((window) => window.important);
	return important.length ? important : snapshot.windows.slice(0, 2);
}
function normalize(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}
function scope(value: string | undefined): string {
	const normalized = normalize(value ?? "");
	if (normalized === "gemini-models") return "gemini";
	if (normalized === "gemini-argon-wtu" || normalized === "gemini-4-argon") return "gemini-4-argon";
	return normalized;
}
function namedWindow(snapshot: ProviderQuotaSnapshot, key: string): QuotaWindow | undefined {
	const dash = key.indexOf("-");
	const period = dash < 0 ? key : key.slice(0, dash);
	const requestedScope = dash < 0 ? "" : key.slice(dash + 1);
	const matches = snapshot.windows.filter((window) => {
		if (window.period !== undefined)
			return normalize(window.period) === period && scope(window.scope) === requestedScope;
		const legacy =
			key === "7d-gemini"
				? "gemini-weekly"
				: key === "7d-gemini-4-argon"
					? "gemini-argon-wtu-weekly"
					: undefined;
		return (
			(normalize(window.id) === key ||
				normalize(window.shortLabel) === key ||
				window.id === legacy) &&
			(!window.scope || scope(window.scope) === requestedScope)
		);
	});
	if (matches.length === 1) return matches[0];
	// Sessions on older parsers share the cache and may add an unscoped sibling (claude `7d_oi`).
	const exact = matches.filter((window) => normalize(window.id) === key);
	return exact.length === 1 ? exact[0] : undefined;
}
function concreteStyle(theme: LineTheme, style: TokenStyle | undefined): ThemeStyle {
	if (!style) return {};
	const { fg, bg, ...attrs } = style;
	return {
		...attrs,
		...(fg ? { fg: typeof fg === "string" ? theme.colors[fg] : fg } : {}),
		...(bg ? { bg: typeof bg === "string" ? theme.colors[bg] : bg } : {}),
	};
}
interface Value {
	text: string;
	available: boolean;
}
function providerFields(
	theme: LineTheme,
	view: QuotaView,
	alias: string,
	fields: readonly TemplateField[],
	config: LineConfig,
	now: number,
	shortIds: boolean,
	inUse: boolean,
	style?: TokenStyle,
): Value {
	const { provider, snapshot, backoff } = view;
	const meta = { label: provider.label, shortLabel: provider.quota?.shortLabel ?? provider.id };
	const failedEmpty = Boolean(
		(snapshot?.error || (backoff && backoff.until > now)) &&
			!snapshot?.credits &&
			!snapshot?.windows.length,
	);
	const custom = concreteStyle(theme, style);
	const paint = (text: string, defaults: ThemeStyle = { fg: theme.colors.muted }) =>
		theme.style(plainText(text), { ...defaults, ...custom });
	const stress = (text: string, used: number | undefined) =>
		used === undefined
			? paint(text)
			: paint(text, { fg: gradientColor(theme, used), bold: used >= 0.85 });
	const missing = (): Value => ({
		text: paint(snapshot?.needsAuth ? "login" : failedEmpty ? "err" : snapshot ? "?" : "…"),
		available: false,
	});
	const primary = snapshot ? selectImportantWindows(snapshot)[0] : undefined;
	const value = (field: TemplateField): Value => {
		if (field === "in-use") return { text: "", available: inUse };
		if (field === "id" || field === "name" || field === "short")
			return {
				text: paint(
					field === "name" ? meta.label : field === "short" || shortIds ? meta.shortLabel : alias,
				),
				available: true,
			};
		if (!snapshot || snapshot.needsAuth || failedEmpty)
			return field === "resets-available" || field === "r"
				? { text: "", available: false }
				: missing();
		let text: string | undefined;
		if (field.startsWith("window-")) {
			const match = /^window-(.+)-(used|remaining)-percent$/.exec(field);
			const window = match ? namedWindow(snapshot, match[1] ?? "") : undefined;
			if (window?.usedFraction !== undefined)
				text = stress(
					`${Math.round((match?.[2] === "remaining" ? 1 - clamp01(window.usedFraction) : clamp01(window.usedFraction)) * 100)}%`,
					window.usedFraction,
				);
		} else
			switch (field) {
				case "tier":
					if (snapshot.tier) text = paint(snapshot.tier);
					break;
				case "credits":
				case "credits-remaining":
					if (snapshot.credits?.remaining !== undefined)
						text = stress(
							`${snapshot.credits.remaining.toFixed(2)}${snapshot.credits.currency}`,
							creditStress(snapshot.credits.remaining, config),
						);
					break;
				case "resets-available":
				case "r": {
					const count = snapshot.resetCredits;
					if (count !== undefined && count > 0)
						text = paint(field === "r" ? `(r ${count})` : `${Math.trunc(count)}`, {
							fg: theme.colors.accent,
						});
					else return { text: "", available: false };
					break;
				}
				case "pct":
					if (primary)
						text = stress(formatPercent(primary.usedFraction, config), primary.usedFraction);
					break;
				case "wins":
					if (snapshot.windows.length)
						text = selectImportantWindows(snapshot)
							.map((window) =>
								shortIds
									? stress(formatPercent(window.usedFraction, config), window.usedFraction)
									: `${paint(window.shortLabel)} ${stress(formatPercent(window.usedFraction, config), window.usedFraction)}`,
							)
							.join(shortIds ? "/" : " ");
					break;
				case "rst": {
					const countdown = formatResetCountdown(primary?.resetAtMs, now);
					if (countdown) text = paint(`↻ ${countdown}`);
					break;
				}
				case "bar":
					if (primary?.usedFraction !== undefined) {
						const used = clamp01(primary.usedFraction);
						const filled = Math.round(used * 6);
						text =
							paint("▕") +
							Array.from({ length: 6 }, (_, index) =>
								index < filled
									? stress("█", clamp01((index / 5) * 0.45 + used * 0.55))
									: paint("░"),
							).join("") +
							paint("▏");
					}
					break;
			}
		return text === undefined ? missing() : { text, available: true };
	};
	const values = fields.map(value);
	const identityCount = fields.filter(
		(field) => field === "id" || field === "name" || field === "short",
	).length;
	const identities = values
		.filter(
			(_, index) => fields[index] === "id" || fields[index] === "name" || fields[index] === "short",
		)
		.map((item) => item.text)
		.filter(Boolean);
	const other = values
		.filter(
			(_, index) => fields[index] !== "id" && fields[index] !== "name" && fields[index] !== "short",
		)
		.map((item) => item.text)
		.filter(Boolean);
	const text =
		identityCount && other.length
			? `${identities.join(" ")}${paint(": ")}${other.join(" ")}`
			: values
					.map((item) => item.text)
					.filter(Boolean)
					.join(" ");
	return { text, available: values.every((item) => item.available) };
}
/** Returns preferred-break segments; row packing and separator styling belong to the caller. */
export function renderLineTemplate(
	theme: LineTheme,
	compiled: CompiledTemplate,
	views: readonly QuotaView[],
	config: LineConfig,
	now: number,
	shortIds: boolean,
	inUse?: readonly string[],
): string[] {
	const enabled = new Map(views.map((view) => [view.provider.id, view]));
	const active = new Set(inUse?.map((id) => compiled.resolve(id.trim().toLowerCase())));
	const relevant = (view: QuotaView): boolean =>
		active.has(view.provider.id) ||
		(view.snapshot?.windows.some((window) => (window.usedFraction ?? -1) >= 0.9) ?? false) ||
		(view.snapshot?.credits?.remaining !== undefined &&
			creditStress(view.snapshot.credits.remaining, config) >= 0.9);
	const remainder = views.filter((view) => !compiled.explicit.has(view.provider.id));
	function render(parts: readonly TemplatePart[]): { segments: string[]; available: boolean } {
		const segments = [""];
		let available = true;
		const append = (text: string) => {
			segments[segments.length - 1] = (segments.at(-1) ?? "") + text;
		};
		const auto = (view: QuotaView, short: boolean, style?: TokenStyle): Value => {
			const { provider, snapshot } = view;
			const fields: TemplateField[] = [short ? "short" : "name"];
			if (provider.quota?.kind === "credits") fields.push("credits");
			else {
				fields.push(snapshot?.windows.length === 1 ? "pct" : "wins");
				if (snapshot?.resetCredits && snapshot.resetCredits > 0) fields.push("r");
			}
			return providerFields(
				theme,
				view,
				provider.id,
				fields,
				config,
				now,
				short,
				relevant(view),
				style,
			);
		};
		for (const part of parts) {
			switch (part.kind) {
				case "text":
					append(theme.fg("dim", part.text));
					break;
				case "sep":
					segments.push("");
					break;
				case "group": {
					const child = render(part.parts);
					if (child.available) {
						append(child.segments[0] ?? "");
						segments.push(...child.segments.slice(1));
					}
					break;
				}
				case "provider": {
					const view = enabled.get(part.id);
					if (!view) {
						available = false;
						break;
					}
					const result = part.fields
						? providerFields(
								theme,
								view,
								part.alias,
								part.fields,
								config,
								now,
								shortIds,
								relevant(view),
								part.style,
							)
						: auto(view, shortIds, part.style);
					append(result.text);
					available &&= result.available;
					break;
				}
				case "all":
				case "in-use": {
					const selected = part.kind === "all" ? remainder : remainder.filter(relevant);
					selected.forEach((view, index) => {
						if (index > 0) segments.push("");
						const result = auto(view, shortIds || part.short);
						append(result.text);
						available &&= result.available;
					});
					const omitted = remainder.length - selected.length;
					if (part.kind === "in-use" && omitted > 0) {
						if (selected.length) segments.push("");
						append(theme.fg("dim", `+${omitted}`));
					}
					break;
				}
			}
		}
		return { segments, available };
	}
	return render(compiled.parts).segments.filter(Boolean);
}
