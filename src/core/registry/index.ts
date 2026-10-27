/** Family registry: the only place engines and the UI learn provider ids, aliases and families. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { QuotaSource } from "../../quotas/types.ts";
import type { AmbientCredential } from "../auth/index.ts";
import type { AppSettings } from "../config/catalog.ts";

/** One Pi provider id a family owns, with the extra names users may type for it. */
export interface ProviderEntry {
	readonly id: string;
	readonly label: string;
	readonly aliases: readonly string[];
	/** The credential Pi falls back to when `auth.json` has no slot for this provider. */
	readonly ambient?: () => AmbientCredential | undefined;
	/** How this provider reports usage limits and balances. */
	readonly quota?: QuotaSource;
}

/** Everything one vendor contributes. A family without `register` only adds quota or status to a Pi builtin. */
export interface FamilyAdapter {
	readonly id: string;
	readonly label: string;
	readonly providers: readonly ProviderEntry[];
	/** Registers the family's providers; runs inside the awaited extension factory. */
	readonly register?: (pi: ExtensionAPI, host: FamilyHost) => void | Promise<void>;
}

/** What the entrypoint shares with families. */
export interface FamilyHost {
	/** The session's settings, loaded before any family's `session_start` handler runs. */
	readonly settings: () => AppSettings;
}

export interface ResolvedProvider {
	readonly provider: ProviderEntry;
	readonly family: FamilyAdapter;
}

export class RegistryError extends Error {
	override readonly name = "RegistryError";
	readonly key: string;

	constructor(key: string, message: string) {
		super(message);
		this.key = key;
	}
}

const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function normalize(name: string): string {
	return name.trim().toLowerCase();
}

export class Registry {
	readonly families: readonly FamilyAdapter[];
	readonly #byName = new Map<string, ResolvedProvider>();
	readonly #byProviderId = new Map<string, ResolvedProvider>();

	/** Throws `RegistryError` for malformed ids and for any id or alias claimed twice. */
	constructor(families: readonly FamilyAdapter[]) {
		const familyIds = new Set<string>();
		for (const family of families) {
			if (!ID_RE.test(family.id))
				throw new RegistryError(family.id, `invalid family id "${family.id}"`);
			if (familyIds.has(family.id)) {
				throw new RegistryError(family.id, `family "${family.id}" is registered twice`);
			}
			familyIds.add(family.id);
			for (const provider of family.providers) this.#add(provider, family);
		}
		this.families = families;
	}

	#add(provider: ProviderEntry, family: FamilyAdapter): void {
		if (!ID_RE.test(provider.id)) {
			throw new RegistryError(
				provider.id,
				`invalid provider id "${provider.id}" in family "${family.id}"`,
			);
		}
		const resolved: ResolvedProvider = { provider, family };
		for (const raw of [provider.id, ...provider.aliases]) {
			const name = normalize(raw);
			const owner = this.#byName.get(name);
			if (owner) {
				throw new RegistryError(
					name,
					`"${name}" of provider "${provider.id}" is already claimed by provider "${owner.provider.id}"`,
				);
			}
			this.#byName.set(name, resolved);
		}
		this.#byProviderId.set(provider.id, resolved);
	}

	/** Every provider in registration order. */
	providers(): readonly ResolvedProvider[] {
		return [...this.#byProviderId.values()];
	}

	/** Exact Pi provider id lookup; aliases never match here. */
	byId(providerId: string): ResolvedProvider | undefined {
		return this.#byProviderId.get(providerId);
	}

	/** User input: id or alias, case- and whitespace-insensitive. */
	resolve(input: string): ResolvedProvider | undefined {
		return this.#byName.get(normalize(input));
	}

	/** Names a user may type, for completions: ids first, then aliases. */
	names(): readonly string[] {
		const ids = this.providers().map((entry) => entry.provider.id);
		const aliases = this.providers().flatMap((entry) => entry.provider.aliases.map(normalize));
		return [...ids, ...aliases];
	}
}
