import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// Pi installs packages without peers (`--omit=peer`, `--legacy-peer-deps`), so only the
// specifiers its extension loader aliases resolve at runtime (pi-coding-agent extensions/loader.js).
const ALIASED = new Set([
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-tui",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-ai/compat",
	"@earendil-works/pi-ai/models",
	"@earendil-works/pi-ai/oauth",
	"@earendil-works/pi-ai/providers/all",
]);

describe("runtime imports", () => {
	test("reach @earendil-works only through specifiers Pi's loader aliases", async () => {
		const offenders: string[] = [];
		for await (const path of new Glob("src/**/*.ts").scan(".")) {
			const source = await Bun.file(path).text();
			for (const match of source.matchAll(
				/^import\s+(?!type\b)[^;]*?from\s+"(@earendil-works\/[^"]+)"/gms,
			)) {
				const specifier = match[1];
				if (specifier && !ALIASED.has(specifier)) offenders.push(`${path}: ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
