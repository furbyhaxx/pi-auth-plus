/** Typed setting field descriptors; each field parses its own raw JSON value. */

/** A literal text rule: rewrite `match` to `replacement`, or drop what contains `match` without one. */
export interface TextRule {
	readonly match: string;
	readonly replacement?: string;
}

export type FieldValue = boolean | number | string | readonly string[] | readonly TextRule[];
export type FieldKind = "boolean" | "number" | "enum" | "string" | "list" | "rules";

export interface FieldOption<V extends string = string> {
	readonly value: V;
	readonly label: string;
}

export interface Field<T extends FieldValue> {
	readonly kind: FieldKind;
	readonly label: string;
	readonly description: string;
	readonly default: T;
	readonly options?: readonly FieldOption[];
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	/** The value, or undefined when `raw` is not valid for this field. */
	parse(raw: unknown): T | undefined;
}

interface Meta<T> {
	readonly label: string;
	readonly description: string;
	readonly default: T;
}

export function booleanField(meta: Meta<boolean>): Field<boolean> {
	return {
		kind: "boolean",
		...meta,
		parse: (raw) => (typeof raw === "boolean" ? raw : undefined),
	};
}

export function numberField(
	meta: Meta<number> & {
		readonly min: number;
		readonly max: number;
		readonly step?: number;
		readonly integer?: boolean;
	},
): Field<number> {
	const { integer = true, ...rest } = meta;
	return {
		kind: "number",
		...rest,
		parse: (raw) => {
			if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
			const value = integer ? Math.round(raw) : raw;
			return Math.min(meta.max, Math.max(meta.min, value));
		},
	};
}

export function enumField<const V extends string>(
	meta: Meta<V> & { readonly options: readonly FieldOption<V>[] },
): Field<V> {
	return {
		kind: "enum",
		...meta,
		parse: (raw) => meta.options.find((option) => option.value === raw)?.value,
	};
}

export function stringField(meta: Meta<string> & { readonly allowEmpty?: boolean }): Field<string> {
	const { allowEmpty = false, ...rest } = meta;
	return {
		kind: "string",
		...rest,
		parse: (raw) =>
			typeof raw === "string" && (allowEmpty || raw.trim() !== "") ? raw : undefined,
	};
}

/** A string list; also accepts a comma or whitespace separated string, as users hand-edit it. */
export function listField(meta: Meta<readonly string[]>): Field<readonly string[]> {
	return {
		kind: "list",
		...meta,
		parse: (raw) => {
			if (typeof raw === "string") return raw.split(/[,\s]+/).filter((item) => item !== "");
			if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) return undefined;
			return raw;
		},
	};
}

function textRule(raw: unknown): TextRule | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
	const { match, replacement } = raw as { match?: unknown; replacement?: unknown };
	if (typeof match !== "string" || match.trim() === "") return undefined;
	if (replacement === undefined) return { match };
	return typeof replacement === "string" ? { match, replacement } : undefined;
}

/** A list of literal text rules; one malformed entry rejects the list so the warning names it. */
export function textRulesField(meta: Meta<readonly TextRule[]>): Field<readonly TextRule[]> {
	return {
		kind: "rules",
		...meta,
		parse: (raw) => {
			if (!Array.isArray(raw)) return undefined;
			const rules: TextRule[] = [];
			for (const entry of raw) {
				const rule = textRule(entry);
				if (!rule) return undefined;
				rules.push(rule);
			}
			return rules;
		},
	};
}
