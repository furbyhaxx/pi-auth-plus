/** Owns Antigravity quota discovery, requests and bucket normalization. */
import { createHash } from "node:crypto";
import { type FetchFn, request } from "../../core/http/index.ts";
import type { ProviderQuotaSnapshot, QuotaSource, QuotaWindow } from "../../quotas/types.ts";
import { PROVIDER } from "./catalog.ts";
import { antigravityProject } from "./project.ts";
import { BASE_URL, cliHeaders } from "./transport.ts";

const QUOTA_URL = `${BASE_URL}/v1internal:retrieveUserQuotaSummary`;

interface PayloadObject {
	readonly groups?: unknown;
	readonly buckets?: unknown;
	readonly bucketId?: unknown;
	readonly displayName?: unknown;
	readonly window?: unknown;
	readonly resetTime?: unknown;
	readonly remainingFraction?: unknown;
}

function object(value: unknown): value is PayloadObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function usedFraction(bucket: PayloadObject): number | undefined {
	// Zero is explicit: pi-quotas/.project/research/provider-quota-credits-reporting.md:115-140.
	const remaining = bucket.remainingFraction;
	return typeof remaining === "number" && Number.isFinite(remaining)
		? 1 - Math.max(0, Math.min(1, remaining))
		: undefined;
}

function groupTag(id: string, name: string | undefined): string {
	if (id.startsWith("gemini-argon")) return "arg";
	if (id.startsWith("gemini-")) return "gem";
	if (id.startsWith("3p-")) return "3p";
	return (name ?? "pool").slice(0, 3).toLowerCase();
}

function missing(field: string): Error {
	return new Error(`${PROVIDER}: ${QUOTA_URL} missing ${field}; retry or update pi-auth-plus`);
}

/** Parses reported windows without inferring usage or exposing the project as a tier. */
export function parseAntigravityQuota(body: unknown, fetchedAt: number): ProviderQuotaSnapshot {
	if (!object(body)) throw missing("quota groups or buckets");
	const groups: PayloadObject[] = [];
	if (Array.isArray(body.groups)) {
		for (const group of body.groups) {
			if (!object(group)) throw missing("quota group object");
			groups.push(group);
		}
	}
	const windows: QuotaWindow[] = [];
	const seen = new Set<string>();

	function appendGroup(group: PayloadObject): void {
		if (!Array.isArray(group.buckets)) throw missing("group buckets");
		const buckets: PayloadObject[] = [];
		for (const bucket of group.buckets) {
			if (!object(bucket) || !text(bucket.bucketId)) throw missing("bucketId");
			buckets.push(bucket);
		}
		const name = text(group.displayName);
		const tag = groupTag(text(buckets[0]?.bucketId) ?? "", name);
		let maxUsed = -1;
		let maxIndex = -1;
		for (const [index, bucket] of buckets.entries()) {
			const used = usedFraction(bucket);
			if (used !== undefined && used > maxUsed) {
				maxUsed = used;
				maxIndex = index;
			}
		}
		for (const [index, bucket] of buckets.entries()) {
			const id = text(bucket.bucketId);
			if (!id) throw missing("bucketId");
			if (seen.has(id)) continue;
			seen.add(id);
			const window = text(bucket.window);
			const period = window === "weekly" ? "7d" : window;
			const important = index === maxIndex;
			const reset = text(bucket.resetTime);
			const resetAtMs = reset ? Date.parse(reset) : Number.NaN;
			windows.push({
				id,
				shortLabel: important || buckets.length === 1 ? tag : `${tag}:${period ?? ""}`,
				label: `${name ?? tag} (${period || text(bucket.displayName) || "limit"})`,
				usedFraction: usedFraction(bucket),
				resetAtMs: Number.isFinite(resetAtMs) ? resetAtMs : undefined,
				important,
				group: name,
				period,
				scope: id.startsWith("gemini-argon-")
					? "gemini-4-argon"
					: id.startsWith("gemini-")
						? "gemini"
						: id.startsWith("3p-")
							? "3p"
							: (name ?? text(bucket.displayName) ?? tag).toLowerCase(),
			});
		}
	}

	for (const group of groups) appendGroup(group);
	if (Array.isArray(body.buckets)) {
		const flatGroups = new Map<string, PayloadObject[]>();
		for (const bucket of body.buckets) {
			if (!object(bucket)) throw missing("quota bucket object");
			const id = text(bucket.bucketId);
			if (!id) throw missing("bucketId");
			if (seen.has(id)) continue;
			const tag = groupTag(id, undefined);
			const buckets = flatGroups.get(tag) ?? [];
			buckets.push(bucket);
			flatGroups.set(tag, buckets);
		}
		for (const buckets of flatGroups.values()) appendGroup({ buckets });
	}
	if (windows.length === 0) throw missing("quota buckets");
	return { provider: PROVIDER, fetchedAt, source: "endpoint", windows };
}

/** Creates a quota source with credential-scoped project discovery through the caller transport. */
export function antigravityQuota(): QuotaSource {
	const projects = new Map<string, Promise<string>>();

	async function projectFor(
		token: string,
		fetch: FetchFn,
		signal: AbortSignal,
		now: () => number,
	): Promise<string> {
		signal.throwIfAborted();
		const key = createHash("sha256").update(token).digest("hex");
		let pending = projects.get(key);
		if (!pending) {
			let requestError: Error | undefined;
			const project = antigravityProject({
				headers: () => cliHeaders(),
				fetch: async (input, init) => {
					try {
						return await request(String(input), {
							...init,
							provider: PROVIDER,
							fetch,
							timeoutMs: 10_000,
							now,
							secrets: [token],
						});
					} catch (error) {
						// Discovery wraps request errors; preserve typed backoff and timeout details.
						if (error instanceof Error) requestError = error;
						throw error;
					}
				},
			});
			pending = project.resolve(token, signal).catch((error: unknown) => {
				projects.delete(key);
				throw requestError ?? error;
			});
			projects.set(key, pending);
		}
		const project = await pending;
		signal.throwIfAborted();
		return project;
	}

	return {
		kind: "windows",
		shortLabel: "ag",
		parserVersion: 1,
		minPollMs: 60_000,
		async fetch(ctx) {
			const auth = await ctx.auth();
			if (!auth) {
				return {
					provider: PROVIDER,
					fetchedAt: ctx.now(),
					source: "endpoint",
					windows: [],
					needsAuth: true,
					error: `${PROVIDER}: no login; run /login ${PROVIDER}`,
				};
			}
			const signal = ctx.signal;
			const project = await projectFor(auth.token, ctx.fetch, signal, ctx.now);
			const response = await request(QUOTA_URL, {
				provider: PROVIDER,
				fetch: ctx.fetch,
				signal,
				timeoutMs: 10_000,
				secrets: [auth.token, project],
				now: ctx.now,
				method: "POST",
				headers: cliHeaders(auth.token),
				body: JSON.stringify({ project }),
			});
			let body: unknown;
			try {
				body = await response.json();
			} catch {
				signal.throwIfAborted();
				throw missing("valid JSON quota body");
			}
			signal.throwIfAborted();
			return parseAntigravityQuota(body, ctx.now());
		},
	};
}
