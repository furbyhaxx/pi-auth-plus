import { describe, expect, test } from "bun:test";
import { conflictMessage, detectConflicts } from "../../src/core/conflicts/index.ts";

describe("core/conflicts", () => {
	test("finds each absorbed package once across settings forms and command paths", () => {
		const conflicts = detectConflicts(
			[
				"git:https://github.com/furbyhaxx/pi-claude-auth",
				"git:github.com/furbyhaxx/pi-antigravity-auth.git@v2",
				"npm:@furbyhaxx/pi-quotas@1.2.0",
				"npm:@furbyhaxx/pi-synthetic-auth@1.2.0",
				{ source: "git:https://github.com/furbyhaxx/pi-synthetic-auth", extensions: [] },
				"git:https://git.viitrium.io/furbyhaxx/pi-workbench",
				"git:https://example.com/x/pi-quotas-extra",
			],
			["/mnt/Projects/furbyhaxx/pi-opencode-auth/index.ts", "-/home/x/pi-claude-auth/index.ts"],
			["/home/u/.pi/agent/git/github.com/furbyhaxx/pi-quotas/src/index.ts"],
		);
		expect(conflicts).toEqual([
			{
				name: "pi-claude-auth",
				source: "git:https://github.com/furbyhaxx/pi-claude-auth",
				via: "package",
			},
			{
				name: "pi-antigravity-auth",
				source: "git:github.com/furbyhaxx/pi-antigravity-auth.git@v2",
				via: "package",
			},
			{
				name: "pi-quotas",
				source: "npm:@furbyhaxx/pi-quotas@1.2.0",
				via: "package",
			},
			{
				name: "pi-synthetic-auth",
				source: "npm:@furbyhaxx/pi-synthetic-auth@1.2.0",
				via: "package",
			},
			{
				name: "pi-opencode-auth",
				source: "/mnt/Projects/furbyhaxx/pi-opencode-auth/index.ts",
				via: "path",
			},
		]);
		expect(conflictMessage(conflicts)).toContain("pi remove npm:@furbyhaxx/pi-quotas@1.2.0");
		expect(conflictMessage(conflicts)).toContain(
			"pi remove npm:@furbyhaxx/pi-synthetic-auth@1.2.0; stop loading /mnt/Projects/furbyhaxx/pi-opencode-auth/index.ts",
		);
	});
});
