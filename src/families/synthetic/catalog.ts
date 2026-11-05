/** Synthetic's public catalog, model mapping and Pi-owned persistence policy. */
import { hasApi, type Model, type RefreshModelsContext } from "@earendil-works/pi-ai";
import snapshotText from "../../../assets/synthetic/models.json" with { type: "text" };
import { type FetchFn, request } from "../../core/http/index.ts";

export const PROVIDER = "synthetic";
export const BASE_URL = "https://api.synthetic.new/anthropic";
export const CATALOG_URL = "https://api.synthetic.new/v1/models";
export const CATALOG_TTL_MS = 4 * 60 * 60 * 1000;
/** A priming fetch may not hold up startup longer than this. */
export const CATALOG_PRIME_TIMEOUT_MS = 2_000;
/** A failed priming fetch backs off this long, so an offline machine retries rarely. */
export const CATALOG_PRIME_BACKOFF_MS = 10 * 60 * 1000;
/** Bumped when the persisted shape or the row mapping changes; older entries are ignored. */
export const CATALOG_PARSER_VERSION = 1;

export type SyntheticModel = Model<"anthropic-messages">;
let snapshot: SyntheticModel[] | undefined;

/** Maps the public API response; rejects an unexpected envelope and skips unusable rows. */
export function parseCatalog(payload: unknown): SyntheticModel[] {
	const rows = record(payload)?.["data"];
	if (!Array.isArray(rows)) throw catalogError("expected a data array");
	const models: SyntheticModel[] = [];
	for (const value of rows) {
		const row = record(value);
		if (!row) continue;
		const id = nonEmpty(row["id"]);
		const contextWindow = positiveInteger(row["context_length"]);
		const maxTokens = positiveInteger(row["max_output_length"]);
		const features = row["supported_features"];
		if (!id || row["always_on"] !== true || !contextWindow || !maxTokens) continue;
		if (features !== undefined && (!Array.isArray(features) || !features.includes("tools")))
			continue;
		const pricing = record(row["pricing"]);
		const input = price(pricing?.["prompt"]);
		const output = price(pricing?.["completion"]);
		if (input === undefined || output === undefined) continue;
		const modalities = row["input_modalities"];
		models.push({
			id,
			name: nonEmpty(row["name"]) ?? nonEmpty(row["hugging_face_id"]) ?? id,
			provider: PROVIDER,
			api: "anthropic-messages",
			baseUrl: BASE_URL,
			reasoning: Array.isArray(features) && features.includes("reasoning"),
			input:
				Array.isArray(modalities) && modalities.includes("image") ? ["text", "image"] : ["text"],
			contextWindow,
			maxTokens,
			cost: {
				input,
				output,
				cacheRead: price(pricing?.["input_cache_reads"]) ?? 0,
				cacheWrite: price(pricing?.["input_cache_writes"]) ?? 0,
			},
		});
	}
	return models;
}

/** Validates a catalog this package persisted; a row it cannot trust is dropped, not repaired. */
export function parseStoredCatalog(raw: unknown): SyntheticModel[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const models: SyntheticModel[] = [];
	for (const value of raw) {
		const model = record(value);
		if (!model || model["provider"] !== PROVIDER || model["api"] !== "anthropic-messages") continue;
		const id = nonEmpty(model["id"]);
		const baseUrl = nonEmpty(model["baseUrl"]);
		const contextWindow = positiveInteger(model["contextWindow"]);
		const maxTokens = positiveInteger(model["maxTokens"]);
		const cost = record(model["cost"]);
		const input = amount(cost?.["input"]);
		const output = amount(cost?.["output"]);
		if (
			!id ||
			!baseUrl ||
			!contextWindow ||
			!maxTokens ||
			input === undefined ||
			output === undefined
		)
			continue;
		const modalities = model["input"];
		models.push({
			id,
			name: nonEmpty(model["name"]) ?? id,
			provider: PROVIDER,
			api: "anthropic-messages",
			baseUrl,
			reasoning: model["reasoning"] === true,
			input:
				Array.isArray(modalities) && modalities.includes("image") ? ["text", "image"] : ["text"],
			contextWindow,
			maxTokens,
			cost: {
				input,
				output,
				cacheRead: amount(cost?.["cacheRead"]) ?? 0,
				cacheWrite: amount(cost?.["cacheWrite"]) ?? 0,
			},
		});
	}
	return models.length > 0 ? models : undefined;
}

/** The captured first-run catalog, parsed only when registration needs it. */
export function bundledModels(): SyntheticModel[] {
	// Pi's Jiti loader decodes JSON even with the text attribute; Bun/AOT supplies text.
	snapshot ??= parseCatalog(
		typeof snapshotText === "string" ? JSON.parse(snapshotText) : snapshotText,
	);
	return snapshot;
}

/** Restores without side effects; only a successful allowed refresh persists a check time. */
export async function refreshCatalog(
	ctx: RefreshModelsContext,
	fetchFn: FetchFn,
	now: () => number,
): Promise<SyntheticModel[]> {
	const stored = ctx.stored?.models.filter(
		(model): model is SyntheticModel =>
			model.provider === PROVIDER && hasApi(model, "anthropic-messages"),
	);
	if (!ctx.allowNetwork) return stored ?? bundledModels();
	if (
		stored &&
		!ctx.force &&
		ctx.stored?.checkedAt !== undefined &&
		now() - ctx.stored.checkedAt < CATALOG_TTL_MS
	)
		return stored;
	const models = await fetchCatalog(fetchFn, ctx.signal);
	await ctx.publish({ persist: { models, checkedAt: now() } });
	return models;
}

/** Fetches and maps the live catalog; the caller owns cancellation and the deadline. */
export async function fetchCatalog(
	fetchFn: FetchFn,
	signal: AbortSignal,
	timeoutMs: number = 15_000,
): Promise<SyntheticModel[]> {
	const response = await request(CATALOG_URL, {
		provider: PROVIDER,
		headers: { Accept: "application/json" },
		timeoutMs,
		signal,
		fetch: fetchFn,
	});
	return parseCatalog(await response.json());
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

/** A non-negative finite amount; zero is a real price. */
function amount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Dollars per million tokens; the API mixes per-token and per-million strings. */
function price(value: unknown): number | undefined {
	const match = typeof value === "string" ? /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(value) : null;
	const amount = match ? Number(match[0]) : Number.NaN;
	if (!Number.isFinite(amount) || amount < 0) return undefined;
	return amount < 0.001 ? amount * 1_000_000 : amount;
}

function catalogError(reason: string): Error {
	return new Error(
		`${PROVIDER}: invalid catalog from ${CATALOG_URL}: ${reason}; retry the model refresh`,
	);
}
