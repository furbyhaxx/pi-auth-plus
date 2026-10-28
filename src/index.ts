/** Pi entrypoint: awaits family registration and wires commands, flags and events. */

import { join } from "node:path";
import { isModelType, type Provider } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRuntime,
	ProviderConfig,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { handleQuotaCli, registerQuotaCliFlags } from "./cli/index.ts";
import { credentialStatus, readCredential } from "./core/auth/index.ts";
import { type AppSettings, SETTINGS } from "./core/config/catalog.ts";
import { SettingsStore } from "./core/config/index.ts";
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
import { filterNativeProvider, filterOwnedConfig } from "./models/catalog/owned-filter.ts";
import { CatalogVisibility } from "./models/catalog/runtime.ts";
import { installStartupCoordinator } from "./models/catalog/startup.ts";
import { installGroupContextCap } from "./models/groups/context-cap.ts";
import { GroupRegistrations } from "./models/groups/registration.ts";
import { registerGroupSettlement } from "./models/groups/settlement.ts";
import { readOverride, updateOverrides } from "./models/overrides/index.ts";
import { compileModelRules, evaluateModelRules } from "./models/rules/match.ts";
import { effectiveModelRules } from "./models/rules/settings.ts";
import {
	composePhysicalFactories,
	installPhysicalRequestHooks,
} from "./models/runtime/physical.ts";
import { quotaAuthFor } from "./quotas/auth.ts";
import { registerQuotaBus } from "./quotas/bus.ts";
import { QuotaEngine } from "./quotas/engine.ts";
import { createQuotaLine } from "./quotas/line/index.ts";
import { quotaLineConfig } from "./quotas/line/line.ts";
import { formatPlainTextSummary } from "./quotas/line/summary.ts";
import { carryOverPiQuotas } from "./quotas/migrate/index.ts";
import { engineReport } from "./quotas/report.ts";
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
	const isVisible = (provider: string, model: { readonly id: string }): boolean => {
		const rules = effectiveModelRules(settings);
		if (rules !== lastRules) {
			lastRules = rules;
			compiledRules = compileModelRules(rules);
		}
		return !evaluateModelRules(compiledRules, provider, model.id).hidden;
	};
	const ownedProviders = new Set<string>();
	const ownedCatalog = new Map<string, () => readonly ModelCatalogItem[]>();
	const providerSink: ProviderSink = {
		registerProvider(providerOrName: Provider | string, config?: ProviderConfig) {
			if (typeof providerOrName !== "string") {
				ownedProviders.add(providerOrName.id);
				const aliased = wrapNativeAliases(providerOrName, () => settings.get("models.aliases"));
				ownedCatalog.set(providerOrName.id, () => aliased.getModels());
				pi.registerProvider(
					filterNativeProvider(aliased, (model) => isVisible(providerOrName.id, model)),
				);
			} else if (config) {
				if (providerOrName === "synthetic") {
					ownedProviders.add(providerOrName);
					const aliased = wrapNamedAliases(providerOrName, config, () =>
						settings.get("models.aliases"),
					);
					let original: readonly ProviderModelConfig[] = [];
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
							aliased,
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
	const catalogVisibility = new CatalogVisibility(
		pi,
		() => settings,
		ownedProviders,
		(model) => isVisible(model.provider, model),
	);
	const applyModelRules = async (
		ctx: ExtensionContext,
		changedProviders: readonly string[] = [],
	): Promise<void> => {
		await catalogVisibility.apply(ctx, changedProviders);
		const selected = ctx.model;
		if (
			!selected ||
			!catalogVisibility.handles(selected.provider) ||
			isVisible(selected.provider, selected)
		)
			return;
		const identity = `${selected.provider}/${selected.id}`;
		if (settings.get("models.hiddenDefault") === "fallback") {
			const available = ctx.modelRegistry
				.getAvailable()
				.filter((model) => isVisible(model.provider, model));
			const next = available.find((model) => model.provider === selected.provider) ?? available[0];
			if (next && (await pi.setModel(next))) {
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
	// Registered before the families so their session_start handlers see this session's settings.
	pi.on("session_start", async (_event, ctx) => {
		const project = ctx.isProjectTrusted() ? projectSettingsPath(ctx.cwd) : undefined;
		settings = new SettingsStore(
			SETTINGS,
			project ? { user: userSettingsPath(), project } : { user: userSettingsPath() },
		);
		const problems = await settings.load();
		await applyModelRules(ctx);
		if (problems.length > 0) {
			const lines = problems.map((p) => `${p.path}${p.key ? ` ${p.key}` : ""}: ${p.reason}`);
			ctx.ui.notify(`pi-auth-plus settings:\n${lines.join("\n")}`, "warning");
		}
	});
	let quotaContext: ExtensionContext | undefined;
	// Filled by session_start; request hooks only run inside a session.
	let sessionCwd = "";
	let physicalHooksActive = false;
	const pendingIngests = new Set<Promise<unknown>>();
	const tokens = createTokenTracker(pi, {
		engine: createTokenEngine({
			families: registry.families,
			deps: {
				auth: (id) => quotaAuthFor(id, quotaContext?.modelRegistry),
				fetch,
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
	});
	let stopTokenBus: (() => void) | undefined;
	pi.on("session_start", () => {
		stopTokenBus?.();
		stopTokenBus = registerTokenBus(pi.events, tokens);
	});
	pi.on("session_shutdown", () => {
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
	});
	const quotaLine = createQuotaLine(pi, {
		engine: quotas,
		registry,
		settings: () => settings,
		now: Date.now,
		tokens,
	});
	let stopQuotaBus: (() => void) | undefined;
	pi.on("session_start", async (_event, ctx) => {
		stopQuotaBus?.();
		stopQuotaBus = undefined;
		quotaLine.stop();
		quotas.stop();
		quotaContext = ctx;
		const configured = NO_EXTENSIONS ? {} : pi.getSettings();
		const commandPaths = pi.getCommands().map((command) => command.sourceInfo.path);
		quotasEnabled = !loadsPackage(
			"pi-quotas",
			configured.packages ?? [],
			configured.extensions ?? [],
			commandPaths,
		);
		if (!quotasEnabled) return;
		const carried = await carryOverPiQuotas({
			settings,
			registry,
			engine: quotas,
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
		});
		if (carried.info.length > 0) ctx.ui.notify(carried.info.join("\n"), "info");
		if (carried.warnings.length > 0)
			ctx.ui.notify(`pi-auth-plus quota carry-over:\n${carried.warnings.join("\n")}`, "warning");
		await quotas.start();
		stopQuotaBus = registerQuotaBus(pi.events, quotas, registry, () => settings, Date.now, {
			confirmReset: (id, credit, requester) =>
				confirmReset(
					quotaContext,
					id,
					credit,
					requester,
					engineReport(quotas, settings, Date.now()),
					registry,
				),
		});
		quotaLine.start(ctx);
	});
	pi.on("session_shutdown", async () => {
		// Print mode exits right after the turn; let header writes land, bounded.
		await Promise.race([
			Promise.allSettled(pendingIngests),
			new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
		]);
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
		if (!quotasEnabled || !settings.get("quotas.refreshOnRequest")) return;
		quotaContext = ctx;
		const id = ctx.model?.provider;
		const provider = id ? registry.resolve(id)?.provider : undefined;
		if (provider?.quota) void quotas.refresh(provider.id, { minAgeMs: 2000 });
	});
	const host = {
		settings: () => settings,
		physicalHooksAvailable: () => physicalHooksActive,
	};
	await registerFamilyProviders(providerSink, registry, host);
	await catalogVisibility.apply();
	for (const family of registry.families) await family.register?.(pi, host);
	registerCompatibleThoughtSignatures(pi);
	const recovery = registerThoughtSignatureRecovery(pi);
	const settlement = registerGroupSettlement(pi, () => settings.get("models.groups"));
	const groups = new GroupRegistrations(pi, {
		groups: () => settings.get("models.groups"),
		quota: (provider) => quotas.view().find((view) => view.provider.id === provider)?.snapshot,
		takeFailed: (groupId) => settlement.takeFailed(groupId),
		onSwitch: (group, from, to) =>
			quotaContext?.ui.notify(
				`Group ${group.name ?? group.id}: ${from.provider}/${from.id} failed; routed to ${to.provider}/${to.id}.`,
				"warning",
			),
	});
	groups.apply();
	const physicalFactory = composePhysicalFactories([
		(model, context) => {
			const hooks = registry.families.flatMap((family) => {
				try {
					const hook = family.physical?.(model, {
						settings: () => settings,
						cwd: sessionCwd,
					});
					return hook ? [hook] : [];
				} catch {
					return [];
				}
			});
			if (hooks.length === 0) return undefined;
			return composePhysicalFactories(hooks.map((hook) => () => hook))(model, context);
		},
		(model, context) => recovery.factory(model, context),
		(model, context) => compatiblePhysicalHooks(model, context),
		(model) => ({
			response: (response) => {
				if (!quotasEnabled) return;
				// The physical provider owns this response; the session model may be a group or alias.
				const ingest = quotas.ingestHeaders(response.headers, model.provider, { strict: true });
				pendingIngests.add(ingest);
				void ingest.finally(() => pendingIngests.delete(ingest));
			},
		}),
	]);
	// Groups, physical hooks and the cap install need this session's cwd and catalog.
	let warnedStartup = false;
	pi.on("session_start", (event, ctx) => {
		try {
			sessionCwd = ctx.cwd;
			physicalHooksActive = installPhysicalRequestHooks(ctx.modelRegistry, physicalFactory);
			recovery.setPhysicalHooksAvailable(physicalHooksActive);
			installGroupContextCap(ctx.modelRegistry);
			groups.apply(ctx.modelRegistry.getAll());
			if (!physicalHooksActive && event.reason === "startup") {
				ctx.ui.notify(
					"pi-auth-plus: physical request hooks are unavailable in this Pi build; aliases and groups fall back to session-level detection.",
					"warning",
				);
			}
		} finally {
			const captured = startupCoordinator?.ready(sessionRuntime(ctx));
			if (
				rpcStartup &&
				!offline &&
				event.reason === "startup" &&
				!captured &&
				!warnedStartup &&
				(effectiveModelRules(settings).length > 0 || settings.get("models.groups").length > 0)
			) {
				warnedStartup = true;
				ctx.ui.notify(
					"pi-auth-plus: RPC startup catalog coordination is unavailable in this Pi build; model rules or groups may interrupt the background refresh. Refresh models later to retry.",
					"warning",
				);
			}
		}
	});
	pi.on("session_shutdown", () => {
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
		return [...rows.values()];
	};
	registerAuthCommands(pi, {
		registry,
		groups: {
			groups: () => settings.get("models.groups"),
			catalog: () => modelCatalog(),
			health: (member) => {
				const model = quotaContext?.modelRegistry.find(member.provider, member.id);
				if (!model || model.api === "pi-virtual") return "unavailable";
				const available = quotaContext?.modelRegistry
					.getAvailable()
					.some((item) => item.provider === member.provider && item.id === member.id);
				if (available === undefined) return "unknown";
				return available ? "healthy" : "unavailable";
			},
			save: async (next, scope) => {
				await settings.save(scope, { "models.groups": next });
				groups.apply(quotaContext?.modelRegistry.getAll() ?? []);
			},
		},
		models: {
			rules: () => effectiveModelRules(settings),
			catalog: modelCatalog,
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
			save: async (rules, scope) => {
				await settings.save(scope, { "models.rules": rules });
				if (quotaContext) await applyModelRules(quotaContext);
			},
			details: {
				aliases: {
					list: () => settings.get("models.aliases"),
					supported: (provider) => ownedProviders.has(provider),
					save: async (aliases, scope) => {
						await settings.save(scope, { "models.aliases": aliases });
						if (quotaContext) await applyModelRules(quotaContext, [...ownedProviders]);
					},
				},
				read: (provider, id) => readOverride(modelsPath(), provider, id),
				current: (provider, id) =>
					modelCatalog().find((model) => model.provider === provider && model.id === id),
				save: async (provider, id, changes) => {
					await updateOverrides(modelsPath(), provider, id, changes);
					const ctx = quotaContext;
					if (!ctx) return;
					try {
						await applyModelRules(ctx, [provider]);
						if (ctx.model?.provider === provider && ctx.model.id === id) {
							const model = ctx.modelRegistry.find(provider, id);
							if (model && !(await pi.setModel(model)))
								ctx.ui.notify("Model override saved; reselect the model to apply it.", "warning");
						}
					} catch (error) {
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
						setLinePlacement: async (next) => {
							await settings.save("user", { "quotas.linePlacement": next });
							quotaLine.settingsChanged();
						},
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
			onSaved: (keys) => {
				quotaLine.settingsChanged();
				if (quotaContext && keys.some((key) => key.startsWith("models."))) {
					const ctx = quotaContext;
					const changed = keys.includes("models.aliases") ? [...ownedProviders] : [];
					void applyModelRules(ctx, changed).catch((error: unknown) =>
						ctx.ui.notify(
							`Model rules could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
							"warning",
						),
					);
				}
			},
			preview: (source, width, theme) => quotaLine.preview(source, width, theme),
		},
	});

	let warned = false;
	pi.on("session_start", (_event, ctx) => {
		if (warned) return;
		warned = true;
		// With --no-extensions Pi skips configured packages; only explicit -e loads count then.
		const settings = NO_EXTENSIONS ? {} : pi.getSettings();
		const commandPaths = pi.getCommands().map((command) => command.sourceInfo.path);
		const conflicts = detectConflicts(
			settings.packages ?? [],
			settings.extensions ?? [],
			commandPaths,
		);
		if (conflicts.length > 0) ctx.ui.notify(conflictMessage(conflicts), "warning");
	});
}
