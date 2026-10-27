/** Cloud Code's protobuf Schema allowlist and GPT bridge constraint adaptation. */

const ALLOWED = new Set([
	"type",
	"properties",
	"items",
	"required",
	"description",
	"pattern",
	"title",
	"nullable",
	"propertyOrdering",
	"example",
	"default",
	"enum",
	"anyOf",
	"minimum",
	"maximum",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"minProperties",
	"maxProperties",
]);
const NUMERIC = new Set([
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"minProperties",
	"maxProperties",
]);

/** The GPT bridge cannot carry protobuf numeric constraints as JSON Schema numbers. */
export interface GeminiSchemaOptions {
	readonly moveNumericConstraintsToDescription?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function intersection(schema: Record<string, unknown>, hints: string[]): Record<string, unknown> {
	const branches = schema["allOf"];
	if (!Array.isArray(branches)) return schema;
	const { allOf: _allOf, ...base } = schema;
	const properties: Record<string, unknown> = {};
	const required = new Set<string>();
	const descriptions: string[] = [];
	const metadata: Record<string, unknown> = {};
	for (const branch of [base, ...branches]) {
		if (
			!isObject(branch) ||
			(branch["type"] !== undefined && String(branch["type"]).toLowerCase() !== "object")
		) {
			hints.push("allOf: using the first branch; other intersection constraints omitted.");
			return { ...base, ...(isObject(branches[0]) ? branches[0] : {}) };
		}
		if (isObject(branch["properties"])) {
			for (const [name, value] of Object.entries(branch["properties"])) {
				if (
					Object.hasOwn(properties, name) &&
					JSON.stringify(properties[name]) !== JSON.stringify(value)
				) {
					hints.push("allOf: using the first branch; conflicting constraints omitted.");
					return { ...base, ...(isObject(branches[0]) ? branches[0] : {}) };
				}
				properties[name] = value;
			}
		}
		if (Array.isArray(branch["required"])) {
			for (const name of branch["required"]) if (typeof name === "string") required.add(name);
		}
		if (typeof branch["description"] === "string") descriptions.push(branch["description"]);
		for (const [key, value] of Object.entries(branch)) {
			if (!["properties", "required", "description"].includes(key) && !Object.hasOwn(metadata, key))
				metadata[key] = value;
		}
	}
	return {
		...metadata,
		type: "object",
		properties,
		required: [...required],
		description: descriptions.join(" "),
	};
}

/** Remove unsupported schema keywords recursively without changing property names. */
export function toGeminiSchema(jsonSchema: unknown, opts: GeminiSchemaOptions = {}): unknown {
	if (!isObject(jsonSchema)) return jsonSchema;
	const hints: string[] = [];
	const schema = intersection(jsonSchema, hints);
	const result: Record<string, unknown> = {};
	const type = typeof schema["type"] === "string" ? schema["type"].toUpperCase() : undefined;
	for (const [key, value] of Object.entries(schema)) {
		if (type && key === "items" && type !== "ARRAY") continue;
		if (type && type !== "OBJECT" && ["properties", "required", "propertyOrdering"].includes(key))
			continue;
		if (key === "const") {
			if (typeof value === "string") result["enum"] = [value];
			else hints.push(`Must be ${JSON.stringify(value)}.`);
			continue;
		}
		if (NUMERIC.has(key)) {
			const exclusive = key === "exclusiveMinimum" || key === "exclusiveMaximum";
			if (
				exclusive &&
				!opts.moveNumericConstraintsToDescription &&
				type === "INTEGER" &&
				typeof value === "number" &&
				Number.isFinite(value)
			) {
				const lower = key === "exclusiveMinimum";
				const bound = lower ? Math.floor(value) + 1 : Math.ceil(value) - 1;
				const target = lower ? "minimum" : "maximum";
				const existing = schema[target];
				if (Number.isSafeInteger(bound)) {
					result[target] =
						typeof existing === "number"
							? lower
								? Math.max(existing, bound)
								: Math.min(existing, bound)
							: bound;
					continue;
				}
			}
			if (opts.moveNumericConstraintsToDescription || exclusive || key === "multipleOf") {
				if (["string", "number", "boolean"].includes(typeof value)) hints.push(`${key}: ${value}`);
				continue;
			}
		}
		if (key === "oneOf" && Array.isArray(value)) {
			if (!Array.isArray(schema["anyOf"]))
				result["anyOf"] = value.map((branch) => toGeminiSchema(branch, opts));
			else hints.push("oneOf: additional union constraints omitted.");
			continue;
		}
		if (!ALLOWED.has(key)) continue;
		if (key === "type" && type) result[key] = type;
		else if (key === "properties" && isObject(value)) {
			result[key] = Object.fromEntries(
				Object.entries(value).map(([name, property]) => [name, toGeminiSchema(property, opts)]),
			);
		} else if (key === "items") result[key] = toGeminiSchema(value, opts);
		else if (key === "anyOf" && Array.isArray(value))
			result[key] = value.map((branch) => toGeminiSchema(branch, opts));
		else if (key === "enum" && Array.isArray(value)) {
			if (value.every((item) => typeof item === "string")) {
				if (typeof schema["const"] !== "string") result[key] = value;
			} else hints.push(`Allowed values: ${value.map((item) => JSON.stringify(item)).join(", ")}.`);
		} else if (key === "required" && Array.isArray(value)) {
			const properties = schema["properties"];
			const required = value.filter(
				(name) =>
					typeof name === "string" && (!isObject(properties) || Object.hasOwn(properties, name)),
			);
			if (required.length) result[key] = required;
		} else if (
			(key === "minimum" || key === "maximum") &&
			typeof result[key] === "number" &&
			typeof value === "number"
		) {
			result[key] = key === "minimum" ? Math.max(result[key], value) : Math.min(result[key], value);
		} else result[key] = value;
	}
	if (hints.length)
		result["description"] = [result["description"], hints.join(", ")].filter(Boolean).join(" ");
	if (result["type"] === "ARRAY" && !result["items"]) result["items"] = { type: "STRING" };
	return result;
}
