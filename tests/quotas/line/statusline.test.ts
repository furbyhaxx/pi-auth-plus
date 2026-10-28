import { describe, expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { parseColor } from "@earendil-works/pi-tui";
import type { AppSettings } from "../../../src/core/config/catalog.ts";
import { SETTINGS } from "../../../src/core/config/catalog.ts";
import { Registry } from "../../../src/core/registry/index.ts";
import { FAMILIES } from "../../../src/families/index.ts";
import type { QuotaEngine, QuotaView } from "../../../src/quotas/engine.ts";
import type { LineTheme } from "../../../src/quotas/line/format.ts";
import { createQuotaStatusline } from "../../../src/quotas/line/statusline.ts";
import type { ProviderQuotaSnapshot } from "../../../src/quotas/types.ts";

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
function defaults(template?: string): AppSettings {
	return {
		get: (key: string) =>
			key === "quotas.lineTemplate" && template !== undefined
				? template
				: SETTINGS[key as keyof typeof SETTINGS]?.default,
	} as unknown as AppSettings;
}
const settings = defaults();

function snapshot(id: string, usedFraction: number): ProviderQuotaSnapshot {
	return {
		provider: id,
		windows: [{ kind: "rolling", period: "5h", usedFraction, scope: "main" }],
		fetchedAt: 0,
	} as unknown as ProviderQuotaSnapshot;
}

function engine(views: QuotaView[]): QuotaEngine {
	return { view: () => views, onChange: () => () => {} } as unknown as QuotaEngine;
}

const views: QuotaView[] = [
	{
		provider: { id: "claude", label: "Claude", quota: { shortLabel: "cc" } },
		snapshot: snapshot("claude", 0.25),
	},
	{
		provider: { id: "antigravity", label: "Antigravity", quota: { shortLabel: "agy" } },
		snapshot: snapshot("antigravity", 0.3),
	},
] as unknown as QuotaView[];

type TestSegment = {
	id: string;
	render(ctx: unknown): { lines: readonly string[]; zero?: boolean };
};

function host() {
	const registrations = new Map<string, { segment: TestSegment; disposed: number }>();
	return {
		version: 1 as const,
		generation: "gen-1",
		register(owner: string, segment: TestSegment) {
			if (!segment.id.startsWith(`${owner}:`)) return undefined;
			const entry = { segment, disposed: 0 };
			registrations.set(segment.id, entry);
			return {
				update(next: TestSegment) {
					entry.segment = next;
					return true;
				},
				dispose() {
					entry.disposed++;
					registrations.delete(segment.id);
				},
			};
		},
		segment: () => registrations.get("pi-auth-plus:quotas")?.segment,
	};
}

describe("quota statusline segment", () => {
	test("registers on the workbench host and renders the template with in-use providers", () => {
		const bus = createEventBus();
		const target = host();
		const statusline = createQuotaStatusline({ events: bus } as never, {
			engine: engine(views),
			registry,
			settings: () => defaults("{in-use}"),
			now: () => 0,
		});
		statusline.start();
		expect(statusline.owned()).toBe(false);
		bus.emit("workbench:v1:statusline:ready", target);
		expect(statusline.owned()).toBe(true);
		const segment = target.segment();
		expect(segment).toBeDefined();
		const all = segment?.render({ width: 120, theme, maxRows: 4, providersInUse: [] });
		expect(all?.lines.length).toBeGreaterThan(0);
		const scoped = segment?.render({
			width: 120,
			theme,
			maxRows: 4,
			providersInUse: ["claude"],
		});
		const text = scoped?.lines.join(" ") ?? "";
		expect(text).toContain("Claude");
		expect(text).not.toContain("antigravity");
		expect(statusline.owned()).toBe(true);
	});

	test("stops owning the row on dispose and answers a late query", () => {
		const bus = createEventBus();
		const statusline = createQuotaStatusline({ events: bus } as never, {
			engine: engine(views),
			registry,
			settings: () => settings,
			now: () => 0,
		});
		let notified = 0;
		statusline.onOwnership(() => notified++);
		statusline.start();
		const target = host();
		bus.emit("workbench:v1:statusline:query", (reply: unknown) => {
			expect(reply).toBeTruthy();
		});
		bus.emit("workbench:v1:statusline:ready", target);
		expect(notified).toBe(2);
		statusline.stop();
		expect(statusline.owned()).toBe(false);
		expect(notified).toBe(3);
	});

	test("an owner prefix conflict leaves the legacy rows in charge", () => {
		const bus = createEventBus();
		const statusline = createQuotaStatusline({ events: bus } as never, {
			engine: engine(views),
			registry,
			settings: () => settings,
			now: () => 0,
		});
		statusline.start();
		bus.emit("workbench:v1:statusline:ready", {
			version: 1,
			generation: "gen-1",
			register: () => undefined,
		});
		expect(statusline.owned()).toBe(false);
	});
});
