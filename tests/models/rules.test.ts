import { describe, expect, test } from "bun:test";
import {
	compileModelRules,
	evaluateModelRules,
	exactModelRule,
} from "../../src/models/rules/match.ts";

describe("model visibility rules", () => {
	test("applies the approved rule list to flat and nested model ids", () => {
		const rules = compileModelRules([
			"opencode/*",
			"!opencode/deepseek-free",
			"antigravity/*claude*",
			"openrouter/*",
			"!openrouter/stealth*",
			"!openrouter/google/*argon*",
		]);
		expect(evaluateModelRules(rules, "opencode", "other")).toEqual({ hidden: true, ruleIndex: 0 });
		expect(evaluateModelRules(rules, "opencode", "deepseek-free")).toEqual({
			hidden: false,
			ruleIndex: 1,
		});
		expect(evaluateModelRules(rules, "antigravity", "a-claude-b")).toEqual({
			hidden: true,
			ruleIndex: 2,
		});
		expect(evaluateModelRules(rules, "openrouter", "anthropic/model")).toEqual({
			hidden: true,
			ruleIndex: 3,
		});
		expect(evaluateModelRules(rules, "openrouter", "stealth-model")).toEqual({
			hidden: false,
			ruleIndex: 4,
		});
		expect(evaluateModelRules(rules, "openrouter", "google/a-argon-b")).toEqual({
			hidden: false,
			ruleIndex: 5,
		});
		expect(evaluateModelRules(rules, "other", "google/a-argon-b")).toEqual({
			hidden: false,
			ruleIndex: undefined,
		});
	});

	test("matches the last rule and retains original indices after ignored lines", () => {
		const rules = compileModelRules([
			"  ",
			" ! ",
			" provider/* ",
			"!provider/model",
			"provider/model",
		]);
		expect(evaluateModelRules(rules, "provider", "model")).toEqual({ hidden: true, ruleIndex: 4 });
		expect(evaluateModelRules(rules, "provider", "other")).toEqual({ hidden: true, ruleIndex: 2 });
		expect(evaluateModelRules(rules, "other", "model")).toEqual({
			hidden: false,
			ruleIndex: undefined,
		});
	});

	test("limits single stars to a segment and lets double stars cross slashes", () => {
		const single = compileModelRules(["provider/a*", "!provider/a*/b*"]);
		expect(evaluateModelRules(single, "provider", "abc")).toEqual({ hidden: true, ruleIndex: 0 });
		expect(evaluateModelRules(single, "provider", "a/b/c")).toEqual({
			hidden: false,
			ruleIndex: undefined,
		});
		const double = compileModelRules(["provider/a**z"]);
		expect(evaluateModelRules(double, "provider", "a/b/cz")).toEqual({
			hidden: true,
			ruleIndex: 0,
		});
		expect(evaluateModelRules(double, "provider", "az")).toEqual({ hidden: true, ruleIndex: 0 });
	});

	test("treats regex metacharacters literally and matches case sensitively", () => {
		const rules = compileModelRules(["provider/a.+?^{}$()|[x]\\end"]);
		expect(evaluateModelRules(rules, "provider", "a.+?^{}$()|[x]\\end")).toEqual({
			hidden: true,
			ruleIndex: 0,
		});
		expect(evaluateModelRules(rules, "provider", "A.+?^{}$()|[x]\\end")).toEqual({
			hidden: false,
			ruleIndex: undefined,
		});
		expect(evaluateModelRules(rules, "provider", "aZZend")).toEqual({
			hidden: false,
			ruleIndex: undefined,
		});
	});

	test("ignores disabled rules and matches escaped wildcard characters literally", () => {
		const rules = compileModelRules(["provider/*", "#provider/*", "#!provider/one"]);
		expect(rules).toHaveLength(1);
		const exact = compileModelRules([exactModelRule("#provider", "star*\\id")]);
		expect(evaluateModelRules(exact, "#provider", "star*\\id").hidden).toBe(true);
		expect(evaluateModelRules(exact, "#provider", "star-other-id").hidden).toBe(false);
	});

	test("a re-show affects only its own pattern", () => {
		const rules = compileModelRules(["provider/*", "!provider/one", "provider/two"]);
		expect(evaluateModelRules(rules, "provider", "one")).toEqual({ hidden: false, ruleIndex: 1 });
		expect(evaluateModelRules(rules, "provider", "two")).toEqual({ hidden: true, ruleIndex: 2 });
	});
});
