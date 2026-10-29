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
import { redactText } from "../../core/redact/index.ts";
import { plainText } from "../../quotas/line/values.ts";
import { compileModelRules, evaluateModelRules } from "../rules/match.ts";
import { effectiveModelRules } from "../rules/settings.ts";
import { filteredProviderConfig } from "./filter.ts";

/** The current application lifetime and its non-fatal catalog warnings. */
export interface CatalogApplication {
	readonly signal: AbortSignal;
	readonly warnings: readonly string[];
}

function application(signal: AbortSignal, warnings: ReadonlySet<string>): CatalogApplication {
	return { signal, warnings: [...warnings].map((warning) => redactText(plainText(warning))) };
}

/** Applies composed-catalog rules and warns when provider ownership conflicts are detected. */
export class CatalogVisibility {
	readonly #pi: ExtensionAPI;
	readonly #settings: () => AppSettings;
	readonly #owned: ReadonlySet<string>;
	readonly #registrations = new Map<string, ProviderConfig>();
	readonly #foreign = new Set<string>();
	readonly #warnings = new Set<string>();
	readonly #pendingProviders = new Set<string>();
	readonly #retryProviders = new Set<string>();
	readonly #pendingMirrorProviders = new Set<string>();
	readonly #retryMirrorProviders = new Set<string>();
	#mirror: ModelRuntime | undefined;
	#mirrorPending = false;
	#retryMirror = false;
	#appliedRules: string | undefined;
	#scheduledRules: string | undefined;
	#warningsRules: string | undefined;
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

	/** Register affected catalogs and return their outcome, or false if superseded. */
	async apply(
		ctx?: ExtensionContext,
		changedProviders: readonly string[] = [],
		owner?: AbortSignal,
		store?: AppSettings,
	): Promise<CatalogApplication | false> {
		if (owner?.aborted) return false;
		if (this.#owner !== owner) {
			this.#pendingProviders.clear();
			for (const provider of this.#retryProviders) this.#pendingProviders.add(provider);
			this.#pendingMirrorProviders.clear();
			for (const provider of this.#retryMirrorProviders) this.#pendingMirrorProviders.add(provider);
			this.#mirrorPending = this.#retryMirror;
			this.#scheduledRules = this.#appliedRules;
		}
		this.#owner = owner;
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		const signal = owner ? AbortSignal.any([owner, controller.signal]) : controller.signal;
		if (signal.aborted) return false;
		for (const provider of changedProviders) this.#pendingProviders.add(provider);
		const rawRules = effectiveModelRules(store ?? this.#settings());
		const rulesKey = JSON.stringify(rawRules);
		const rulesChanged = rulesKey !== this.#scheduledRules;
		if (rulesChanged) {
			this.#scheduledRules = rulesKey;
			if (ctx) {
				for (const provider of this.#owned) this.#pendingProviders.add(provider);
				for (const provider of this.#registrations.keys()) this.#pendingProviders.add(provider);
			}
		}
		const rules = compileModelRules(rawRules);
		const needsMirror = rules.some((rule) => rule.hidden) || this.#mirror;
		if (rulesChanged && !needsMirror) {
			this.#mirrorPending = false;
			this.#retryMirror = false;
			this.#pendingMirrorProviders.clear();
			this.#retryMirrorProviders.clear();
		} else if ((rulesChanged || changedProviders.length > 0) && needsMirror) {
			this.#mirrorPending = true;
		}
		const visible = (model: AnyModel) =>
			!evaluateModelRules(rules, model.provider, model.id).hidden;
		this.#visible = visible;
		const warnings = new Set(this.#warningsRules === rulesKey ? this.#warnings : []);
		let mirror: ModelRuntime | undefined;
		if (this.#mirrorPending || this.#pendingMirrorProviders.size > 0) {
			try {
				const runtime = await this.#runtime(signal);
				if (signal.aborted || !runtime) return false;
				if (ctx) {
					const providers = this.#mirrorPending ? undefined : [...this.#pendingMirrorProviders];
					const refreshed = await runtime.refresh({
						allowNetwork: false,
						...(providers ? { providers } : {}),
						signal,
					});
					if (signal.aborted || refreshed.aborted) return false;
					if (providers) {
						for (const provider of providers) this.#pendingMirrorProviders.delete(provider);
					} else this.#pendingMirrorProviders.clear();
					for (const [provider, error] of refreshed.errors) {
						this.#pendingMirrorProviders.add(provider);
						warnings.add(
							`Catalog mirror for ${provider} failed: ${error.message}; retry or reopen the session`,
						);
					}
					this.#retryMirrorProviders.clear();
					for (const provider of this.#pendingMirrorProviders)
						this.#retryMirrorProviders.add(provider);
				}
				this.#mirrorPending = false;
				this.#retryMirror = false;
				mirror = runtime;
			} catch (error) {
				if (signal.aborted) return false;
				this.#mirrorPending = true;
				this.#retryMirror = true;
				warnings.add(
					`Model rules could not be applied: ${error instanceof Error ? error.message : String(error)}; retry or reopen the session`,
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
					try {
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
						if (ctx) this.#pendingProviders.add(provider);
					} catch (error) {
						if (signal.aborted) return false;
						this.#pendingMirrorProviders.add(provider);
						this.#retryMirrorProviders.add(provider);
						warnings.add(
							`Model rules could not be applied to ${provider}: ${error instanceof Error ? error.message : String(error)}; retry or reopen the session`,
						);
					}
				}
			} catch (error) {
				if (signal.aborted) return false;
				this.#mirrorPending = true;
				this.#retryMirror = true;
				warnings.add(
					`Model rules could not be applied: ${error instanceof Error ? error.message : String(error)}; retry or reopen the session`,
				);
			}
		}
		if (signal.aborted) return false;
		if (!ctx) {
			this.#warnings.clear();
			for (const warning of warnings) this.#warnings.add(warning);
			this.#warningsRules = rulesKey;
			if (!this.#mirrorPending && this.#pendingMirrorProviders.size === 0)
				this.#appliedRules = rulesKey;
			return application(signal, warnings);
		}
		for (const provider of this.#pendingMirrorProviders) {
			if (this.handles(provider)) this.#pendingProviders.add(provider);
		}
		const providers = [...this.#pendingProviders];
		if (providers.length > 0) {
			try {
				const result = await ctx.modelRegistry.refresh({ allowNetwork: false, providers, signal });
				if (signal.aborted || result.aborted) return false;
				for (const [provider, error] of result.errors) {
					this.#pendingProviders.add(provider);
					warnings.add(
						`Model refresh for ${provider} failed: ${error.message}; retry or reopen the session`,
					);
				}
				for (const provider of providers) {
					if (result.errors.has(provider) || this.#pendingMirrorProviders.has(provider)) {
						this.#retryProviders.add(provider);
					} else {
						this.#pendingProviders.delete(provider);
						this.#retryProviders.delete(provider);
					}
				}
			} catch (error) {
				if (signal.aborted) return false;
				for (const provider of providers) this.#retryProviders.add(provider);
				const reason = error instanceof Error ? error.message : String(error);
				warnings.add(`Model catalog refresh failed: ${reason}; retry or reopen the session`);
			}
		}
		if (signal.aborted) return false;
		if (
			this.#pendingProviders.size === 0 &&
			!this.#mirrorPending &&
			this.#pendingMirrorProviders.size === 0
		)
			this.#appliedRules = rulesKey;
		this.#warnings.clear();
		this.#warningsRules = undefined;
		return application(signal, warnings);
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
