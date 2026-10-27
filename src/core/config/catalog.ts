/** The one pi-auth-plus settings catalog; `auth-plus.json` keys are its dotted names. */
import {
	booleanField,
	listField,
	numberField,
	type SettingsStore,
	textRulesField,
} from "./index.ts";

export const SETTINGS = {
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
} as const;

export type AppSettings = SettingsStore<typeof SETTINGS>;
