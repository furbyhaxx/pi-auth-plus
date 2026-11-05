/** Persists the Synthetic catalog for hosts that never refresh a provider registration. */
import { join } from "node:path";
import { HostCache } from "../../core/cache/index.ts";
import { type FetchFn, ProviderHttpError } from "../../core/http/index.ts";
import { cacheDir, type PathEnv } from "../../core/paths/index.ts";
import { redactText } from "../../core/redact/index.ts";
import {
	CATALOG_PARSER_VERSION,
	CATALOG_PRIME_BACKOFF_MS,
	CATALOG_PRIME_TIMEOUT_MS,
	CATALOG_TTL_MS,
	fetchCatalog,
	PROVIDER,
	parseStoredCatalog,
	type SyntheticModel,
} from "./catalog.ts";

export const CATALOG_CACHE_KEY = "catalog";

/** The host-shared catalog cache; one file, written under the host's file lock. */
export function syntheticCatalogCache(env: PathEnv = process.env): HostCache<SyntheticModel[]> {
	return new HostCache<SyntheticModel[]>({
		path: join(cacheDir(env), PROVIDER, "catalog.json"),
		parse: parseStoredCatalog,
		parserVersion: () => CATALOG_PARSER_VERSION,
	});
}

/** The persisted catalog, when this host has one. */
export function cachedCatalog(cache: HostCache<SyntheticModel[]>): SyntheticModel[] | undefined {
	return cache.get(CATALOG_CACHE_KEY)?.value;
}

/**
 * Refreshes the persisted catalog at most once per TTL. A failure backs off and never throws:
 * the caller keeps whatever the cache already holds and startup proceeds.
 */
export async function primeCatalogCache(
	cache: HostCache<SyntheticModel[]>,
	options: { readonly fetch: FetchFn; readonly now: () => number; readonly signal?: AbortSignal },
): Promise<void> {
	const signal = options.signal ?? new AbortController().signal;
	if (!(await cache.tryAcquire(CATALOG_CACHE_KEY, { minAgeMs: CATALOG_TTL_MS }, signal))) return;
	try {
		const models = await fetchCatalog(options.fetch, signal, CATALOG_PRIME_TIMEOUT_MS);
		await cache.put(CATALOG_CACHE_KEY, models, signal);
	} catch (error) {
		await cache.fail(
			CATALOG_CACHE_KEY,
			{
				backoffMs: CATALOG_PRIME_BACKOFF_MS,
				...(error instanceof ProviderHttpError ? { status: error.status } : {}),
				error: redactText(error instanceof Error ? error.message : String(error)),
			},
			signal,
		);
	}
}
