import { describe, expect, test } from "bun:test";
import {
	PINNED_VERSION,
	ReportedVersion,
	VERSION_ENV,
} from "../../../src/families/anthropic/version.ts";

function counting(output: string | undefined) {
	const probe = {
		calls: 0,
		run: async () => {
			probe.calls += 1;
			return output;
		},
	};
	return probe;
}

describe("families/anthropic/version", () => {
	test("an installed newer claude wins over the pin, an older one does not, probed once", async () => {
		const newer = counting("2.1.310 (Claude Code)\n");
		const version = new ReportedVersion({}, newer.run);
		expect(await version.get()).toBe("2.1.310");
		expect(await version.get()).toBe("2.1.310");
		expect(newer.calls).toBe(1);

		expect(await new ReportedVersion({}, counting("2.1.99 (Claude Code)").run).get()).toBe(
			PINNED_VERSION,
		);
		expect(await new ReportedVersion({}, counting(undefined).run).get()).toBe(PINNED_VERSION);
	});

	test("the env override beats detection; an older one warns, a malformed one falls back", async () => {
		const probe = counting("2.1.400 (Claude Code)");
		expect(await new ReportedVersion({ [VERSION_ENV]: " 2.1.500 " }, probe.run).get()).toBe(
			"2.1.500",
		);
		const older = new ReportedVersion({ [VERSION_ENV]: "2.1.200" }, probe.run);
		expect(await older.get()).toBe("2.1.200");
		expect(older.override.kind).toBe("outdated");
		const invalid = new ReportedVersion({ [VERSION_ENV]: "latest" }, probe.run);
		expect(await invalid.get()).toBe(PINNED_VERSION);
		expect(invalid.override.kind).toBe("invalid");
		expect(probe.calls).toBe(0);
	});
});
