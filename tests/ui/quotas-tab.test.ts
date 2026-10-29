import { describe, expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	type KeybindingsConfig,
	KeybindingsManager,
	parseColor,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { SaveScope } from "../../src/core/config/index.ts";
import type { SaveOutcome } from "../../src/core/config/save.ts";
import type { LineTheme } from "../../src/quotas/line/format.ts";
import type { LineConfig } from "../../src/quotas/line/values.ts";
import type { QuotaReport, ReportProvider } from "../../src/quotas/report.ts";
import { AuthDashboard, staticViews } from "../../src/ui/dashboard/index.ts";
import { fitLabel, type LinePlacement, QuotasView } from "../../src/ui/dashboard/quotas.ts";
import type { DashboardResult, TabViewHost } from "../../src/ui/dashboard/view.ts";
import { bindingLabel } from "../../src/ui/frame/index.ts";

const theme = {
	colors: {
		success: parseColor("#00ff00"),
		warning: parseColor("#ffff00"),
		error: parseColor("#ff0000"),
	},
	fg: (_token: string, text: string) => `\x1b[90m${text}\x1b[39m`,
	style: (text: string) => text,
} as unknown as LineTheme;

function provider(id: string): ReportProvider {
	return {
		id,
		title: id,
		short: id,
		state: "ok",
		windows: [{ id: "daily", label: "Daily", shortLabel: "day", usedFraction: 0.25 }],
	};
}

function open(
	providers: readonly ReportProvider[],
	solo?: string,
	bindings: KeybindingsConfig = {},
	dashboardHost?: TabViewHost,
) {
	let report: QuotaReport = { v: 1, generatedAt: 0, providers };
	let placement: LinePlacement = "below-editor-first";
	let listener = () => {};
	let renders = 0;
	let unsubscribed = 0;
	const calls: [string, boolean][] = [];
	const saves: [LinePlacement, SaveScope][] = [];
	const finished: DashboardResult[] = [];
	const busy = new Set<string>();
	let reject = false;
	let pendingDiscard: (() => void) | undefined;
	let saveBehavior: (next: LinePlacement, scope: SaveScope) => Promise<SaveOutcome> = async (
		_next,
		scope,
	) => ({ committed: true, scope, shadowed: [], warnings: [] });
	const config: LineConfig = { percentDisplay: "used", creditHealthyUsd: 50, creditCriticalUsd: 5 };
	const keys = new KeybindingsManager(TUI_KEYBINDINGS, bindings);
	const host: TabViewHost = {
		theme: { fg: theme.fg, bg: (_token, text) => text, bold: (text) => text },
		keys,
		binding: (id) => bindingLabel(keys, id),
		refresh: () => {
			renders++;
		},
		finish: (result) => finished.push(result),
		confirmDiscard: (discard) => {
			pendingDiscard = discard;
		},
	};
	const view = new QuotasView(
		dashboardHost ?? host,
		theme,
		{
			report: () => report,
			resetSupport: (id) => id === "one",
			refreshing: (id) => busy.has(id),
			refresh: async (id, force) => {
				calls.push([id, force]);
				if (reject) throw new Error("reported failure");
			},
			onChange: (next) => {
				listener = next;
				return () => {
					unsubscribed++;
				};
			},
			lineConfig: () => config,
			linePlacement: () => placement,
			setLinePlacement: async (next, scope) => {
				saves.push([next, scope]);
				const outcome = await saveBehavior(next, scope);
				if (outcome.committed && !outcome.shadowed.includes("quotas.linePlacement"))
					placement = next;
				return outcome;
			},
			now: () => 3_600_000,
		},
		solo,
	);
	return {
		view,
		host,
		calls,
		saves,
		finished,
		busy,
		config,
		placement: () => placement,
		renders: () => renders,
		unsubscribed: () => unsubscribed,
		reject: () => {
			reject = true;
		},
		setSaveBehavior: (behavior: typeof saveBehavior) => {
			saveBehavior = behavior;
		},
		confirmDiscard: () => {
			const discard = pendingDiscard;
			pendingDiscard = undefined;
			discard?.();
		},
		hasDiscardConfirmation: () => pendingDiscard !== undefined,
		change: (providers: readonly ReportProvider[]) => {
			report = { ...report, providers };
			listener();
		},
	};
}

const lines = (view: QuotasView, width = 140, rows = 100) =>
	view.render(width, rows).lines.map(stripVTControlCharacters);
const selected = (view: QuotasView) => lines(view).find((line) => line.includes("❯"));

describe("quotas tab", () => {
	test("reset finishes only for supported providers and hints follow selection", () => {
		const f = open([provider("one"), provider("two")]);
		expect(f.view.render(80, 10).hints).toContainEqual({ key: "x", action: "reset", priority: 3 });
		expect(f.view.handleInput("x")).toBe(true);
		expect(f.finished).toEqual([{ reset: "one" }]);
		f.view.handleInput("j");
		expect(f.view.render(80, 10).hints?.some((hint) => hint.key === "x")).toBe(false);
		f.view.handleInput("x");
		expect(f.finished).toEqual([{ reset: "one" }]);
		expect(f.view.render(80, 10).description).toContain(
			"two exposes no verified on-demand reset endpoint. Supported: one.",
		);
		f.view.dispose();
	});
	test("unknown usage and credits stay unknown, and every window remains visible", () => {
		const fixture = open([
			{
				...provider("one"),
				credits: { currency: "USD" },
				windows: [
					{ id: "credits", label: "Unknown window", shortLabel: "?" },
					{ id: "other", label: "Other unknown", shortLabel: "?" },
				],
			},
		]);
		const text = lines(fixture.view).join("\n");
		expect(text).toContain("Unknown window");
		expect(text).toContain("Other unknown");
		expect(text).toContain("? used");
		expect(text).toContain("? USD");
		expect(text).not.toContain("0%");
		expect(text).not.toContain("█");
		fixture.view.dispose();
	});

	test("selection follows provider identity across reorder, removal, and solo toggling", () => {
		const f = open([provider("one"), provider("two"), provider("three")]);
		f.view.handleInput("j");
		f.change([provider("two"), provider("three"), provider("one")]);
		expect(selected(f.view)).toContain("two");
		f.view.handleInput("a");
		expect(lines(f.view).join("\n")).not.toContain("three");
		f.view.handleInput("a");
		expect(selected(f.view)).toContain("two");
		f.view.handleInput("k");
		expect(selected(f.view)).toContain("one");
		f.change([provider("three")]);
		expect(selected(f.view)).toContain("three");
		expect(f.renders()).toBe(2);
		f.view.dispose();
		f.view.dispose();
		expect(f.unsubscribed()).toBe(1);
	});

	test("manual refresh forces the selected provider and R includes providers outside solo", async () => {
		const f = open([provider("one"), provider("two")], "two");
		f.view.handleInput("r");
		expect(f.calls).toEqual([["two", true]]);
		f.reject();
		f.view.handleInput("R");
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(f.calls).toEqual([
			["two", true],
			["one", true],
			["two", true],
		]);
		f.view.dispose();
	});

	test("placement is staged until an explicit save scope is chosen", async () => {
		for (const [key, scope] of [
			["r", "runtime"],
			["u", "user"],
			["p", "project"],
		] as const) {
			const f = open([provider("one")]);
			expect(f.view.handleInput("p")).toBe(true);
			expect(f.saves).toEqual([]);
			f.view.handleInput("j");
			expect(f.saves).toEqual([]);
			expect(f.view.hasDrafts()).toBe(true);
			f.view.handleInput("\r");
			expect(f.saves).toEqual([]);
			expect(f.placement()).toBe("below-editor-first");
			f.view.handleInput(key);
			await Promise.resolve();
			await Promise.resolve();
			expect(f.saves).toEqual([["below-editor-last", scope]]);
			expect(f.placement()).toBe("below-editor-last");
			expect(f.view.hasDrafts()).toBe(false);
			f.view.dispose();
		}
	});

	test("all rows fit at check widths, sanitize text, and show balance, countdown and drainage units", () => {
		const f = open([
			{
				...provider("one"),
				title: "Title\x1b]0;evil\x07",
				tier: "pro\nplan",
				ageSec: 90,
				credits: {
					remaining: 12,
					currency: "USD",
					detailText: "balance",
					drainage: { observedAt: 0, h1: { perHour: 2, coverageSec: 3600 }, etaSec: 21600 },
				},
				windows: [
					{
						id: "daily",
						shortLabel: "day",
						label: "Daily",
						usedFraction: 0.25,
						valueText: "25/100",
						resetAtMs: 7_200_000,
						drainage: {
							observedAt: 0,
							window: { perHour: 0.1, coverageSec: 100 },
							resetsBeforeExhaustion: true,
						},
					},
				],
			},
			{ ...provider("auth"), state: "needs-auth", needsAuth: true },
			{
				...provider("codex"),
				state: "needs-auth",
				needsAuth: true,
				loginHint: "/quota codex login or /login openai-codex",
			},
			{ ...provider("error"), state: "error", error: "HTTP 500; retry" },
			{ ...provider("loading"), state: "unknown", windows: [] },
		]);
		for (const width of [36, 57, 80, 140])
			for (const line of f.view.render(width, 100).lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(line).not.toContain("\n");
				expect(line).not.toContain("evil");
			}
		const text = lines(f.view).join("\n");
		expect(text).not.toContain("/login codex");
		for (const part of [
			"12.00 USD",
			"25% used",
			"25/100",
			"↻ 1h 0m",
			"2.00 USD/h",
			"empty in 5h 0m",
			"10.0%/h",
			"resets first",
			"/login auth",
			"⚠ /quota codex login or /login openai-codex",
			"✗",
			"Loading quota…",
			"1m ago",
		])
			expect(text).toContain(part);
		f.config.percentDisplay = "remaining";
		expect(lines(f.view).join("\n")).toContain("75% left");
		f.view.dispose();
	});

	test("committed outcomes show shadowing and every warning, even in short narrow views", async () => {
		const f = open([provider("one")]);
		f.setSaveBehavior(async (_next, scope) => ({
			committed: true,
			scope,
			shadowed: ["quotas.linePlacement"],
			warnings: [
				"Effects need a restart\nthen retry\x1b]0;evil\x07",
				"Lock release needs attention",
			],
		}));
		f.view.handleInput("p");
		f.view.handleInput("j");
		f.view.handleInput("\r");
		f.view.handleInput("u");
		await Promise.resolve();
		await Promise.resolve();
		expect(f.saves).toEqual([["below-editor-last", "user"]]);
		expect(f.placement()).toBe("below-editor-first");
		expect(f.view.hasDrafts()).toBe(false);
		const result = lines(f.view).join(" ").replace(/\s+/g, " ");
		expect(result).toContain("Saved to user scope");
		expect(result).toContain("shadowed by higher scope: quotas.linePlacement");
		expect(result).toContain("warning: Effects need a restart");
		expect(result).toContain("warning: Lock release needs attention");
		const pages: string[] = [];
		for (let i = 0; i < 20; i++) {
			const body = f.view.render(36, 1);
			pages.push(...body.lines.map(stripVTControlCharacters));
			f.view.handleInput("\x1b[6~");
		}
		const paged = pages.join(" ").replace(/\s+/g, " ");
		for (const fragment of [
			"Saved to user scope",
			"shadowed by higher scope:",
			"quotas.linePlacement",
			"Effects need a restart",
			"Lock release needs attention",
		])
			expect(paged).toContain(fragment);
		const oneRow = f.view.render(36, 1);
		expect(oneRow.lines).toHaveLength(1);
		for (const line of oneRow.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
		const feedback = oneRow.fullFeedback?.map(stripVTControlCharacters).join("\n") ?? "";
		expect(feedback).toContain("Saved to user scope");
		expect(feedback).toContain("Effects need a restart\nthen retry;");
		expect(feedback).toContain("Lock release needs attention");
		expect(feedback).not.toContain("evil");
		f.view.dispose();
	});

	test("selected auth and provider errors remain complete in narrow help feedback", () => {
		const f = open([
			{
				...provider("one"),
				state: "needs-auth",
				needsAuth: true,
				loginHint: "/quota provider login\nthen /login provider-with-a-long-name",
				error: "HTTP 500; retry from the provider dashboard\x1b]0;evil\x07",
			},
		]);
		const body = f.view.render(36, 1);
		expect(body.lines).toHaveLength(1);
		for (const line of body.lines) expect(visibleWidth(line)).toBeLessThanOrEqual(36);
		const feedback = body.fullFeedback?.map(stripVTControlCharacters).join("\n") ?? "";
		expect(feedback).toContain("/quota provider login\nthen /login provider-with-a-long-name");
		expect(feedback).toContain("HTTP 500; retry from the provider dashboard");
		expect(feedback).not.toContain("evil");
		f.view.dispose();
	});

	test("failed saves retain the selection for retry and sanitize errors", async () => {
		const f = open([provider("one")]);
		f.setSaveBehavior(async () => ({
			committed: false,
			error: "disk error\x1b]0;evil\x07; retry",
		}));
		f.view.handleInput("p");
		f.view.handleInput("j");
		f.view.handleInput("\r");
		f.view.handleInput("p");
		await Promise.resolve();
		await Promise.resolve();
		expect(f.view.hasDrafts()).toBe(true);
		expect(f.view.isSaving()).toBe(false);
		expect(f.placement()).toBe("below-editor-first");
		expect(lines(f.view).join(" ")).toContain("Save failed: disk error; retry");
		expect(lines(f.view).join(" ")).not.toContain("evil");
		expect(stripVTControlCharacters(f.view.render(36, 1).state ?? "")).toContain("scope: project");
		f.setSaveBehavior(async (_next, scope) => ({
			committed: true,
			scope,
			shadowed: [],
			warnings: [],
		}));
		f.view.handleInput("\r");
		await Promise.resolve();
		await Promise.resolve();
		expect(f.saves).toEqual([
			["below-editor-last", "project"],
			["below-editor-last", "project"],
		]);
		expect(f.view.hasDrafts()).toBe(false);
		expect(f.placement()).toBe("below-editor-last");
		f.view.dispose();
	});

	test("chooser and scope remain navigable at check widths and short heights", () => {
		const f = open([provider("one")]);
		const check = () => {
			for (const width of [36, 57, 80, 140]) {
				for (const height of [0, 1, 2, 4, 10]) {
					const body = f.view.render(width, height);
					expect(body.modal).toBe(true);
					expect(body.lines.length).toBeLessThanOrEqual(height);
					for (const line of [...body.lines, body.state ?? "", body.description ?? ""])
						expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		};
		f.view.handleInput("p");
		check();
		f.view.handleInput("j");
		expect(lines(f.view, 36, 1).join("")).toContain("Below editor, last");
		f.view.handleInput("\r");
		check();
		f.view.handleInput("j");
		f.view.handleInput("j");
		expect(lines(f.view, 36, 1).join("")).toContain("project");
		expect(f.saves).toEqual([]);
		f.view.dispose();
	});

	test("dashboard frames stay shrink-wrapped and fit short terminals throughout the chooser", async () => {
		const terminal = { rows: 40 };
		const views = staticViews({ providers: [], nowMs: 0 });
		views.quotas = (host) => {
			const rig = open([provider("one")], undefined, {}, host);
			rig.setSaveBehavior(async (_next, scope) => ({
				committed: true,
				scope,
				shadowed: ["quotas.linePlacement"],
				warnings: ["Effects need a restart"],
			}));
			return rig.view;
		};
		const panel = new AuthDashboard(
			{ terminal, requestRender: () => {} },
			{ fg: theme.fg, bg: (_token, text) => text, bold: (text) => text },
			new KeybindingsManager(TUI_KEYBINDINGS),
			() => {},
			views,
			"quotas",
			1,
		);
		const check = () => {
			for (const rows of [8, 9, 12, 24, 40]) {
				terminal.rows = rows;
				for (const width of [36, 57, 80, 140]) {
					const frame = panel.render(width);
					expect(frame.length).toBeLessThanOrEqual(rows);
					for (const line of frame) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				}
			}
		};
		check();
		terminal.rows = 40;
		expect(panel.render(140).length).toBeLessThan(12);
		panel.handleInput("p");
		check();
		terminal.rows = 40;
		expect(panel.render(140).length).toBeLessThan(12);
		panel.handleInput("j");
		panel.handleInput("\r");
		check();
		panel.handleInput("u");
		await Promise.resolve();
		await Promise.resolve();
		check();
		panel.dispose();
	});

	test("refresh state and reserved keys remain available in the provider list", () => {
		const f = open([provider("one")]);
		f.busy.add("one");
		expect(f.view.render(80, 10).state).toContain("refreshing");
		for (const key of ["\t", "\x1b[Z", "\x1b[D", "\x1b[C", "\x1b", "l"])
			expect(f.view.handleInput(key)).toBe(false);
		f.view.dispose();
	});

	test("rebound confirm and cancel keep placement unchanged and discard only the local draft", () => {
		const f = open([provider("one")], undefined, {
			"tui.select.confirm": "ctrl+g",
			"tui.select.cancel": "ctrl+x",
		});
		const rebound = open([provider("one")], undefined, {
			"tui.select.up": "ctrl+shift+up",
			"tui.select.down": "ctrl+shift+down",
		});
		expect(rebound.view.render(80, 10).hints).toContainEqual({
			key: "ctrl+shift+up/ctrl+shift+down",
			action: "provider",
			priority: 2,
		});
		f.view.handleInput("p");
		expect(f.view.hasDrafts()).toBe(false);
		f.view.handleInput("\x18");
		expect(f.view.hasDrafts()).toBe(false);
		expect(f.hasDiscardConfirmation()).toBe(false);
		f.view.handleInput("p");
		const helpHints = f.view.render(36, 1);
		expect(helpHints.fullHints ?? helpHints.hints).toContainEqual({
			key: "ctrl+g",
			action: "choose",
			priority: 0,
		});
		expect(helpHints.fullHints ?? helpHints.hints).toContainEqual({
			key: "ctrl+x",
			action: "back",
			priority: 0,
		});
		f.view.handleInput("\x1b[B");
		f.view.handleInput("\x07");
		expect(f.saves).toEqual([]);
		expect(f.view.hasDrafts()).toBe(true);
		f.view.handleInput("\x18");
		expect(f.hasDiscardConfirmation()).toBe(false);
		f.view.handleInput("\x18");
		expect(f.hasDiscardConfirmation()).toBe(true);
		expect(f.view.hasDrafts()).toBe(true);
		f.confirmDiscard();
		expect(f.view.hasDrafts()).toBe(false);
		expect(f.placement()).toBe("below-editor-first");
		expect(f.saves).toEqual([]);
		expect(f.view.handleInput("\x18")).toBe(false);
		const views = staticViews({ providers: [], nowMs: 0 });
		views.quotas = () => rebound.view;
		const panel = new AuthDashboard(
			{ terminal: { rows: 40 }, requestRender: () => {} },
			f.host.theme,
			f.host.keys,
			() => {},
			views,
			"quotas",
			1,
		);
		panel.handleInput("\x1bOP");
		const fullHelp = stripVTControlCharacters(panel.render(80).join("\n"));
		expect(fullHelp).toContain("ctrl+shift+up/ctrl+shift+down provider");
		panel.dispose();
		f.view.dispose();
	});

	test("rebound confirm selects the highlighted save scope", async () => {
		const f = open([provider("one")], undefined, {
			"tui.select.confirm": "ctrl+g",
			"tui.select.cancel": "ctrl+x",
		});
		f.view.handleInput("p");
		f.view.handleInput("j");
		f.view.handleInput("\x07");
		f.view.handleInput("j");
		f.view.handleInput("\x07");
		await Promise.resolve();
		await Promise.resolve();
		expect(f.saves).toEqual([["below-editor-last", "user"]]);
		expect(f.placement()).toBe("below-editor-last");
		f.view.dispose();
	});

	test("saving and failed drafts protect dashboard close without discarding other tabs", async () => {
		let otherDraft = true;
		let rig: ReturnType<typeof open> | undefined;
		let closed = 0;
		const deferred = Promise.withResolvers<SaveOutcome>();
		const views = staticViews({ providers: [], nowMs: 0 });
		views.quotas = (host) => {
			rig = open([provider("one")], undefined, {}, host);
			rig.setSaveBehavior(() => deferred.promise);
			return rig.view;
		};
		views.settings = () => ({
			hasDrafts: () => otherDraft,
			discardDrafts: () => {
				otherDraft = false;
			},
			handleInput: () => false,
			render: () => ({ lines: [], above: 0, below: 0, hints: [] }),
		});
		const panel = new AuthDashboard(
			{ terminal: { rows: 30 }, requestRender: () => {} },
			{ fg: theme.fg, bg: (_token, text) => text, bold: (text) => text },
			new KeybindingsManager(TUI_KEYBINDINGS),
			() => closed++,
			views,
			"quotas",
			1,
		);
		const quota = () => {
			if (!rig) throw new Error("Quotas view was not constructed");
			return rig;
		};
		panel.handleInput("p");
		panel.handleInput("j");
		panel.handleInput("\r");
		panel.handleInput("u");
		expect(quota().view.isSaving()).toBe(true);
		quota().view.discardDrafts();
		panel.handleInput("\x03");
		panel.handleInput("\x1b");
		expect(closed).toBe(0);
		expect(quota().view.hasDrafts()).toBe(true);
		expect(otherDraft).toBe(true);
		deferred.resolve({ committed: false, error: "save failed; retry" });
		await Promise.resolve();
		await Promise.resolve();
		expect(quota().view.isSaving()).toBe(false);
		panel.handleInput("\x03");
		expect(panel.render(80).map(stripVTControlCharacters).join(" ")).toContain(
			"Discard all & exit?",
		);
		panel.handleInput("\x1b");
		panel.handleInput("\x1b");
		panel.handleInput("\x1b");
		expect(panel.render(80).map(stripVTControlCharacters).join(" ")).toContain(
			"Discard this draft?",
		);
		panel.handleInput("\r");
		expect(quota().view.hasDrafts()).toBe(false);
		expect(otherDraft).toBe(true);
		expect(closed).toBe(0);
		panel.dispose();
	});

	test("unexpected save rejection remains visible and retryable", async () => {
		const f = open([provider("one")]);
		f.setSaveBehavior(async () => {
			throw new Error("unexpected failure");
		});
		f.view.handleInput("p");
		f.view.handleInput("j");
		f.view.handleInput("\r");
		f.view.handleInput("u");
		await Promise.resolve();
		await Promise.resolve();
		expect(f.view.isSaving()).toBe(false);
		expect(f.view.hasDrafts()).toBe(true);
		expect(lines(f.view).join(" ")).toContain("Save failed: unexpected failure");
		f.view.dispose();
	});

	test("late saves and refreshes do not redraw disposed views", async () => {
		const f = open([provider("one")]);
		const deferred = Promise.withResolvers<SaveOutcome>();
		f.setSaveBehavior(() => deferred.promise);
		f.view.handleInput("r");
		f.view.handleInput("p");
		f.view.handleInput("j");
		f.view.handleInput("\r");
		f.view.handleInput("r");
		f.view.dispose();
		const renders = f.renders();
		deferred.resolve({ committed: false, error: "late failure" });
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		f.change([]);
		expect(f.renders()).toBe(renders);
	});

	test("missing solo providers fall back to all; empty reports have no refresh target", () => {
		const f = open([provider("one")], "missing");
		expect(selected(f.view)).toContain("one");
		f.change([]);
		expect(lines(f.view).join("\n")).toContain("No quota providers enabled.");
		f.view.handleInput("j");
		f.view.handleInput("r");
		expect(f.calls).toEqual([]);
		f.view.dispose();
	});

	test("scroll follows selection and tall providers can expose every row", () => {
		const f = open([
			provider("one"),
			provider("two"),
			{
				...provider("three"),
				windows: Array.from({ length: 8 }, (_, i) => ({
					id: `${i}`,
					label: `Window ${i}`,
					shortLabel: `${i}`,
				})),
			},
		]);
		f.view.render(57, 3);
		f.view.handleInput("\x1b[B");
		expect(f.view.render(57, 3).above).toBeGreaterThan(0);
		f.view.handleInput("\x1b[B");
		const seen = new Set<string>();
		for (let i = 0; i < 10; i++) {
			for (const line of lines(f.view, 57, 3)) seen.add(line);
			f.view.handleInput("j");
		}
		for (let i = 0; i < 8; i++) expect([...seen].join("\n")).toContain(`Window ${i}`);
		f.view.dispose();
	});
});

test("clipped window labels keep the qualifier that tells sibling windows apart", () => {
	expect(stripVTControlCharacters(fitLabel("Claude and GPT models (5h)", 19))).toBe(
		"Claude and GP… (5h)",
	);
	expect(fitLabel("Claude and GPT models (7d)", 19)).toEndWith(" (7d)");
	expect(fitLabel("Short (7d)", 19)).toBe("Short (7d)");
});
