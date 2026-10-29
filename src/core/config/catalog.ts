/** The one pi-auth-plus settings catalog; `auth-plus.json` keys are its dotted names. */
import { type ModelAlias, parseAliases } from "../../models/aliases/index.ts";
import { type ModelGroup, parseGroups } from "../../models/groups/config.ts";
import {
	booleanField,
	enumField,
	listField,
	numberField,
	type SettingsStore,
	stringField,
	textRulesField,
} from "./index.ts";

const DEFAULT_LINE_TEMPLATE =
	"{openrouter:id}: {openrouter:credits-remaining} · {deepseek:id}: {deepseek:credits-remaining} · {codex:id}: {codex:window-7d-used-percent}[ ({codex:resets-available}r)] · {claude:id}: 5h/{claude:window-5h-used-percent} 7d/{claude:window-7d-used-percent}[ ({claude:resets-available}r)] · {antigravity:id}: gem/{antigravity:window-7d-gemini-used-percent} arg/{antigravity:window-7d-gemini-4-argon-used-percent} · {synthetic:id}: {synthetic:window-7d-used-percent}[ ({synthetic:resets-available}r)] · {xai:id}: {xai:window-7d-used-percent}[ ({xai:resets-available}r)]";

export const SETTINGS = {
	"dashboard.density": enumField({
		label: "Dashboard density",
		description: "Row spacing in the dashboard; compact uses less vertical space than comfortable",
		default: "comfortable",
		options: [
			{ value: "comfortable", label: "Comfortable" },
			{ value: "compact", label: "Compact" },
		],
	}),
	"dashboard.maxBodyRows": numberField({
		label: "Maximum dashboard body rows",
		description:
			"Maximum additional body rows; 0 automatically fits available space, while primary identity and state remain visible",
		default: 0,
		min: 0,
		max: 60,
		step: 1,
		integer: true,
	}),
	"dashboard.showProvenance": booleanField({
		label: "Show dashboard provenance",
		description:
			"Show the source or provider for dashboard entries; primary identity and state remain visible",
		default: false,
	}),
	"dashboard.showMatchedRule": booleanField({
		label: "Show matched dashboard rule",
		description:
			"Show the model visibility rule matched by dashboard entries; primary identity and state remain visible",
		default: false,
	}),
	"quotas.refreshIntervalSec": numberField({
		label: "Quota refresh interval",
		description: "Seconds between endpoint refreshes; provider polling floors still apply",
		default: 60,
		min: 15,
		max: 3600,
	}),
	"quotas.refreshOnRequest": booleanField({
		label: "Refresh quotas after requests",
		description: "Refresh the active provider's quotas when an agent turn finishes",
		default: true,
	}),
	"quotas.providers": listField({
		label: "Quota providers",
		description: "Provider ids or aliases to refresh; an empty list enables every quota source",
		default: [],
	}),
	"quotas.linePlacement": enumField({
		label: "Quota line placement",
		description: "Where the quota line renders; below-editor-last uses the footer",
		default: "below-editor-first",
		options: [
			{ value: "above-editor", label: "Above editor" },
			{ value: "below-editor-first", label: "Below editor, first" },
			{ value: "below-editor-last", label: "Below editor, last (footer)" },
			{ value: "off", label: "Off" },
		],
	}),
	"quotas.percentDisplay": enumField({
		label: "Quota percent",
		description: "Show used or remaining percentages",
		default: "used",
		options: [
			{ value: "used", label: "Used" },
			{ value: "remaining", label: "Remaining" },
		],
	}),
	"quotas.compactWidthCols": numberField({
		label: "Compact width",
		description: "Below this terminal width the line uses short provider ids",
		default: 100,
		min: 40,
		max: 220,
		step: 5,
	}),
	"quotas.alwaysShortIds": booleanField({
		label: "Always short ids",
		description: "Use short provider ids at every width",
		default: false,
	}),
	"quotas.creditHealthyUsd": numberField({
		label: "Healthy credit (USD)",
		description: "Credit balance at or above this renders as healthy",
		default: 50,
		min: 5,
		max: 500,
		step: 5,
	}),
	"quotas.creditCriticalUsd": numberField({
		label: "Critical credit (USD)",
		description: "Credit balance at or below this renders as critical",
		default: 5,
		min: 0,
		max: 100,
		validateRelation: (critical, lookup) => {
			const healthy = lookup("quotas.creditHealthyUsd");
			return typeof healthy === "number" && critical < healthy
				? undefined
				: {
						keys: ["quotas.creditCriticalUsd", "quotas.creditHealthyUsd"],
						reason: "critical must be strictly less than healthy",
					};
		},
	}),
	"quotas.lineTemplate": stringField({
		label: "Quota line template",
		description: "Template tokens {provider:field}; provider ids and aliases both resolve",
		default: DEFAULT_LINE_TEMPLATE,
	}),
	"models.rules": listField({
		label: "Model visibility rules",
		description: "Ordered provider/model patterns; hide matches and use ! to show them again",
		default: [],
	}),
	"models.rulesScope": enumField({
		label: "Model rules scope",
		description: "Whether trusted project rules can override user rules",
		default: "trusted-project",
		allowedScopes: ["user", "runtime"],
		options: [
			{ value: "user", label: "User" },
			{ value: "trusted-project", label: "User and trusted project" },
		],
	}),
	"models.hiddenDefault": enumField({
		label: "Hidden selected model",
		description: "Warn and keep the selection, or switch to a visible model",
		default: "warn",
		options: [
			{ value: "warn", label: "Warn and keep" },
			{ value: "fallback", label: "Fall back" },
		],
	}),
	"models.aliases": {
		kind: "rules",
		label: "Model aliases",
		description: "Provider, source and alias IDs with optional name and limits",
		default: [] as readonly ModelAlias[],
		parse: parseAliases,
	},
	"models.groups": {
		kind: "rules",
		label: "Model groups",
		description: "Virtual models with prioritized physical members and routing policies",
		default: [] as readonly ModelGroup[],
		parse: parseGroups,
	},
	"openai.verbosity": enumField({
		label: "Response verbosity",
		description: "OpenAI Responses verbosity; default leaves Pi's request unchanged",
		default: "default",
		options: [
			{ value: "default", label: "Pi default" },
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" },
		],
	}),
	"openai.verbosityProviders": listField({
		label: "Verbosity providers",
		description: "Provider IDs for the OpenAI Responses verbosity override",
		default: ["openai", "openai-codex"],
	}),
	"claude.replacePatterns": textRulesField({
		label: "Claude prompt rules",
		description:
			"Literal rules for claude system prompts: rewrite match to replacement, or drop paragraphs containing match",
		default: [],
	}),
	"synthetic.webSearch": booleanField({
		label: "Synthetic web search",
		description:
			"Offer the synthetic_web_search tool; it needs a Synthetic login or SYNTHETIC_API_KEY",
		default: false,
	}),
	"tokens.warningPercent": numberField({
		label: "Token warning threshold",
		description:
			"Token usage at or above this percentage is colored warning; it must stay below the error threshold",
		default: 70,
		min: 0,
		max: 100,
		step: 5,
		integer: true,
		validateRelation: (warning, lookup) => {
			const error = lookup("tokens.errorPercent");
			return typeof error === "number" && warning < error
				? undefined
				: {
						keys: ["tokens.warningPercent", "tokens.errorPercent"],
						reason: "warning must be strictly less than error",
					};
		},
	}),
	"tokens.errorPercent": numberField({
		label: "Token error threshold",
		description: "Token usage at or above this percentage is colored error",
		default: 90,
		min: 0,
		max: 100,
		step: 5,
		integer: true,
	}),
} as const;

export type AppSettings = SettingsStore<typeof SETTINGS>;
