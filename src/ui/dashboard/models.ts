/** Staged model visibility rules and their catalog preview. */
import {
	decodeKittyPrintable,
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { SaveScope } from "../../core/config/index.ts";
import { formatSaveOutcome, type SaveOutcome } from "../../core/config/save.ts";
import type { ModelAlias } from "../../models/aliases/index.ts";
import type { OverrideEdit } from "../../models/overrides/index.ts";
import { exactModelRule } from "../../models/rules/match.ts";
import { type HintItem, sanitize } from "../frame/index.ts";
import { ModelDetail } from "./model-detail.ts";
import { ModelPicker } from "./model-picker.ts";
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
	save(rules: readonly string[], scope: SaveScope): Promise<SaveOutcome>;
	details?: {
		aliases?: {
			list(): readonly ModelAlias[];
			supported(provider: string): boolean;
			save(aliases: readonly ModelAlias[], scope: SaveScope): Promise<SaveOutcome>;
		};
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

interface Preview {
	rules: readonly string[];
	catalogVersion: number;
	outcomes: readonly RuleOutcome[];
	hidden: number;
	selection: number | undefined;
	effect: number | undefined;
}

function sameCatalogItem(left: ModelCatalogItem, right: ModelCatalogItem): boolean {
	return (
		left.provider === right.provider &&
		left.id === right.id &&
		left.name === right.name &&
		left.contextWindow === right.contextWindow &&
		left.maxTokens === right.maxTokens &&
		left.reasoning === right.reasoning &&
		left.api === right.api &&
		left.cost?.input === right.cost?.input &&
		left.cost?.output === right.cost?.output &&
		left.cost?.cacheRead === right.cost?.cacheRead &&
		left.cost?.cacheWrite === right.cost?.cacheWrite &&
		(left.input === right.input ||
			(left.input !== undefined &&
				right.input !== undefined &&
				left.input.length === right.input.length &&
				left.input.every((value, index) => value === right.input?.[index])))
	);
}

function sameRules(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((rule, index) => rule === right[index]);
}

function fitCatalogHints(hints: readonly HintItem[], width: number): HintItem[] {
	const ordered = hints.map((hint, index) => ({ hint, index }));
	ordered.sort((left, right) => left.hint.priority - right.hint.priority);
	const selected = new Set<number>();
	let used = 0;
	for (const { hint, index } of ordered) {
		if (!hint.key) continue;
		const space = visibleWidth(`${hint.key} ${hint.action}`) + (selected.size ? 3 : 0);
		if (used + space <= Math.max(0, width - 1)) {
			selected.add(index);
			used += space;
		}
	}
	return hints.filter((_, index) => selected.has(index));
}

function pickerBinding(keys: TabViewHost["keys"], data: string): boolean {
	return (
		keys.matches(data, "tui.select.cancel") ||
		keys.matches(data, "tui.select.confirm") ||
		keys.matches(data, "tui.select.up") ||
		keys.matches(data, "tui.select.down") ||
		keys.matches(data, "tui.select.pageUp") ||
		keys.matches(data, "tui.select.pageDown") ||
		keys.matches(data, "tui.input.tab") ||
		keys.matches(data, "tui.editor.cursorLeft") ||
		keys.matches(data, "tui.editor.cursorRight")
	);
}

/** A rules editor with a live catalog preview and explicit scoped saves. */
export class ModelsView implements TabView {
	readonly #host: TabViewHost;
	readonly #deps: ModelsTabDeps;
	readonly #picker: ModelPicker;
	readonly #input = new Input({ prompt: "", placeholder: "provider/model or !provider/model" });
	#staged: string[] | undefined;
	#view: "rules" | "catalog" = "rules";
	#mode: "list" | "edit" | "save" = "list";
	#editInitial = "";
	#ruleSelected = 0;
	#offset = 0;
	#adding = false;
	#message = "";
	#saving = false;
	#disposed = false;
	#detail: ModelDetail | undefined;
	#catalogSnapshot: readonly ModelCatalogItem[] = [];
	#catalogOrder: number[] = [];
	#catalogItems: ModelCatalogItem[] = [];
	#catalogVersion = 0;
	#preview: Preview | undefined;

	constructor(host: TabViewHost, deps: ModelsTabDeps) {
		this.#host = host;
		this.#deps = deps;
		this.#picker = new ModelPicker(
			host,
			() => this.#catalog(),
			(item) => {
				if (deps.details)
					this.#detail = new ModelDetail(host, deps.details, item, () => this.#closeDetail());
			},
			() => {
				this.#view = "rules";
				this.#offset = 0;
			},
			(_item, index) => (this.#preview?.outcomes[index]?.visible ? "listed" : "hidden"),
		);
	}

	/** Include staged rules, unfinished rule input and nested model drafts. */
	hasDrafts(): boolean {
		return (
			this.#staged !== undefined ||
			(this.#mode === "edit" && this.#input.getValue() !== this.#editInitial) ||
			(this.#detail?.hasDrafts() ?? false)
		);
	}

	/** Discard rules and nested model drafts without touching other tabs. */
	discardDrafts(): void {
		if (this.isSaving()) return;
		this.#staged = undefined;
		this.#detail?.discardDrafts();
		this.#mode = "list";
		this.#input.setValue("");
		this.#adding = false;
		this.#message = "";
	}

	/** Include saves owned by nested model and alias editors. */
	isSaving(): boolean {
		return this.#saving || (this.#detail?.isSaving() ?? false);
	}

	#closeDetail(): void {
		this.#detail?.dispose();
		this.#detail = undefined;
	}

	#rules(): readonly string[] {
		return this.#staged ?? this.#deps.rules();
	}

	#stage(rules: string[]): void {
		this.#staged = rules;
		this.#message = "";
	}

	#catalog(): ModelCatalogItem[] {
		const items = this.#deps.catalog();
		if (
			items.length !== this.#catalogSnapshot.length ||
			items.some((item, index) => {
				const previous = this.#catalogSnapshot[index];
				return previous === undefined || !sameCatalogItem(item, previous);
			})
		) {
			this.#catalogSnapshot = items.map((item) => ({
				...item,
				...(item.input ? { input: [...item.input] } : {}),
				...(item.cost ? { cost: { ...item.cost } } : {}),
			}));
			const groups = new Map<string, number[]>();
			for (const [index, item] of items.entries()) {
				const group = groups.get(item.provider);
				if (group) group.push(index);
				else groups.set(item.provider, [index]);
			}
			this.#catalogOrder = [...groups.values()].flat();
			this.#catalogItems.length = this.#catalogOrder.length;
			this.#catalogVersion++;
		}
		for (const [position, index] of this.#catalogOrder.entries()) {
			const item = items[index];
			if (item) this.#catalogItems[position] = item;
		}
		return this.#catalogItems;
	}

	#previewFor(rules: readonly string[], catalog: readonly ModelCatalogItem[]): Preview {
		let preview = this.#preview;
		const unchanged = preview !== undefined && sameRules(rules, preview.rules);
		if (!preview || !unchanged || preview.catalogVersion !== this.#catalogVersion) {
			const stableRules = unchanged && preview ? preview.rules : [...rules];
			let hidden = 0;
			const outcomes = catalog.map((item) => {
				const outcome = this.#deps.evaluate(stableRules, item.provider, item.id);
				if (!outcome.visible) hidden++;
				return outcome;
			});
			preview = {
				rules: stableRules,
				catalogVersion: this.#catalogVersion,
				outcomes,
				hidden,
				selection: undefined,
				effect: undefined,
			};
			this.#preview = preview;
		}
		if (
			this.#view === "rules" &&
			rules[this.#ruleSelected] !== undefined &&
			preview.selection !== this.#ruleSelected
		) {
			const beforeRule = preview.rules.slice(0, this.#ruleSelected);
			const throughRule = preview.rules.slice(0, this.#ruleSelected + 1);
			const before = catalog.map(
				(item) => this.#deps.evaluate(beforeRule, item.provider, item.id).visible,
			);
			let effect = 0;
			for (const [index, item] of catalog.entries()) {
				if (before[index] !== this.#deps.evaluate(throughRule, item.provider, item.id).visible)
					effect++;
			}
			preview.selection = this.#ruleSelected;
			preview.effect = effect;
		}
		return preview;
	}

	#edit(adding: boolean): void {
		this.#adding = adding;
		this.#input.setValue("");
		const value = adding ? "" : (this.#rules()[this.#ruleSelected] ?? "");
		this.#input.handleInput(`\x1b[200~${text(value)}\x1b[201~`);
		this.#editInitial = this.#input.getValue();
		this.#input.focused = true;
		this.#mode = "edit";
		this.#message = "";
	}

	async #save(scope: SaveScope): Promise<void> {
		const rules = this.#staged;
		if (!rules) return;
		this.#saving = true;
		try {
			const outcome = await this.#deps.save([...rules], scope);
			if (this.#disposed) return;
			if (outcome.committed) {
				this.#staged = undefined;
				this.#message = formatSaveOutcome(outcome);
			} else {
				this.#message = `Save failed: ${formatSaveOutcome(outcome)}`;
			}
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
		if (this.isSaving()) return true;
		if (this.#detail) {
			if (!this.#detail.handleInput(data)) this.#closeDetail();
			return true;
		}
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
		if (matchesKey(data, "ctrl+s") && !pickerBinding(keys, data)) {
			if (this.#staged) this.#mode = "save";
			else this.#message = "No staged changes to save";
			return true;
		}
		if (this.#view === "catalog") {
			if (this.#picker.isEditing() || this.#picker.isInspecting())
				return this.#picker.handleInput(data);
			if (cancel) return this.#picker.handleInput(data);
			if (
				keys.matches(data, "tui.input.tab") ||
				keys.matches(data, "tui.editor.cursorLeft") ||
				keys.matches(data, "tui.editor.cursorRight") ||
				matchesKey(data, "shift+tab")
			)
				return false;
			if (pickerBinding(keys, data)) return this.#picker.handleInput(data);
			const printable = decodeKittyPrintable(data) ?? data;
			if (printable === "v") {
				this.#view = "rules";
				this.#offset = 0;
				return true;
			}
			if (printable === "h") {
				const item = this.#picker.selected();
				if (item) {
					const rules = this.#rules();
					const catalog = this.#catalog();
					const index = catalog.findIndex(
						(model) => model.provider === item.provider && model.id === item.id,
					);
					const outcome = this.#previewFor(rules, catalog).outcomes[index];
					if (outcome)
						this.#stage([
							...rules,
							`${outcome.visible ? "" : "!"}${exactModelRule(item.provider, item.id)}`,
						]);
				}
				return true;
			}
			if (printable === "j" || printable === "k") {
				this.#picker.moveSelection(printable === "j" ? 1 : -1);
				return true;
			}
			return this.#picker.handleInput(data);
		}
		if (cancel) return false;
		if (
			keys.matches(data, "tui.input.tab") ||
			keys.matches(data, "tui.editor.cursorLeft") ||
			keys.matches(data, "tui.editor.cursorRight") ||
			matchesKey(data, "shift+tab")
		)
			return false;
		const rules = this.#rules();
		this.#ruleSelected = Math.max(0, Math.min(this.#ruleSelected, rules.length - 1));
		if (matchesKey(data, "shift+up") || matchesKey(data, "shift+down")) {
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
			this.#ruleSelected = Math.max(0, Math.min(rules.length - 1, this.#ruleSelected + delta));
			return true;
		}
		if (data === "v") {
			this.#view = "catalog";
			this.#offset = 0;
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
		this.#ruleSelected = Math.max(0, Math.min(this.#ruleSelected, rules.length - 1));
		const { hidden, effect } = this.#previewFor(rules, catalog);
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => this.#host.binding(id);
		if (this.#view === "catalog") {
			const details: string[] = [];
			if (this.#message) details.push(` ${theme.fg("warning", text(this.#message))}`);
			if (this.#mode === "save") details.push(" Save: u user · p project · r runtime");
			const reserved = Math.min(details.length, Math.max(0, bodyRows - 1));
			const body = this.#picker.render(width, Math.max(0, bodyRows - reserved));
			const active = !this.#picker.isEditing() && !this.#picker.isInspecting();
			// Leave room for the Models crumb and frame rules.
			const stateWidth = Math.max(0, width - 16);
			const baseState = `${this.#staged ? theme.fg("warning", "● ") : ""}${body.state ?? ""}`;
			const count = theme.fg("dim", ` · ${hidden} hidden`);
			const state =
				!this.#picker.isInspecting() && visibleWidth(baseState + count) <= stateWidth
					? baseState + count
					: baseState;
			return {
				...body,
				lines: [...body.lines, ...details.slice(0, reserved)].map((line) =>
					truncateToWidth(line, Math.max(0, width), "…"),
				),
				state: truncateToWidth(state, stateWidth, "…"),
				hints:
					this.#mode === "save"
						? [
								{ key: "u/p/r", action: "user/project/runtime", priority: 0 },
								{ key: binding("tui.select.cancel"), action: "cancel", priority: 1 },
							]
						: fitCatalogHints(
								[
									...body.hints.flatMap((hint) =>
										hint.action === "choose"
											? this.#deps.details
												? [{ ...hint, action: "detail", priority: 1 }]
												: []
											: [hint],
									),
									...(active
										? [
												...(!pickerBinding(this.#host.keys, "v")
													? [{ key: "v", action: "rules", priority: 0 }]
													: []),
												...(!pickerBinding(this.#host.keys, "h")
													? [{ key: "h", action: "hide/show", priority: 0 }]
													: []),
												{ key: binding("tui.input.tab"), action: "switch", priority: 1 },
											]
										: []),
									{ key: "ctrl+s", action: "save", priority: 1 },
								],
								width,
							),
			};
		}
		const rows: string[] = [` Rules · ${hidden} hidden${this.#staged ? " · ● staged" : ""}`];
		let selectedRow = 0;
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
		const details: string[] = [];
		if (this.#message) details.push(` ${theme.fg("warning", text(this.#message))}`);
		if (this.#mode === "save") details.push(" Save: u user · p project · r runtime");
		const reserved = Math.min(details.length, Math.max(0, bodyRows - 1));
		const available = Math.max(0, bodyRows - reserved);
		this.#offset = Math.max(0, Math.min(this.#offset, selectedRow));
		this.#offset = Math.max(this.#offset, selectedRow - available + 1);
		this.#offset = Math.max(0, Math.min(this.#offset, rows.length - available));
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
								{ key: "v", action: "catalog", priority: 0 },
								{ key: "ctrl+s", action: "save", priority: 1 },
								{
									key: `${binding("tui.select.up")}/${binding("tui.select.down")}`,
									action: "move",
									priority: 2,
								},
								{ key: `a/${binding("tui.select.confirm")}`, action: "add/edit", priority: 1 },
								{ key: "space/d", action: "toggle/delete", priority: 2 },
								{ key: "shift+↑/↓", action: "reorder", priority: 3 },
							],
		};
	}

	/** Prevents late save completions from redrawing a closed dashboard. */
	dispose(): void {
		this.#disposed = true;
		this.#detail?.dispose();
	}
}
