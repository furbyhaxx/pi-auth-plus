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
import { compileModelRules, evaluateModelRules } from "../rules/match.ts";
import { effectiveModelRules } from "../rules/settings.ts";
import { filteredProviderConfig } from "./filter.ts";

/** Applies composed-catalog rules and warns when provider ownership conflicts are detected. */
export class CatalogVisibility {
	readonly #pi: ExtensionAPI;
	readonly #settings: () => AppSettings;
	readonly #owned: ReadonlySet<string>;
	readonly #registrations = new Map<string, ProviderConfig>();
	readonly #foreign = new Set<string>();
	readonly #warnings = new Set<string>();
	readonly #pendingProviders = new Set<string>();
	#mirror: ModelRuntime | undefined;
	#appliedRules: string | undefined;
	#visible: (model: AnyModel) => boolean = () => true;
	#controller: AbortController | undefined;
	#owner: AbortSignal | undefined;

	constructor(pi: ExtensionAPI, settings: () => AppSettings, owned: ReadonlySet<string>) {
		this.#pi = pi;
		this.#settings = settings;
		this.#owned = owned;
	}

	async #runtime(signal: AbortSignal): Promise<ModelRuntime | undefined> {
		if (this.#mirror) return this.#mirror;
		const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
		if (signal.aborted) return;
		const mirror = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: modelsPath(),
			allowModelNetwork: false,
			signal,
		});
		if (signal.aborted) return;
		this.#mirror = mirror;
		return mirror;
	}

	/** Register affected catalogs and return their lifetime, or false if superseded. */
	async apply(
		ctx?: ExtensionContext,
		changedProviders: readonly string[] = [],
		owner?: AbortSignal,
		store?: AppSettings,
	): Promise<AbortSignal | undefined | false> {
		if (owner?.aborted) return false;
		if (this.#owner !== owner) this.#pendingProviders.clear();
		this.#owner = owner;
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		const signal = owner ? AbortSignal.any([owner, controller.signal]) : controller.signal;
		if (signal.aborted) return false;
		for (const provider of changedProviders) this.#pendingProviders.add(provider);
		const rawRules = effectiveModelRules(store ?? this.#settings());
		const rulesKey = JSON.stringify(rawRules);
		const rulesChanged = rulesKey !== this.#appliedRules;
		const rules = compileModelRules(rawRules);
		const visible = (model: AnyModel) =>
			!evaluateModelRules(rules, model.provider, model.id).hidden;
		this.#visible = visible;
		const warnings = new Set(this.#warnings);
		let mirror: ModelRuntime | undefined;
		if (
			(rulesChanged || this.#pendingProviders.size > 0) &&
			(rules.some((rule) => rule.hidden) || this.#mirror)
		) {
			try {
				const runtime = await this.#runtime(signal);
				if (signal.aborted || !runtime) return false;
				if (ctx) {
					const refreshed = await runtime.refresh({ allowNetwork: false, signal });
					if (signal.aborted || refreshed.aborted) return false;
					for (const [provider, error] of refreshed.errors)
						warnings.add(`Catalog mirror for ${provider} failed: ${error.message}`);
				}
				mirror = runtime;
			} catch (error) {
				if (signal.aborted) return false;
				warnings.add(
					`Model rules could not be applied: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (signal.aborted) return false;
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
					if (signal.aborted) return false;
					warnings.add(
						`Model rules may not apply to ${provider}: another extension changed its provider registration.`,
					);
					this.#registrations.delete(provider);
					this.#foreign.add(provider);
				}
			}
		}
		if (mirror) {
			try {
				const providers = new Set(mirror.getAllModels().map((model) => model.provider));
				for (const provider of providers) {
					if (signal.aborted) return false;
					if (this.#owned.has(provider) || this.#foreign.has(provider)) continue;
					const registered = this.#registrations.get(provider);
					if (registered || !mirror.getAllModels(provider).some((model) => !visible(model)))
						continue;
					const existing = ctx?.modelRegistry.getRegisteredProviderConfig(provider);
					if (
						ctx?.modelRegistry.getRegisteredNativeProvider(provider) ||
						(existing && Object.keys(existing).some((key) => key !== "apiKey"))
					) {
						if (signal.aborted) return false;
						warnings.add(
							`Model rules could not be applied to ${provider}: another extension owns its provider registration.`,
						);
						this.#foreign.add(provider);
						continue;
					}
					const config = filteredProviderConfig(
						mirror,
						provider,
						(model) => this.#visible(model),
						modelsPath(),
					);
					if (signal.aborted) return false;
					this.#pi.registerProvider(provider, config);
					if (signal.aborted) return false;
					this.#registrations.set(provider, config);
				}
			} catch (error) {
				if (signal.aborted) return false;
				warnings.add(
					`Model rules could not be applied: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (signal.aborted) return false;
		if (!ctx) {
			for (const warning of warnings) this.#warnings.add(warning);
			this.#pendingProviders.clear();
			this.#appliedRules = rulesKey;
			return signal;
		}
		if (warnings.size > 0) {
			ctx.ui.notify([...warnings].join("\n"), "warning");
			if (signal.aborted) return false;
			warnings.clear();
			this.#warnings.clear();
		}
		const providers = [
			...new Set([
				...(rulesChanged ? [...this.#owned, ...this.#registrations.keys()] : []),
				...this.#pendingProviders,
			]),
		];
		if (providers.length > 0) {
			try {
				const result = await ctx.modelRegistry.refresh({ allowNetwork: false, providers, signal });
				if (signal.aborted || result.aborted) return false;
				for (const [provider, error] of result.errors)
					warnings.add(`Model refresh for ${provider} failed: ${error.message}`);
			} catch (error) {
				if (signal.aborted) return false;
				throw error;
			}
		}
		if (signal.aborted) return false;
		this.#pendingProviders.clear();
		this.#appliedRules = rulesKey;
		if (warnings.size > 0) ctx.ui.notify([...warnings].join("\n"), "warning");
		return signal;
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
