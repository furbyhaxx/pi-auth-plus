/** Pi entrypoint: awaits family registration and wires commands, flags and events. */

import { join } from "node:path";
import { isModelType, type Provider } from "@earendil-works/pi-ai";
import type {
	EventBus,
	ExtensionAPI,
	ExtensionContext,
	ModelRuntime,
	ProviderConfig,
	ProviderModelConfig,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { handleQuotaCli, registerQuotaCliFlags } from "./cli/index.ts";
import { credentialStatus, readCredential } from "./core/auth/index.ts";
import { type AppSettings, SETTINGS } from "./core/config/catalog.ts";
import { SettingsStore } from "./core/config/index.ts";
import { createSettingsSaver } from "./core/config/save.ts";
import { conflictMessage, detectConflicts, loadsPackage } from "./core/conflicts/index.ts";
import { cacheDir, modelsPath, projectSettingsPath, userSettingsPath } from "./core/paths/index.ts";
import { type ProviderSink, Registry, registerFamilyProviders } from "./core/registry/index.ts";
import {
	compatiblePhysicalHooks,
	registerCompatibleThoughtSignatures,
} from "./families/google/compatible-signatures.ts";
import { registerThoughtSignatureRecovery } from "./families/google/signature-recovery.ts";
import { FAMILIES } from "./families/index.ts";
import { wrapNamedAliases } from "./models/aliases/named.ts";
import { wrapNativeAliases } from "./models/aliases/native.ts";
import { AliasCatalog } from "./models/aliases/runtime.ts";
import { filterNativeProvider, filterOwnedConfig } from "./models/catalog/owned-filter.ts";
import { CatalogVisibility } from "./models/catalog/runtime.ts";
import { installStartupCoordinator } from "./models/catalog/startup.ts";
import { installGroupContextCap } from "./models/groups/context-cap.ts";
import { groupMemberHealth } from "./models/groups/member.ts";
import { GroupRegistrations } from "./models/groups/registration.ts";
import { registerGroupSettlement } from "./models/groups/settlement.ts";
import { readGroupRouteState } from "./models/groups/state.ts";
import { readOverride, updateOverrides } from "./models/overrides/index.ts";
import { compileModelRules, evaluateModelRules } from "./models/rules/match.ts";
import { effectiveModelRules } from "./models/rules/settings.ts";
import {
	composePhysicalFactories,
	installPhysicalRequestHooks,
	type PhysicalRequestFactory,
} from "./models/runtime/physical.ts";
import { quotaAuthFor } from "./quotas/auth.ts";
import { registerQuotaBus } from "./quotas/bus.ts";
import { QuotaEngine } from "./quotas/engine.ts";
import { createQuotaLine } from "./quotas/line/index.ts";
import { quotaLineConfig } from "./quotas/line/line.ts";
import { formatPlainTextSummary } from "./quotas/line/summary.ts";
import { carryOverPiQuotas } from "./quotas/migrate/index.ts";
import { engineReport } from "./quotas/report.ts";
import { enabledQuotaProviders } from "./quotas/settings.ts";
import { registerTokenBus } from "./tokens/bus.ts";
import { createTokenEngine } from "./tokens/engine/index.ts";
import { defaultTokenizerStore } from "./tokens/tokenizer/index.ts";
import { createTokenTracker } from "./tokens/tracker/index.ts";
import { registerAuthCommands } from "./ui/commands/index.ts";
import { confirmReset } from "./ui/commands/resets.ts";
import type { ModelCatalogItem } from "./ui/dashboard/models.ts";

const NO_EXTENSIONS = process.argv.some((arg) => arg === "--no-extensions" || arg === "-ne");

function sessionRuntime(ctx: ExtensionContext): ModelRuntime | undefined {
	const runtime: unknown = (ctx.modelRegistry as unknown as { runtime?: unknown }).runtime;
	if (
		!runtime ||
		typeof runtime !== "object" ||
		!("refresh" in runtime) ||
		typeof runtime.refresh !== "function"
	)
		return undefined;
	return runtime as ModelRuntime;
}

export default async function piAuthPlus(pi: ExtensionAPI): Promise<void> {
	let sessionController = new AbortController();
	let stopQuotaBus: (() => void) | undefined;
	const shutdownOwners = new WeakMap<ExtensionContext, AbortSignal>();
	const startupOwners = new WeakMap<
		object,
		{ signal: AbortSignal; groupWarnings: Set<string>; store?: AppSettings }
	>();
	const ownsStartup = (event: object) => {
		const startup = startupOwners.get(event);
		return startup !== undefined && !startup.signal.aborted;
	};
	const physicalResponseProviders = new Set<string>();
	let stopTokenTracker: ((event: SessionStartEvent, ctx: ExtensionContext) => void) | undefined;
	const sessionBus = (signal: AbortSignal): EventBus => ({
		on: (channel, handler) =>
			pi.events.on(channel, (payload) => {
				if (!signal.aborted) handler(payload);
			}),
		emit: (channel, payload) => {
			if (!signal.aborted) pi.events.emit(channel, payload);
		},
	});
	sessionController.abort();
	const stopSession = () => {
		const controller = sessionController;
		controller.abort();
		if (controller !== sessionController) return;
		physicalResponseProviders.clear();
		const stop = stopQuotaBus;
		stopQuotaBus = undefined;
		stop?.();
	};
	pi.on("session_start", (event, ctx) => {
		const previous = sessionController;
		sessionController = new AbortController();
		const signal = sessionController.signal;
		startupOwners.set(event, { signal, groupWarnings: new Set() });
		previous.abort();
		if (signal.aborted) return;
		physicalResponseProviders.clear();
		const stopQuota = stopQuotaBus;
		stopQuotaBus = undefined;
		stopQuota?.();
		if (signal.aborted) return;
		const stopToken = stopTokenBus;
		stopTokenBus = undefined;
		stopToken?.();
		if (signal.aborted) return;
		quotasEnabled = false;
		quotaContext = undefined;
		physicalHooksActive = false;
		quotaLine.stop();
		if (signal.aborted) return;
		stopTokenTracker?.(event, ctx);
		if (signal.aborted) return;
		quotas.stop();
	});
	pi.on("session_shutdown", (_event, ctx) => {
		shutdownOwners.set(ctx, sessionController.signal);
		stopSession();
	});
	const ownsShutdown = (ctx: ExtensionContext) =>
		shutdownOwners.get(ctx) === sessionController.signal;
	const modeIndex = process.argv.indexOf("--mode");
	const rpcStartup = modeIndex >= 0 && process.argv[modeIndex + 1] === "rpc";
	const offline =
		process.argv.includes("--offline") ||
		["1", "true", "yes"].includes((process.env["PI_OFFLINE"] ?? "").toLowerCase());
	let startupCoordinator: ReturnType<typeof installStartupCoordinator>;
	if (rpcStartup && !offline) {
		try {
			const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
			startupCoordinator = installStartupCoordinator(ModelRuntime.prototype);
		} catch {
			startupCoordinator = undefined;
		}
	}
	if (startupCoordinator) {
		const coordinator = startupCoordinator;
		pi.on("session_shutdown", (_event, ctx) => {
			if (!ownsShutdown(ctx)) return;
			const runtime = sessionRuntime(ctx);
			if (runtime) coordinator.stop(runtime);
		});
	}
	registerQuotaCliFlags(pi);
	await handleQuotaCli(process.argv.slice(2));
	const registry = new Registry(FAMILIES);
	let settings: AppSettings = new SettingsStore(SETTINGS, { user: userSettingsPath() });
	await settings.load();
	let lastRules: readonly string[] | undefined;
	let compiledRules = compileModelRules([]);
	const isVisible = (
		provider: string,
		model: { readonly id: string },
		store: AppSettings = settings,
	): boolean => {
		const rules = effectiveModelRules(store);
		if (rules !== lastRules) {
			lastRules = rules;
			compiledRules = compileModelRules(rules);
		}
		return !evaluateModelRules(compiledRules, provider, model.id).hidden;
	};
	const ownedProviders = new Set<string>();
	const ownedCatalog = new Map<string, () => readonly ModelCatalogItem[]>();
	const aliasCatalog = new AliasCatalog(() => settings.get("models.aliases"));
	const warnedAliases = new Set<string>();
	let aliasContext: ExtensionContext | undefined;
	const warnAliasIssues = (ctx: ExtensionContext, signal: AbortSignal): void => {
		if (signal.aborted) return;
		const lines: string[] = [];
		for (const issue of aliasCatalog.issues()) {
			const { provider, id, source } = issue.alias;
			const key = JSON.stringify([provider, id, issue.kind]);
			if (warnedAliases.has(key)) continue;
			warnedAliases.add(key);
			const reason =
				issue.kind === "collision"
					? "ID collides with a physical model or another alias"
					: "source is missing, ambiguous, or not a chat model";
			lines.push(
				`${JSON.stringify(provider)}/${JSON.stringify(id)} -> ${JSON.stringify(source)}: ${reason}`,
			);
		}
		if (lines.length > 0)
			ctx.ui.notify(
				`pi-auth-plus rejected model aliases:\n${lines.join("\n")}\nEdit models.aliases and refresh models.`,
				"warning",
			);
	};
	const providerSink: ProviderSink = {
		registerProvider(providerOrName: Provider | string, config?: ProviderConfig) {
			if (typeof providerOrName !== "string") {
				ownedProviders.add(providerOrName.id);
				aliasCatalog.register(
					providerOrName.id,
					() => providerOrName.getAllModels?.() ?? providerOrName.getModels(),
				);
				const aliased = wrapNativeAliases(providerOrName, () => settings.get("models.aliases"));
				ownedCatalog.set(providerOrName.id, () => aliased.getModels());
				pi.registerProvider(
					filterNativeProvider(aliased, (model) => isVisible(providerOrName.id, model)),
				);
			} else if (config) {
				if (providerOrName === "synthetic") {
					ownedProviders.add(providerOrName);
					let physical: readonly ProviderModelConfig[] = [];
					let original: readonly ProviderModelConfig[] = [];
					aliasCatalog.register(providerOrName, () =>
						physical.map((model) => ({
							provider: providerOrName,
							id: model.id,
							...(model.type === undefined ? {} : { type: model.type }),
						})),
					);
					const aliased = wrapNamedAliases(
						providerOrName,
						config,
						() => settings.get("models.aliases"),
						undefined,
						(models) => {
							physical = models;
							if (aliasContext) warnAliasIssues(aliasContext, sessionController.signal);
						},
					);
					const refresh = aliased.refreshModels;
					const guarded: ProviderConfig = refresh
						? {
								...aliased,
								async refreshModels(context) {
									const owner = sessionController.signal;
									const signal = owner.aborted
										? context.signal
										: AbortSignal.any([context.signal, owner]);
									const models = await refresh({ ...context, signal });
									return signal.aborted ? [...original] : models;
								},
							}
						: aliased;
					ownedCatalog.set(providerOrName, () =>
						original.flatMap((model) =>
							model.type === undefined || model.type === "chat"
								? [
										{
											provider: providerOrName,
											id: model.id,
											name: model.name,
											contextWindow: model.contextWindow,
											maxTokens: model.maxTokens,
											reasoning: model.reasoning,
											input: model.input,
											cost: model.cost,
											api: model.api ?? config.api ?? "",
										},
									]
								: [],
						),
					);
					pi.registerProvider(
						providerOrName,
						filterOwnedConfig(
							guarded,
							(model) => isVisible(providerOrName, model),
							(models) => {
								original = models;
							},
						),
					);
				} else pi.registerProvider(providerOrName, config);
			}
		},
	};
	const catalogVisibility = new CatalogVisibility(pi, () => settings, ownedProviders);
	const reconcileSelectedModel = async (
		ctx: ExtensionContext,
		store: AppSettings,
		signal: AbortSignal,
	): Promise<void> => {
		if (signal.aborted) return;
		const selected = ctx.model;
		if (
			!selected ||
			(selected.provider !== "group" && !catalogVisibility.handles(selected.provider)) ||
			isVisible(selected.provider, selected, store)
		)
			return;
		const identity = `${selected.provider}/${selected.id}`;
		if (store.get("models.hiddenDefault") === "fallback") {
			const available = ctx.modelRegistry
				.getAvailable()
				.filter((model) => isVisible(model.provider, model, store));
			const next = available.find((model) => model.provider === selected.provider) ?? available[0];
			const switched = next && (await pi.setModel(next));
			if (signal.aborted) return;
			if (switched && next) {
				ctx.ui.notify(
					`${identity} is hidden by model rules; switched to ${next.provider}/${next.id}.`,
					"info",
				);
				return;
			}
		}
		ctx.ui.notify(
			`${identity} is hidden by model rules; the current selection was kept.`,
			"warning",
		);
	};
	const applyModelRules = async (
		ctx: ExtensionContext,
		changedProviders: readonly string[] = [],
		store: AppSettings = settings,
		signal: AbortSignal = sessionController.signal,
		startupGroupWarnings?: Set<string>,
	): Promise<AbortSignal | false> => {
		if (signal.aborted) return false;
		const applied = await catalogVisibility.apply(ctx, changedProviders, signal, store);
		if (signal.aborted || applied === false || applied.signal.aborted) return false;
		const lifetime = applied.signal;
		try {
			const catalog = ctx.modelRegistry.getAll();
			if (signal.aborted || lifetime.aborted) return false;
			const groupWarnings = groups.apply(catalog);
			const warnings = [...applied.warnings, ...groupWarnings];
			await reconcileSelectedModel(ctx, store, lifetime);
			if (lifetime.aborted) return false;
			if (warnings.length > 0) {
				ctx.ui.notify(warnings.join("\n"), "warning");
				for (const warning of groupWarnings) startupGroupWarnings?.add(warning);
			}
		} catch (error) {
			if (lifetime.aborted) return false;
			throw error;
		}
		return lifetime.aborted ? false : lifetime;
	};
	// Registered before the families so their session_start handlers see this session's settings.
	pi.on("session_start", async (event, ctx) => {
		const startup = startupOwners.get(event);
		if (!startup || startup.signal.aborted) return;
		const signal = startup.signal;
		aliasContext = undefined;
		warnedAliases.clear();
		const previousAliases = JSON.stringify(settings.get("models.aliases"));
		const project = ctx.isProjectTrusted() ? projectSettingsPath(ctx.cwd) : undefined;
		if (signal.aborted) return;
		const store = new SettingsStore(
			SETTINGS,
			project ? { user: userSettingsPath(), project } : { user: userSettingsPath() },
		);
		startup.store = store;
		settings = store;
		const problems = await store.load();
		if (signal.aborted) return;
		const changed =
			previousAliases === JSON.stringify(store.get("models.aliases")) ? [] : [...ownedProviders];
		const applied = await applyModelRules(ctx, changed, store, signal, startup.groupWarnings);
		if (applied === false || applied.aborted || signal.aborted) return;
		aliasContext = ctx;
		warnAliasIssues(ctx, signal);
		if (signal.aborted) return;
		if (problems.length > 0) {
			const lines = problems.map((p) => `${p.path}${p.key ? ` ${p.key}` : ""}: ${p.reason}`);
			ctx.ui.notify(`pi-auth-plus settings:\n${lines.join("\n")}`, "warning");
		}
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ownsShutdown(ctx)) aliasContext = undefined;
	});
	let quotaContext: ExtensionContext | undefined;
	let physicalHooksActive = false;
	const pendingIngests = new Set<Promise<unknown>>();
	// Tracker cancellation must precede a replacement's potentially slow settings load.
	const tokenOn: ExtensionAPI["on"] = (event: string, handler: (...args: never[]) => unknown) => {
		if (event === "session_shutdown") {
			stopTokenTracker = (start, ctx) => {
				const reason = start.reason === "startup" ? "new" : start.reason;
				Reflect.apply(handler, undefined, [{ type: "session_shutdown", reason }, ctx]);
			};
		}
		return Reflect.apply(pi.on, pi, [
			event,
			(payload: object, ctx: ExtensionContext) => {
				if (event === "session_start" && !ownsStartup(payload)) return;
				if (event === "session_shutdown" && !ownsShutdown(ctx)) return;
				return Reflect.apply(handler, undefined, [payload, ctx]);
			},
		]);
	};
	const tokens = createTokenTracker(
		{ on: tokenOn },
		{
			engine: createTokenEngine({
				families: registry.families,
				resolveModel: (model) => aliasCatalog.resolve(model),
				deps: {
					auth: offline
						? async () => undefined
						: (id) => quotaAuthFor(id, quotaContext?.modelRegistry),
					fetch: offline
						? async () => {
								throw new Error("Native token counting is unavailable offline; retry online.");
							}
						: fetch,
					tokenizers: defaultTokenizerStore(),
				},
				tools: () => {
					const active = new Set(pi.getActiveTools());
					return pi
						.getAllTools()
						.filter((tool) => active.has(tool.name))
						.map(({ name, description, parameters }) => ({ name, description, parameters }));
				},
			}),
		},
	);
	let stopTokenBus: (() => void) | undefined;
	pi.on("session_start", (event) => {
		const startup = startupOwners.get(event);
		if (!startup || startup.signal.aborted) return;
		const stop = registerTokenBus(sessionBus(startup.signal), tokens);
		if (startup.signal.aborted) {
			stop();
			return;
		}
		stopTokenBus = stop;
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (!ownsShutdown(ctx)) return;
		stopTokenBus?.();
		stopTokenBus = undefined;
	});
	let quotasEnabled = false;
	const quotas = new QuotaEngine({
		registry,
		cachePath: join(cacheDir(), "quotas.json"),
		settings: () => settings,
		now: Date.now,
		fetch,
		authFor: (id) => quotaAuthFor(id, quotaContext?.modelRegistry),
		backgroundNetwork: !offline,
	});
	const quotaLine = createQuotaLine(pi, {
		engine: quotas,
		registry,
		settings: () => settings,
		now: Date.now,
		tokens,
	});
	pi.on("session_start", async (event, ctx) => {
		const startup = startupOwners.get(event);
		if (!startup?.store || startup.signal.aborted) return;
		const { signal, store } = startup;
		const configured = NO_EXTENSIONS ? {} : pi.getSettings();
		const commandPaths = pi.getCommands().map((command) => command.sourceInfo.path);
		if (signal.aborted) return;
		quotaContext = ctx;
		quotasEnabled = !loadsPackage(
			"pi-quotas",
			configured.packages ?? [],
			configured.extensions ?? [],
			commandPaths,
		);
		if (!quotasEnabled) return;
		const projectTrusted = ctx.isProjectTrusted();
		if (signal.aborted) return;
		const carried = await carryOverPiQuotas({
			settings: store,
			registry,
			engine: quotas,
			cwd: ctx.cwd,
			projectTrusted,
		});
		if (signal.aborted) return;
		if (carried.info.length > 0) ctx.ui.notify(carried.info.join("\n"), "info");
		if (signal.aborted) return;
		if (carried.warnings.length > 0)
			ctx.ui.notify(`pi-auth-plus quota carry-over:\n${carried.warnings.join("\n")}`, "warning");
		if (signal.aborted) return;
		await quotas.start();
		if (signal.aborted) return;
		const stop = registerQuotaBus(sessionBus(signal), quotas, registry, () => store, Date.now, {
			confirmReset: async (id, credit, requester) => {
				if (signal.aborted) return false;
				const approved = await confirmReset(
					ctx,
					id,
					credit,
					requester,
					engineReport(quotas, store, Date.now()),
					registry,
				);
				return !signal.aborted && approved;
			},
		});
		if (signal.aborted) {
			stop();
			return;
		}
		stopQuotaBus = stop;
		quotaLine.start(ctx);
		if (signal.aborted) quotaLine.stop();
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ownsShutdown(ctx)) return;
		// Print mode exits right after the turn; let header writes land, bounded.
		await Promise.race([
			Promise.allSettled(pendingIngests),
			new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
		]);
		if (!ownsShutdown(ctx)) return;
		quotasEnabled = false;
		quotaContext = undefined;
		stopQuotaBus?.();
		stopQuotaBus = undefined;
		quotaLine.stop();
		quotas.stop();
	});
	pi.on("after_provider_response", (event, ctx) => {
		// A physical request reported its own response with an exact provider.
		if (!quotasEnabled || physicalHooksActive) return;
		const ingest = quotas.ingestHeaders(event.headers, ctx.model?.provider);
		pendingIngests.add(ingest);
		void ingest.finally(() => pendingIngests.delete(ingest));
	});
	pi.on("agent_end", (_event, ctx) => {
		const providers = new Set(physicalResponseProviders);
		physicalResponseProviders.clear();
		if (
			sessionController.signal.aborted ||
			offline ||
			!quotasEnabled ||
			!settings.get("quotas.refreshOnRequest")
		)
			return;
		if (!physicalHooksActive && ctx.model?.provider) providers.add(ctx.model.provider);
		const enabled = new Set(
			enabledQuotaProviders(registry, settings).map((provider) => provider.id),
		);
		const ids = new Set<string>();
		for (const name of providers) {
			const provider = registry.resolve(name)?.provider;
			if (provider?.quota && enabled.has(provider.id)) ids.add(provider.id);
		}
		quotaContext = ctx;
		for (const id of ids) void quotas.refresh(id, { minAgeMs: 2000 });
	});
	const host = {
		settings: () => settings,
		aliases: () => aliasCatalog.aliases(),
		resolveModel: (model: Parameters<AliasCatalog["resolve"]>[0]) => aliasCatalog.resolve(model),
		physicalHooksAvailable: () => physicalHooksActive,
	};
	await registerFamilyProviders(providerSink, registry, host);
	await catalogVisibility.apply();
	const familyOn: ExtensionAPI["on"] = (event: string, handler: (...args: never[]) => unknown) => {
		if (event !== "session_start") return Reflect.apply(pi.on, pi, [event, handler]);
		return Reflect.apply(pi.on, pi, [
			event,
			(...args: [object, ...unknown[]]) => {
				if (!ownsStartup(args[0])) return;
				return Reflect.apply(handler, undefined, args);
			},
		]);
	};
	const familyPi: ExtensionAPI = { ...pi, on: familyOn };
	for (const family of registry.families) await family.register?.(familyPi, host);
	registerCompatibleThoughtSignatures(pi);
	const recovery = registerThoughtSignatureRecovery(pi);
	const settlement = registerGroupSettlement(pi, () => settings.get("models.groups"));
	const groupQuota = (provider: string) => {
		const id = registry.resolve(provider)?.provider.id ?? provider;
		return quotas.view().find((view) => view.provider.id === id)?.snapshot;
	};
	const groups = new GroupRegistrations(pi, {
		groups: () => settings.get("models.groups"),
		visible: (id) => isVisible("group", { id }),
		quota: groupQuota,
		takeFailed: (groupId) => settlement.takeFailed(groupId),
		onSwitch: (group, from, to) =>
			quotaContext?.ui.notify(
				`Group ${group.name ?? group.id}: ${from.provider}/${from.id} failed; routed to ${to.provider}/${to.id}.`,
				"warning",
			),
	});
	groups.apply();
	const physicalFactory = (ctx: ExtensionContext, store: AppSettings, signal: AbortSignal) => {
		const sessionHost = { ...host, settings: () => store, cwd: ctx.cwd };
		const factories: PhysicalRequestFactory[] = [
			...registry.families.map(
				(family): PhysicalRequestFactory =>
					(model) =>
						family.physical?.(model, sessionHost),
			),
			recovery.factory,
			compatiblePhysicalHooks,
			() => ({
				response: (response, actualModel) => {
					if (!quotasEnabled) return;
					physicalResponseProviders.add(actualModel.provider);
					// The physical provider owns this response; the session model may be a group or alias.
					const ingest = quotas.ingestHeaders(response.headers, actualModel.provider, {
						strict: true,
					});
					pendingIngests.add(ingest);
					void ingest.finally(() => pendingIngests.delete(ingest));
				},
			}),
		];
		return composePhysicalFactories(
			factories.map((factory) => (model, context) => {
				if (signal.aborted) return undefined;
				const hooks = factory(model, context);
				if (!hooks || signal.aborted) return undefined;
				const { headers, payload, response, message } = hooks;
				return {
					...(headers && {
						headers: async (value) => {
							if (signal.aborted) return value;
							const result = await headers(value);
							return signal.aborted ? value : result;
						},
					}),
					...(payload && {
						payload: async (value, actualModel) => {
							if (signal.aborted) return undefined;
							const result = await payload(value, actualModel);
							return signal.aborted ? undefined : result;
						},
					}),
					...(response && {
						response: (value, actualModel) => {
							if (!signal.aborted) return response(value, actualModel);
						},
					}),
					...(message && {
						message: (value) => (signal.aborted ? undefined : message(value)),
					}),
				};
			}),
		);
	};
	// Groups, physical hooks and the cap install need this session's cwd and catalog.
	let warnedStartup = false;
	pi.on("session_start", (event, ctx) => {
		const startup = startupOwners.get(event);
		if (!startup?.store || startup.signal.aborted) return;
		const { signal, groupWarnings, store } = startup;
		try {
			const installed = installPhysicalRequestHooks(
				ctx.modelRegistry,
				physicalFactory(ctx, store, signal),
			);
			if (signal.aborted) return;
			physicalHooksActive = installed;
			recovery.setPhysicalHooksAvailable(installed);
			installGroupContextCap(ctx.modelRegistry);
			if (signal.aborted) return;
			const catalog = ctx.modelRegistry.getAll();
			if (signal.aborted) return;
			const warnings = groups.apply(catalog).filter((warning) => !groupWarnings.has(warning));
			if (!signal.aborted && warnings.length > 0) ctx.ui.notify(warnings.join("\n"), "warning");
			if (!signal.aborted && !physicalHooksActive && event.reason === "startup") {
				ctx.ui.notify(
					"pi-auth-plus: physical request hooks are unavailable in this Pi build; aliases and groups fall back to session-level detection.",
					"warning",
				);
			}
		} finally {
			if (!signal.aborted) {
				const runtime = sessionRuntime(ctx);
				const captured = !signal.aborted && startupCoordinator?.ready(runtime);
				if (
					!signal.aborted &&
					rpcStartup &&
					!offline &&
					event.reason === "startup" &&
					!captured &&
					!warnedStartup &&
					(effectiveModelRules(store).length > 0 || store.get("models.groups").length > 0)
				) {
					warnedStartup = true;
					ctx.ui.notify(
						"pi-auth-plus: RPC startup catalog coordination is unavailable in this Pi build; model rules or groups may interrupt the background refresh. Refresh models later to retry.",
						"warning",
					);
				}
			}
		}
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (!ownsShutdown(ctx)) return;
		physicalHooksActive = false;
	});
	let previewRules: readonly string[] | undefined;
	let previewCompiled = compileModelRules([]);
	const modelCatalog = (): ModelCatalogItem[] => {
		const rows = new Map<string, ModelCatalogItem>();
		const add = (models: readonly ModelCatalogItem[]) => {
			for (const model of models) rows.set(`${model.provider}\0${model.id}`, model);
		};
		for (const models of ownedCatalog.values()) add(models());
		add(catalogVisibility.catalog().filter((model) => isModelType(model, "chat")));
		add(quotaContext?.modelRegistry.getAll() ?? []);
		const sources = new Map(
			aliasCatalog.aliases().map((alias) => [`${alias.provider}\0${alias.id}`, alias.source]),
		);
		return [...rows.values()].map((model) => {
			const source = sources.get(`${model.provider}\0${model.id}`);
			return source === undefined ? model : { ...model, aliasSource: source };
		});
	};
	const captureSettingsEffects = () => {
		const store = settings;
		const ctx = quotaContext;
		const signal = sessionController.signal;
		return {
			store,
			ctx,
			signal,
			apply: async (keys: readonly string[]): Promise<readonly string[]> => {
				const warnings: string[] = [];
				const effect = async (
					name: string,
					run: () => void | Promise<void>,
					owner: AbortSignal = signal,
				) => {
					if (signal.aborted || owner.aborted) return;
					try {
						await run();
					} catch (error) {
						if (!signal.aborted && !owner.aborted) {
							const reason = error instanceof Error ? error.message : String(error);
							warnings.push(`${name} failed: ${reason}; retry or reopen the session`);
						}
					}
				};
				await effect("Quota line refresh", () => quotaLine.settingsChanged());
				const modelsChanged = keys.some((key) => key.startsWith("models."));
				const aliasesChanged = keys.includes("models.aliases");
				let catalogLifetime: AbortSignal | undefined | false;
				const modelWarnings: string[] = [];
				const modelWarningIndex = warnings.length;
				let catalogRefreshed = false;
				let groupsRefreshed = false;
				if (modelsChanged && ctx) {
					await effect("Model catalog refresh", async () => {
						const applied = await catalogVisibility.apply(
							ctx,
							aliasesChanged ? [...ownedProviders] : [],
							signal,
							store,
						);
						if (applied === false) {
							catalogLifetime = false;
							return;
						}
						catalogLifetime = applied.signal;
						modelWarnings.push(...applied.warnings);
						catalogRefreshed = true;
					});
					if (aliasesChanged && catalogLifetime !== false && !catalogLifetime?.aborted)
						await effect(
							"Model alias warnings",
							() => warnAliasIssues(ctx, signal),
							catalogLifetime ?? signal,
						);
				}
				if (modelsChanged && catalogLifetime !== false && !catalogLifetime?.aborted) {
					await effect(
						"Model group refresh",
						() => {
							modelWarnings.push(...groups.apply(ctx?.modelRegistry.getAll() ?? []));
							groupsRefreshed = true;
						},
						catalogLifetime ?? signal,
					);
					if (ctx && catalogRefreshed && groupsRefreshed && !catalogLifetime?.aborted)
						await effect(
							"Selected model reconciliation",
							() => reconcileSelectedModel(ctx, store, catalogLifetime || signal),
							catalogLifetime || signal,
						);
				}
				if (modelsChanged || keys.includes("claude.replacePatterns"))
					await effect("Token refresh", async () => {
						await tokens.refresh();
					});
				for (const family of registry.families) {
					if (family.settingsChanged)
						await effect(`${family.label} settings`, () => family.settingsChanged?.(keys, signal));
				}
				if (!signal.aborted && catalogLifetime !== false && !catalogLifetime?.aborted)
					warnings.splice(modelWarningIndex, 0, ...modelWarnings);
				return warnings;
			},
		};
	};
	const saveSettings = createSettingsSaver(captureSettingsEffects);
	registerAuthCommands(pi, {
		registry,
		saveSettings,
		signal: () => sessionController.signal,
		groups: {
			groups: () => settings.get("models.groups"),
			catalog: () => modelCatalog(),
			current: (groupId) => {
				const owner = quotaContext;
				return owner
					? readGroupRouteState(owner.sessionManager.getBranch(), groupId)?.selected
					: undefined;
			},
			health: (member) => {
				const model = quotaContext?.modelRegistry.find(member.provider, member.id);
				const available =
					quotaContext?.modelRegistry
						.getAvailable()
						.some((item) => item.provider === member.provider && item.id === member.id) ?? false;
				return groupMemberHealth(model, available, groupQuota(member.provider));
			},
			save: (next, scope) => saveSettings(scope, { "models.groups": next }),
		},
		models: {
			rules: () => effectiveModelRules(settings),
			catalog: modelCatalog,
			presentation: () => ({
				showProvenance: settings.get("dashboard.showProvenance"),
				showMatchedRule: settings.get("dashboard.showMatchedRule"),
			}),
			evaluate: (rules, provider, id) => {
				if (rules !== previewRules) {
					previewRules = rules;
					previewCompiled = compileModelRules(rules);
				}
				const result = evaluateModelRules(previewCompiled, provider, id);
				return {
					visible: !result.hidden,
					...(result.ruleIndex === undefined ? {} : { ruleIndex: result.ruleIndex }),
				};
			},
			save: (rules, scope) => saveSettings(scope, { "models.rules": rules }),
			details: {
				aliases: {
					list: () => settings.get("models.aliases"),
					supported: (provider) => ownedProviders.has(provider),
					save: (aliases, scope) => saveSettings(scope, { "models.aliases": aliases }),
				},
				read: (provider, id) => readOverride(modelsPath(), provider, id),
				current: (provider, id) =>
					modelCatalog().find((model) => model.provider === provider && model.id === id),
				save: async (provider, id, changes) => {
					const ctx = quotaContext;
					const signal = sessionController.signal;
					const store = settings;
					const path = modelsPath();
					await updateOverrides(path, provider, id, changes);
					if (!ctx || signal.aborted) return;
					let lifetime: AbortSignal | undefined;
					try {
						const applied = await applyModelRules(ctx, [provider], store, signal);
						if (applied === false || applied.aborted) return;
						lifetime = applied;
						if (ctx.model?.provider === provider && ctx.model.id === id) {
							const model = ctx.modelRegistry.find(provider, id);
							if (model && !(await pi.setModel(model)) && !lifetime.aborted)
								ctx.ui.notify("Model override saved; reselect the model to apply it.", "warning");
						}
					} catch (error) {
						if (!signal.aborted && !lifetime?.aborted)
							ctx.ui.notify(
								`Model override saved, but catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`,
								"warning",
							);
					}
				},
			},
		},
		status: (providerId) => {
			const custom = registry.resolve(providerId)?.provider.login?.status;
			if (custom) return custom(Date.now());
			const stored = credentialStatus(readCredential(providerId), Date.now());
			if (stored.state !== "missing") return stored;
			const ambient = registry.resolve(providerId)?.provider.ambient?.();
			return ambient ? { state: "ambient", ...ambient } : stored;
		},
		now: Date.now,
		tokens: () => tokens,
		quotas: () =>
			quotasEnabled
				? {
						report: () => engineReport(quotas, settings, Date.now()),
						resetSupport: (id) => quotas.resetSupport(id),
						listResets: (id) => quotas.listResets(id),
						consumeReset: (id, creditId, requester) => quotas.consumeReset(id, creditId, requester),
						refreshing: (id) =>
							quotas.view().some((view) => view.provider.id === id && view.refreshing),
						refresh: (id, force) => quotas.refresh(id, { force, minAgeMs: 0 }),
						onChange: (listener) => quotas.onChange(listener),
						lineConfig: () => quotaLineConfig(settings),
						linePlacement: () => settings.get("quotas.linePlacement"),
						setLinePlacement: (next, scope) =>
							saveSettings(scope, { "quotas.linePlacement": next }),
						now: Date.now,
						text: (provider) =>
							formatPlainTextSummary(
								quotas.view(),
								quotaLineConfig(settings),
								provider,
								Date.now(),
							),
					}
				: "pi-quotas is loaded and still owns quotas. Remove it from your Pi settings to use these.",
		settings: {
			store: () => settings,
			save: saveSettings,
			providerOptions: (key) => {
				const options = new Map(
					registry
						.providers()
						.filter(({ provider }) => key !== "quotas.providers" || provider.quota)
						.map(({ provider }) => [provider.id, { value: provider.id, label: provider.label }]),
				);
				if (key === "openai.verbosityProviders")
					for (const model of modelCatalog())
						if (!options.has(model.provider))
							options.set(model.provider, { value: model.provider, label: model.provider });
				return [...options.values()];
			},
			preview: (source, width, theme) => quotaLine.preview(source, width, theme),
		},
	});

	let warned = false;
	pi.on("session_start", (event, ctx) => {
		const startup = startupOwners.get(event);
		if (!startup || startup.signal.aborted || warned) return;
		// With --no-extensions Pi skips configured packages; only explicit -e loads count then.
		const settings = NO_EXTENSIONS ? {} : pi.getSettings();
		const commandPaths = pi.getCommands().map((command) => command.sourceInfo.path);
		if (startup.signal.aborted) return;
		warned = true;
		const conflicts = detectConflicts(
			settings.packages ?? [],
			settings.extensions ?? [],
			commandPaths,
		);
		if (conflicts.length > 0) ctx.ui.notify(conflictMessage(conflicts), "warning");
	});
}
