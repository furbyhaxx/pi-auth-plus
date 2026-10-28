import type { AppSettings } from "../../core/config/catalog.ts";

/** Effective rules cannot be enabled by a project when the user restricted their scope. */
export function effectiveModelRules(settings: AppSettings): readonly string[] {
	const includeProject =
		settings.get("models.rulesScope", { includeProject: false }) === "trusted-project";
	return settings.get("models.rules", { includeProject });
}
