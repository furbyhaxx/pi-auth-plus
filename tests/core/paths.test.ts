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

describe("core/paths under pig", () => {
	const host = (agentDir: string, configDirName = ".pig") => ({
		HOME: "/h",
		PIG_EXT_HOST_INFO: JSON.stringify({ agentDir, configDirName, version: "1.4.0" }),
	});

	test("the host report supplies the agent directory and project config dir", () => {
		const env = host("/home/pig/.pig/agent");
		expect(agentDir(env)).toBe("/home/pig/.pig/agent");
		expect(userSettingsPath(env)).toBe("/home/pig/.pig/agent/auth-plus.json");
		expect(cacheDir(env)).toBe("/home/pig/.pig/agent/cache/auth-plus");
		expect(projectSettingsPath("/repo", env)).toBe("/repo/.pig/auth-plus.json");
	});

	test("the host report outranks a stale PI_CODING_AGENT_DIR", () => {
		const env = { ...host("/home/pig/.pig/agent"), PI_CODING_AGENT_DIR: "/home/pi/agent" };
		expect(agentDir(env)).toBe("/home/pig/.pig/agent");
	});

	test("shared mode falls back to Pi's agent directory and project dir", () => {
		const env = {
			PIG_EXT_HOST_INFO: JSON.stringify({ agentDir: "/home/pi/.pi/agent", configDirName: ".pi" }),
		};
		expect(agentDir(env)).toBe("/home/pi/.pi/agent");
		expect(projectSettingsPath("/repo", env)).toBe("/repo/.pi/auth-plus.json");
	});

	test("a malformed or absent host report keeps Pi's defaults", () => {
		expect(agentDir({ HOME: "/h", PIG_EXT_HOST_INFO: "{not json" })).toBe("/h/.pi/agent");
		expect(projectSettingsPath("/repo", { HOME: "/h" })).toBe("/repo/.pi/auth-plus.json");
	});

	test("PIG_CODING_AGENT_DIR and PIG_HOME apply without a host report", () => {
		expect(agentDir({ HOME: "/h", PIG_CODING_AGENT_DIR: "~/own" })).toBe("/h/own");
		expect(agentDir({ HOME: "/h", PIG_HOME: "/opt/pig" })).toBe("/opt/pig/agent");
	});

	test("a config dir name that could escape the project is ignored", () => {
		const env = { HOME: "/h", PIG_EXT_HOST_INFO: JSON.stringify({ configDirName: "../evil" }) };
		expect(projectSettingsPath("/repo", env)).toBe("/repo/.pi/auth-plus.json");
	});
});
