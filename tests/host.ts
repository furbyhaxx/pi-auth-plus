/** A family host whose settings come only from defaults and the runtime layer. */
import { join } from "node:path";
import { SETTINGS } from "../src/core/config/catalog.ts";
import { type Changes, SettingsStore } from "../src/core/config/index.ts";
import type { FamilyHost } from "../src/core/registry/index.ts";

export async function testHost(runtime: Changes<typeof SETTINGS> = {}): Promise<FamilyHost> {
	const settings = new SettingsStore(SETTINGS, {
		user: join(process.env["PI_CODING_AGENT_DIR"] ?? "", "none.json"),
	});
	await settings.save("runtime", runtime);
	return { settings: () => settings };
}
