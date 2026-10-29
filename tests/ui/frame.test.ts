import { describe, expect, test } from "bun:test";
import { layoutFor } from "../../src/ui/frame/index.ts";

describe("frame layout", () => {
	test("adapts the reserve and frame chrome to terminal height", () => {
		expect(layoutFor(8, 1)).toEqual({ bodyRows: 1, compact: true });
		expect(layoutFor(9, 1)).toEqual({ bodyRows: 2, compact: true });
		expect(layoutFor(12, 1)).toEqual({ bodyRows: 3, compact: true });
		expect(layoutFor(14, 1)).toEqual({ bodyRows: 4, compact: true });
		expect(layoutFor(16, 1)).toEqual({ bodyRows: 5, compact: true });
		expect(layoutFor(18, 1)).toEqual({ bodyRows: 4, compact: false });
		expect(layoutFor(24, 1)).toEqual({ bodyRows: 10, compact: false });
	});

	test("supports explicit compact density and positive body caps", () => {
		expect(layoutFor(24, 1, { density: "compact" })).toEqual({
			bodyRows: 13,
			compact: true,
		});
		expect(layoutFor(24, 1, { maxBodyRows: 2 })).toEqual({ bodyRows: 2, compact: false });
		expect(layoutFor(8, 1, { maxBodyRows: 1 })).toEqual({ bodyRows: 1, compact: true });
		expect(layoutFor(24, 1, { maxBodyRows: 0 })).toEqual(layoutFor(24, 1));
	});
});
