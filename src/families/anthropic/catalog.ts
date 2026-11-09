/** Claude's account model listing, bundled metadata and Pi-owned refresh persistence. */
import { hasApi, type Model, type RefreshModelsContext } from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";
import { type FetchFn, ProviderHttpError, request } from "../../core/http/index.ts";
import { PINNED_VERSION, userAgent } from "./version.ts";

const PROVIDER = "claude";
export const CATALOG_URL = "https://api.anthropic.com/v1/models?limit=1000";
export const CATALOG_TTL_MS = 4 * 60 * 60 * 1000;
const PRICES_URL = "https://models.dev/api.json";
const FREE_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
type AnthropicModel = Model<"anthropic-messages"> & { claudeUnpriced?: true };

/** Refresh transport and clock, independent of Pi's registration lifecycle. */
export interface CatalogDeps {
	readonly fetch: FetchFn;
	readonly now: () => number;
}

/** Safe failure without response bodies or credential values. */
export class ClaudeCatalogError extends Error {
	override readonly name = "ClaudeCatalogError";
	readonly provider = PROVIDER;
	readonly status: number | undefined;
	constructor(reason: string, status?: number) {
		super(
			`${PROVIDER}: models listing at ${CATALOG_URL}${status ? ` (HTTP ${status})` : ""}: ${reason}; retry the model refresh or /login claude`,
		);
		this.status = status;
	}
}

/** Bundled priced metadata remains the first-run offline fallback. */
export function bundledModels(): AnthropicModel[] {
	return getModels("anthropic").map((model) => ({ ...model, provider: PROVIDER }));
}

/** Identifies zero-cost placeholders that must never be offered for API-key billing. */
export function hasCatalogPrice(model: Model<"anthropic-messages">): boolean {
	return !("claudeUnpriced" in model && model.claudeUnpriced === true);
}

/** Maps active models with exact-source prices; templates supply only non-price metadata. */
export function parseCatalog(
	payload: unknown,
	bundled = bundledModels(),
	prices?: unknown,
	includeUnpriced = false,
): AnthropicModel[] {
	const priceRows = record(record(record(prices)?.["anthropic"])?.["models"]);
	const envelope = record(payload);
	if (!Array.isArray(envelope?.["data"]) || envelope["has_more"] !== false)
		throw new ClaudeCatalogError("expected a complete model listing");
	const models: AnthropicModel[] = [];
	for (const value of envelope["data"]) {
		const row = record(value);
		if (row?.["lifecycle"] !== "active") continue;
		const id = nonEmpty(row["id"]);
		if (!id) continue;
		const known =
			bundled.find((model) => model.id === id) ?? bundled.find((model) => model.id === undated(id));
		const cost = priceOf(priceRows?.[id]) ?? priceOf(priceRows?.[undated(id)]) ?? known?.cost;
		if (!cost && !includeUnpriced) continue;
		const contextWindow = positiveInteger(row["max_input_tokens"]);
		const maxTokens = positiveInteger(row["max_tokens"]);
		if (known) {
			models.push({
				...known,
				cost: cost ?? known.cost,
				id,
				...(contextWindow ? { contextWindow } : {}),
				...(maxTokens ? { maxTokens } : {}),
			});
			continue;
		}
		const line = nonEmpty(row["line"]);
		const name = nonEmpty(row["display_name"]);
		const template = line
			? bundled
					.filter((model) => model.id.startsWith(`claude-${line}-`))
					.sort((a, b) => undated(b.id).localeCompare(undated(a.id), "en", { numeric: true }))[0]
			: undefined;
		const capabilities = record(row["capabilities"]);
		const thinking = record(record(capabilities?.["thinking"])?.["types"]);
		const effort = record(capabilities?.["effort"]);
		if (!template || !name || !contextWindow || !maxTokens || !capabilities || !thinking || !effort)
			continue;
		const adaptive = supported(thinking["adaptive"]);
		const enabled = supported(thinking["enabled"]);
		const disabled = supported(thinking["disabled"]);
		const thinkingLevelMap: NonNullable<AnthropicModel["thinkingLevelMap"]> = {
			off: disabled ? "off" : null,
			minimal: null,
		};
		for (const level of ["low", "medium", "high", "xhigh", "max"] as const)
			thinkingLevelMap[level] = supported(effort[level]) ? level : null;
		const { allowedFallbackModels: _fallbacks, ...compat } = template.compat ?? {};
		models.push({
			...template,
			cost: cost ?? { ...FREE_COST },
			...(!cost ? { claudeUnpriced: true as const } : {}),
			id,
			name,
			contextWindow,
			maxTokens,
			input: supported(capabilities["image_input"]) ? ["text", "image"] : ["text"],
			reasoning: adaptive || enabled,
			thinkingLevelMap,
			compat: { ...compat, forceAdaptiveThinking: adaptive && !enabled && !disabled },
		});
	}
	return [...models, ...undatedAliases(models, bundled)];
}

