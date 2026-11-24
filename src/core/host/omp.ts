/**
 * How pi-auth-plus splits work with oh-my-pi, which ships its own providers, logins and usage
 * display: families declare what omp already serves, this module applies it when omp runs.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CredentialReader, credentialStatus, readCredential } from "../auth/index.ts";
import type { FamilyAdapter, OmpLogin, ProviderEntry } from "../registry/index.ts";

/** oh-my-pi's usage window, the subset we fill (`UsageWindow` in `@oh-my-pi/pi-ai`). */
export interface OmpUsageWindow {
	readonly id: string;
	readonly label: string;
	readonly durationMs?: number;
	readonly resetsAt?: number;
}

/** oh-my-pi's usage amount (`UsageAmount`). */
export interface OmpUsageAmount {
	readonly used?: number;
	readonly limit?: number;
	readonly remaining?: number;
	readonly usedFraction?: number;
	readonly remainingFraction?: number;
	readonly unit: "percent" | "usd" | "credits";
}

/** oh-my-pi's usage status (`UsageStatus`). */
export type OmpUsageStatus = "ok" | "warning" | "exhausted" | "unknown";

/** oh-my-pi's usage limit (`UsageLimit`). */
export interface OmpUsageLimit {
	readonly id: string;
	readonly label: string;
	readonly scope: { readonly provider: string; readonly windowId?: string; readonly tier?: string };
	readonly window?: OmpUsageWindow;
	readonly amount: OmpUsageAmount;
	readonly status?: OmpUsageStatus;
	readonly notes?: readonly string[];
}

/** oh-my-pi's usage report (`UsageReport`). */
export interface OmpUsageReport {
	readonly provider: string;
	readonly fetchedAt: number;
	readonly limits: readonly OmpUsageLimit[];
	readonly notes?: readonly string[];
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** oh-my-pi's usage provider (`UsageProvider`); it caches results in its own database. */
interface OmpUsageProvider {
	readonly id: string;
	readonly cacheVersion: number;
	fetchUsage(params: unknown, ctx: unknown): Promise<OmpUsageReport | null>;
}

/** omp's runtime registry; it takes named configs only. */
export interface OmpRuntime {
	registerProvider(name: string, config: object): void;
}

/** omp's provider registration lives on `pi.runtime`; no other host has one. */
export function ompRuntime(pi: ExtensionAPI): OmpRuntime | undefined {
	if (!("runtime" in pi)) return undefined;
	const runtime: unknown = pi.runtime;
	if (typeof runtime !== "object" || runtime === null || !("registerProvider" in runtime))
		return undefined;
	const register = runtime.registerProvider;
	if (typeof register !== "function") return undefined;
	return { registerProvider: (name, config) => register.call(runtime, name, config) };
}

/** True when the extension runs inside oh-my-pi. */
export function isOmp(pi: ExtensionAPI): boolean {
	return ompRuntime(pi) !== undefined;
}

/** omp keeps logins in its database, not `auth.json`; its registry exposes them per provider. */
export function hostCredentialReader(registry: unknown): CredentialReader | undefined {
	if (typeof registry !== "object" || registry === null || !("authStorage" in registry))
		return undefined;
	const storage: unknown = registry.authStorage;
	if (typeof storage !== "object" || storage === null || !("credentials" in storage))
		return undefined;
	const credentials: unknown = storage.credentials;
	if (typeof credentials !== "object" || credentials === null || !("get" in credentials))
		return undefined;
	const get = credentials.get;
	if (typeof get !== "function") return undefined;
	return (providerId) => get.call(credentials, providerId);
}

function usableLogin(login: OmpLogin): boolean {
	return !login.oauthOnly || readCredential(login.id)?.type === "oauth";
}

function withOmpLogins(entry: ProviderEntry, logins: readonly OmpLogin[]): ProviderEntry {
	const quota = entry.quota;
	return {
		...entry,
		...(quota && !quota.auth
			? {
					quota: {
						...quota,
						auth: async (lookup) => {
							for (const login of logins) {
								if (!usableLogin(login)) continue;
								const auth = await lookup(login.id);
								if (auth) return auth;
							}
							return undefined;
						},
					},
				}
			: {}),
		login: entry.login ?? {
			hint: logins.map((login) => `/login ${login.id}`).join(" or "),
			status: (nowMs) => {
				for (const login of logins) {
					if (!usableLogin(login)) continue;
					const status = credentialStatus(readCredential(login.id), nowMs);
					if (status.state !== "missing") return status;
				}
				return { state: "missing" };
			},
		},
	};
}

/**
 * The families as omp should see them: vendors omp serves itself lose their providers and
 * request hooks (keeping quota and token parts), and quotas read omp's own login ids.
 */
export function ompFamilies(families: readonly FamilyAdapter[]): FamilyAdapter[] {
	return families.flatMap((family) => {
		if (family.ompBuiltin === "all") return [];
		const providers = family.providers.map((entry) =>
			entry.ompLogins ? withOmpLogins(entry, entry.ompLogins) : entry,
		);
		if (family.ompBuiltin === "provider")
			return [
				{
					id: family.id,
					label: family.label,
					providers,
					...(family.tokens ? { tokens: family.tokens } : {}),
				},
			];
		return [{ ...family, providers }];
	});
}

/** The families for the running host; only omp changes them. */
export function hostFamilies(
	pi: ExtensionAPI,
	families: readonly FamilyAdapter[],
): FamilyAdapter[] {
	return isOmp(pi) ? ompFamilies(families) : [...families];
}

/** Bump when the report shape changes, so omp drops reports it cached from older versions. */
const USAGE_CACHE_VERSION = 1;

/**
 * Registers usage readers with omp for every provider that asks for it. omp calls them for the
 * active model's provider and for `/usage`, and caches the reports itself.
 */
export function registerOmpUsage(
	pi: ExtensionAPI,
	providers: readonly ProviderEntry[],
	report: (providerId: string) => Promise<OmpUsageReport | null>,
): void {
	const runtime = ompRuntime(pi);
	if (!runtime) return;
	for (const provider of providers) {
		if (!provider.ompUsage || !provider.quota) continue;
		const id = provider.id;
		const usage: OmpUsageProvider = {
			id,
			cacheVersion: USAGE_CACHE_VERSION,
			fetchUsage: () => report(id),
		};
		runtime.registerProvider(id, { usage });
	}
}
