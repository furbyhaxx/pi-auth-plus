import { expect, test } from "bun:test";
import { asFooterHost } from "../../../src/quotas/line/workbench.ts";

test("only services offering both footer methods are accepted", () => {
	const host = { setFooterRows() {}, requestFooterRender() {} };
	expect(asFooterHost(host)).toBe(host);
	for (const value of [
		null,
		undefined,
		1,
		"host",
		{},
		{ setFooterRows() {} },
		{ setFooterRows: 1, requestFooterRender() {} },
	]) {
		expect(asFooterHost(value)).toBeUndefined();
	}
});
