/** Family registry: the only place engines and the UI learn provider ids, aliases and families. */
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { PhysicalRequestHooks } from "../../models/runtime/physical.ts";
import type { QuotaSource } from "../../quotas/types.ts";
import type { CounterDeps, TokenCounter, TokenModel } from "../../tokens/types.ts";
import type { AmbientCredential, CredentialStatus } from "../auth/index.ts";
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
	/** Where to sign in when it is not `/login <id>`, e.g. a quota fed by another provider's login. */
	readonly login?: ProviderLogin;
}

/** A sign-in path other than Pi's `/login <id>`. */
export interface ProviderLogin {
	/** Shown instead of `/login <id>`, e.g. "/quota codex login or /login openai-codex". */
	readonly hint: string;
	/** Credential state from wherever this provider's credential lives. */
	readonly status?: (nowMs: number) => CredentialStatus;
}

/** A native provider or a named override of a Pi provider. */
export type ProviderRegistration =
	| { readonly provider: Provider }
	| { readonly name: string; readonly config: ProviderConfig };

/** The registration overloads shared by ExtensionAPI and ModelRegistry. */
export interface ProviderSink {
	registerProvider(provider: Provider): void;
	registerProvider(name: string, config: ProviderConfig): void;
}

/** Everything one vendor contributes to Pi. */
export interface FamilyAdapter {
	readonly id: string;
	readonly label: string;
	readonly providers: readonly ProviderEntry[];
	/** Loads local state needed to decide registrations, without network or process work. */
	readonly prepareProviders?: () => void | Promise<void>;
	/** Declares providers without I/O; called after prepareProviders by registerFamilyProviders. */
	readonly providerRegistrations?: (host: FamilyHost) => readonly ProviderRegistration[];
	/**
	 * The token counter for a model this family serves, including Pi builtins it measured;
	 * undefined lets the next family or the default estimate answer.
	 */
	readonly tokens?: (model: TokenModel, deps: CounterDeps) => TokenCounter | undefined;
	/** Registers the family's remaining Pi hooks inside the awaited extension factory. */
	readonly register?: (pi: ExtensionAPI, host: FamilyHost) => void | Promise<void>;
	/**
	 * Request shaping or observation that needs the physical model, e.g. under an alias or a
	 * cross-provider group. Composition is the entrypoint's job; the family only names its hooks.
	 */
	readonly physical?: (
		model: Model<Api>,
		host: { readonly settings: () => AppSettings; readonly cwd: string },
	) => PhysicalRequestHooks | undefined;
}

/** What the entrypoint shares with families. */
export interface FamilyHost {
	/** The session's settings, loaded before any family's `session_start` handler runs. */
	readonly settings: () => AppSettings;
	/** Whether request-local physical hooks are active for this session. */
	readonly physicalHooksAvailable?: () => boolean;
}

/** Prepares local registration state, then installs every family's providers in order. */
export async function registerFamilyProviders(
	sink: ProviderSink,
	registry: Registry,
	host: FamilyHost,
): Promise<void> {
	for (const family of registry.families) {
		await family.prepareProviders?.();
		for (const registration of family.providerRegistrations?.(host) ?? []) {
			if ("provider" in registration) sink.registerProvider(registration.provider);
			else sink.registerProvider(registration.name, registration.config);
		}
	}
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
