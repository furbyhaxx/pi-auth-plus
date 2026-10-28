/** Staged model visibility rules and their catalog preview. */
import { Input, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { SaveScope } from "../../core/config/index.ts";
import type { OverrideEdit } from "../../models/overrides/index.ts";
import { exactModelRule } from "../../models/rules/match.ts";
import { sanitize } from "../frame/index.ts";
import { ModelDetail } from "./model-detail.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

/** A model available to the visibility preview. */
export interface ModelCatalogItem {
	provider: string;
	id: string;
	name: string;
	contextWindow: number;
	maxTokens?: number;
	reasoning?: boolean;
	input?: readonly ("text" | "image")[];
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	api?: string;
}

/** The final visibility and the last matching rule, if any. */
export interface RuleOutcome {
	visible: boolean;
	ruleIndex?: number;
}

/** Session-owned sources and persistence for model rules. */
export interface ModelsTabDeps {
	rules(): readonly string[];
	catalog(): readonly ModelCatalogItem[];
	evaluate(rules: readonly string[], provider: string, id: string): RuleOutcome;
	save(rules: readonly string[], scope: SaveScope): Promise<void>;
	details?: {
		read(provider: string, id: string): Promise<Record<string, unknown> | undefined>;
		current?(provider: string, id: string): ModelCatalogItem | undefined;
		save(
			provider: string,
			id: string,
			changes: readonly { field: readonly string[]; edit: OverrideEdit }[],
		): Promise<void>;
	};
}

function text(value: string): string {
	return sanitize(value).replace(/\n/g, " ");
}

/** A rules editor with a live catalog preview and explicit scoped saves. */
export class ModelsView implements TabView {
	readonly #host: TabViewHost;
	readonly #deps: ModelsTabDeps;
	readonly #input = new Input({ prompt: "", placeholder: "provider/model or !provider/model" });
	#staged: string[] | undefined;
	#view: "rules" | "catalog" = "rules";
	#mode: "list" | "edit" | "save" = "list";
	#ruleSelected = 0;
	#modelSelected = 0;
	#offset = 0;
	#adding = false;
	#message = "";
	#saving = false;
	#disposed = false;
	#detail: ModelDetail | undefined;

	constructor(host: TabViewHost, deps: ModelsTabDeps) {
		this.#host = host;
		this.#deps = deps;
	}

	#rules(): readonly string[] {
		return this.#staged ?? this.#deps.rules();
	}

	#stage(rules: string[]): void {
		this.#staged = rules;
		this.#message = "";
	}

	#catalog(): ModelCatalogItem[] {
		const groups = new Map<string, ModelCatalogItem[]>();
		for (const item of this.#deps.catalog()) {
			const group = groups.get(item.provider);
			if (group) group.push(item);
			else groups.set(item.provider, [item]);
		}
		return [...groups.values()].flat();
	}

	#edit(adding: boolean): void {
		this.#adding = adding;
		this.#input.setValue("");
		const value = adding ? "" : (this.#rules()[this.#ruleSelected] ?? "");
		this.#input.handleInput(`\x1b[200~${text(value)}\x1b[201~`);
		this.#input.focused = true;
		this.#mode = "edit";
		this.#message = "";
	}

	async #save(scope: SaveScope): Promise<void> {
		const rules = this.#staged;
		if (!rules) return;
		this.#saving = true;
		try {
			await this.#deps.save([...rules], scope);
			if (this.#disposed) return;
			this.#staged = undefined;
			this.#message = `Saved to ${scope} scope`;
		} catch (error) {
			if (!this.#disposed)
				this.#message = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			this.#saving = false;
			this.#mode = "list";
			if (!this.#disposed) this.#host.refresh();
		}
	}

	/** Handles inline editing, staged actions and the scope prompt before frame keys. */
	handleInput(data: string): boolean {
		if (this.#detail) {
			if (!this.#detail.handleInput(data)) {
				this.#detail.dispose();
				this.#detail = undefined;
			}
			return true;
		}
		if (this.#saving) return true;
		const { keys } = this.#host;
		const cancel = keys.matches(data, "tui.select.cancel");
		const enter = keys.matches(data, "tui.select.confirm");
		if (this.#mode === "edit") {
			if (cancel) {
				this.#mode = "list";
				this.#message = "";
			} else if (enter) {
				const value = this.#input.getValue();
				if (!value.trim()) this.#message = "Rule cannot be empty";
				else {
					const rules = [...this.#rules()];
					if (this.#adding) {
						rules.push(value);
						this.#ruleSelected = rules.length - 1;
					} else rules[this.#ruleSelected] = value;
					this.#stage(rules);
					this.#mode = "list";
				}
			} else this.#input.handleInput(data);
			return true;
		}
		if (this.#mode === "save") {
			if (cancel) this.#mode = "list";
			else if (data === "u") void this.#save("user");
			else if (data === "p") void this.#save("project");
			else if (data === "r") void this.#save("runtime");
			return true;
		}
		if (cancel) {
			if (!this.#staged) return false;
			this.#staged = undefined;
			this.#message = "Discarded staged changes";
			return true;
		}
		if (
			keys.matches(data, "tui.input.tab") ||
			keys.matches(data, "tui.editor.cursorLeft") ||
			keys.matches(data, "tui.editor.cursorRight") ||
			matchesKey(data, "shift+tab")
		)
			return false;
		if (matchesKey(data, "ctrl+s")) {
			if (this.#staged) this.#mode = "save";
			else this.#message = "No staged changes to save";
			return true;
		}
		const rules = this.#rules();
		const catalog = this.#catalog();
		this.#ruleSelected = Math.max(0, Math.min(this.#ruleSelected, rules.length - 1));
		this.#modelSelected = Math.max(0, Math.min(this.#modelSelected, catalog.length - 1));
		if (
			this.#view === "rules" &&
			(matchesKey(data, "shift+up") || matchesKey(data, "shift+down"))
		) {
			const next = this.#ruleSelected + (matchesKey(data, "shift+up") ? -1 : 1);
			if (next >= 0 && next < rules.length) {
				const reordered = [...rules];
				const current = reordered[this.#ruleSelected];
				const other = reordered[next];
				if (current !== undefined && other !== undefined) {
					reordered[next] = current;
					reordered[this.#ruleSelected] = other;
					this.#ruleSelected = next;
					this.#stage(reordered);
				}
			}
			return true;
		}
		const up = keys.matches(data, "tui.select.up") || data === "k";
		const down = keys.matches(data, "tui.select.down") || data === "j";
		if (up || down) {
			const delta = up ? -1 : 1;
			if (this.#view === "rules")
				this.#ruleSelected = Math.max(0, Math.min(rules.length - 1, this.#ruleSelected + delta));
			else
				this.#modelSelected = Math.max(
					0,
					Math.min(catalog.length - 1, this.#modelSelected + delta),
				);
			return true;
		}
		if (data === "v") {
			this.#view = this.#view === "rules" ? "catalog" : "rules";
			this.#offset = 0;
			return true;
		}
		if (this.#view === "catalog") {
			const item = catalog[this.#modelSelected];
			if (enter && item && this.#deps.details) {
				this.#detail = new ModelDetail(this.#host, this.#deps.details, item);
				return true;
			}
			if (data !== "h" || !item) return false;
			const visible = this.#deps.evaluate(rules, item.provider, item.id).visible;
			this.#stage([...rules, `${visible ? "" : "!"}${exactModelRule(item.provider, item.id)}`]);
			return true;
		}
		const current = rules[this.#ruleSelected];
		if (data === "a") this.#edit(true);
		else if (enter && current !== undefined) this.#edit(false);
		else if (data === " " && current !== undefined) {
			const updated = [...rules];
			updated[this.#ruleSelected] = current.startsWith("#") ? current.slice(1) : `#${current}`;
			this.#stage(updated);
		} else if (data === "d" && current !== undefined) {
			const updated = [...rules];
			updated.splice(this.#ruleSelected, 1);
			this.#ruleSelected = Math.max(0, Math.min(this.#ruleSelected, updated.length - 1));
			this.#stage(updated);
		} else return false;
		return true;
	}

	/** Returns a clipped, scrollable body with status and binding-aware hints. */
	render(width: number, bodyRows: number): TabBody {
		if (this.#detail) return this.#detail.render(width, bodyRows);
		const { theme } = this.#host;
		const rules = this.#rules();
		const catalog = this.#catalog();
		const outcomes = catalog.map((item) => this.#deps.evaluate(rules, item.provider, item.id));
		const hidden = outcomes.filter((outcome) => !outcome.visible).length;
		this.#ruleSelected = Math.max(0, Math.min(this.#ruleSelected, rules.length - 1));
		const beforeRule = rules.slice(0, this.#ruleSelected);
		const throughRule = rules.slice(0, this.#ruleSelected + 1);
		const effect =
			this.#view === "rules" && rules[this.#ruleSelected] !== undefined
				? catalog.filter((item) => {
						const before = this.#deps.evaluate(beforeRule, item.provider, item.id);
						const after = this.#deps.evaluate(throughRule, item.provider, item.id);
						return before.visible !== after.visible;
					}).length
				: undefined;
		const rows: string[] = [
			` ${this.#view === "rules" ? "Rules" : "Catalog"} · ${hidden} hidden${this.#staged ? " · ● staged" : ""}`,
		];
		let selectedRow = 0;
		if (this.#view === "rules") {
			for (const [index, rule] of rules.entries()) {
				const selected = index === this.#ruleSelected;
				if (selected) selectedRow = rows.length;
				const value =
					selected && this.#mode === "edit" && !this.#adding
						? (this.#input.render(Math.max(1, width - 5))[0] ?? "")
						: text(rule);
				rows.push(` ${selected ? theme.fg("accent", "❯") : " "} ${value}`);
			}
			if (this.#mode === "edit" && this.#adding) {
				selectedRow = rows.length;
				rows.push(
					` ${theme.fg("accent", "❯")} ${this.#input.render(Math.max(1, width - 5))[0] ?? ""}`,
				);
			} else if (rules.length === 0) rows.push(" No rules; all models listed.");
		} else {
			this.#modelSelected = Math.max(0, Math.min(this.#modelSelected, catalog.length - 1));
			let provider: string | undefined;
			for (const [index, item] of catalog.entries()) {
				if (provider !== item.provider) {
					provider = item.provider;
					rows.push(` ${theme.bold(text(provider))}`);
				}
				const selected = index === this.#modelSelected;
				if (selected) selectedRow = rows.length;
				const state = outcomes[index]?.visible ? "listed" : "hidden";
				rows.push(
					` ${selected ? theme.fg("accent", "❯") : " "} ${state} ${text(item.id)} · ${text(item.name)} · ${item.contextWindow}`,
				);
			}
			if (catalog.length === 0) rows.push(" No models in catalog.");
		}
		const details: string[] = [];
		if (this.#message) details.push(` ${theme.fg("warning", text(this.#message))}`);
		if (this.#mode === "save") details.push(" Save: u user · p project · r runtime");
		const reserved = Math.min(details.length, Math.max(0, bodyRows - 1));
		const available = Math.max(0, bodyRows - reserved);
		this.#offset = Math.max(0, Math.min(this.#offset, selectedRow));
		this.#offset = Math.max(this.#offset, selectedRow - available + 1);
		this.#offset = Math.max(0, Math.min(this.#offset, rows.length - available));
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => this.#host.binding(id);
		return {
			lines: [
				...rows.slice(this.#offset, this.#offset + available),
				...details.slice(0, reserved),
			].map((line) => truncateToWidth(line, Math.max(0, width), "…")),
			above: this.#offset,
			below: Math.max(0, rows.length - this.#offset - available),
			modal: this.#mode !== "list" || this.#saving,
			state: truncateToWidth(
				theme.fg("dim", `${hidden} hidden${this.#staged ? " · staged" : ""}`),
				Math.max(0, width),
				"…",
			),
			description: truncateToWidth(
				theme.fg(
					"muted",
					effect === undefined
						? "Default listed; last matching rule wins. # disables a rule."
						: `Rule ${this.#ruleSelected + 1} changes ${effect} model${effect === 1 ? "" : "s"}; last match wins.`,
				),
				Math.max(0, width - 1),
				"…",
			),
			hints:
				this.#mode === "edit"
					? [
							{ key: binding("tui.select.confirm"), action: "stage", priority: 0 },
							{ key: binding("tui.select.cancel"), action: "cancel", priority: 0 },
						]
					: this.#mode === "save"
						? [
								{ key: "u/p/r", action: "user/project/runtime", priority: 0 },
								{ key: binding("tui.select.cancel"), action: "cancel", priority: 1 },
							]
						: [
								{ key: "v", action: this.#view === "rules" ? "catalog" : "rules", priority: 0 },
								{ key: "ctrl+s", action: "save", priority: 1 },
								{
									key: `${binding("tui.select.up")}/${binding("tui.select.down")}`,
									action: "move",
									priority: 2,
								},
								...(this.#view === "rules"
									? [
											{
												key: `a/${binding("tui.select.confirm")}`,
												action: "add/edit",
												priority: 1,
											},
											{ key: "space/d", action: "toggle/delete", priority: 2 },
											{ key: "shift+↑/↓", action: "reorder", priority: 3 },
										]
									: [
											{ key: "h", action: "hide/show", priority: 1 },
											...(this.#deps.details
												? [{ key: binding("tui.select.confirm"), action: "detail", priority: 0 }]
												: []),
										]),
							],
		};
	}

	/** Prevents late save completions from redrawing a closed dashboard. */
	dispose(): void {
		this.#disposed = true;
		this.#detail?.dispose();
	}
}
