import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { useCredentialReader } from "../../src/core/auth/index.ts";
import {
	hostCredentialReader,
	hostFamilies,
	ompFamilies,
	registerOmpUsage,
} from "../../src/core/host/omp.ts";
import type { FamilyAdapter } from "../../src/core/registry/index.ts";
import type { QuotaAuth, QuotaSource } from "../../src/quotas/types.ts";

const quota: QuotaSource = {
	kind: "windows",
	shortLabel: "q",
	parserVersion: 1,
	fetch: async () => ({ provider: "x", fetchedAt: 0, source: "endpoint", windows: [] }),
};

const families: FamilyAdapter[] = [
	{
		id: "zen",
		label: "Zen",
		ompBuiltin: "all",
		providers: [{ id: "zen", label: "Zen", aliases: [] }],
	},
	{
		id: "syn",
		label: "Syn",
		ompBuiltin: "provider",
		providers: [{ id: "syn", label: "Syn", aliases: [], quota }],
		providerRegistrations: () => [],
		register: () => {},
		tokens: () => undefined,
	},
	{
		id: "cl",
		label: "Claude",
		providers: [
			{
				id: "claude",
				label: "Claude",
				aliases: [],
				quota,
				ompLogins: [{ id: "claude" }, { id: "anthropic", oauthOnly: true }],
				ompUsage: true,
			},
		],
		register: () => {},
	},
];

function fakeApi(extra: Record<string, unknown> = {}): ExtensionAPI {
	return extra as unknown as ExtensionAPI;
}

function storeOf(slots: Record<string, unknown>) {
	return { authStorage: { credentials: { get: (id: string) => slots[id] } } };
}

afterEach(() => useCredentialReader(undefined));

describe("core/host omp families", () => {
	test("Pi keeps every family unchanged", () => {
		expect(hostFamilies(fakeApi(), families)).toEqual(families);
	});

	test("omp drops what it ships and keeps quota and token parts", () => {
		const projected = ompFamilies(families);
		expect(projected.map((family) => family.id)).toEqual(["syn", "cl"]);
		const syn = projected[0];
		expect(syn?.providerRegistrations).toBeUndefined();
		expect(syn?.register).toBeUndefined();
		expect(syn?.tokens).toBeDefined();
		expect(syn?.providers[0]?.quota).toBe(quota);
		expect(projected[1]?.register).toBeDefined();
	});

	test("a quota reads omp's own login when ours is missing, OAuth only where required", async () => {
		const claude = ompFamilies(families)[1]?.providers[0];
		const auth = claude?.quota?.auth;
		if (!auth) throw new Error("quota auth missing");
		const lookups: string[] = [];
		const lookup = async (id: string): Promise<QuotaAuth | undefined> => {
			lookups.push(id);
			return id === "anthropic" ? { token: "t", extra: {} } : undefined;
		};
		const signal = new AbortController().signal;

		useCredentialReader(
			hostCredentialReader(storeOf({ anthropic: { type: "api_key", key: "k" } })),
		);
		expect(await auth(lookup, signal)).toBeUndefined();
		expect(lookups).toEqual(["claude"]);
		expect(claude?.login?.status?.(0)).toEqual({ state: "missing" });

		lookups.length = 0;
		useCredentialReader(
			hostCredentialReader(
				storeOf({ anthropic: { type: "oauth", access: "a", refresh: "r", expires: 10 } }),
			),
		);
		expect(await auth(lookup, signal)).toEqual({ token: "t", extra: {} });
		expect(lookups).toEqual(["claude", "anthropic"]);
		expect(claude?.login?.status?.(0)).toEqual({ state: "oauth", expiresAt: 10, expired: false });
		expect(claude?.login?.hint).toBe("/login claude or /login anthropic");
	});
});

describe("core/host omp usage", () => {
	test("usage readers register on omp's runtime for providers that ask", async () => {
		const registered: [string, { usage: { fetchUsage: () => Promise<unknown> } }][] = [];
		const runtime = {
			registerProvider: (name: string, config: { usage: { fetchUsage: () => Promise<unknown> } }) =>
				registered.push([name, config]),
		};
		const providers = families.flatMap((family) => family.providers);
		registerOmpUsage(fakeApi(), providers, async () => null);
		expect(registered).toEqual([]);
		registerOmpUsage(fakeApi({ runtime }), providers, async (id) => ({
			provider: id,
			fetchedAt: 1,
			limits: [],
		}));
		expect(registered.map(([name]) => name)).toEqual(["claude"]);
		const [entry] = registered;
		if (!entry) throw new Error("usage not registered");
		expect(await entry[1].usage.fetchUsage()).toEqual({
			provider: "claude",
			fetchedAt: 1,
			limits: [],
		});
	});
});
