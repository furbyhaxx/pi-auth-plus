import { expect, test } from "bun:test";
import { parseQuotaCliArgs } from "../../src/cli/args.ts";

test.each([
	[[], undefined],
	[["--json"], undefined],
	[["--quotas-json"], { json: true, provider: undefined }],
	[["--quotas-list", "cc"], { json: false, provider: "cc" }],
	[["--quotas-json", "--quotas-list", "cc"], { json: true, provider: "cc" }],
	[["--quotas-list", "ag", "--quotas-json", "cc"], { json: true, provider: "cc" }],
	[["--quotas-list", "--model", "cc"], { json: false, provider: undefined }],
	[["--", "--quotas-json"], undefined],
	[["--quotas-json", "--", "cc"], { json: true, provider: undefined }],
	[["--quotas-list", "cc", "--", "--help"], { json: false, provider: "cc" }],
] as const)("parses %j", (argv, expected) => {
	expect(parseQuotaCliArgs(argv)).toEqual(expected);
});

test.each(["--help", "-h", "--version", "-v", "--list-models"])("defers to %s", (flag) => {
	expect(parseQuotaCliArgs(["--quotas-json", "cc", flag])).toBeUndefined();
});
