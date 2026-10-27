import { describe, expect, test } from "bun:test";
import { toGeminiSchema } from "../../../src/families/google/schema.ts";

describe("families/google/schema", () => {
	test("sanitizes nested unions while preserving property names and required fields", () => {
		const schema = {
			$schema: "schema",
			type: "object",
			additionalProperties: false,
			properties: {
				format: { type: "string", format: "uri", const: "fixed" },
				choice: {
					anyOf: [
						{
							type: "object",
							additionalProperties: false,
							properties: {
								value: {
									anyOf: [
										{ type: "string", $ref: "bad" },
										{ type: "integer", const: 3 },
									],
								},
							},
							required: ["value"],
						},
						{ type: "string", format: "date-time" },
					],
				},
			},
			required: ["format", "choice", "missing"],
		};
		expect(toGeminiSchema(schema)).toEqual({
			type: "OBJECT",
			properties: {
				format: { type: "STRING", enum: ["fixed"] },
				choice: {
					anyOf: [
						{
							type: "OBJECT",
							properties: {
								value: {
									anyOf: [{ type: "STRING" }, { type: "INTEGER", description: "Must be 3." }],
								},
							},
							required: ["value"],
						},
						{ type: "STRING" },
					],
				},
			},
			required: ["format", "choice"],
		});
		expect(schema.properties.format.format).toBe("uri");
	});

	test("GPT numeric constraints become description hints at every depth", () => {
		expect(
			toGeminiSchema(
				{
					type: "array",
					minItems: 1,
					items: {
						type: "integer",
						minimum: 2,
						exclusiveMaximum: 9,
						multipleOf: 2,
						description: "Count",
					},
				},
				{ moveNumericConstraintsToDescription: true },
			),
		).toEqual({
			type: "ARRAY",
			items: {
				type: "INTEGER",
				description: "Count minimum: 2, exclusiveMaximum: 9, multipleOf: 2",
			},
			description: "minItems: 1",
		});
	});

	test("preserves numeric bounds, translates exclusive integer bounds and fills array items", () => {
		expect(
			toGeminiSchema({
				type: "integer",
				exclusiveMinimum: 1.5,
				minimum: 0,
				exclusiveMaximum: 10,
				maximum: 12,
			}),
		).toEqual({ type: "INTEGER", minimum: 2, maximum: 9 });
		expect(toGeminiSchema({ type: "array" })).toEqual({ type: "ARRAY", items: { type: "STRING" } });
	});

	test("merges object intersections and translates oneOf and non-string enums", () => {
		expect(
			toGeminiSchema({
				allOf: [
					{ type: "object", properties: { a: { type: "string" } }, required: ["a"] },
					{
						type: "object",
						properties: {
							b: {
								type: "array",
								items: { oneOf: [{ type: "string" }, { type: "number", enum: [1, 2] }] },
							},
						},
						required: ["b"],
					},
				],
			}),
		).toEqual({
			type: "OBJECT",
			properties: {
				a: { type: "STRING" },
				b: {
					type: "ARRAY",
					items: {
						anyOf: [{ type: "STRING" }, { type: "NUMBER", description: "Allowed values: 1, 2." }],
					},
				},
			},
			required: ["a", "b"],
			description: "",
		});
	});
});
