/** Resolves runtime alias identities against original provider catalogs. */
import type { TokenModel } from "../../tokens/types.ts";
import {
	type AliasCatalogEntry,
	type AliasIssue,
	type ModelAlias,
	resolveAliases,
} from "./index.ts";

/** Tracks physical catalogs while reading the latest configured aliases. */
export class AliasCatalog {
	readonly #configured: () => readonly ModelAlias[];
	readonly #catalogs = new Map<string, () => readonly AliasCatalogEntry[]>();

	constructor(configured: () => readonly ModelAlias[]) {
		this.#configured = configured;
	}

	/** Register a getter for an original, unfiltered provider catalog. */
	register(provider: string, catalog: () => readonly AliasCatalogEntry[]): void {
		this.#catalogs.set(provider, catalog);
	}

	/** Return aliases accepted against the current physical catalogs. */
	aliases(): readonly ModelAlias[] {
		return this.#resolve().aliases;
	}

	/** Resolve accepted aliases, leaving every other model identity unchanged. */
	resolve(model: TokenModel): TokenModel {
		const alias = this.aliases().find(
			(entry) => entry.provider === model.provider && entry.id === model.id,
		);
		return alias ? { ...model, id: alias.source } : model;
	}

	/** Return the current rejected alias entries and their reasons. */
	issues(): readonly AliasIssue[] {
		return this.#resolve().issues;
	}

	#resolve() {
		const catalog = [...this.#catalogs.values()].flatMap((get) => get());
		return resolveAliases(catalog, this.#configured());
	}
}
