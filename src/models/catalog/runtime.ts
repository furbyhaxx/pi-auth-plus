/** Composed catalog filtering for providers not owned by this extension. */
import { type AnyModel, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRuntime,
	ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import type { AppSettings } from "../../core/config/catalog.ts";
import { modelsPath } from "../../core/paths/index.ts";
import { compileModelRules } from "../rules/match.ts";
import { effectiveModelRules } from "../rules/settings.ts";
import { filteredProviderConfig } from "./filter.ts";

/** Applies composed-catalog rules and warns when provider ownership conflicts are detected. */
export class CatalogVisibility {
	readonly #pi: ExtensionAPI;
	readonly #settings: () => AppSettings;
	readonly #owned: ReadonlySet<string>;
	readonly #visible: (model: AnyModel) => boolean;
	readonly #registrations = new Map<string, ProviderConfig>();
	readonly #foreign = new Set<string>();
	readonly #warnings = new Set<string>();
	#mirror: ModelRuntime | undefined;
	#appliedRules: string | undefined;

	constructor(
		pi: ExtensionAPI,
		settings: () => AppSettings,
		owned: ReadonlySet<string>,
		visible: (model: AnyModel) => boolean,
	) {
		this.#pi = pi;
		this.#settings = settings;
		this.#owned = owned;
		this.#visible = visible;
	}

	async #runtime(): Promise<ModelRuntime> {
		if (!this.#mirror) {
			const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
			this.#mirror = await ModelRuntime.create({
				credentials: new InMemoryCredentialStore(),
				modelsPath: modelsPath(),
				allowModelNetwork: false,
			});
		}
		return this.#mirror;
	}

	/** Register affected catalogs early, or refresh them after settings change. */
	async apply(ctx?: ExtensionContext, changedProviders: readonly string[] = []): Promise<void> {
		const rawRules = effectiveModelRules(this.#settings());
		const rulesKey = JSON.stringify(rawRules);
		const rulesChanged = rulesKey !== this.#appliedRules;
		const rules = compileModelRules(rawRules);
		if (ctx) {
			for (const [provider, registration] of this.#registrations) {
				const current = ctx.modelRegistry.getRegisteredProviderConfig(provider);
				const extra =
					current &&
					Object.keys(current).some((key) => !["models", "refreshModels", "apiKey"].includes(key));
				if (
					ctx.modelRegistry.getRegisteredNativeProvider(provider) ||
					!current ||
					current.refreshModels !== registration.refreshModels ||
					current.models !== registration.models ||
					extra
				) {
					this.#warnings.add(
						`Model rules may not apply to ${provider}: another extension changed its provider registration.`,
					);
					this.#registrations.delete(provider);
					this.#foreign.add(provider);
				}
			}
		}
		if (
			(rulesChanged || changedProviders.length > 0) &&
			(rules.some((rule) => rule.hidden) || this.#mirror)
		) {
			try {
				const mirror = await this.#runtime();
				if (ctx) {
					const refreshed = await mirror.refresh({ allowNetwork: false });
					for (const [provider, error] of refreshed.errors)
						this.#warnings.add(`Catalog mirror for ${provider} failed: ${error.message}`);
				}
				const providers = new Set(mirror.getAllModels().map((model) => model.provider));
				for (const provider of providers) {
					if (this.#owned.has(provider) || this.#foreign.has(provider)) continue;
					const registered = this.#registrations.get(provider);
					if (registered || !mirror.getAllModels(provider).some((model) => !this.#visible(model)))
						continue;
					const existing = ctx?.modelRegistry.getRegisteredProviderConfig(provider);
					if (
						ctx?.modelRegistry.getRegisteredNativeProvider(provider) ||
						(existing && Object.keys(existing).some((key) => key !== "apiKey"))
					) {
						this.#warnings.add(
							`Model rules could not be applied to ${provider}: another extension owns its provider registration.`,
						);
						this.#foreign.add(provider);
						continue;
					}
					const config = filteredProviderConfig(mirror, provider, this.#visible, modelsPath());
					this.#pi.registerProvider(provider, config);
					this.#registrations.set(provider, config);
				}
			} catch (error) {
				this.#warnings.add(
					`Model rules could not be applied: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		this.#appliedRules = rulesKey;
		if (ctx) {
			const providers = [
				...new Set([
					...(rulesChanged ? [...this.#owned, ...this.#registrations.keys()] : []),
					...changedProviders,
				]),
			];
			if (providers.length > 0) {
				const result = await ctx.modelRegistry.refresh({ allowNetwork: false, providers });
				for (const [provider, error] of result.errors)
					this.#warnings.add(`Model refresh for ${provider} failed: ${error.message}`);
			}
			if (this.#warnings.size > 0) {
				ctx.ui.notify([...this.#warnings].join("\n"), "warning");
				this.#warnings.clear();
			}
		}
	}

	/** Whether this extension currently enforces rules on this provider. */
	handles(provider: string): boolean {
		return this.#owned.has(provider) || this.#registrations.has(provider);
	}

	/** The unfiltered built-in catalog, when a mirror has been needed. */
	catalog(): readonly AnyModel[] {
		return this.#mirror?.getAllModels() ?? [];
	}
}
