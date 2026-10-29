import { describe, expect, test } from "bun:test";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import type { SaveOutcome } from "../../src/core/config/save.ts";
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
		{
			list: () => [original],
			supported: () => true,
			save: async (_aliases, scope) => ({ committed: true, scope, shadowed: [], warnings: [] }),
		},
		original.provider,
		original.source,
		original,
		() => {},
	);
	return detail;
}

describe("alias detail", () => {
	test("failed delayed deletion preserves the draft, blocks input, and successful retry reports warnings", async () => {
		const original: ModelAlias = { provider: "vendor", source: "model", id: "copy" };
		const pending = Promise.withResolvers<SaveOutcome>();
		const retries = Promise.withResolvers<SaveOutcome>();
		const calls: (readonly ModelAlias[])[] = [];
		const messages: (string | undefined)[] = [];
		const keys = new KeybindingsManager(TUI_KEYBINDINGS);
		const detail = new AliasDetail(
			{
				theme: {
					fg: (_color, value) => value,
					bg: (_color, value) => value,
					bold: (value) => value,
				},
				keys,
				binding: (id) => bindingLabel(keys, id),
				refresh: () => {},
				finish: () => {},
			},
			{
				list: () => [original],
				supported: () => true,
				save: (aliases) => {
					calls.push([...aliases]);
					return calls.length === 1 ? pending.promise : retries.promise;
				},
			},
			"vendor",
			"model",
			original,
			(message) => messages.push(message),
		);
		detail.handleInput("d");
		detail.handleInput("\x13");
		detail.handleInput("p");
		expect(detail.isSaving()).toBe(true);
		detail.handleInput("d");
		detail.handleInput("\x1b");
		expect(detail.render(140, 20).lines.join("\n")).toContain("removal staged");
		pending.resolve({
			committed: false,
			error: "settings locked by another session; wait and retry",
		});
		await Promise.resolve();
		expect(detail.isSaving()).toBe(false);
		expect(detail.hasDrafts()).toBe(true);
		expect(detail.render(140, 20).lines.join("\n")).toContain("settings locked");
		for (const width of [36, 57, 80, 140]) {
			const lines = detail.render(width, 20).lines;
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			expect(lines.join(" ").replace(/\s+/g, " ")).toContain("wait and retry");
		}
		expect(messages).toEqual([]);
		detail.handleInput("\x13");
		detail.handleInput("p");
		expect(calls).toEqual([[], []]);
		retries.resolve({
			committed: true,
			scope: "project",
			shadowed: ["models.aliases"],
			warnings: ["refresh failed"],
		});
		await Promise.resolve();
		expect(messages).toEqual([
			"Saved to project scope; shadowed by higher scope: models.aliases; warning: refresh failed",
		]);
	});

	test("a dirty alias cannot be silently discarded when confirmation is unavailable", () => {
		const detail = open({ provider: "vendor", source: "model", id: "copy" });
		detail.handleInput("d");
		expect(detail.handleInput("\x1b")).toBe(true);
		expect(detail.hasDrafts()).toBe(true);
		const text = detail.render(140, 20).lines.join("\n");
		expect(text).toContain("removal staged");
		expect(text).toContain("Cannot discard");
	});

	test("late committed saves do not close or refresh a disposed alias", async () => {
		const pending = Promise.withResolvers<SaveOutcome>();
		const original: ModelAlias = { provider: "vendor", source: "model", id: "copy" };
		const keys = new KeybindingsManager(TUI_KEYBINDINGS);
		let refreshes = 0;
		let closes = 0;
		const detail = new AliasDetail(
			{
				theme: {
					fg: (_color, value) => value,
					bg: (_color, value) => value,
					bold: (value) => value,
				},
				keys,
				binding: (id) => bindingLabel(keys, id),
				refresh: () => refreshes++,
				finish: () => {},
			},
			{ list: () => [original], supported: () => true, save: () => pending.promise },
			"vendor",
			"model",
			original,
			() => closes++,
		);
		detail.handleInput("d");
		detail.handleInput("\x13");
		detail.handleInput("r");
		detail.dispose();
		pending.resolve({ committed: true, scope: "runtime", shadowed: [], warnings: [] });
		await Promise.resolve();
		expect(closes).toBe(0);
		expect(refreshes).toBe(0);
	});

	test("changed inline input is a draft and explicit discard clears it", () => {
		const detail = open({ provider: "vendor", source: "model", id: "copy" });
		detail.handleInput("\r");
		expect(detail.hasDrafts()).toBe(false);
		detail.handleInput("-edited");
		expect(detail.hasDrafts()).toBe(true);
		detail.discardDrafts();
		expect(detail.hasDrafts()).toBe(false);
		expect(detail.render(140, 20).lines.join("\n")).toContain("copy");
	});
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
