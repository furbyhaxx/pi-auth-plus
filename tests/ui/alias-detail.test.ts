import { describe, expect, test } from "bun:test";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { ModelAlias } from "../../src/models/aliases/index.ts";
import { AliasDetail } from "../../src/ui/dashboard/alias-detail.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

function open(original: ModelAlias) {
	const keys = new KeybindingsManager(TUI_KEYBINDINGS);
	const host: TabViewHost = {
		theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {},
		finish: () => {},
	};
	const detail = new AliasDetail(
		host,
		{ list: () => [original], supported: () => true, save: async () => {} },
		original.provider,
		original.source,
		original,
		() => {},
	);
	return detail;
}

describe("alias detail", () => {
	test("renders a short alias ID input within 140 columns without clipping cursor markup", () => {
		const detail = open({
			provider: "vendor",
			source: "model",
			id: "short\x1b]0;bad\x07",
		});
		detail.handleInput("\r");

		const body = detail.render(140, 20);
		const row = body.lines.find((line) => line.includes("ID"));
		expect(row).toBeDefined();
		expect(row).toContain("short");
		expect(row).not.toContain("…");
		expect(row).not.toContain("bad");
		expect(row).toContain("\x1b_pi:c\x07");
	});

	test("keeps detail lines within each supported width", () => {
		const detail = open({ provider: "vendor", source: "model", id: "short" });
		detail.handleInput("\r");
		for (const width of [36, 57, 80, 140]) {
			const body = detail.render(width, 20);
			for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});
