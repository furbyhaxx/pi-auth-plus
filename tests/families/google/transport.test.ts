import { describe, expect, test } from "bun:test";
import { userAgent } from "../../../src/families/google/transport.ts";

describe("families/google/transport", () => {
	test("builds the agy 1.5.15 user agent from the observed 1.4.8 template", () => {
		// Header template: evidence/live-2026-10-27/inference-request-headers.txt in the 1.4.8 dossier.
		expect(userAgent("linux", "x64")).toBe(
			"antigravity/cli/1.5.15 (aidev_client; os_type=linux; arch=amd64; cl=1007749967; auth_method=consumer)",
		);
		expect(userAgent("darwin", "arm64")).toContain("os_type=darwin; arch=arm64;");
		expect(userAgent("win32", "x64")).toContain("os_type=windows; arch=amd64;");
	});
});
