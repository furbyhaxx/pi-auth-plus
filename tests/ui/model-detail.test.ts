import { describe, expect, test } from "bun:test";
import {
	type KeybindingsConfig,
	KeybindingsManager,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { ModelDetail } from "../../src/ui/dashboard/model-detail.ts";
import type { ModelCatalogItem } from "../../src/ui/dashboard/models.ts";
import type { TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

function open(name: string, userBindings: KeybindingsConfig = {}) {
	let onLoad: (() => void) | undefined;
	const loaded = new Promise<void>((resolve) => {
		onLoad = resolve;
	});
	const keys = new KeybindingsManager(TUI_KEYBINDINGS, userBindings);
	const host: TabViewHost = {
		theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text },
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {
			onLoad?.();
			onLoad = undefined;
		},
		finish: () => {},
	};
	const item: ModelCatalogItem = {
		provider: "vendor",
		id: "model",
		name,
		contextWindow: 8192,
	};
	const detail = new ModelDetail(
		host,
		{ read: async () => undefined, save: async () => {} },
		item,
		() => {},
	);
	return { detail, loaded };
}

describe("model detail", () => {
	test("renders a short name input within 140 columns without clipping cursor markup", async () => {
		const rig = open("short\x1b]0;bad\x07");
		await rig.loaded;
		rig.detail.handleInput("\r");

		const body = rig.detail.render(140, 20);
		const row = body.lines.find((line) => line.includes("Name"));
		expect(row).toBeDefined();
		expect(row).toContain("short");
		expect(row).toContain("default");
		expect(row).not.toContain("…");
		expect(row).not.toContain("bad");
		expect(row).toContain("\x1b_pi:c\x07");
	});

	test("keeps detail lines within each supported width", async () => {
		const rig = open("short");
		await rig.loaded;
		rig.detail.handleInput("\r");
		for (const width of [36, 57, 80, 140]) {
			const body = rig.detail.render(width, 20);
			for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	test("shows the configured cursor bindings in the change hint", async () => {
		const rig = open("short", {
			"tui.editor.cursorLeft": "ctrl+h",
			"tui.editor.cursorRight": "ctrl+l",
		});
		await rig.loaded;
		const changeHint = rig.detail.render(140, 20).hints.find((hint) => hint.action === "change");
		expect(changeHint?.key).toBe("ctrl+h/ctrl+l");
	});
});
