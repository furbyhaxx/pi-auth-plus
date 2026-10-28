import { describe, expect, test } from "bun:test";
import { parseColor, visibleWidth } from "@earendil-works/pi-tui";
import { SETTINGS } from "../../../src/core/config/catalog.ts";
import { Registry } from "../../../src/core/registry/index.ts";
import { FAMILIES } from "../../../src/families/index.ts";
import type { QuotaView } from "../../../src/quotas/engine.ts";
import type { LineTheme } from "../../../src/quotas/line/format.ts";
import {
	createQuotaLineRenderer,
	limitQuotaRows,
	type QuotaLineConfig,
} from "../../../src/quotas/line/line.ts";
import { compileLineTemplate } from "../../../src/quotas/line/template.ts";
import type { ProviderQuotaSnapshot, QuotaWindow } from "../../../src/quotas/types.ts";

const theme = {
	colors: {
		success: parseColor("#00ff00"),
		warning: parseColor("#ffff00"),
		error: parseColor("#ff0000"),
		muted: parseColor("#aaaaaa"),
		text: parseColor("#ffffff"),
	},
	fg: (_token: string, text: string) => text,
	style: (text: string) => text,
} as unknown as LineTheme;

const registry = new Registry(FAMILIES);
const resolve = (token: string) => registry.resolve(token)?.provider.id;
const config: QuotaLineConfig = {
	lineTemplate: SETTINGS["quotas.lineTemplate"].default,
	compactWidthCols: 100,
	alwaysShortIds: false,
	percentDisplay: "used",
	creditHealthyUsd: 50,
	creditCriticalUsd: 5,
};

function window(period: string, usedFraction: number, scope?: string): QuotaWindow {
	return {
		id: `${scope ?? "plan"}-${period}`,
		shortLabel: period,
		label: period,
		period,
		scope,
		usedFraction,
		important: true,
	};
}

const SNAPSHOTS: Record<
	string,
	Omit<ProviderQuotaSnapshot, "provider" | "fetchedAt" | "source">
> = {
	openrouter: { windows: [], credits: { remaining: 120.08, currency: "$" } },
	deepseek: { windows: [], credits: { remaining: 13.2, currency: "$" } },
	codex: { windows: [window("7d", 0.27)], resetCredits: 1 },
	claude: { windows: [window("5h", 0.2), window("7d", 0.24)] },
	antigravity: {
		windows: [window("7d", 0, "gemini"), window("7d", 1, "gemini-4-argon")],
	},
	synthetic: { windows: [window("7d", 0.84)] },
	xai: { windows: [window("7d", 0)] },
};

function views(): QuotaView[] {
	return registry
		.providers()
		.filter(({ provider }) => provider.quota)
		.map(({ provider }) => {
			const value = SNAPSHOTS[provider.id];
			return {
				provider,
				snapshot: value && {
					...value,
					provider: provider.id,
					fetchedAt: 0,
					source: "endpoint" as const,
				},
				backoff: undefined,
				refreshing: false,
				fetchedAt: 0,
			};
		});
}

describe("quota line rows", () => {
	test("the default template resolves every token against the real providers", () => {
		expect(compileLineTemplate(config.lineTemplate, resolve).unknown).toEqual([]);
		const rows = createQuotaLineRenderer(resolve)(300, theme, views(), config, 0);
		expect(rows).toEqual([
			"openrouter: 120.08$ · deepseek: 13.20$ · codex: 27% (1r) · claude: 5h/20% 7d/24% · antigravity: gem/0% arg/100% · synthetic: 84% · xai: 0%",
		]);
	});

	for (const width of [36, 57, 80, 140]) {
		test(`packs in-use expansion at ${width} columns`, () => {
			const rows = createQuotaLineRenderer(resolve)(
				width,
				theme,
				views(),
				{ ...config, lineTemplate: "{in-use:short}" },
				0,
				["openai-codex"],
			);
			for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
			const text = rows.join(" ");
			expect(text).toContain("27%");
			expect(text).toContain("100%");
			expect(text).toContain("+5");
		});
		test(`wraps every provider segment without losing data at ${width} columns`, () => {
			const rows = createQuotaLineRenderer(resolve)(width, theme, views(), config, 0);
			for (const row of rows) {
				expect(visibleWidth(row)).toBeLessThanOrEqual(width);
				expect(row).not.toMatch(/^ · | · $/);
			}
			const text = rows.join(" ");
			for (const value of [
				"120.08$",
				"13.20$",
				"27% (1r)",
				"5h/20% 7d/24%",
				"gem/0% arg/100%",
				"84%",
			])
				expect(text).toContain(value);
		});
	}

	test("a tall block keeps editor room and says how many rows exist", () => {
		const rows = Array.from({ length: 20 }, (_, index) => `provider ${index}`);
		expect(limitQuotaRows(36, theme, rows, 3)).toEqual([
			"provider 0",
			"provider 1",
			"… quota line has 20 rows",
		]);
		expect(limitQuotaRows(36, theme, rows, 0)).toEqual(["… quota line has 20 rows"]);
		expect(limitQuotaRows(36, theme, rows, 20)).toEqual(rows);
	});
});
