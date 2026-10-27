/** Antigravity's agent catalog, grouped thinking levels and Pi-owned refresh persistence. */
import { hasApi, type Model, type RefreshModelsContext } from "@earendil-works/pi-ai";
import snapshotText from "../../../assets/antigravity/models.json" with { type: "text" };
import { type FetchFn, ProviderHttpError, request } from "../../core/http/index.ts";
import { encodeLevel, type ThinkingSpec, type WireEffort } from "./levels.ts";
import { BASE_URL } from "./transport.ts";

export const PROVIDER = "antigravity";
export const CATALOG_URL = `${BASE_URL}/v1internal:fetchAvailableModels`;
// Match the CLI's model-config reload interval; entitlement changes can alter the offered list.
export const CATALOG_TTL_MS = 5 * 60 * 1000;

type AntigravityModel = Model<"google-generative-ai">;
let snapshot: AntigravityModel[] | undefined;

/** Transport, clock and session project resolution supplied by provider wiring. */
export interface CatalogDeps {
	readonly fetch: FetchFn;
	readonly now: () => number;
	readonly headers: () => Record<string, string>;
	readonly project: (accessToken: string, signal: AbortSignal) => Promise<string>;
}

/** Safe catalog failure; provider response bodies and credential values are never included. */
export class AntigravityCatalogError extends Error {
	override readonly name = "AntigravityCatalogError";
	readonly operation = "fetchAvailableModels";
	readonly provider = PROVIDER;
	readonly status: number | undefined;

	constructor(reason: string, status?: number) {
		super(
			`${PROVIDER}: fetchAvailableModels at ${CATALOG_URL}${status ? ` (HTTP ${status})` : ""}: ${reason}; retry the model refresh or /login antigravity`,
		);
		this.status = status;
	}
}

/** Maps only agent-sort entries; malformed envelopes fail and unusable model rows are skipped. */
export function parseCatalog(payload: unknown): AntigravityModel[] {
	const envelope = record(payload);
	const rows = record(envelope?.["models"]);
	const sorts = envelope?.["agentModelSorts"];
	if (!rows || !Array.isArray(sorts)) {
		throw new AntigravityCatalogError("expected models and agentModelSorts");
	}
	const families = new Map<string, AntigravityModel>();
	for (const sort of sorts) {
		const groups = record(sort)?.["groups"];
		if (!Array.isArray(groups)) throw new AntigravityCatalogError("expected sort groups");
		for (const group of groups) {
			const ids = record(group)?.["modelIds"];
			if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
				throw new AntigravityCatalogError("expected group modelIds");
			}
			for (const id of ids) {
				const suffix = /-(minimal|low|medium|high)$/.exec(id);
				const effort = suffix?.[1];
				if (effort !== "low" && effort !== "medium" && effort !== "high") continue;
				const row = record(rows[id]);
				if (!row) continue;
				const name = nonEmpty(row["displayName"]);
				const modelEnum = nonEmpty(row["model"]);
				const contextWindow = positiveInteger(row["maxTokens"]);
				const maxTokens = positiveInteger(row["maxOutputTokens"]);
				const thinking = parseThinking(row);
				if (!name || !modelEnum || !contextWindow || !maxTokens || !thinking) continue;
				const family = id.replace(/-(minimal|low|medium|high)$/, "");
				let model = families.get(family);
				if (!model) {
					model = {
						id: family,
						name: name.replace(/ \((Minimal|Low|Medium|High)\)$/i, ""),
						provider: PROVIDER,
						api: "google-generative-ai",
						baseUrl: BASE_URL,
						reasoning: true,
						input: row["supportsImages"] === true ? ["text", "image"] : ["text"],
						contextWindow,
						maxTokens,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null },
					};
					families.set(family, model);
				}
				model.contextWindow = Math.min(model.contextWindow, contextWindow);
				model.maxTokens = Math.min(model.maxTokens, maxTokens);
				if (row["supportsImages"] === true && !model.input.includes("image"))
					model.input.push("image");
				if (model.thinkingLevelMap) {
					model.thinkingLevelMap[effort] = encodeLevel({ id, modelEnum, thinking });
				}
			}
		}
	}
	return [...families.values()];
}

/** Parses the embedded first-run catalog on first use without filesystem access. */
export function bundledModels(): AntigravityModel[] {
	// Pi's Jiti loader decodes JSON even with the text attribute; Bun/AOT supplies text.
	snapshot ??= parseCatalog(
		typeof snapshotText === "string" ? JSON.parse(snapshotText) : snapshotText,
	);
	return snapshot;
}

/** Restores offline; authenticated stale refreshes publish a persisted catalog and check time. */
export async function refreshCatalog(
	ctx: RefreshModelsContext,
	deps: CatalogDeps,
): Promise<AntigravityModel[]> {
	const stored = ctx.stored?.models.filter(
		(model): model is AntigravityModel =>
			model.provider === PROVIDER && hasApi(model, "google-generative-ai"),
	);
	if (!ctx.allowNetwork || ctx.credential?.type !== "oauth" || !ctx.credential.access) {
		return stored ?? bundledModels();
	}
	if (
		stored &&
		!ctx.force &&
		ctx.stored?.checkedAt !== undefined &&
		deps.now() - ctx.stored.checkedAt < CATALOG_TTL_MS
	)
		return stored;
	const access = ctx.credential.access;
	let models: AntigravityModel[];
	try {
		const project = await deps.project(access, ctx.signal);
		const response = await request(CATALOG_URL, {
			provider: PROVIDER,
			method: "POST",
			headers: {
				...deps.headers(),
				Authorization: `Bearer ${access}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ project }),
			timeoutMs: 15_000,
			signal: ctx.signal,
			fetch: deps.fetch,
			secrets: [access],
		});
		models = parseCatalog(await response.json());
	} catch (error) {
		if (ctx.signal.aborted || error instanceof AntigravityCatalogError) throw error;
		throw new AntigravityCatalogError(
			"catalog request or response failed",
			error instanceof ProviderHttpError ? error.status : undefined,
		);
	}
	await ctx.publish({ persist: { models, checkedAt: deps.now() } });
	return models;
}

function parseThinking(row: Record<string, unknown>): ThinkingSpec | undefined {
	const level: WireEffort | undefined =
		row["thinkingLevel"] === 1
			? "LOW"
			: row["thinkingLevel"] === 2
				? "MEDIUM"
				: row["thinkingLevel"] === 3
					? "HIGH"
					: undefined;
	if (level)
		return { kind: row["supportsAdaptiveThinking"] === true ? "adaptive" : "level", level };
	const budget = row["thinkingBudget"];
	return typeof budget === "number" && Number.isInteger(budget) && budget >= -1
		? { kind: "budget", budget }
		: undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
