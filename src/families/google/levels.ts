/**
 * One Antigravity thinking level per Pi thinking level. Pi stores each model's
 * `thinkingLevelMap` in `models-store.json`, so the encoded value carries everything a
 * request needs without the live catalog.
 */

export type WireEffort = "LOW" | "MEDIUM" | "HIGH";

/** How a level reaches `generationConfig.thinkingConfig`. */
export type ThinkingSpec =
	| { readonly kind: "level"; readonly level: WireEffort }
	| { readonly kind: "adaptive"; readonly level: WireEffort }
	| { readonly kind: "budget"; readonly budget: number };

/** One catalog entry such as `gemini-4-argon-low`. */
export interface WireLevel {
	/** Catalog id; sent as the envelope `model`. */
	readonly id: string;
	/** Catalog `model` (`MODEL_PLACEHOLDER_M419`); sent as `labels.model_enum`. */
	readonly modelEnum: string;
	readonly thinking: ThinkingSpec;
}

const SEP = "|";
const EFFORTS: readonly string[] = ["LOW", "MEDIUM", "HIGH"];

/** `gemini-4-argon-low|MODEL_PLACEHOLDER_M419|level:LOW`. */
export function encodeLevel(level: WireLevel): string {
	const spec = level.thinking;
	const thinking = spec.kind === "budget" ? `budget:${spec.budget}` : `${spec.kind}:${spec.level}`;
	return [level.id, level.modelEnum, thinking].join(SEP);
}

/** Undefined for anything `encodeLevel` did not produce. */
export function decodeLevel(value: string): WireLevel | undefined {
	const parts = value.split(SEP);
	if (parts.length !== 3) return undefined;
	const [id, modelEnum, thinking] = parts as [string, string, string];
	if (!id || !modelEnum) return undefined;
	const colon = thinking.indexOf(":");
	const kind = thinking.slice(0, colon);
	const arg = thinking.slice(colon + 1);
	if (colon < 0 || !arg) return undefined;
	if (kind === "budget") {
		const budget = Number(arg);
		if (!Number.isInteger(budget) || budget < -1) return undefined;
		return { id, modelEnum, thinking: { kind, budget } };
	}
	if ((kind === "level" || kind === "adaptive") && EFFORTS.includes(arg)) {
		return { id, modelEnum, thinking: { kind, level: arg as WireEffort } };
	}
	return undefined;
}

/** The CLI's `thinkingConfig` for a level; adaptive (Claude) keeps a zero budget. */
export function thinkingConfig(spec: ThinkingSpec): Record<string, unknown> {
	switch (spec.kind) {
		case "level":
			return { includeThoughts: true, thinkingLevel: spec.level };
		case "adaptive":
			return { includeThoughts: true, thinkingBudget: 0, thinkingLevel: spec.level };
		case "budget":
			return { includeThoughts: true, thinkingBudget: spec.budget };
	}
}
