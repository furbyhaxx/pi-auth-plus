/** Owns session-local Antigravity project discovery without credential persistence. */
import { createHash } from "node:crypto";
import { type FetchFn, ProviderHttpError, request } from "../../core/http/index.ts";
import { BASE_URL } from "./transport.ts";

const LOAD_URL = `${BASE_URL}/v1internal:loadCodeAssist`;

/** A project discovery failure safe to surface to the user. */
export class AntigravityProjectError extends Error {
	override readonly name = "AntigravityProjectError";
	readonly status: number | undefined;

	constructor(operation: string, status?: number) {
		super(
			`antigravity: loadCodeAssist ${operation} at ${LOAD_URL}${status === undefined ? "" : ` (HTTP ${status})`}; sign in to Antigravity once, then run /login antigravity again`,
		);
		this.status = status;
	}
}

/** Creates a resolver that discovers the project once per credential key. */
export function antigravityProject(deps: {
	fetch?: FetchFn;
	headers: () => Record<string, string>;
	/** Stable credential key, the access token by default; only its SHA-256 hash is cached. */
	cacheKey?: (accessToken: string) => string;
}): {
	/** Discovers once per credential, sharing concurrent requests until reset. */
	resolve(accessToken: string, signal: AbortSignal): Promise<string>;
	/** Detaches cached and pending discoveries at session start. */
	reset(): void;
} {
	let discoveries = new Map<string, Promise<string>>();

	async function discover(accessToken: string, signal: AbortSignal): Promise<string> {
		try {
			const response = await request(LOAD_URL, {
				provider: "antigravity",
				fetch: deps.fetch ?? fetch,
				signal,
				secrets: [accessToken],
				method: "POST",
				headers: {
					...deps.headers(),
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
			});
			const payload: unknown = await response.json();
			signal.throwIfAborted();
			if (
				typeof payload === "object" &&
				payload !== null &&
				"cloudaicompanionProject" in payload &&
				typeof payload.cloudaicompanionProject === "string" &&
				payload.cloudaicompanionProject.trim()
			)
				return payload.cloudaicompanionProject;
			throw new AntigravityProjectError("returned no project");
		} catch (error) {
			signal.throwIfAborted();
			if (error instanceof AntigravityProjectError) throw error;
			throw new AntigravityProjectError(
				"discovery failed",
				error instanceof ProviderHttpError ? error.status : undefined,
			);
		}
	}

	return {
		async resolve(accessToken, signal) {
			signal.throwIfAborted();
			const key = createHash("sha256")
				.update(deps.cacheKey?.(accessToken) ?? accessToken)
				.digest("hex");
			const cache = discoveries;
			let pending = cache.get(key);
			if (!pending) {
				pending = discover(accessToken, signal).catch((error: unknown) => {
					cache.delete(key);
					throw error;
				});
				cache.set(key, pending);
			}
			const project = await pending;
			signal.throwIfAborted();
			return project;
		},
		reset() {
			discoveries = new Map();
		},
	};
}
