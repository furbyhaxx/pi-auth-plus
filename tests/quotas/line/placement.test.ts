import { expect, test } from "bun:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
	createFooterPlacement,
	type FooterPlacementContext,
} from "../../../src/quotas/line/placement.ts";
import type { FooterRows } from "../../../src/quotas/line/workbench.ts";

function rig() {
	const handlers = new Map<string, Set<(value: unknown) => void>>();
	const events: ExtensionAPI["events"] = {
		on(name, handler) {
			let set = handlers.get(name);
			if (!set) {
				set = new Set();
				handlers.set(name, set);
			}
			set.add(handler);
			return () => {
				set.delete(handler);
			};
		},
		emit(name, value) {
			for (const handler of handlers.get(name) ?? []) handler(value);
		},
	};
	let own = false;
	let renders = 0;
	let ownRenders = 0;
	const contributions = new Map<string, FooterRows>();
	const log: string[] = [];
	const ctx: FooterPlacementContext = {
		mode: "tui",
		hasUI: true,
		model: undefined,
		getContextUsage: () => undefined,
		sessionManager: {
			getEntries: () => [],
			getLeafId: () => null,
			getCwd: () => "/project",
			getSessionName: () => undefined,
		},
		ui: {
			setFooter(factory) {
				own = factory !== undefined;
				log.push(own ? "own" : "clear");
				expect(own && contributions.size > 0).toBe(false);
				factory?.(
					{
						terminal: { rows: 40 },
						requestRender() {
							ownRenders++;
						},
					} as TUI,
					{ fg: (_color: string, text: string) => text } as Theme,
					{
						getGitBranch: () => null,
						getAvailableProviderCount: () => 1,
						getExtensionStatuses: () => new Map(),
						onBranchChange: () => () => {},
					},
				);
			},
		},
	};
	const host = {
		setFooterRows(key: string, rows: FooterRows | undefined) {
			if (rows) contributions.set(key, rows);
			else contributions.delete(key);
			expect(own && contributions.size > 0).toBe(false);
		},
		requestFooterRender() {
			renders++;
		},
	};
	const rows: FooterRows = () => ["quota"];
	const placement = createFooterPlacement({ events, getThinkingLevel: () => "off" }, rows);
	return {
		events,
		ctx,
		host,
		placement,
		contributions,
		log,
		rows,
		renders: () => renders,
		ownRenders: () => ownRenders,
	};
}

test("own footer is mounted once, switching away and shutdown clear it", () => {
	const r = rig();
	r.placement.start(r.ctx, true);
	r.placement.setEnabled(true);
	expect(r.log).toEqual(["own"]);
	const renders = r.ownRenders();
	r.placement.requestRender();
	expect(r.ownRenders()).toBe(renders + 1);
	r.placement.setEnabled(false);
	expect(r.log).toEqual(["own", "clear"]);
	r.placement.setEnabled(true);
	r.placement.stop();
	r.placement.stop();
	expect(r.log).toEqual(["own", "clear", "own", "clear"]);
	r.placement.dispose();
});

test("workbench push before start joins its footer and routes refreshes", () => {
	const r = rig();
	r.events.emit("workbench:service", r.host);
	r.placement.start(r.ctx, true);
	expect(r.log).toEqual([]);
	expect(r.contributions.get("pi-auth-plus")).toBe(r.rows);
	r.placement.requestRender();
	expect(r.renders()).toBeGreaterThan(0);
	r.placement.setEnabled(false);
	expect(r.contributions.size).toBe(0);
	r.placement.dispose();
});

test("late push clears own footer before contributing and replaces hosts cleanly", () => {
	const r = rig();
	r.placement.start(r.ctx, true);
	r.events.emit("workbench:service", r.host);
	expect(r.log).toEqual(["own", "clear"]);
	expect(r.contributions.size).toBe(1);
	const other = new Map<string, FooterRows>();
	r.events.emit("workbench:service", {
		setFooterRows(key: string, rows: FooterRows | undefined) {
			expect(r.contributions.size).toBe(0);
			if (rows) other.set(key, rows);
			else other.delete(key);
		},
		requestFooterRender() {},
	});
	expect(other.size).toBe(1);
	r.placement.stop();
	expect(other.size).toBe(0);
	r.events.emit("workbench:service", r.host);
	expect(r.contributions.size).toBe(0);
	r.placement.dispose();
});

test("pull replies work synchronously or late, but cannot resurrect a stopped session", () => {
	for (const late of [false, true]) {
		const r = rig();
		let reply: ((value: unknown) => void) | undefined;
		r.events.on("workbench:service-request", (value) => {
			if (typeof value !== "function") throw new Error("Expected reply callback");
			reply = (service) => value(service);
			if (!late) reply(r.host);
		});
		r.placement.start(r.ctx, true);
		if (late) reply?.(r.host);
		expect(r.contributions.size).toBe(1);
		r.placement.stop();
		reply?.(r.host);
		expect(r.contributions.size).toBe(0);
		r.placement.dispose();
	}
});

test("headless contexts and invalid pushes do not mount a footer", () => {
	const r = rig();
	r.placement.start({ ...r.ctx, hasUI: false }, true);
	r.events.emit("workbench:service", {});
	expect(r.log).toEqual([]);
	r.placement.dispose();
});
