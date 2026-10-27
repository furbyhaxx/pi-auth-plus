import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";

describe("test isolation", () => {
	test("HOME, XDG and agent dirs point into a temp root", () => {
		const keys = [
			"HOME",
			"XDG_CONFIG_HOME",
			"XDG_CACHE_HOME",
			"XDG_STATE_HOME",
			"XDG_DATA_HOME",
			"PI_CODING_AGENT_DIR",
		];
		for (const key of keys) {
			expect(process.env[key]?.startsWith(tmpdir())).toBe(true);
		}
	});
});
