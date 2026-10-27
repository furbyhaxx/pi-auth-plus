/** Synthetic's public catalog, model mapping and Pi-owned persistence policy. */
import { hasApi, type Model, type RefreshModelsContext } from "@earendil-works/pi-ai";
import snapshotText from "../../../assets/synthetic/models.json" with { type: "text" };
import { type FetchFn, request } from "../../core/http/index.ts";

export const PROVIDER = "synthetic";
export const BASE_URL = "https://api.synthetic.new/anthropic";
export const CATALOG_URL = "https://api.synthetic.new/v1/models";
export const CATALOG_TTL_MS = 4 * 60 * 60 * 1000;

type SyntheticModel = Model<"anthropic-messages">;
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
	const response = await request(CATALOG_URL, {
		provider: PROVIDER,
		headers: { Accept: "application/json" },
		timeoutMs: 15_000,
		signal: ctx.signal,
		fetch: fetchFn,
	});
	const models = parseCatalog(await response.json());
	await ctx.publish({ persist: { models, checkedAt: now() } });
	return models;
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
