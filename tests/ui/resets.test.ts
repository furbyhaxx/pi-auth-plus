import { describe, expect, test } from "bun:test";
import { Registry } from "../../src/core/registry/index.ts";
import type { QuotaReport } from "../../src/quotas/report.ts";
import type { ResetRequester } from "../../src/quotas/resets.ts";
import type { ResetCredit } from "../../src/quotas/types.ts";
import { confirmReset, type ResetFlowDeps, runResetFlow } from "../../src/ui/commands/resets.ts";

const credit: ResetCredit = {
	id: "credit",
	type: "reset",
	title: "Rate limit reset",
	status: "available",
};
const registry = new Registry([
	{
		id: "example",
		label: "Example",
		providers: [{ id: "example", label: "Example", aliases: ["ex"] }],
	},
]);
const report: QuotaReport = {
	v: 1,
	generatedAt: 0,
	providers: [
		{
			id: "example",
			title: "Example",
			short: "ex",
			state: "ok",
			windows: [
				{ id: "5h", label: "Session", shortLabel: "5h", period: "5h", usedFraction: 0.8 },
				{ id: "7d", label: "Weekly", shortLabel: "7d" },
			],
		},
	],
};

function rig(choice?: string, hasUI = true) {
	const calls: [string, string, ResetRequester | undefined][] = [];
	const notices: [string, string][] = [];
	const dialogs: [string, string[]][] = [];
	let credits = [credit];
	let fail = false;
	const deps: ResetFlowDeps = {
		report: () => report,
		resetSupport: (id) => id === "example",
		listResets: async () => ({
			provider: "example",
			fetchedAt: 0,
			available: credits.length,
			credits,
		}),
		consumeReset: async (id, creditId, requester) => {
			calls.push([id, creditId, requester]);
			if (fail) throw new Error("Consume failed; check provider status.");
			return { provider: id, creditId, code: "reset", windowsReset: 2 };
		},
	};
	const ctx = {
		hasUI,
		ui: {
			select: async (title: string, options: string[]) => {
				dialogs.push([title, options]);
				return choice;
			},
		},
	};
	const run = (requester: "panel" | "command" = "command") =>
		runResetFlow(ctx, "example", requester, deps, registry, (text, tone) => {
			notices.push([text, tone]);
		});
	return {
		ctx,
		deps,
		run,
		calls,
		notices,
		dialogs,
		empty: () => {
			credits = [];
		},
		fail: () => {
			fail = true;
		},
	};
}

describe("reset approval", () => {
	for (const choice of ["Keep the credit", undefined]) {
		test(`safe choice ${String(choice)} never consumes`, async () => {
			const f = rig(choice);
			await f.run();
			expect(f.calls).toEqual([]);
			expect(f.notices).toEqual([["Reset cancelled; no credit was spent.", "info"]]);
			expect(f.dialogs).toEqual([
				[
					"Spend one Example reset credit? Rate limit reset (available). Current: 5h 80% used, Weekly ? used.",
					["Keep the credit", "Spend 1 credit now (cannot be undone)"],
				],
			]);
		});
	}
	for (const requester of ["panel", "command"] as const) {
		test(`spend consumes once as ${requester} and reports the outcome`, async () => {
			const f = rig("Spend 1 credit now (cannot be undone)");
			await f.run(requester);
			expect(f.calls).toEqual([["example", "credit", requester]]);
			expect(f.notices).toEqual([
				["Example: reset applied; 2 windows reset, one credit spent.", "info"],
			]);
		});
	}
	test("headless and unavailable credits list why nothing was spent", async () => {
		const headless = rig(undefined, false);
		await headless.run();
		expect(headless.notices[0]?.[0]).toContain("Example: 1 reset credit available");
		expect(headless.notices[0]?.[0]).toContain("No interactive UI is available");
		const empty = rig();
		empty.empty();
		await empty.run();
		expect(empty.notices[0]?.[0]).toContain("No redeemable reset credit available");
		expect([...headless.calls, ...empty.calls, ...headless.dialogs, ...empty.dialogs]).toEqual([]);
	});
	test("consume errors are reported without retry", async () => {
		const f = rig("Spend 1 credit now (cannot be undone)");
		f.fail();
		await f.run();
		expect(f.calls).toHaveLength(1);
		expect(f.notices).toEqual([["Consume failed; check provider status.", "error"]]);
	});
	test("bus uses the same safe select and refuses without UI", async () => {
		const f = rig("Keep the credit");
		expect(await confirmReset(f.ctx, "example", credit, "bus", report, registry)).toBe(false);
		expect(f.dialogs[0]?.[0]).toStartWith(
			"Another extension requests this reset. Spend one Example",
		);
		const headless = rig("Spend 1 credit now (cannot be undone)", false);
		expect(await confirmReset(headless.ctx, "example", credit, "bus", report, registry)).toBe(
			false,
		);
		expect(await confirmReset(undefined, "example", credit, "bus", report, registry)).toBe(false);
		expect(headless.dialogs).toEqual([]);
	});
});
