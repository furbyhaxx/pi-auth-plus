/** Pure model alias parsing, catalog expansion and request rewriting. */

/** A model alias within one provider. */
export interface ModelAlias {
	readonly provider: string;
	readonly source: string;
	readonly id: string;
	readonly name?: string;
	readonly contextWindow?: number;
	readonly maxTokens?: number;
}

/** The model fields needed to expand an alias. */
export interface AliasCatalogModel {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
}

/** An alias that could not be added to the catalog. */
export interface AliasIssue {
	readonly kind: "collision" | "missing-source";
	readonly alias: ModelAlias;
}

/** Catalog metadata is retained while alias-controlled fields can change. */
export type ExpandedModel<T extends AliasCatalogModel> = Omit<
	T,
	"id" | "name" | "contextWindow" | "maxTokens"
> &
	AliasCatalogModel;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentity(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isLimit(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Parse the whole setting or reject it without returning partial aliases. */
export function parseAliases(raw: unknown): readonly ModelAlias[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const aliases: ModelAlias[] = [];
	const ids = new Map<string, Set<string>>();
	const fields = new Set(["provider", "source", "id", "name", "contextWindow", "maxTokens"]);
	for (const value of raw) {
		if (!isRecord(value) || Object.keys(value).some((key) => !fields.has(key))) return undefined;
		const { provider, source, id, name, contextWindow, maxTokens } = value;
		if (!isIdentity(provider) || !isIdentity(source) || !isIdentity(id) || source === id) {
			return undefined;
		}
		if ("name" in value && typeof name !== "string") return undefined;
		if ("contextWindow" in value && !isLimit(contextWindow)) return undefined;
		if ("maxTokens" in value && !isLimit(maxTokens)) return undefined;
		const providerIds = ids.get(provider) ?? new Set<string>();
		if (providerIds.has(id)) return undefined;
		providerIds.add(id);
		ids.set(provider, providerIds);
		aliases.push({
			provider,
			source,
			id,
			...(typeof name === "string" ? { name } : {}),
			...(isLimit(contextWindow) ? { contextWindow } : {}),
			...(isLimit(maxTokens) ? { maxTokens } : {}),
		});
	}
	return aliases;
}

/** Append aliases of original models and report any that cannot be added. */
export function expandAliases<T extends AliasCatalogModel>(
	catalog: readonly T[],
	aliases: readonly ModelAlias[],
): { readonly models: readonly ExpandedModel<T>[]; readonly issues: readonly AliasIssue[] } {
	const models: ExpandedModel<T>[] = [...catalog];
	const issues: AliasIssue[] = [];
	for (const alias of aliases) {
		if (models.some((model) => model.provider === alias.provider && model.id === alias.id)) {
			issues.push({ kind: "collision", alias });
			continue;
		}
		const source = catalog.find(
			(model) => model.provider === alias.provider && model.id === alias.source,
		);
		if (!source) {
			issues.push({ kind: "missing-source", alias });
			continue;
		}
		models.push({
			...source,
			id: alias.id,
			name: alias.name ?? source.name,
			contextWindow: alias.contextWindow ?? source.contextWindow,
			maxTokens: alias.maxTokens ?? source.maxTokens,
		});
	}
	return { models, issues };
}

/** Rewrite a selected alias only when the body still names that alias. */
export function rewriteAliasPayload(
	payload: unknown,
	selected: { readonly provider: string; readonly id: string },
	aliases: readonly ModelAlias[],
): unknown {
	if (!isRecord(payload) || payload["model"] !== selected.id) return payload;
	const alias = aliases.find(
		(entry) => entry.provider === selected.provider && entry.id === selected.id,
	);
	return alias ? { ...payload, model: alias.source } : payload;
}
