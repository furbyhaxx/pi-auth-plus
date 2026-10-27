import { expect, test } from "bun:test";
import { Registry } from "../../src/core/registry/index.ts";
import {
	describeResetCredit,
	describeResetList,
	describeResetOutcome,
	formatResetDate,
	pickResetCredit,
	unsupportedResetMessage,
} from "../../src/quotas/resets.ts";
import type { ResetCreditList, ResetOutcomeCode } from "../../src/quotas/types.ts";

const registry = new Registry([
	{
		id: "fake",
		label: "Family",
		providers: [{ id: "fake", label: "Provider label", aliases: [] }],
	},
]);
const list: ResetCreditList = {
	provider: "fake",
	fetchedAt: 0,
	available: 3,
	credits: [
		{ id: "long", type: "reset", status: "available", expiresAtMs: 300 },
		{ id: "unknown", type: "reset", status: "available" },
		{ id: "short", type: "reset", status: "available", expiresAtMs: 100 },
		{
			id: "unsupported",
			type: "reset",
			status: "available",
			expiresAtMs: 1,
			supportedByPlan: false,
		},
		{ id: "spent", type: "reset", status: "redeemed", expiresAtMs: 1 },
	],
};

test("credit choice preserves the longest-lived credit and the caller's order", () => {
	const before = [...list.credits];
	expect(pickResetCredit(list)?.id).toBe("short");
	expect(pickResetCredit(list, "long")?.id).toBe("long");
	expect(pickResetCredit(list, "unsupported")).toBeUndefined();
	expect(pickResetCredit(list, "spent")).toBeUndefined();
	expect(pickResetCredit(list, "missing")).toBeUndefined();
	expect(pickResetCredit({ ...list, credits: [] })).toBeUndefined();
	expect(list.credits).toEqual(before);
});

test("reset descriptions use registry labels, scrub controls and show Zurich dates", () => {
	expect(formatResetDate(undefined)).toBe("-");
	expect(formatResetDate(Date.UTC(2026, 0, 1, 12, 30))).toBe("2026-01-01 13:30");
	expect(formatResetDate(Date.UTC(2026, 6, 1, 12, 30))).toBe("2026-07-01 14:30");
	expect(
		describeResetCredit({
			id: "one",
			type: "reset",
			title: "\u001b[31mCredit\u001b[0m\n",
			status: "available",
		}),
	).toBe("Credit  (available)");
	expect(describeResetList({ ...list, credits: [] }, registry)).toBe(
		"Provider label: 3 reset credits available",
	);
	expect(
		describeResetList(
			{
				...list,
				provider: "unknown",
				available: 1,
				credits: [
					{ id: "one", type: "reset", status: "available", expiresAtMs: Date.UTC(2026, 0, 1) },
				],
			},
			registry,
		),
	).toBe("unknown: 1 reset credit available\n  reset (available, expires 2026-01-01 01:00)");
	expect(unsupportedResetMessage("fake", ["other"])).toContain("Supported: other.");
	expect(unsupportedResetMessage("fake", [])).toContain("Supported: none.");
});

for (const code of [
	"reset",
	"nothing_to_reset",
	"no_credit",
	"already_redeemed",
] satisfies ResetOutcomeCode[]) {
	test(`outcome ${code} explains whether credit was spent`, () => {
		const result = describeResetOutcome(
			{ provider: "fake", code, creditId: "one", windowsReset: 1 },
			registry,
		);
		expect(result.text).toStartWith("Provider label:");
		expect(result.tone).toBe(code === "reset" ? "info" : "warning");
		if (code === "reset") expect(result.text).toContain("1 window reset, one credit spent");
		else if (code === "already_redeemed") expect(result.text).toContain("already redeemed");
		else
			expect(result.text).toContain(
				code === "no_credit" ? "nothing was spent" : "no credit was spent",
			);
	});
}
