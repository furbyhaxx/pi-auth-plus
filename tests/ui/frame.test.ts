import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { drawFrame, layoutFor, type PanelTheme } from "../../src/ui/frame/index.ts";

const theme: PanelTheme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};

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

	test("keeps an affordance, identity, count, and overflow visible in compact frames", () => {
		const lines = drawFrame(theme, 36, {
			crumbs: ["Auth", "Providers"],
			state: "100 providers",
			affordance: "F1 help",
			header: [],
			body: [" selected"],
			bodyRows: 1,
			compact: true,
			above: 2,
			below: 97,
			description: "description",
			footer: "controls",
		});
		expect(lines[0]).toContain("Providers");
		expect(lines[0]).toContain("100");
		expect(lines[0]).toContain("↑2↓97");
		expect(lines[0]).toContain("F1 help");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
		const crowded = drawFrame(theme, 36, {
			crumbs: ["Auth", "Providers"],
			state: "999999999999 providers",
			affordance: "F1 help",
			header: [],
			body: [" selected"],
			bodyRows: 1,
			compact: true,
			above: 999999999999,
			below: 999999999999,
			description: "description",
			footer: "controls",
		});
		expect(crowded[0]).toContain("F1 help");
		for (const line of crowded) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
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
