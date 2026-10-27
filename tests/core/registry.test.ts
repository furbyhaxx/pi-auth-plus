import { describe, expect, test } from "bun:test";
import { type FamilyAdapter, Registry, RegistryError } from "../../src/core/registry/index.ts";

const anthropic: FamilyAdapter = {
	id: "anthropic",
	label: "Anthropic",
	providers: [{ id: "claude", label: "Claude", aliases: ["Claude-Code", "cc"] }],
};
const google: FamilyAdapter = {
	id: "google",
	label: "Google",
	providers: [{ id: "antigravity", label: "Antigravity", aliases: ["ag"] }],
};

function thrownKey(families: FamilyAdapter[]): string | undefined {
	try {
		new Registry(families);
	} catch (error) {
		if (error instanceof RegistryError) return error.key;
		throw error;
	}
	return undefined;
}

describe("core/registry", () => {
	test("resolves ids and aliases case-insensitively; byId takes exact ids only", () => {
		const registry = new Registry([anthropic, google]);
		expect(registry.resolve(" CC ")?.provider.id).toBe("claude");
		expect(registry.resolve("claude-code")?.family.id).toBe("anthropic");
		expect(registry.resolve("AG")?.provider.id).toBe("antigravity");
		expect(registry.resolve("google")).toBeUndefined();
		expect(registry.byId("cc")).toBeUndefined();
		expect(registry.names()).toEqual(["claude", "antigravity", "claude-code", "cc", "ag"]);
	});

	test("refuses a provider id, alias or family claimed twice, and malformed ids", () => {
		const aliasClash: FamilyAdapter = {
			id: "openai",
			label: "OpenAI",
			providers: [{ id: "codex", label: "Codex", aliases: ["CC"] }],
		};
		const idClash: FamilyAdapter = {
			...aliasClash,
			providers: [{ id: "ag", label: "x", aliases: [] }],
		};
		expect(thrownKey([anthropic, aliasClash])).toBe("cc");
		expect(thrownKey([google, idClash])).toBe("ag");
		expect(thrownKey([anthropic, { ...google, id: "anthropic" }])).toBe("anthropic");
		expect(thrownKey([{ ...google, providers: [{ id: "Bad Id", label: "x", aliases: [] }] }])).toBe(
			"Bad Id",
		);
	});
});
