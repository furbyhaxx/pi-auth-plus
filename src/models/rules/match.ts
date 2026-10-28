/** Compiled model visibility rules and their ordered evaluation. */

export interface CompiledModelRule {
	readonly pattern: RegExp;
	readonly hidden: boolean;
	readonly ruleIndex: number;
}

export function compileModelRules(patterns: readonly string[]): readonly CompiledModelRule[] {
	const rules: CompiledModelRule[] = [];
	for (const [ruleIndex, input] of patterns.entries()) {
		const trimmed = input.trim();
		const hidden = !trimmed.startsWith("!");
		const pattern = (hidden ? trimmed : trimmed.slice(1)).trim();
		if (!pattern) continue;

		const providerWide = /^[^/*]+\/\*$/.test(pattern);
		let expression = "";
		for (let i = 0; i < pattern.length; i++) {
			const char = pattern.charAt(i);
			if (char === "*") {
				if (pattern.charAt(i + 1) === "*") {
					expression += "[\\s\\S]*";
					i++;
				} else {
					expression += providerWide ? "[\\s\\S]*" : "[^/]*";
				}
			} else {
				expression += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
			}
		}
		rules.push({ pattern: new RegExp(`^${expression}(?![\\s\\S])`), hidden, ruleIndex });
	}
	return rules;
}

export function evaluateModelRules(
	rules: readonly CompiledModelRule[],
	provider: string,
	modelId: string,
): { hidden: boolean; ruleIndex: number | undefined } {
	const fullId = `${provider}/${modelId}`;
	for (let i = rules.length - 1; i >= 0; i--) {
		const rule = rules[i];
		if (rule?.pattern.test(fullId)) return { hidden: rule.hidden, ruleIndex: rule.ruleIndex };
	}
	return { hidden: false, ruleIndex: undefined };
}
