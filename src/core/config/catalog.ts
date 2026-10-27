/** The one pi-auth-plus settings catalog; `auth-plus.json` keys are its dotted names. */
import { booleanField, type SettingsStore } from "./index.ts";

export const SETTINGS = {
	"synthetic.webSearch": booleanField({
		label: "Synthetic web search",
		description:
			"Offer the synthetic_web_search tool; it needs a Synthetic login or SYNTHETIC_API_KEY",
		default: false,
	}),
} as const;

export type AppSettings = SettingsStore<typeof SETTINGS>;
