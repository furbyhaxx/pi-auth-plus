import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { type SaveScope, SettingsStore } from "../../src/core/config/index.ts";
import { type SettingsTabDeps, SettingsView } from "../../src/ui/dashboard/settings.ts";
import type { DashboardResult, TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "settings-tab-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function open(
	select = "quotas.refreshOnRequest",
	previewTemplate?: SettingsTabDeps["previewTemplate"],
	trusted = true,
) {
	const user = join(dir, "user.json");
	const project = join(dir, "project.json");
	const store = new SettingsStore(SETTINGS, trusted ? { user, project } : { user });
	const saved: { keys: readonly string[]; scope: SaveScope }[] = [];
	const finished: DashboardResult[] = [];
	let onRefresh: (() => void) | undefined;
	const keys = new KeybindingsManager(TUI_KEYBINDINGS);
	const host: TabViewHost = {
		theme: {
			fg: (_color, text) => `\x1b[90m${text}\x1b[39m`,
			bg: (_color, text) => text,
			bold: (text) => text,
		},
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {
			onRefresh?.();
			onRefresh = undefined;
		},
		finish: (result) => {
			finished.push(result);
		},
	};
	const view = new SettingsView(
		host,
		{
			store: () => store,
			onSaved: (keys, scope) => {
				saved.push({ keys, scope });
			},
			...(previewTemplate ? { previewTemplate } : {}),
		},
		select,
	);
	const text = () => view.render(140, 30).lines.map(stripVTControlCharacters).join("\n");
	return {
		view,
		store,
		saved,
		finished,
		text,
		user,
		project,
		nextRefresh: () =>
			new Promise<void>((resolve) => {
				onRefresh = resolve;
			}),
	};
}

async function save(rig: ReturnType<typeof open>, target: string) {
	rig.view.handleInput("\x13");
	rig.view.handleInput(target);
	await rig.nextRefresh();
}

