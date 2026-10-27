import { expect, test } from "bun:test";
import { effectiveSnapshot } from "../../src/quotas/merge.ts";
import type { ProviderQuotaSnapshot } from "../../src/quotas/types.ts";

const endpoint: ProviderQuotaSnapshot = {
	provider: "fake",
	source: "endpoint",
	fetchedAt: 100,
	tier: "endpoint",
	credits: { currency: "$", remaining: 10 },
	resetCredits: 2,
	windows: [
		{
			id: "5h",
			label: "Five hours",
			shortLabel: "5h",
			period: "5h",
			scope: "plan",
			important: true,
			group: "Plan",
			usedFraction: 0.2,
			valueText: "20%",
			resetAtMs: 500,
		},
	],
};
const header: ProviderQuotaSnapshot = {
	provider: "fake",
	source: "headers",
	fetchedAt: 200,
	tier: "header",
	windows: [
		{
			id: "5h",
			label: "Header",
			shortLabel: "h",
			period: "wrong",
			scope: "wrong",
			important: false,
			group: "Header",
			usedFraction: 0.5,
			valueText: "50%",
			resetAtMs: 600,
		},
		{ id: "7d", label: "Week", shortLabel: "7d" },
	],
};

test("newer headers overlay values and append windows while retaining endpoint metadata", () => {
	const merged = effectiveSnapshot({
		snapshot: endpoint,
		headers: { snapshot: header, observedAt: 200 },
		drainage: [],
	});
	expect(merged).toEqual({
		...endpoint,
		tier: "header",
		windows: [
			...endpoint.windows.map((window) => ({
				...window,
				usedFraction: 0.5,
				valueText: "50%",
				resetAtMs: 600,
			})),
			...header.windows.slice(1),
		],
	});
	expect(endpoint.windows[0]?.usedFraction).toBe(0.2);
});

test("unknown header usage never erases known endpoint usage and absent tier falls back", () => {
	const merged = effectiveSnapshot({
		snapshot: endpoint,
		headers: {
			snapshot: {
				...header,
				tier: undefined,
				windows: [{ id: "5h", label: "Header", shortLabel: "h" }],
			},
			observedAt: 200,
		},
		drainage: [],
	});
	expect(merged?.windows[0]?.usedFraction).toBe(0.2);
	expect(merged?.tier).toBe("endpoint");
});

test("endpoint wins over older or simultaneous headers", () => {
	for (const observedAt of [99, 100]) {
		expect(
			effectiveSnapshot({
				snapshot: endpoint,
				headers: { snapshot: header, observedAt },
				drainage: [],
			}),
		).toBe(endpoint);
	}
});

test("missing endpoint or headers returns the available snapshot", () => {
	expect(effectiveSnapshot({ drainage: [] })).toBeUndefined();
	expect(effectiveSnapshot({ snapshot: endpoint, drainage: [] })).toBe(endpoint);
	expect(effectiveSnapshot({ headers: { snapshot: header, observedAt: 200 }, drainage: [] })).toBe(
		header,
	);
});
