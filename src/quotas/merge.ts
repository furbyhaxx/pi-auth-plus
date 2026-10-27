/** Combines endpoint metadata with newer response-header quota observations. */
import type { QuotaState } from "./state.ts";
import type { ProviderQuotaSnapshot } from "./types.ts";

/** Returns the freshest reported window values without changing endpoint freshness. */
export function effectiveSnapshot(state: QuotaState): ProviderQuotaSnapshot | undefined {
	const endpoint = state.snapshot;
	const headers = state.headers;
	if (!endpoint) return headers?.snapshot;
	if (!headers || headers.observedAt <= endpoint.fetchedAt) return endpoint;
	const windows = new Map(endpoint.windows.map((window) => [window.id, window]));
	for (const incoming of headers.snapshot.windows) {
		const previous = windows.get(incoming.id);
		windows.set(
			incoming.id,
			previous
				? {
						...previous,
						...(incoming.usedFraction === undefined
							? {}
							: { usedFraction: incoming.usedFraction, valueText: incoming.valueText }),
						resetAtMs: incoming.resetAtMs ?? previous.resetAtMs,
					}
				: incoming,
		);
	}
	return {
		...endpoint,
		tier: headers.snapshot.tier ?? endpoint.tier,
		credits: headers.snapshot.credits ?? endpoint.credits,
		resetCredits: headers.snapshot.resetCredits ?? endpoint.resetCredits,
		windows: [...windows.values()],
	};
}
