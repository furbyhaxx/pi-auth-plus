import { describe, expect, test } from "bun:test";
import {
	agentDir,
	cacheDir,
	projectSettingsPath,
	stateDir,
	userSettingsPath,
} from "../../src/core/paths/index.ts";

describe("core/paths", () => {
	test("PI_CODING_AGENT_DIR wins and expands a leading tilde against HOME", () => {
		const env = { HOME: "/h", PI_CODING_AGENT_DIR: "~/custom" };
		expect(agentDir(env)).toBe("/h/custom");
		expect(userSettingsPath(env)).toBe("/h/custom/auth-plus.json");
		expect(cacheDir(env)).toBe("/h/custom/cache/auth-plus");
	});

	test("an empty override falls back to HOME/.pi/agent", () => {
		expect(agentDir({ HOME: "/h", PI_CODING_AGENT_DIR: "" })).toBe("/h/.pi/agent");
	});

	test("XDG_STATE_HOME wins over the HOME fallback", () => {
		expect(stateDir({ HOME: "/h", XDG_STATE_HOME: "/x" })).toBe("/x/pi-auth-plus");
		expect(stateDir({ HOME: "/h" })).toBe("/h/.local/state/pi-auth-plus");
	});

	test("project settings resolve from the given cwd", () => {
		expect(projectSettingsPath("/repo")).toBe("/repo/.pi/auth-plus.json");
	});
});