/** Keeps bundled undated aliases of listed dated ids, so saved selections stay resolvable. */
function undatedAliases(models: AnthropicModel[], bundled: AnthropicModel[]): AnthropicModel[] {
	const listed = new Set(models.map((model) => model.id));
	const aliases: AnthropicModel[] = [];
	for (const alias of bundled) {
		if (listed.has(alias.id)) continue;
		const dated = models.find((model) => model.id !== alias.id && undated(model.id) === alias.id);
		if (!dated) continue;
		listed.add(alias.id);
		aliases.push({
			...alias,
			cost: dated.cost,
			contextWindow: dated.contextWindow,
			maxTokens: dated.maxTokens,
		});
	}
	return aliases;
}

/** Restores the host snapshot offline; stale authenticated refreshes persist priced models. */
export async function refreshCatalog(
	ctx: RefreshModelsContext,
	deps: CatalogDeps,
): Promise<AnthropicModel[]> {
	const stored = ctx.stored?.models.filter(
		(model): model is AnthropicModel =>
			model.provider === PROVIDER &&
			hasApi(model, "anthropic-messages") &&
			(ctx.credential?.type !== "api_key" || hasCatalogPrice(model)),
	);
	const credential = ctx.credential;
	const token = credential?.type === "oauth" ? credential.access : credential?.key;
	if (!ctx.allowNetwork || !token) return stored ?? bundledModels();
	if (
		stored &&
		!ctx.force &&
		ctx.stored?.checkedAt !== undefined &&
		deps.now() - ctx.stored.checkedAt < CATALOG_TTL_MS
	)
		return stored;
	let models: AnthropicModel[];
	try {
		const response = await request(CATALOG_URL, {
			provider: PROVIDER,
			headers: {
				...(credential?.type === "oauth"
					? { Authorization: `Bearer ${token}` }
					: { "x-api-key": token }),
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "oauth-2025-04-20",
				"User-Agent": userAgent(PINNED_VERSION),
				Accept: "application/json",
			},
			timeoutMs: 15_000,
			signal: ctx.signal,
			fetch: deps.fetch,
			secrets: [token],
		});
		const payload: unknown = await response.json();
		let prices: unknown;
		try {
			const priceResponse = await request(PRICES_URL, {
				provider: PROVIDER,
				timeoutMs: 10_000,
				signal: ctx.signal,
				fetch: deps.fetch,
			});
			prices = await priceResponse.json();
		} catch (error) {
			if (ctx.signal.aborted) throw error;
			prices = undefined;
		}
		models = parseCatalog(payload, bundledModels(), prices, credential?.type === "oauth");
	} catch (error) {
		if (ctx.signal.aborted || error instanceof ClaudeCatalogError) throw error;
		throw new ClaudeCatalogError(
			"catalog request or response failed",
			error instanceof ProviderHttpError ? error.status : undefined,
		);
	}
	await ctx.publish({ persist: { models, checkedAt: deps.now() } });
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
function priceOf(value: unknown): AnthropicModel["cost"] | undefined {
	const cost = record(record(value)?.["cost"]);
	const input = nonNegative(cost?.["input"]);
	const output = nonNegative(cost?.["output"]);
	const cacheRead = nonNegative(cost?.["cache_read"]);
	const cacheWrite = nonNegative(cost?.["cache_write"]);
	return input !== undefined &&
		output !== undefined &&
		cacheRead !== undefined &&
		cacheWrite !== undefined
		? { input, output, cacheRead, cacheWrite }
		: undefined;
}
function nonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function supported(value: unknown): boolean {
	return record(value)?.["supported"] === true;
}
function undated(id: string): string {
	return id.replace(/-\d{8}$/, "");
}