describe("settings tab", () => {
	test("edits remain staged until saved to exactly the chosen scope", async () => {
		for (const [target, scope] of [
			["u", "user"],
			["p", "project"],
			["r", "runtime"],
		] as const) {
			const rig = open();
			rig.view.handleInput(" ");
			expect(rig.store.get("quotas.refreshOnRequest")).toBe(true);
			expect(rig.text()).toContain("● staged");
			await save(rig, target);
			expect(rig.saved).toEqual([{ keys: ["quotas.refreshOnRequest"], scope }]);
			expect(rig.store.sourceOf("quotas.refreshOnRequest")).toBe(scope);
			expect(rig.store.get("quotas.refreshOnRequest")).toBe(false);
			for (const [path, fileScope] of [
				[rig.user, "user"],
				[rig.project, "project"],
			]) {
				expect(existsSync(path ?? "")).toBe(fileScope === scope);
				if (path && existsSync(path)) {
					expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
						quotas: { refreshOnRequest: false },
					});
					rmSync(path);
				}
			}
		}
	});

	test("saving under a higher scope warns without losing the chosen scope's value", async () => {
		const rig = open();
		await rig.store.save("runtime", { "quotas.refreshOnRequest": true });
		rig.view.handleInput(" ");
		await save(rig, "u");
		expect(rig.text()).toContain("shadowed by higher scope: quotas.refreshOnRequest");
		expect(rig.store.get("quotas.refreshOnRequest")).toBe(true);
		expect(JSON.parse(readFileSync(rig.user, "utf8"))).toEqual({
			quotas: { refreshOnRequest: false },
		});
	});

	test("cancel discards staged edits before falling through to dashboard close", () => {
		const rig = open();
		rig.view.handleInput(" ");
		expect(rig.view.handleInput("\x1b")).toBe(true);
		expect(rig.text()).toContain("Discarded staged changes");
		expect(rig.text()).not.toContain("● staged");
		expect(rig.view.handleInput("\x1b")).toBe(false);
		expect(rig.view.handleInput("\t")).toBe(false);
	});

	test("rules and lists open the external editor only with no staged edits", () => {
		for (const key of ["claude.replacePatterns", "quotas.providers"]) {
			const rig = open(key);
			rig.view.handleInput("\x7f");
			rig.view.handleInput("\r");
			expect(rig.finished).toEqual([]);
			expect(
				rig.view.render(80, 20).hints.some((hint) => hint.action.includes("save/discard")),
			).toBe(true);
			rig.view.handleInput("\x1b");
			rig.view.handleInput("\r");
			expect(rig.finished).toEqual([{ editSetting: key }]);
		}
	});

	test("failed save retains edits and cancellation leaves them available", async () => {
		const rig = open("quotas.refreshOnRequest", undefined, false);
		rig.view.handleInput(" ");
		await save(rig, "p");
		expect(rig.text()).toContain("trusted");
		expect(rig.text()).toContain("● staged");
		expect(rig.saved).toEqual([]);
		rig.view.handleInput("\x13");
		expect(rig.view.handleInput("\x1b")).toBe(true);
		expect(rig.text()).toContain("● staged");
		writeFileSync(rig.user, "{");
		await save(rig, "u");
		expect(rig.text()).toContain("not valid JSON");
		expect(rig.saved).toEqual([]);
	});

	test("number Input traps navigation, validates, clamps and saves; reset deletes the scoped key", async () => {
		const rig = open("quotas.compactWidthCols");
		rig.view.handleInput("l");
		expect(rig.text()).toContain("105");
		rig.view.handleInput("h");
		rig.view.handleInput("\r");
		expect(rig.view.handleInput("\t")).toBe(true);
		expect(rig.view.handleInput("\x1b[D")).toBe(true);
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("nope");
		rig.view.handleInput("\r");
		expect(rig.text()).toContain("Invalid value");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("9999");
		rig.view.handleInput("\r");
		await save(rig, "r");
		expect(rig.store.get("quotas.compactWidthCols")).toBe(220);
		rig.view.handleInput("\x7f");
		await save(rig, "r");
		expect(rig.store.get("quotas.compactWidthCols")).toBe(100);
		expect(rig.store.sourceOf("quotas.compactWidthCols")).toBe("default");
	});

	test("enum cycling and movement stage the selected field", async () => {
		const rig = open("quotas.percentDisplay");
		rig.view.handleInput("\x1b[C");
		expect(rig.text()).toContain("Remaining");
		rig.view.handleInput("\x1b[D");
		rig.view.handleInput("\r");
		rig.view.handleInput("j");
		rig.view.handleInput("l");
		rig.view.handleInput("k");
		await save(rig, "r");
		expect(rig.store.get("quotas.percentDisplay")).toBe("remaining");
		expect(rig.store.get("quotas.compactWidthCols")).toBe(105);
	});

	test("template preview pages expose every row", () => {
		const rig = open("quotas.lineTemplate", () => ({
			rows: ["first preview", "second preview"],
			unknown: ["unknown-token"],
		}));
		expect(rig.text()).toContain("first preview");
		expect(rig.text()).toContain("ignored: unknown-token");
		rig.view.handleInput("\x1b[6~");
		expect(rig.text()).toContain("second preview");
		expect(rig.text()).toContain("preview 2/2");
		rig.view.handleInput("\x1b[5~");
		expect(rig.text()).toContain("first preview");
	});

	test("template preview follows inline and staged edits without writing the store", async () => {
		const seen: { source: string; width: number }[] = [];
		const rig = open("quotas.lineTemplate", (source, width) => {
			seen.push({ source, width });
			return { rows: [source], unknown: [] };
		});
		await rig.store.save("runtime", { "quotas.lineTemplate": "old" });
		rig.view.handleInput("\r");
		rig.view.handleInput("\x01");
		rig.view.handleInput("\x0b");
		rig.view.handleInput("new");
		rig.view.render(57, 20);
		expect(seen.at(-1)).toEqual({ source: "new", width: 56 });
		rig.view.handleInput("\r");
		rig.view.render(80, 20);
		expect(seen.at(-1)).toEqual({ source: "new", width: 79 });
		expect(rig.store.get("quotas.lineTemplate")).toBe("old");
		rig.view.handleInput("\r");
		rig.view.handleInput("more");
		rig.view.handleInput("\x1b");
		rig.view.render(36, 20);
		expect(seen.at(-1)?.source).toBe("new");
	});

	test("sections, editing, save prompts and sanitized template previews fit every check width", async () => {
		const rig = open("quotas.lineTemplate", (source, width) => ({
			rows: [source.repeat(2), "preview".repeat(width)],
			unknown: ["bad\x1b]0;evil\x07"],
		}));
		await rig.store.save("runtime", { "quotas.lineTemplate": "hello\x1b]0;evil\x07" });
		for (const data of ["", "\r", "\x1b", "\x7f", "\x13"]) {
			if (data) rig.view.handleInput(data);
			for (const width of [36, 57, 80, 140]) {
				const body = rig.view.render(width, 30);
				for (const line of [...body.lines, body.description ?? ""]) {
					expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					expect(stripVTControlCharacters(line)).not.toContain("evil");
				}
			}
		}
		rig.view.handleInput("\x1b");
		expect(rig.text()).toContain("⚠ ignored: bad");
		expect(rig.text()).toContain("Quotas");
		expect(rig.text()).toContain("Claude");
		expect(rig.text()).toContain("Synthetic");
	});
});
